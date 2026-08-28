import { getCache, setCache } from './db/repositories/cache.repository'
import { getValidToken, getBangumiAccount } from './auth/oauth'
import { getP1UserTimeline, getP1UserRecentActivity } from './api/bangumi'

/**
 * C' 方案（p1 timeline 全局最后活动时钟）：
 * 用 next.bgm.tv/p1 的 /users/{username}/timeline 第一条动态的时间戳作为
 * 「账号最后一次任何标记活动（收藏/评分/评论/章节进度）」的统一时钟，
 * 规避 v0 collection.updated_at 在改章节进度时不刷新的已知 bug。
 *
 * 降级策略：若取不到远端活动（无 token / 网络异常 / p1 返回格式不符），
 * shouldRefreshProgress 返回 true，退化为原有的 force 拉取，功能不退化。
 *
 * 定向刷新：同一次 timeline 拉取（60s memo 共享，不多发请求）解析出「哪几部作品」
 * 有新活动，闸门开时只精准拉这些作品（1+K 请求而非整批 N）。
 */

const TIMELINE_MEMO_MS = 60_000 // p1 timeline 结果内存缓存，避免切栏频繁打端点
const REFRESH_THROTTLE_S = 300 // 即使有新活动，两次实际全量拉之间最小间隔（秒）
const LAST_PULL_TTL_MS = 365 * 86400_000 // lastPullAt 当成持久状态，基本不过期

interface ActivitySnapshot {
  ts: number | null
  acts: Array<{ subjectId: number; ts: number }>
}
let memo: { t: number; snap: ActivitySnapshot } | null = null

async function computeActivity(): Promise<ActivitySnapshot> {
  const token = await getValidToken()
  if (!token) return { ts: null, acts: [] }
  const acct = await getBangumiAccount()
  if (!acct?.username) return { ts: null, acts: [] }
  const acts = await getP1UserRecentActivity(acct.username, token, 20)
  // 兼容：动态全部解析失败时回退「只取首行时间」的老路径（保持 shouldRefresh 可用）
  if (!acts.length) {
    const ts = await getP1UserTimeline(acct.username, token, 1)
    return { ts, acts: [] }
  }
  return { ts: Math.max(...acts.map((a) => a.ts)), acts }
}

async function getActivity(): Promise<ActivitySnapshot> {
  const now = Date.now()
  if (memo && now - memo.t < TIMELINE_MEMO_MS) return memo.snap
  const snap = await computeActivity()
  memo = { t: now, snap }
  return snap
}

/**
 * 切栏时是否需实际拉取单集进度：
 * - 取不到远端活动 → true（降级，照常拉）
 * - 首次（未记 lastPullAt）→ true
 * - 远端最后活动 <= 本地上次拉取 → false（期间无新标记，全局短路 0 请求）
 * - 远端有新活动但距上次拉取 < 节流窗口 → false（本周期已拉过）
 * - 否则 true
 */
export async function shouldRefreshProgress(): Promise<boolean> {
  const { ts: remote } = await getActivity()
  if (remote == null) return true
  const lastPull = (await getCache<number>('progress.lastPullAt')) ?? 0
  if (!lastPull) return true
  if (remote <= lastPull) return false
  const now = Math.floor(Date.now() / 1000)
  if (now - lastPull < REFRESH_THROTTLE_S) return false
  return true
}

export function markProgressPulled(): void {
  setCache('progress.lastPullAt', Math.floor(Date.now() / 1000), LAST_PULL_TTL_MS).catch(() => {})
}

/** 本地上次进度拉取时钟（C'），供定向刷新计算 since。 */
export async function getLastPullAt(): Promise<number> {
  return (await getCache<number>('progress.lastPullAt')) ?? 0
}

/**
 * 定向刷新：最近动态（memo 共享，60s 内 0 请求）里晚于 sinceSec 的作品 id。
 * 返回 null = 无法解析/无数据（调用方退化为整批拉取）；[] = 确认无相关变化。
 */
export async function getRecentActivitySubjects(
  sinceSec: number,
  limit = 20
): Promise<number[] | null> {
  const { acts } = await getActivity()
  if (!acts.length) return null
  return acts.filter((a) => a.ts > sinceSec).map((a) => a.subjectId)
}
