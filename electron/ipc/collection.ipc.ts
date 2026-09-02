import electron from 'electron'
const { ipcMain } = electron
import { getDb } from '../services/db/connection'
import { upsertSubject, findCached, importSubject } from '../services/db/repositories/subjects.repository'
import { loadSubjectMeta, refreshSubjectMeta } from '../services/db/repositories/subjectMeta'
import { loadSubjectExtra } from '../services/db/repositories/subjectExtra.repository'
import { reclassifyBooks } from '../services/db/repositories/subjects.repository'
import { enrichSummary } from '../services/subjectSummary'
import { resolveRatingDistribution } from '../services/ratingDistribution'
import { resolveRank, updateRankOnline } from '../services/subjectRank'
import { resolveScore, updateScoreOnline } from '../services/subjectScore'
import { getSubjectDetailLocal } from '../services/subjectDetailLocal'
import {
  ensureLocalAccount,
  getOrCreateCollection,
  updateEpStatus,
  updateVolStatus,
  updateEpStatusLocal,
  updateVolStatusLocal,
  setCollectionStatus,
  setRatingByProviderSubjectId,
  clearDirty,
  saveCollectionFull,
  updateCollectionRating,
  getCollectionExistingBySubject,
  deleteCollectionFullBySubject,
  getSubjectTopTags,
  setCollectionTags,
  getUserStats
} from '../services/db/repositories/collections.repository'
import { getRoutes, addRoute, updateRoute, deleteRoute } from '../services/db/repositories/routes.repository'
import { updateCollection, deleteCollectionOnBgm, COLLECTION_TYPE_BY_STATUS, getSubjectDetail, getSubjectFull } from '../services/api/bangumi'
import { getBangumiAccount, getValidToken } from '../services/auth/oauth'
import type { Subject, Category, SaveCollectionPayload } from '../../shared/types'

/**
 * 通用收藏服务：轻小说 / 漫画 / Galgame / 游戏 复用同一套 collections 仓储。
 * 与动画模块的区别：进度是「单数字」（卷 / 话 / 路线数 / 状态），而非逐集点格子。
 * 任何进度变更都会置 dirty=1，等待 Bangumi 同步。
 */
export function registerCollectionIpc(): void {
  // 添加到列表（在读/在看/在玩，默认 status=3）：缓存作品 → 取/建本地收藏
  ipcMain.handle('collection:add', async (_event, subject: Subject, status = 3) => {
    await upsertSubject(subject)
    const cached = await findCached(subject.provider, subject.providerSubjectId)
    if (!cached) throw new Error('作品缓存失败')
    const accountId = await ensureLocalAccount()
    const collectionId = await getOrCreateCollection(accountId, cached.id, status)
    return { collectionId, subjectId: cached.id as number }
  })

  // 取作品本地详情（不联网）：直接返回已缓存的评分/标签/制作信息 + 角色/关联作品，供「本地优先」即时展示
  ipcMain.handle('collection:detailLocal', async (_event, subjectId: number) => {
    return getSubjectDetailLocal(subjectId, false)
  })

  // 取作品详情：作品 + 收藏（含当前进度）+ 标签/制作信息 + 角色/关联作品（按需在线补全并缓存）
  ipcMain.handle('collection:detail', async (event, subjectId: number) => {
    const db = await getDb()
    const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(subjectId)
    if (!subject) return { subject: null, collection: null, characters: [], relations: [] }
    // series 标志位归一成布尔（DB 存 INTEGER 0/1，null=未获取）；书籍且未获取时联网补一次并写回
    if (subject.series != null) {
      subject.series = !!subject.series
    } else if (subject.category === 'manga' || subject.category === 'light_novel') {
      try {
        const bd = await getSubjectDetail(String(subject.provider_subject_id))
        if (typeof bd?.series === 'boolean') {
          subject.series = bd.series
          db.prepare('UPDATE subjects SET series = ? WHERE id = ?').run(bd.series ? 1 : 0, subject.id)
        }
      } catch (e) {
        console.warn('[detail] 获取 series 失败（忽略）：', e)
      }
    }
    let collection = db
      .prepare('SELECT * FROM collections WHERE subject_id = ? ORDER BY id DESC LIMIT 1')
      .get(subjectId)
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
    // 站点均分：主库无值时回退 Archive 离线库（全量 dump 自带，离线即可读），详情秒开不转圈
    await resolveScore(subject)
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
      // 站点均分：联网刷新并写回 Archive 离线库（与分布/排名同通道、容错）
      await updateScoreOnline(subject)
    } catch (e) {
      console.warn('[detail] 评分分布获取失败（忽略）：', e)
    }
    // 角色/关联条目补全：失败也不影响详情主体（简介/标签已就绪），仅该部分缺数据。
    let characters: any[] = []
    let relations: any[] = []
    try {
      const extra = await loadSubjectExtra(subject, (chunk) =>
        event.sender.send('subjectExtra:cnUpdated', chunk)
      )
      characters = extra.characters
      relations = extra.relations
    } catch (e) {
      console.warn('[detail] 角色/关联补全失败（其余展示不受影响）：', e)
    }
    return { subject, collection: collection ?? null, characters, relations }
  })

  // 设置当前进度（如「已读第 X 话/章」或「已读第 X 卷」）：写入对应列并标记 dirty。
  // kind 默认 'ep'（话/章），'vol' 写卷数。回读两者当前值返回，供前端同步双进度。
  ipcMain.handle(
    'collection:setProgress',
    async (_event, collectionId: number, value: number, kind?: 'ep' | 'vol', localOnly?: boolean) => {
      const v = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
      const db = await getDb()
      const cur = db
        .prepare('SELECT ep_status, vol_status FROM collections WHERE id = ?')
        .get(collectionId) as { ep_status: number; vol_status: number } | undefined
      const epStatus = cur?.ep_status ?? 0
      const volStatus = cur?.vol_status ?? 0
      if (kind === 'vol') {
        if (localOnly) await updateVolStatusLocal(collectionId, v)
        else await updateVolStatus(collectionId, v)
        return { epStatus, volStatus: v }
      }
      if (localOnly) await updateEpStatusLocal(collectionId, v)
      else await updateEpStatus(collectionId, v)
      return { epStatus: v, volStatus }
    }
  )

  // 更改收藏状态（想玩/在玩/已通关/搁置/抛弃）：通用收藏模块使用，标记 dirty
  ipcMain.handle('collection:setStatus', async (_event, collectionId: number, status: number) => {
    await setCollectionStatus(collectionId, status)
    return { status }
  })

  // 设置「我的评价」评分并同步到 Bangumi：本地写库（取/建收藏）→ 立即推送 rate，失败保留 dirty 待重试
  ipcMain.handle(
    'collection:setRating',
    async (_event, providerSubjectId: string, rating: number) => {
      const { collectionId, status } = await setRatingByProviderSubjectId(
        providerSubjectId,
        rating
      )
      const acct = await getBangumiAccount()
      let synced = false
      let error: string | undefined
      if (acct) {
        const token = await getValidToken()
        if (token) {
          try {
            // Bangumi 用户评分字段名为 rate（整数 1-10）
            await updateCollection(providerSubjectId, { rate: rating, type: status }, token)
            await clearDirty(collectionId)
            synced = true
          } catch (e) {
            error = e instanceof Error ? e.message : String(e)
          }
        } else {
          error = 'Bangumi 授权已失效，评分已保存到本地，重新登录后将自动同步'
        }
      } else {
        error = '未登录 Bangumi，评分已保存到本地'
      }
      return { ok: true, synced, error, collectionId }
    }
  )

  // 列表（按分类 + 状态过滤，默认在看/在读/在玩=3）
  ipcMain.handle('collection:list', async (_event, category: Category, status: number) => {
    const db = await getDb()
    const rows = db
      .prepare(
        `SELECT c.id AS collectionId, c.subject_id AS subjectId, c.ep_status AS epStatus,
                c.vol_status AS volStatus, c.status AS status,
                s.title, s.title_cn AS titleCn, s.image_url AS imageUrl,
                s.total_volumes AS totalVolumes, s.total_episodes AS totalEpisodes,
                s.series AS series, s.provider_subject_id AS providerSubjectId,
                c.rating AS rating, c.local_updated_at AS markedAt, s.rating AS siteRating,
                s.nsfw AS nsfw
         FROM collections c
         JOIN subjects s ON s.id = c.subject_id
         WHERE c.status = ? AND s.category = ?
         ORDER BY c.local_updated_at DESC`
      )
      .all(status, category) as any[]

    // 书籍且 series 为空：联网补一次写回本地（并发 6），避免列表与详情判定不一致
    const isBook = category === 'manga' || category === 'light_novel'
    if (isBook) {
      const need = rows.filter((r) => r.series == null && r.providerSubjectId)
      if (need.length) {
        let cursor = 0
        const worker = async () => {
          while (cursor < need.length) {
            const r = need[cursor++]
            try {
              const bd = await getSubjectDetail(String(r.providerSubjectId))
              if (typeof bd?.series === 'boolean') {
                r.series = bd.series
                db.prepare('UPDATE subjects SET series = ? WHERE id = ?').run(bd.series ? 1 : 0, r.subjectId)
              }
            } catch (e) {
              console.warn('[list] 补 series 失败（忽略）：', e)
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(6, need.length) }, worker))
      }
    }

    return rows.map((r) => {
      // providerSubjectId 现为公开字段（右键菜单「在 Bangumi 打开」/删除收藏需要），不再剥离
      const { series } = r
      return { ...r, series: series == null ? null : !!series }
    })
  })

  // 统计（某分类下的在看部数 + 累计进度之和）
  ipcMain.handle('collection:stats', async (_event, category: Category) => {
    const db = await getDb()
    const watching = db
      .prepare(
        `SELECT COUNT(*) AS n FROM collections c
         JOIN subjects s ON s.id = c.subject_id
         WHERE c.status = 3 AND s.category = ?`
      )
      .get(category)
    const total = db
      .prepare(
        `SELECT COALESCE(SUM(c.ep_status), 0) AS n FROM collections c
         JOIN subjects s ON s.id = c.subject_id
         WHERE s.category = ?`
      )
      .get(category)
    return { watching: (watching as any).n, totalProgress: (total as any).n }
  })

  // 按 API 的 platform 字段重新判定本地书籍分类（轻小说 / 漫画），写回变更结果
  ipcMain.handle('collection:reclassifyBooks', async () => {
    return await reclassifyBooks()
  })

  // 个人页统计悬浮窗：本地收藏聚合统计
  ipcMain.handle('collection:userStats', async () => {
    return await getUserStats()
  })

  // 统计历史趋势：当月快照（缺失则补记）+ 近 N 月历史
  ipcMain.handle('collection:snapshotHistory', async (_event, limit = 12) => {
    const { recordMonthlySnapshotIfAbsent, getSnapshotHistory } = await import(
      '../services/db/repositories/statsSnapshots.repository'
    )
    try {
      await recordMonthlySnapshotIfAbsent()
    } catch (e) {
      console.warn('[collection:snapshotHistory] 记录当月快照失败（忽略）：', e)
    }
    return await getSnapshotHistory(limit)
  })

  // 新建 / 更新收藏（收藏悬浮窗「保存」）：写本地库（含吐槽 / 仅自己可见 / 我的前 10 tag），
  // 已登录则同步到 Bangumi（含 tags + private）。本地必定成功，同步失败仅保留 dirty 待重试。
  ipcMain.handle('collection:saveCollection', async (_event, payload: SaveCollectionPayload) => {
    const { providerSubjectId, status, comment, private: privateFlag, rating } = payload
    let cached = await findCached('bangumi', providerSubjectId)
    // 兜底收编：卡片打开时后台 importSubject 可能因竞态/异常未落库（作品尚未进本地 subjects 表），
    // 此时重新抓取并收编进本地库，避免「作品未缓存，无法收藏」。已登录才走联网抓取，失败则回退原错误。
    if (!cached) {
      try {
        const token = await getValidToken()
        const detail = await getSubjectFull(String(providerSubjectId), token ?? undefined)
        const s = detail?.subject
        if (s && s.id) {
          const subj: Subject = {
            provider: 'bangumi',
            providerSubjectId: String(s.id),
            category: s.category,
            title: s.title || '',
            titleCn: s.title_cn || undefined,
            summary: s.summary || undefined,
            imageUrl: s.image_url || undefined,
            airDate: s.air_date ?? undefined,
            totalEpisodes: s.total_episodes ?? undefined,
            totalVolumes: s.total_volumes ?? undefined,
            series: s.series,
            rating: typeof s.rating === 'number' ? s.rating : undefined
          }
          await importSubject(subj)
          cached = await findCached('bangumi', providerSubjectId)
        }
      } catch (e) {
        console.warn('[collection:saveCollection] 兜底收编失败（回退原错误）：', e)
      }
    }
    if (!cached) throw new Error('作品未缓存，无法收藏')
    const accountId = await ensureLocalAccount()
    const collectionId = await getOrCreateCollection(accountId, cached.id, status)
    await saveCollectionFull(collectionId, status, comment ?? null, !!privateFlag)
    // 「我的评价」评分：rating 为 undefined 表示不改动（沿用已有评分）；
    // 为 number 则写入该分数；为 null 则清除评分。
    if (rating !== undefined) {
      await updateCollectionRating(collectionId, rating ?? null)
    }
    // 我的 tag：自动取该作品前 10 个 Bangumi tag（按标记次数降序）
    const tags = await getSubjectTopTags(providerSubjectId, 10)
    await setCollectionTags(collectionId, tags)
    const acct = await getBangumiAccount()
    if (acct) {
      const token = await getValidToken()
      if (token) {
        try {
          const updatePayload: {
            type: number
            comment?: string
            private: boolean
            tags: string[]
            rate?: number
          } = {
            type: COLLECTION_TYPE_BY_STATUS[status] ?? status,
            comment: comment || undefined,
            private: !!privateFlag,
            tags
          }
          // 评分随收藏原子上传：rate=0 表示清除 Bangumi 上的评分
          if (rating !== undefined) updatePayload.rate = rating ?? 0
          await updateCollection(providerSubjectId, updatePayload, token)
          await clearDirty(collectionId)
        } catch (e) {
          // 本地已保存，同步失败仅记录，待自动同步重试
          console.warn('[collection:saveCollection] Bangumi 同步失败（本地已保存）：', e)
        }
      }
    }
    return { collectionId, subjectId: cached.id as number }
  })

  // 删除收藏（收藏悬浮窗「删除」）：删本地收藏行 + 联结 tag，已登录则同步删除 Bangumi 收藏。
  // 本地必定成功，同步失败仅记录（本地已删，不影响使用）。
  ipcMain.handle('collection:deleteCollection', async (_event, providerSubjectId: string) => {
    if (!providerSubjectId) throw new Error('缺少作品 id')
    await deleteCollectionFullBySubject(providerSubjectId)
    const acct = await getBangumiAccount()
    if (acct) {
      const token = await getValidToken()
      if (token) {
        try {
          await deleteCollectionOnBgm(providerSubjectId, token)
        } catch (e) {
          console.warn('[collection:deleteCollection] Bangumi 删除失败（本地已删）：', e)
        }
      }
    }
    return { ok: true as const }
  })

  // 查询某作品是否已收藏（返回 status + 吐槽），供详情页 / 悬浮窗渲染标签或「我想X这Y」文字。
  ipcMain.handle('collection:getExisting', async (_event, providerSubjectId: string) => {
    if (!providerSubjectId) return { status: null, comment: null }
    const existing = await getCollectionExistingBySubject(providerSubjectId)
    // 本地无吐槽时，实时拉取 Bangumi 网页端写的吐槽并回填（与网页端评分 resolveMyRating 同模式）
    if (!existing.comment) {
      try {
        const { resolveMyComment } = await import('../services/myRating')
        const comment = await resolveMyComment(
          { provider: 'bangumi', provider_subject_id: providerSubjectId },
          existing.comment
        )
        if (comment) existing.comment = comment
      } catch (e) {
        console.warn('[getExisting] 拉取网页端吐槽失败（忽略）：', e)
      }
    }
    return existing
  })

  // 通关路线（Galgame）：取 / 增 / 改 / 删。路线条数由业务层同步写入 collections.ep_status。
  ipcMain.handle('collection:routes', async (_event, collectionId: number) => {
    return getRoutes(collectionId)
  })
  ipcMain.handle('collection:routeAdd', async (_event, collectionId: number, name: string) => {
    const id = await addRoute(collectionId, name ?? '')
    return { id }
  })
  ipcMain.handle('collection:routeUpdate', async (_event, id: number, name: string) => {
    await updateRoute(id, name ?? '')
    return { ok: true as const }
  })
  ipcMain.handle('collection:routeDelete', async (_event, id: number) => {
    await deleteRoute(id)
    return { ok: true as const }
  })
}
