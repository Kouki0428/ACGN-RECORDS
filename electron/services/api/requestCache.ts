import { getCache, setCache } from '../db/repositories/cache.repository'

/**
 * 通用「只读数据缓存」：先查本地硬盘缓存（SQLite），命中且未过期直接返回、不发网络请求；
 * 未命中才真正拉取，并写回硬盘。同一时刻多个相同 key 的请求会合并成一次（在途去重）。
 *
 * 用于 Bangumi 详情类接口（作品详情 / 角色 / 制作人员 / 实体卡 / 讨论 / 评论 / 热门讨论），
 * 显著降低重复网络请求。写操作（单集标记、拉进度、发回复等）请勿使用本函数。
 *
 * @param key    缓存键（调用方保证唯一，如 `subject:123`）
 * @param ttlMs  有效期（毫秒）。热门讨论/评论用 60_000，作品详情类用 86_400_000
 * @param fetcher 真正发网络请求的函数
 * @param opts.force 为 true 时忽略缓存、强制重新拉取（如用户点「刷新」按钮）
 */
const inflight = new Map<string, Promise<unknown>>()

export async function cachedGet<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts?: { force?: boolean }
): Promise<T> {
  if (!opts?.force) {
    const hit = await getCache<T>(key)
    if (hit !== null) return hit
  }
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const p = (async () => {
    try {
      const val = await fetcher()
      await setCache(key, val, ttlMs)
      return val
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p as Promise<T>
}

/** 天（毫秒），详情类接口默认有效期 */
export const ONE_DAY_MS = 86_400_000
/** 10 分钟（毫秒），热门讨论 / 单作品吐槽 / 评论默认有效期 */
export const TEN_MIN_MS = 600_000
