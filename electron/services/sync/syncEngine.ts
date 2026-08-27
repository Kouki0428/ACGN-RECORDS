import type { SyncResult, Category } from '../../../../shared/types'
import {
  getBangumiAccount,
  getValidToken
} from '../auth/oauth'
import {
  ensureLocalAccount,
  getDirtyCollectionsForSync,
  clearDirty,
  upsertCollectionFromBangumi,
  logSync,
  getCollectionsForCompare,
  deleteUnsyncedBangumiCollections,
  findLocalCollectionByProviderSubjectId
} from '../db/repositories/collections.repository'
import { importSubject } from '../db/repositories/subjects.repository'
import {
  reconcileRemoteEpisodeProgress,
  clearAllEpisodeProgress,
  listProgressFull
} from '../db/repositories/episode_progress.repository'
import {
  getMyCollections,
  getEpisodeProgress,
  updateCollection,
  getMe,
  getSubjectDetail,
  analyzeBook,
  setEpisodeStatusOnBgm,
  mapWithConcurrency,
  COLLECTION_TYPE_BY_STATUS,
  toSubject,
  BGM_TYPE_TO_CATEGORY
} from '../api/bangumi'
import { markProgressPulled } from '../progressGuard'

/** 将 Bangumi 返回的 ISO 时间字符串解析为 Unix 秒；无法解析时返回 undefined（由本地 now 兜底）。 */
function parseBgmUpdatedAt(v: any): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v
  if (typeof v !== 'string' || !v) return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined
}

/** 低于此阈值视为 Bangumi 的零值/无效 updated_at（如 0000-00-00 或公元元年），不应当作真实标记时间。 */
const MARK_TIME_FLOOR = 1104537600 // 2005-01-01
/**
 * 计算一条收藏的“最后标记时间”排序键：
 * - 若 Bangumi 返回有效 updated_at（>2005），用真实时间；
 * - 否则（零值/从未更新过的收藏）用「列表返回顺序」兜底：order 越小（越先返回）ts 越大，
 *   使这些收藏排在真实标记时间之后，且彼此按 Bangumi 返回顺序（通常即更新时间倒序）排列。
 */
function resolveMarkTime(item: any, order: number): number {
  const real = parseBgmUpdatedAt(item?.updated_at)
  if (real !== undefined && real > MARK_TIME_FLOOR) return real
  return MARK_TIME_FLOOR - order
}

const PULL_PAGE = 30

// ===== 同步引擎状态（供侧栏指示灯等 UI 订阅）=====
export type SyncPhase = 'idle' | 'running' | 'ok' | 'error'
export type SyncKind = 'push' | 'pull' | 'full' | 'both'
export interface SyncEngineState {
  phase: SyncPhase
  kind: SyncKind | null
  finishedAt: number | null
  /** 最近一次失败的摘要（phase==='error' 时有值） */
  error: string | null
}

let syncState: SyncEngineState = { phase: 'idle', kind: null, finishedAt: null, error: null }
const stateListeners = new Set<(s: SyncEngineState) => void>()
const runningKinds = new Set<SyncKind>()

function deriveKind(): SyncKind | null {
  const has = (k: SyncKind) => runningKinds.has(k)
  if (has('push') && (has('pull') || has('full'))) return 'both'
  if (has('push')) return 'push'
  if (has('full')) return 'full'
  if (has('pull')) return 'pull'
  return null
}

function emitState() {
  for (const l of stateListeners) {
    try {
      l(syncState)
    } catch {
      /* 监听器异常不影响同步 */
    }
  }
}

/** 订阅同步状态变化；返回取消订阅函数（main.ts 桥接到渲染进程）。 */
export function onSyncState(cb: (s: SyncEngineState) => void): () => void {
  stateListeners.add(cb)
  return () => {
    stateListeners.delete(cb)
  }
}

export function getSyncState(): SyncEngineState {
  return syncState
}

function beginSync(kind: SyncKind) {
  runningKinds.add(kind)
  syncState = { ...syncState, phase: 'running', kind: deriveKind(), error: null }
  emitState()
}

function endSync(err: string | null) {
  runningKinds.clear()
  syncState = { phase: err ? 'error' : 'ok', kind: null, finishedAt: Date.now(), error: err }
  emitState()
}

/**
 * 上传本地脏收藏到 Bangumi。
 * 仅推送 provider='bangumi' 且 dirty=1 的本地收藏（离线优先：本地永远是源，Bangumi 是镜像）。
 */
async function pushAllInner(opts?: { episodeMarks?: boolean }): Promise<SyncResult> {
  const acct = await getBangumiAccount()
  if (!acct) return { pushed: 0, pulled: 0, failed: 0, error: '未登录 Bangumi' }

  const token = await getValidToken()
  if (!token) return { pushed: 0, pulled: 0, failed: 0, error: 'Bangumi 授权失效，请重新登录' }

  const localId = await ensureLocalAccount()
  const rows = await getDirtyCollectionsForSync(localId)

  let pushed = 0
  let failed = 0
  for (const r of rows) {
    try {
      // 游戏在 Bangumi 上没有集/卷进度概念，进度数（路线数）纯本地，绝不推送
      const isGame = r.category === 'galgame'
      // 本地「我的 tag」不外传到 Bangumi（用户决定：不同步本地标签到 Bangumi 收藏）
      await updateCollection(
        r.provider_subject_id,
        {
          type: COLLECTION_TYPE_BY_STATUS[r.status] ?? r.status,
          ep_status: isGame ? 0 : (r.ep_status ?? 0),
          vol_status: isGame ? 0 : (r.vol_status ?? 0),
          // 逐字段 dirty：仅当评分被显式改动(dirty_rate=1)才推送 rate 字段；
          // 否则整行 dirty（如改状态/集数）时省略 rate，Bangumi 保留现有评分，避免误删。
          // dirty_rate=1 时：rating 1-10 → 设置；0/null → 发 0（删除 Bangumi 评分，即「app 清零=删 Bangumi 评分」）。
          rate: r.dirty_rate ? (r.rating ?? 0) : undefined,
          comment: r.comment || undefined,
          private: !!r.private
        },
        token
      )
      await clearDirty(r.id)
      pushed++
      await logSync('push', 'collection', r.id, 'ok')
        // 上传该收藏的本地单集标记（本地离线改动 → Bangumi，保证全量同步含单集双向）
        // episodeMarks=false 时跳过：调用方已通过 setEpisodeStatus 直传单集，避免把整部单集重推一遍
        if (opts?.episodeMarks !== false) {
          try {
            const localMarks = await listProgressFull(r.id)
            const toPush = Object.entries(localMarks)
              .filter(([id, v]) => Number(id) > 0 && (v.watched || v.want || v.dropped))
              .map(([id, v]) => ({ id: Number(id), type: v.dropped ? 3 : v.watched ? 2 : 1 }))
            if (toPush.length) {
              await mapWithConcurrency(toPush, 5, (a) => setEpisodeStatusOnBgm(a.id, a.type, token))
            }
          } catch (e) {
            console.warn('[pushAll] 单集标记上传失败（忽略）：', e)
          }
        }
    } catch (e) {
      failed++
      await logSync('push', 'collection', r.id, 'failed', String(e))
    }
  }
  return { pushed, pulled: 0, failed }
}

/** 带状态跟踪的上传：begin/end 驱动侧栏指示灯；有失败或授权问题标记 error。 */
export async function pushAll(opts?: { episodeMarks?: boolean }): Promise<SyncResult> {
  beginSync('push')
  try {
    const r = await pushAllInner(opts)
    const err =
      r.failed > 0
        ? `上传失败 ${r.failed} 部${r.error ? '：' + r.error : ''}`
        : /授权|AUTH/.test(r.error ?? '')
          ? r.error
          : null
    endSync(err)
    return r
  } catch (e) {
    endSync(String(e))
    throw e
  }
}

/**
 * 从 Bangumi 拉取并导入本地，采用「早停对齐」策略：
 * 1. 先轻量拉取全部远端收藏（仅 list，收集比对数据与全量 ID 集合，后者用于 Q1 差集删除）。
 * 2. 与本地收藏（local_updated_at DESC）按“同作品且内容相等”找第一个锚点；
 *    锚点之前的“头部分裂区”双向调和（本地独有/dirty→上传，远端独有/非 dirty→拉取），
 *    锚点之后视为已同步，跳过重型拉取（书籍精确细分、import、upsert）。
 * 3. 找不到锚点则退化为全量处理（保证正确性）。
 * 4. Q1：删除本地“云端已移除”的 Bangumi 收藏（保护 dirty 行）。
 * 冲突策略：本地 dirty=1 的收藏以本地为准（跳过拉取、交由本地上传覆盖云端）。
 * @param opts.full 为 true 时跳过锚点早停，逐条比对全部收藏（全量拉取）。
 */
async function pullAllInner(opts?: { full?: boolean }): Promise<SyncResult> {
  const acct = await getBangumiAccount()
  if (!acct) return { pushed: 0, pulled: 0, failed: 0, error: '未登录 Bangumi' }

  const token = await getValidToken()
  if (!token) return { pushed: 0, pulled: 0, failed: 0, error: 'Bangumi 授权失效，请重新登录' }

  // v0 收藏列表端点必须用真实用户名（不支持 "-")，缺失时回退 /me 获取
  const username = acct.username ?? (await getMe(token))?.username
  if (!username)
    return { pushed: 0, pulled: 0, failed: 0, error: '无法获取 Bangumi 用户名，请重新登录' }

  const localId = await ensureLocalAccount()

  // ---- Pass 1：轻量拉取全部远端收藏（list 仅，收集比对数据 + 全量 ID 集合）----
  const remoteItems: RemotePullItem[] = []
  const remoteIds = new Set<string>()
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total) {
    let page: { data: any[]; total: number }
    try {
      page = await getMyCollections(token, { limit: PULL_PAGE, offset }, username)
      total = page.total || 0
    } catch (e) {
      return { pushed: 0, pulled: 0, failed: 1, error: String(e) }
    }
    for (const item of page.data) {
      const rawSubject = item?.subject
      const subjectId = String(rawSubject?.id)
      if (!subjectId) continue
      const category = BGM_TYPE_TO_CATEGORY[rawSubject.type]
      if (!category) continue // 音乐/三次元等无对应分类，不计入，本地也不会有
      remoteIds.add(subjectId)
      remoteItems.push({ subjectId, rawType: rawSubject.type, category, item })
    }
    if (page.data.length < PULL_PAGE) break
    offset += PULL_PAGE
  }

  // ---- 本地收藏快照（按 local_updated_at DESC，对应远端 updated_at DESC）----
  const localItems = await getCollectionsForCompare(localId)
  const localIds = new Set(localItems.map((l) => l.provider_subject_id))

  const anchor = opts?.full ? null : findAnchor(localItems, remoteItems)
  let pulled = 0
  let failed = 0
  let skipped = 0

  if (anchor) {
    // 本地头部分裂区：仅上传本地 dirty 行（其余已同步态跳过）
    for (let i = 0; i < anchor.localIdx; i++) {
      const l = localItems[i]
      if (l.dirty === 1) {
        try {
          await pushOne(token, l)
        } catch {
          failed++
        }
      }
      // 非 dirty 且远端已存在 → 已同步（可能仅重排），跳过；非 dirty 且远端不存在 → 交给 Q1 删除
    }
    // 远端头部分裂区：拉取远端独有 / 非 dirty 行（本地 dirty 优先，跳过）
    let order = 0
    for (let j = 0; j < anchor.remoteIdx; j++) {
      const r = remoteItems[j]
      const localMatch = localItems.find((l) => l.provider_subject_id === r.subjectId)
      if (localMatch && localMatch.dirty === 1) continue // 本地未上传改动，本地优先
      try {
        await pullOne(token, r, localId, order++)
        pulled++
      } catch {
        failed++
      }
    }
    skipped = localItems.length - anchor.localIdx
  } else {
    // 全量拉取模式 或 未找到锚点：逐条处理全部远端收藏（保证正确性，永不丢数据）。
    // 本地 dirty 行优先跳过，保留离线编辑，稍后由上传覆盖云端。
    if (opts?.full) console.warn('[sync] 全量拉取模式：逐条比对全部收藏，不做早停')
    let order = 0
    for (const r of remoteItems) {
      const localMatch = localItems.find((l) => l.provider_subject_id === r.subjectId)
      if (localMatch && localMatch.dirty === 1) continue // 本地未上传改动，本地优先
      try {
        await pullOne(token, r, localId, order++)
        pulled++
      } catch {
        failed++
      }
    }
  }

  // ---- Q1：差集删除（同步取消收藏）----
  const deleted = await deleteUnsyncedBangumiCollections(localId, remoteIds)

  if (skipped > 0) console.warn(`[sync] 早停对齐：跳过 ${skipped} 条已同步尾部的重型拉取`)
  if (deleted > 0) console.warn(`[sync] 已同步取消收藏：删除本地 ${deleted} 条云端已移除的收藏`)
  return { pushed: 0, pulled, failed, deleted }
}

/** 带状态跟踪的拉取（kind 区分普通拉取/全量拉取）。 */
export async function pullAll(opts?: { full?: boolean }): Promise<SyncResult> {
  beginSync(opts?.full ? 'full' : 'pull')
  try {
    const r = await pullAllInner(opts)
    const err =
      r.failed > 0
        ? `拉取失败 ${r.failed} 部${r.error ? '：' + r.error : ''}`
        : /授权|AUTH/.test(r.error ?? '')
          ? r.error
          : null
    endSync(err)
    return r
  } catch (e) {
    endSync(String(e))
    throw e
  }
}

interface RemotePullItem {
  subjectId: string
  rawType: number
  category: Category
  item: any
}

/** 两条收藏“内容相等”判定：status / ep / vol / rating / comment 全部一致 */
function contentEqual(
  l: { status: number; ep_status: number; vol_status: number; rating: number | null; comment: string | null },
  item: any
): boolean {
  const type = item?.type ?? 3
  const rate = typeof item?.rate === 'number' ? item.rate : null
  const comment = item?.comment || ''
  return (
    l.status === type &&
    l.ep_status === (item?.ep_status ?? 0) &&
    l.vol_status === (item?.vol_status ?? 0) &&
    (l.rating ?? null) === rate &&
    (l.comment || '') === comment
  )
}

/**
 * 找第一个“同作品且内容相等”的锚点：对齐点之后、双方顺序一致的尾部视为已同步，可跳过。
 * 双向扫描：优先找首个本地项在远端存在“同作品且内容相等”的对应，返回其 (localIdx, remoteIdx)。
 */
function findAnchor(
  localItems: { provider_subject_id: string; status: number; ep_status: number; vol_status: number; rating: number | null; comment: string | null }[],
  remoteItems: RemotePullItem[]
): { localIdx: number; remoteIdx: number } | null {
  for (let i = 0; i < localItems.length; i++) {
    for (let j = 0; j < remoteItems.length; j++) {
      if (
        localItems[i].provider_subject_id === remoteItems[j].subjectId &&
        contentEqual(localItems[i], remoteItems[j].item)
      ) {
        return { localIdx: i, remoteIdx: j }
      }
    }
  }
  return null
}

/** 上传单条本地收藏到 Bangumi（供早停头部分裂区使用，等价于 pushAll 的单行逻辑） */
async function pushOne(
  token: string,
  l: { id: number; status: number; ep_status: number; vol_status: number; rating: number | null; comment: string | null; private: number; dirty_rate: number; provider_subject_id: string; category: string }
): Promise<void> {
  // 游戏在 Bangumi 上没有集/卷进度概念，进度数（路线数）纯本地，绝不推送
  const isGame = l.category === 'galgame'
  // 本地「我的 tag」不外传到 Bangumi（用户决定：不同步本地标签到 Bangumi 收藏）
  await updateCollection(
    l.provider_subject_id,
    {
      type: COLLECTION_TYPE_BY_STATUS[l.status] ?? l.status,
      ep_status: isGame ? 0 : (l.ep_status ?? 0),
      vol_status: isGame ? 0 : (l.vol_status ?? 0),
      // 逐字段 dirty：仅 dirty_rate=1（评分被显式改动）才推送 rate；否则省略，保留 Bangumi 现有评分
      rate: l.dirty_rate ? (l.rating ?? 0) : undefined,
      comment: l.comment || undefined,
      private: !!l.private
    },
    token
  )
  await clearDirty(l.id)
  await logSync('push', 'collection', l.id, 'ok')
}

/** 拉取单条远端收藏并 upsert 到本地（懒加载书籍精确细分，仅在真正要写入时才发请求） */
async function pullOne(token: string, r: RemotePullItem, localId: number, order: number): Promise<void> {
  let category = r.category
  let tags: any[] | undefined
  let meta: any[] | undefined
  if (r.rawType === 1) {
    const detail = await getSubjectDetail(r.subjectId, token)
    const analysis = await analyzeBook(r.item.subject, token, detail)
    category = analysis.category
    tags = analysis.tags
    meta = analysis.meta
  }
  const subject = toSubject(r.item.subject, category)
  subject.tags = tags
  subject.meta = meta
  const localSubjectId = await importSubject(subject)
  const updatedAt = resolveMarkTime(r.item, order)
  await upsertCollectionFromBangumi(
    localId,
    localSubjectId,
    {
      type: r.item.type ?? 3,
      ep_status: r.item.ep_status ?? 0,
      vol_status: r.item.vol_status ?? 0,
      rating: typeof r.item.rate === 'number' ? r.item.rate : null,
      comment: r.item.comment ?? null
    },
    updatedAt
  )
  await logSync('pull', 'collection', localSubjectId, 'ok')
  // 同步逐集进度（Bangumi 权威，与本地对比后写入）：不再依赖列表项的 subject.eps
  // 字段（常缺失，会导致整段跳过），统一尝试拉取；远端为空则清空本地以完全对齐 Bangumi。
  try {
    const marks = await getEpisodeProgress(r.subjectId, token)
    const colId = (await findLocalCollectionByProviderSubjectId(r.subjectId))?.id
    if (colId) {
      if (Object.keys(marks).length === 0) await clearAllEpisodeProgress(colId)
      else await reconcileRemoteEpisodeProgress(colId, marks)
      await logSync('pull', 'episode', localSubjectId, 'ok')
    }
  } catch (e) {
    console.warn('[pullOne] 逐集进度拉取失败（忽略）：', e)
  }
}

/** 双向同步：先上传本地离线改动，再拉取远端整库，保证本地编辑不被 pull 覆盖。 */
export async function syncAll(): Promise<SyncResult> {
  const push = await pushAll()
  const pull = await pullAll()
  // 同步（pull）完成即视为已拉取最新进度，刷新 C' 的 lastPullAt 时钟
  markProgressPulled()
  const errors = [push.error, pull.error].filter(Boolean) as string[]
  return {
    pushed: push.pushed,
    pulled: pull.pulled,
    failed: pull.failed + push.failed,
    deleted: pull.deleted,
    error: errors.length ? errors.join('；') : undefined
  }
}
