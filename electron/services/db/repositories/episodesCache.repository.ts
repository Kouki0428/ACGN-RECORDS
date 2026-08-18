import { getDb } from '../connection'
import type { SubjectFullEpisode } from '../../../../shared/types'

/**
 * 本地剧集缓存：把 Bangumi 真实剧集元数据（集号/标题/首播/时长）按 provider_subject_id 落库，
 * 悬浮窗/详情页优先读本地，避免每次打开都联网抓取（受 Bangumi 限流影响、且慢）。
 * 抓取后由调用方（anime.ipc 的 getDetail、subject.ipc 的 detailFull）回写。
 */

/** 写入/更新某作品的剧集缓存（幂等 upsert，按 episode_id 覆盖）。 */
export async function upsertEpisodes(
  providerSubjectId: string,
  episodes: SubjectFullEpisode[]
): Promise<void> {
  if (!episodes || episodes.length === 0) return
  const db = await getDb()
  const now = Math.floor(Date.now() / 1000)
  const tx = db.transaction((eps: SubjectFullEpisode[]) => {
    const stmt = db.prepare(
      `INSERT INTO subject_episodes
        (provider_subject_id, episode_id, ep_number, ep, title, airdate, duration, ep_type, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_subject_id, episode_id) DO UPDATE SET
         ep_number = excluded.ep_number,
         ep       = excluded.ep,
         title    = excluded.title,
         airdate  = excluded.airdate,
         duration = excluded.duration,
         ep_type  = excluded.ep_type,
         updated_at = excluded.updated_at`
    )
    for (const e of eps) {
      stmt.run(
        providerSubjectId,
        e.id,
        e.epNumber ?? null,
        null, // ep 列：季内编号，SubjectFullEpisode 未跟踪，置空（网格只用 ep_number）
        e.title ?? null,
        e.airDate ?? null,
        e.duration ?? null,
        e.epType ?? 0, // ep_type 列：真实剧集类型（0=正片 1=SP），务必透传，不可写死
        now
      )
    }
  })
  tx(episodes)
}

/** 读某作品的本地剧集缓存，按真实集号(ep_number)升序返回；无缓存返回空数组。 */
export async function getCachedEpisodes(providerSubjectId: string): Promise<SubjectFullEpisode[]> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT episode_id AS id, ep_number AS epNumber, title, airdate AS airDate, duration, ep_type AS epType
       FROM subject_episodes
       WHERE provider_subject_id = ?
       ORDER BY ep_type ASC, ep_number ASC`
    )
    .all(providerSubjectId) as Array<{
    id: number
    epNumber: number | null
    title: string | null
    airDate: string | null
    duration: string | null
    epType: number
  }>
  return rows.map((r) => {
    // 兜底纠正：Bangumi 正片 sort 必为整数，小数 ep_number 必是 SP；
    // 即使缓存表 ep_type 因旧 bundle 被错写成 0，这里也按集号还原为 1（特别篇）。
    const n = typeof r.epNumber === 'number' ? r.epNumber : Number(r.epNumber)
    const spByNumber = Number.isFinite(n) && n > 0 && !Number.isInteger(n)
    const epType = r.epType === 1 || spByNumber ? 1 : 0
    return {
      id: r.id,
      epNumber: r.epNumber ?? 0,
      title: r.title ?? null,
      airDate: r.airDate ?? null,
      duration: r.duration ?? null,
      epType
    }
  })
}

/** 某作品本地剧集缓存数量（用于判断是否需要在线补全）。 */
export async function getCachedEpisodeCount(providerSubjectId: string): Promise<number> {
  const db = await getDb()
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM subject_episodes WHERE provider_subject_id = ?')
    .get(providerSubjectId) as { n: number }
  return row.n
}
