import type { CacheStats } from '@shared/types'

/** 缓存管理客户端：统计并清理可重新抓取的本地辅助缓存。 */
export const cacheClient = {
  /** 统计本机缓存体积与各类缓存条目数 */
  stats: () => window.acgn.cache.stats() as Promise<CacheStats>,
  /** 清除可重新抓取的本地缓存（剧集/角色/关联作品/画廊 + 图片字节缓存），返回清理后统计 */
  clear: () => window.acgn.cache.clear() as Promise<CacheStats>,
  /** 手动裁剪「半年前」缓存，返回清理后统计 */
  prune: () => window.acgn.cache.prune() as Promise<CacheStats>
}
