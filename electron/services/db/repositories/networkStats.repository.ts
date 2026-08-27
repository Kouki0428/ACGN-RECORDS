import { getDb } from '../connection'

/** 单月网络使用量统计（字节 / 请求次数）。 */
export interface NetworkMonthStat {
  month: string
  sent: number
  received: number
  requests: number
}

/** 单日网络使用量统计（字节 / 请求次数）。day 形如 'YYYY-MM-DD'。 */
export interface NetworkDayStat {
  day: string
  sent: number
  received: number
  requests: number
}

/** 当月及历史汇总（供设置页一次性拉取）。 */
export interface NetworkStatsResult {
  current: NetworkMonthStat | null
  history: NetworkMonthStat[]
  today: NetworkDayStat | null
}

/** 给定日期的月份键（'YYYY-MM'），默认当前月。 */
export function currentMonthKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 给定日期的日键（'YYYY-MM-DD'），默认今天。 */
export function currentDayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 累加某月用量（增量 upsert；默认当月）。 */
export async function addNetworkUsage(
  sent: number,
  received: number,
  requests: number,
  month?: string
): Promise<void> {
  const db = await getDb()
  const m = month ?? currentMonthKey()
  db.prepare(
    `INSERT INTO network_stats (month, sent, received, requests)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET
       sent = sent + excluded.sent,
       received = received + excluded.received,
       requests = requests + excluded.requests`
  ).run(m, sent, received, requests)
}

/** 取当月累计（无记录返回 null）。 */
export async function getNetworkStats(month?: string): Promise<NetworkMonthStat | null> {
  const db = await getDb()
  const m = month ?? currentMonthKey()
  const row = db
    .prepare('SELECT month, sent, received, requests FROM network_stats WHERE month = ?')
    .get(m) as NetworkMonthStat | undefined
  return row ?? null
}

/** 累加某天用量（增量 upsert；默认今天）。 */
export async function addDailyUsage(
  sent: number,
  received: number,
  requests: number,
  day?: string
): Promise<void> {
  const db = await getDb()
  const k = day ?? currentDayKey()
  db.prepare(
    `INSERT INTO network_stats_daily (day, sent, received, requests)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       sent = sent + excluded.sent,
       received = received + excluded.received,
       requests = requests + excluded.requests`
  ).run(k, sent, received, requests)
}

/** 取当天累计（无记录返回 null）。 */
export async function getTodayStats(day?: string): Promise<NetworkDayStat | null> {
  const db = await getDb()
  const k = day ?? currentDayKey()
  const row = db
    .prepare('SELECT day, sent, received, requests FROM network_stats_daily WHERE day = ?')
    .get(k) as NetworkDayStat | undefined
  return row ?? null
}

/** 最近 months 个月（含当月），按月升序；缺失月份补 0。 */
export async function getNetworkHistory(months = 6): Promise<NetworkMonthStat[]> {
  const db = await getDb()
  const now = new Date()
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const rows = db
    .prepare(
      `SELECT month, sent, received, requests FROM network_stats WHERE month IN (${keys
        .map(() => '?')
        .join(',')})`
    )
    .all(...keys) as NetworkMonthStat[]
  const map = new Map(rows.map((r) => [r.month, r]))
  return keys.map((k) => map.get(k) ?? { month: k, sent: 0, received: 0, requests: 0 })
}
