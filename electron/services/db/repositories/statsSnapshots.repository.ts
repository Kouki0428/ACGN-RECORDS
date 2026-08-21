// 收藏月度快照：每月首次启动 INSERT OR IGNORE 当期计数（不覆盖已有月份），
// 供统计悬浮窗绘制「收藏/完成」历史趋势。分类归并约定：book=light_novel+manga、game=galgame+game。
import { getDb } from '../connection'

export interface StatsSnapshot {
  month: string
  total: number
  done: number
  rated: number
  avgRating: number
  anime: number
  book: number
  game: number
}

function monthKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`
}

/** 记录当月快照（当月已存在则忽略）。返回是否新写入。 */
export async function recordMonthlySnapshotIfAbsent(): Promise<boolean> {
  const db = await getDb()
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN c.status = 2 THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN c.rating > 0 THEN 1 ELSE 0 END) AS rated,
              AVG(CASE WHEN c.rating > 0 THEN c.rating END) AS avg_rating,
              SUM(CASE WHEN s.category = 'anime' THEN 1 ELSE 0 END) AS anime,
              SUM(CASE WHEN s.category IN ('light_novel','manga') THEN 1 ELSE 0 END) AS book,
              SUM(CASE WHEN s.category IN ('galgame','game') THEN 1 ELSE 0 END) AS game
       FROM collections c JOIN subjects s ON s.id = c.subject_id`
    )
    .get()
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO stats_snapshots (month, total, done, rated, avg_rating, anime, book, game)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      monthKey(),
      row.total ?? 0,
      row.done ?? 0,
      row.rated ?? 0,
      row.avg_rating ?? 0,
      row.anime ?? 0,
      row.book ?? 0,
      row.game ?? 0
    )
  return info.changes > 0
}

/** 历史快照（按月升序，最多 limit 条） */
export async function getSnapshotHistory(limit = 12): Promise<StatsSnapshot[]> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT month, total, done, rated, avg_rating AS avgRating, anime, book, game
       FROM stats_snapshots ORDER BY month DESC LIMIT ?`
    )
    .all(limit)
  return rows.reverse()
}
