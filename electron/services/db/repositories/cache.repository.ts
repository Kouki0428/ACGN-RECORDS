import { getDb } from '../connection'

/**
 * 通用只读数据缓存仓库：把 Bangumi 详情类响应按 key 暂存到本地 SQLite（硬盘）。
 * 配合 services/api/requestCache.ts 的 cachedGet 使用，有效期由调用方决定。
 * value 以 JSON 文本存储；expires_at 为绝对过期时间戳（秒）。
 */

export async function getCache<T>(key: string): Promise<T | null> {
  const db = await getDb()
  const now = Math.floor(Date.now() / 1000)
  const row = db
    .prepare('SELECT value, expires_at FROM cache WHERE key = ?')
    .get(key) as { value: string; expires_at: number } | undefined
  if (!row) return null
  if (row.expires_at <= now) {
    // 已过期：顺手清理，避免堆积
    db.prepare('DELETE FROM cache WHERE key = ?').run(key)
    return null
  }
  try {
    return JSON.parse(row.value) as T
  } catch {
    // 解析失败视为无缓存
    db.prepare('DELETE FROM cache WHERE key = ?').run(key)
    return null
  }
}

export async function setCache(key: string, value: unknown, ttlMs: number): Promise<void> {
  const db = await getDb()
  const expiresAt = Math.floor(Date.now() / 1000) + Math.ceil(ttlMs / 1000)
  db.prepare(
    `INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
  ).run(key, JSON.stringify(value), expiresAt)
}

/** 清理所有已过期的缓存行（可周期性或启动时调用，防止表无限增长） */
export async function deleteExpiredCache(): Promise<void> {
  const db = await getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare('DELETE FROM cache WHERE expires_at <= ?').run(now)
}
