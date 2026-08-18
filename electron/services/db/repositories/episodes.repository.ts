import { getDb } from '../connection'

export interface EpisodeInput {
  providerEpisodeId: string
  epNumber: number
  epType?: number
  title?: string | null
}

/** 批量写入/更新某作品的剧集（按 subject_id + provider_episode_id 去重）。 */
export async function upsertEpisodes(subjectId: number, episodes: EpisodeInput[]): Promise<void> {
  const db = await getDb()
  const stmt = db.prepare(
    `INSERT INTO episodes (subject_id, provider_episode_id, ep_number, ep_type, title)
     VALUES (@subjectId, @providerEpisodeId, @epNumber, @epType, @title)
     ON CONFLICT(subject_id, provider_episode_id) DO UPDATE SET
       ep_number = excluded.ep_number, title = excluded.title`
  )
  const tx = db.transaction((rows: EpisodeInput[]) => {
    for (const e of rows) {
      stmt.run({
        subjectId,
        providerEpisodeId: e.providerEpisodeId,
        epNumber: e.epNumber,
        epType: e.epType ?? 0,
        title: e.title ?? null
      })
    }
  })
  tx(episodes)
}

export async function listEpisodes(subjectId: number): Promise<any[]> {
  const db = await getDb()
  return db
    .prepare('SELECT * FROM episodes WHERE subject_id = ? ORDER BY ep_number ASC')
    .all(subjectId)
}

/**
 * 确保作品有剧集数据。真实数据应来自 Bangumi getEpisodes；
 * MVP 阶段若未拉取到，则按 totalEpisodes 生成占位剧集，保证「点格子」可用。
 */
export async function ensureMockEpisodes(subjectId: number, count: number): Promise<void> {
  const db = await getDb()
  const row = db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE subject_id = ?').get(subjectId)
  if ((row as any).n > 0) return
  const rows: EpisodeInput[] = Array.from({ length: count }, (_, i) => ({
    providerEpisodeId: `local-ep-${i + 1}`,
    epNumber: i + 1,
    epType: 0,
    title: `第 ${i + 1} 集`
  }))
  await upsertEpisodes(subjectId, rows)
}
