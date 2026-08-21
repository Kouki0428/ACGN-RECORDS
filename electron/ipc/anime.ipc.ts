import electron from 'electron'
const { ipcMain } = electron
import { getDb } from '../services/db/connection'
import { upsertSubject, findCached } from '../services/db/repositories/subjects.repository'
import { loadSubjectMeta, refreshSubjectMeta } from '../services/db/repositories/subjectMeta'
import { loadSubjectExtra } from '../services/db/repositories/subjectExtra.repository'
import {
  ensureLocalAccount,
  getOrCreateCollection,
  updateEpStatus
} from '../services/db/repositories/collections.repository'
import { listEpisodes, ensureMockEpisodes } from '../services/db/repositories/episodes.repository'
import { upsertEpisodes, getCachedEpisodes } from '../services/db/repositories/episodesCache.repository'
import {
  setWatched,
  setWant,
  setWatchedUpTo,
  setDropped,
  clearEpisode,
  getProgressEntry,
  listProgressFull,
  countWatched,
  applyRemoteEpisodeProgress
} from '../services/db/repositories/episode_progress.repository'
import { enrichSummary } from '../services/subjectSummary'
import { resolveRatingDistribution } from '../services/ratingDistribution'
import { resolveRank, updateRankOnline } from '../services/subjectRank'
import { getEpisodes, setEpisodeStatusOnBgm, mapWithConcurrency } from '../services/api/bangumi'
import { getValidToken } from '../services/auth/oauth'
import type { Subject, SubjectFullEpisode, EpisodeMarkPayload } from '../../shared/types'

/** 取作品本地详情核心逻辑（不联网）：供单条与批量通道复用。 */
async function getAnimeDetailLocalById(subjectId: number) {
  const db = await getDb()
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(subjectId)
  if (!subject) return { subject: null, collection: null, episodes: [], progress: {}, characters: [], relations: [] }
  const collection = db
    .prepare('SELECT * FROM collections WHERE subject_id = ? ORDER BY id DESC LIMIT 1')
    .get(subjectId)
  const episodes = await listEpisodes(subjectId)
  const progress = collection ? await listProgressFull(collection.id) : {}
  const { tags, meta, rating, metaTags } = await loadSubjectMeta(subject)
  subject.tags = tags
  subject.meta = meta
  subject.metaTags = metaTags
  if (typeof rating === 'number') subject.rating = rating
  // 评分分布：优先 Archive 离线库，fallback 主库缓存（不联网）
  await resolveRatingDistribution(subject)
  // 站点排名：优先 Archive 离线库（不联网）
  await resolveRank(subject)
  // 瞬时真实剧集：优先读本地缓存（subject_episodes），不联网即可显示真实集号/标题/首播/时长
  const pidLocal = (subject as any).provider_subject_id as string | undefined
  const bangumiEpisodes = pidLocal ? await getCachedEpisodes(pidLocal) : []
  // 本地优先通道：角色/关联先用「本地缓存 + 离线 Archive 兜底」即时返回（online:false 不联网），
  // 与书籍通道（getSubjectDetailLocal）一致，避免动画作品首屏因本地缓存为空而转圈等网络。
  // Archive 角色覆盖不全（部分条目 arc_subject_characters 为空），这类仍由在线 anime:getDetail 补全。
  const extraLocal = await loadSubjectExtra(subject, undefined, { online: false })
  return {
    subject,
    collection: collection ?? null,
    episodes,
    bangumiEpisodes,
    progress,
    characters: extraLocal.characters,
    relations: extraLocal.relations
  }
}

export function registerAnimeIpc(): void {
  // 添加到「在看」：缓存作品 → 取/建本地收藏(status=3) → 确保剧集存在
  ipcMain.handle('anime:addToWatching', async (_event, subject: Subject) => {
    await upsertSubject(subject)
    const cached = await findCached(subject.provider, subject.providerSubjectId)
    if (!cached) throw new Error('作品缓存失败')
    const accountId = await ensureLocalAccount()
    const collectionId = await getOrCreateCollection(accountId, cached.id, 3)
    // 真实剧集数据应来自 Bangumi getEpisodes；MVP 阶段按 totalEpisodes 生成占位
    await ensureMockEpisodes(cached.id, subject.totalEpisodes ?? 12)
    return { collectionId, subjectId: cached.id as number }
  })

  // 取作品本地详情（不联网）：直接返回已缓存的评分/标签/制作信息 + 剧集/进度 + 角色/关联作品，供「本地优先」即时展示
  ipcMain.handle('anime:getDetailLocal', async (_event, subjectId: number) => {
    return getAnimeDetailLocalById(subjectId)
  })

  // 批量取本地详情（主页动画卡片一次 IPC 拿全部，替代逐卡 N 次 invoke）：
  // 单条失败返回空骨架（subject:null），不影响其余；顺序与入参 ids 一一对应。
  ipcMain.handle('anime:getDetailsLocal', async (_event, ids: number[]) => {
    const empty = { subject: null, collection: null, episodes: [], progress: {}, characters: [], relations: [] }
    if (!Array.isArray(ids) || ids.length === 0) return []
    const results = await Promise.all(
      ids.map((id) =>
        getAnimeDetailLocalById(Number(id)).catch((e) => {
          console.warn('[anime:getDetailsLocal] 单条加载失败（已跳过）：', e)
          return empty
        })
      )
    )
    return results
  })

  // 取作品详情：作品 + 收藏 + 剧集 + 逐集进度 + 标签/制作信息 + 角色/关联作品（按需在线补全并缓存）
  ipcMain.handle('anime:getDetail', async (event, subjectId: number) => {
    const db = await getDb()
    const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(subjectId)
    if (!subject) return { subject: null, collection: null, episodes: [], progress: {}, characters: [], relations: [] }
    let collection = db
      .prepare('SELECT * FROM collections WHERE subject_id = ? ORDER BY id DESC LIMIT 1')
      .get(subjectId)
    const episodes = await listEpisodes(subjectId)
    let progress = collection ? await listProgressFull(collection.id) : {}
    // 本地无逐集进度且已登录时，拉取 Bangumi 上已有的单集标记合并进来（best-effort，失败忽略）。
    // 这样详情页打开即显示「在 Bangumi 网页/其它端标记过的单集状态」，无需手动重新标记。
    if (collection) {
      const token = await getValidToken()
      if (token && Object.keys(progress).length === 0) {
        const pid = (subject as any).provider_subject_id as string | undefined
        if (pid) {
          try {
            const marks = await getEpisodeProgress(String(pid), token)
            if (Object.keys(marks).length) {
              await applyRemoteEpisodeProgress(collection.id, marks)
              progress = await listProgressFull(collection.id)
            }
          } catch (e) {
            console.warn('[anime:getDetail] 拉取 Bangumi 单集标记失败（忽略）：', e)
          }
        }
      }
    }
    // 简介优先：最先取（联网→离线 Archive 兜底），取到即通过事件流式推前端，
    // 不等后面的角色/关联加载，避免「要等角色中文名跑完才显示 / 加载失败则整条丢失」。
    await enrichSummary(event, subject)
    const { tags, meta, rating, metaTags } = await loadSubjectMeta(subject)
    subject.tags = tags
    subject.meta = meta
    subject.metaTags = metaTags
    if (typeof rating === 'number') subject.rating = rating
    // 后台联网补全：已登录才取权威标签/制作信息/评分，取到即推前端置换离线 Archive 填充（未登录保留离线数据）
    void refreshSubjectMeta(event, subject)
    // 实时拉取 Bangumi 上的「我的评价」，合并进收藏（本地无未推送改动时以远端为准）
    const { resolveMyRating } = await import('../services/myRating')
    const myRate = await resolveMyRating(subject, collection)
    if (myRate != null) {
      collection = collection ?? {}
      collection.rating = myRate
    }
    // 评分分布（1–10 星票数）合并进 subject，供详情页右侧柱状图
    // 优先用 Archive 离线库缓存（立即有数据），再联网更新写回 Archive（主库兜底）
    try {
      const { resolveRatingDistribution, updateRatingDistributionOnline } = await import(
        '../services/ratingDistribution'
      )
      await resolveRatingDistribution(subject)
      await updateRatingDistributionOnline(subject)
      // 站点排名：先用 Archive 离线值即时显示，再联网刷新写回
      await resolveRank(subject)
      await updateRankOnline(subject)
    } catch (e) {
      console.warn('[anime:getDetail] 评分分布获取失败（忽略）：', e)
    }
    // 角色/关联条目补全：失败也不影响详情主体（简介/标签/剧集已就绪），仅该部分缺数据。
    let characters: any[] = []
    let relations: any[] = []
    try {
      const extra = await loadSubjectExtra(subject, (chunk) =>
        event.sender.send('subjectExtra:cnUpdated', chunk)
      )
      characters = extra.characters
      relations = extra.relations
    } catch (e) {
      console.warn('[anime:getDetail] 角色/关联补全失败（其余展示不受影响）：', e)
    }
    // 真实剧集（Bangumi 正片）：仅用于显示增强（真实集号/标题/首播/时长），按位置对应本地库剧集；
    // 失败不影响详情主体（本地占位剧集已就绪，可正常点格子记进度）。
    let bangumiEpisodes: SubjectFullEpisode[] = []
    try {
      const pid = (subject as any).provider_subject_id
      if (pid) bangumiEpisodes = await getEpisodes(String(pid))
      else console.warn('[anime:getDetail] 无 provider_subject_id，跳过剧集抓取')
    } catch {
      bangumiEpisodes = []
    }
    // 抓到的真实剧集写回本地缓存（供悬浮窗/详情页瞬时读取，避免重复联网）
    try {
      const pid = (subject as any).provider_subject_id
      if (pid && bangumiEpisodes.length) await upsertEpisodes(String(pid), bangumiEpisodes)
    } catch (e) {
      console.warn('[anime:getDetail] 剧集缓存写回失败（忽略）：', e)
    }
    console.log(`[anime:getDetail] subject=${subject?.id} provider_subject_id=${subject?.provider_subject_id} 剧集数=${bangumiEpisodes.length}`)
    // 末态重新读取逐集进度：捕获并行 pullEpisodeProgress(force) 已写入的 Bangumi 对比结果，
    // 避免返回「打开瞬间 pull 尚未完成」时的旧本地快照（本地已有进度时 getDetail 早期不会重拉）。
    if (collection && (collection as any).id) {
      progress = await listProgressFull((collection as any).id)
    }
    return { subject, collection: collection ?? null, episodes, bangumiEpisodes, progress, characters, relations }
  })

  // 标记单集状态：看过 / 看到（含之前全部）/ 想看 / 抛弃 / 撤销。
  // 返回更新后的完整进度映射（episodeId -> {watched,want,dropped}）与已看集数，供前端即时着色。
  // 本地更新后 best-effort 同步到 Bangumi（需登录令牌）。
  ipcMain.handle(
    'anime:setEpisodeStatus',
    async (_event, collectionId: number, payload: EpisodeMarkPayload) => {
      const { action, episodeId, upToIds } = payload

      // 计算需同步到 Bangumi 的受影响单集及目标状态（EpisodeCollectionType: 2=看过 / 1=想看 / 3=抛弃 / 0=撤销）
      const affected: { id: number; type: number }[] = []
      if (upToIds && upToIds.length > 0) {
        // 「看到」：把当前集及之前所有集标记为已看
        await setWatchedUpTo(collectionId, upToIds)
        for (const eid of upToIds) affected.push({ id: eid, type: 2 })
      } else if (action === 'watched') {
        const cur = await getProgressEntry(collectionId, episodeId)
        const next = !cur.watched
        await setWatched(collectionId, episodeId, next)
        affected.push({ id: episodeId, type: next ? 2 : 0 })
      } else if (action === 'want') {
        const cur = await getProgressEntry(collectionId, episodeId)
        const next = !cur.want
        await setWant(collectionId, episodeId, next)
        affected.push({ id: episodeId, type: next ? 1 : 0 })
      } else if (action === 'drop') {
        // 抛弃：真实 Bangumi 状态 type=3（不再是「清除」），本地记 dropped
        await setDropped(collectionId, episodeId, true)
        affected.push({ id: episodeId, type: 3 })
      } else if (action === 'undo') {
        // 撤销：清除该集所有标记（回到未标记），Bangumi type=0
        await clearEpisode(collectionId, episodeId)
        affected.push({ id: episodeId, type: 0 })
      }

      // best-effort 同步到 Bangumi（失败不影响本地；未登录则跳过）
      const token = await getValidToken()
      if (token && affected.length) {
        const valid = affected.filter((a) => a.id > 0)
        if (valid.length) {
          try {
            await mapWithConcurrency(valid, 5, (a) => setEpisodeStatusOnBgm(a.id, a.type, token))
          } catch (e) {
            console.warn('[anime:setEpisodeStatus] 同步 Bangumi 单集状态失败（本地已保存）：', e)
          }
        }
      }

      const progress = await listProgressFull(collectionId)
      const epStatus = await countWatched(collectionId)
      await updateEpStatus(collectionId, epStatus)
      return { progress, epStatus }
    }
  )

  // 按状态列出动画收藏（status 默认 3 = 在看；1 想看 / 2 看过 / 4 搁置 / 5 抛弃）
  ipcMain.handle('anime:listWatching', async (_event, status = 3) => {
    const db = await getDb()
    return db
      .prepare(
        `SELECT c.id AS collectionId, c.subject_id AS subjectId, c.ep_status AS epStatus, c.status AS status,
                s.provider_subject_id AS providerSubjectId,
                s.title, s.title_cn AS titleCn, s.image_url AS imageUrl, s.total_episodes AS totalEpisodes,
                c.rating AS rating, c.local_updated_at AS markedAt, s.rating AS siteRating
         FROM collections c
         JOIN subjects s ON s.id = c.subject_id
         WHERE c.status = ? AND s.category = 'anime'
         ORDER BY c.local_updated_at DESC`
      )
      .all(status)
  })

  // 动画统计：在看部数 + 总观看集数
  ipcMain.handle('anime:getStats', async () => {
    const db = await getDb()
    const watching = db
      .prepare(
        `SELECT COUNT(*) AS n FROM collections c
         JOIN subjects s ON s.id = c.subject_id
         WHERE c.status = 3 AND s.category = 'anime'`
      )
      .get()
    const watched = db.prepare('SELECT COUNT(*) AS n FROM episode_progress WHERE watched = 1').get()
    return { watching: (watching as any).n, watched: (watched as any).n }
  })
}
