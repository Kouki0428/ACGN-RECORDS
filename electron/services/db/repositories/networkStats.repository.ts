import { getDb } from '../connection'

/** 单月网络使用量统计（字节 / 请求次数）。 */
export interface NetworkMonthStat {
  month: string
  sent: number
  received: number
  requests: number
  /** 当月 bgm 相关域名（api.bgm.tv / bgm.tv / bangumi.tv / next.bgm.tv）请求次数 */
  bgmRequests: number
  /** 当月其它域名（vndb / dlsite / steam / tmdb / 离线库下载等）请求次数 */
  otherRequests: number
}

/** 单日网络使用量统计（字节 / 请求次数）。day 形如 'YYYY-MM-DD'。 */
export interface NetworkDayStat {
  day: string
  sent: number
  received: number
  requests: number
  bgmRequests: number
  otherRequests: number
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

/** 缓存：network_stats(_daily) 是否已具备 bgm_requests/other_requests 拆分列。
 *  迁移在「主进程完全重启」时执行；未重启前为 false，写入退回旧的仅总量 SQL，避免整批回滚丢数据。 */
let splitColsReady: boolean | null = null
async function hasSplitCols(): Promise<boolean> {
  if (splitColsReady != null) return splitColsReady
  try {
    const db = await getDb()
    const ns = (db.prepare('PRAGMA table_info(network_stats)').all() as { name: string }[]).map((c) => c.name)
    const nsd = (db.prepare('PRAGMA table_info(network_stats_daily)').all() as { name: string }[]).map((c) => c.name)
    splitColsReady = ns.includes('bgm_requests') && nsd.includes('bgm_requests')
  } catch {
    splitColsReady = false
  }
  return splitColsReady
}

/** 累加某月用量（增量 upsert；默认当月）。
 *  bgmRequests / otherRequests 分别为该批请求中 bgm 域与其它的次数；requests 列记两者之和。
 *  列未迁移时退回仅总量写入（不丢旧数据）。 */
export async function addNetworkUsage(
  sent: number,
  received: number,
  bgmRequests: number,
  otherRequests: number,
  month?: string
): Promise<void> {
  const db = await getDb()
  const m = month ?? currentMonthKey()
  if (await hasSplitCols()) {
    db.prepare(
      `INSERT INTO network_stats (month, sent, received, requests, bgm_requests, other_requests)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET
         sent = sent + excluded.sent,
         received = received + excluded.received,
         requests = requests + excluded.requests,
         bgm_requests = bgm_requests + excluded.bgm_requests,
         other_requests = other_requests + excluded.other_requests`
    ).run(m, sent, received, bgmRequests + otherRequests, bgmRequests, otherRequests)
  } else {
    db.prepare(
      `INSERT INTO network_stats (month, sent, received, requests)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET
         sent = sent + excluded.sent,
         received = received + excluded.received,
         requests = requests + excluded.requests`
    ).run(m, sent, received, bgmRequests + otherRequests)
  }
}

/** 取当月累计（无记录返回 null）。 */
export async function getNetworkStats(month?: string): Promise<NetworkMonthStat | null> {
  const db = await getDb()
  const m = month ?? currentMonthKey()
  const row = db
    .prepare('SELECT * FROM network_stats WHERE month = ?')
    .get(m) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    month: String(row.month),
    sent: Number(row.sent) || 0,
    received: Number(row.received) || 0,
    requests: Number(row.requests) || 0,
    bgmRequests: Number(row.bgm_requests) || 0,
    otherRequests: Number(row.other_requests) || 0
  }
}

/** 累加某天用量（增量 upsert；默认今天）。 */
export async function addDailyUsage(
  sent: number,
  received: number,
  bgmRequests: number,
  otherRequests: number,
  day?: string
): Promise<void> {
  const db = await getDb()
  const k = day ?? currentDayKey()
  if (await hasSplitCols()) {
    db.prepare(
      `INSERT INTO network_stats_daily (day, sent, received, requests, bgm_requests, other_requests)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         sent = sent + excluded.sent,
         received = received + excluded.received,
         requests = requests + excluded.requests,
         bgm_requests = bgm_requests + excluded.bgm_requests,
         other_requests = other_requests + excluded.other_requests`
    ).run(k, sent, received, bgmRequests + otherRequests, bgmRequests, otherRequests)
  } else {
    db.prepare(
      `INSERT INTO network_stats_daily (day, sent, received, requests)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         sent = sent + excluded.sent,
         received = received + excluded.received,
         requests = requests + excluded.requests`
    ).run(k, sent, received, bgmRequests + otherRequests)
  }
}

/** 取当天累计（无记录返回 null）。 */
export async function getTodayStats(day?: string): Promise<NetworkDayStat | null> {
  const db = await getDb()
  const k = day ?? currentDayKey()
  const row = db
    .prepare('SELECT * FROM network_stats_daily WHERE day = ?')
    .get(k) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    day: String(row.day),
    sent: Number(row.sent) || 0,
    received: Number(row.received) || 0,
    requests: Number(row.requests) || 0,
    bgmRequests: Number(row.bgm_requests) || 0,
    otherRequests: Number(row.other_requests) || 0
  }
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
      `SELECT * FROM network_stats WHERE month IN (${keys.map(() => '?').join(',')})`
    )
    .all(...keys) as Record<string, unknown>[]
  const map = new Map(rows.map((r) => [String(r.month), r]))
  return keys.map((k) => {
    const r = map.get(k)
    if (!r)
      return { month: k, sent: 0, received: 0, requests: 0, bgmRequests: 0, otherRequests: 0 }
    return {
      month: k,
      sent: Number(r.sent) || 0,
      received: Number(r.received) || 0,
      requests: Number(r.requests) || 0,
      bgmRequests: Number(r.bgm_requests) || 0,
      otherRequests: Number(r.other_requests) || 0
    }
  })
}
