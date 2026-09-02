import { getBangumiAccount, getValidToken } from './auth/oauth'
import { getMyCollection } from './api/bangumi'
import { saveCollectionRatingLocal, saveCollectionCommentLocal } from './db/repositories/collections.repository'

/** 远端拉取超时（毫秒）：超时视为取不到，回退本地值，不阻塞调用方 */
const REMOTE_TIMEOUT_MS = 3000
/** 会话级缓存有效期（毫秒）：同作品短时间重复打开直接读缓存，不再发请求 */
const CACHE_TTL_MS = 30_000

/**
 * 对 Promise 加超时：在 ms 内未完成则返回 fallback（不取消底层请求，仅让调用方不再等待）。
 */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// 会话级缓存：pid -> { value, at }。value 为 null 也缓存（避免反复拉取「确实无吐槽/无评分」）。
const cache = new Map<string, { value: number | string | null; at: number }>()

function cacheGet(pid: string): number | string | null | undefined {
  const hit = cache.get(pid)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  return undefined // 未命中或过期
}

function cacheSet(pid: string, value: number | string | null): void {
  // 简单防膨胀：超过 500 条清空（收藏悬浮窗/详情页按需打开，正常远低于此）
  if (cache.size > 500) cache.clear()
  cache.set(pid, { value, at: Date.now() })
}

/**
 * 解析「我的评价」评分（1-10）用于详情页展示：
 * - 本地有未推送改动(dirty=1)：以本地为准（app 内刚改、待同步），不联网、不覆盖。
 * - 否则：若已登录 Bangumi，实时拉取该用户在 Bangumi 上的收藏评分(rate 字段)；
 *   取到则写回本地缓存（不标记 dirty）并返回；取不到则回退本地已缓存值（可能为 null）。
 * - 远端拉取带 3s 超时 + 30s 会话缓存，网络慢/离线时秒回本地值，不阻塞详情页。
 * 这样用户在 Bangumi 网页端打的分，打开详情页时会立刻反映出来。
 */
export async function resolveMyRating(
  subject: { provider?: string; provider_subject_id?: string } | null | undefined,
  localCollection: { rating?: number | null; dirty?: number } | null | undefined
): Promise<number | null> {
  const isBgm = !!subject && subject.provider === 'bangumi' && !!subject.provider_subject_id
  if (!isBgm) return null

  const pid = subject.provider_subject_id!
  const localRating = (localCollection as { rating?: number | null } | null)?.rating ?? null
  const localDirty = (localCollection as { dirty?: number } | null)?.dirty ?? 0

  // 本地有未推送改动：以本地为准，避免覆盖 app 内刚点的星
  if (localRating != null && localDirty === 1) return localRating

  // 会话缓存命中：直接返回，不再联网
  const cached = cacheGet(pid)
  if (cached !== undefined) return cached as number | null

  // 已登录则实时取 Bangumi 上的我的评分（带超时）
  try {
    const token = await getValidToken()
    const acct = await getBangumiAccount()
    if (token && acct?.username) {
      const remote = await withTimeout(
        getMyCollection(pid, token, acct.username),
        REMOTE_TIMEOUT_MS,
        null
      )
      const rate = remote && typeof remote.rate === 'number' ? remote.rate : null
      cacheSet(pid, rate)
      if (rate != null) {
        await saveCollectionRatingLocal(pid, rate)
        return rate
      }
    } else {
      // 未登录：缓存空结果，避免每次打开都走一遍 token/账号检查
      cacheSet(pid, null)
    }
  } catch (e) {
    console.warn('[resolveMyRating] 拉取 Bangumi 我的评分失败（不影响详情）：', e)
  }

  // 远端取不到：回退本地（已缓存或 null）
  return localRating
}

/**
 * 解析「我的吐槽」（收藏评论）用于收藏悬浮窗回显：
 * - 本地已有吐槽则直接用（无需联网）。
 * - 否则：若已登录 Bangumi，实时拉取该用户在 Bangumi 上的收藏吐槽(comment 字段)；
 *   取到则写回本地缓存（不标记 dirty）并返回；取不到则回退本地（可能为 null）。
 * - 远端拉取带 3s 超时 + 30s 会话缓存，网络慢/离线时秒回本地值，不阻塞收藏悬浮窗。
 * 这样用户在 Bangumi 网页端写的吐槽，打开收藏悬浮窗时会立刻显示出来。
 */
export async function resolveMyComment(
  subject: { provider?: string; provider_subject_id?: string } | null | undefined,
  localComment: string | null | undefined
): Promise<string | null> {
  const isBgm = !!subject && subject.provider === 'bangumi' && !!subject.provider_subject_id
  if (!isBgm) return localComment ?? null

  const pid = subject.provider_subject_id!

  // 本地已有吐槽：直接显示，不联网
  if (localComment) return localComment

  // 会话缓存命中：直接返回，不再联网
  const cached = cacheGet(pid)
  if (cached !== undefined) return cached as string | null

  // 已登录则实时取 Bangumi 上的我的吐槽（带超时）
  try {
    const token = await getValidToken()
    const acct = await getBangumiAccount()
    if (token && acct?.username) {
      const remote = await withTimeout(
        getMyCollection(pid, token, acct.username),
        REMOTE_TIMEOUT_MS,
        null
      )
      const comment =
        remote && typeof remote.comment === 'string' && remote.comment.trim().length > 0
          ? remote.comment
          : null
      cacheSet(pid, comment)
      if (comment) {
        await saveCollectionCommentLocal(pid, comment)
        return comment
      }
    } else {
      // 未登录：缓存空结果，避免每次打开都走一遍 token/账号检查
      cacheSet(pid, null)
    }
  } catch (e) {
    console.warn('[resolveMyComment] 拉取 Bangumi 我的吐槽失败（不影响收藏悬浮窗）：', e)
  }

  // 远端取不到：回退本地（已缓存或 null）
  return localComment ?? null
}