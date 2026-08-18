import { getDb } from '../connection'

/** 辅助源外链（vndb / tmdb / dlsite / steam 等），挂在 Bangumi 主作品上 */
export async function saveExternalLink(
  subjectId: number,
  source: string,
  extId: string,
  url?: string
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO subject_external_links (subject_id, source, ext_id, url, updated_at)
     VALUES (?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(subject_id, source) DO UPDATE SET
       ext_id=excluded.ext_id, url=excluded.url, updated_at=strftime('%s','now')`
  ).run(subjectId, source, extId, url ?? null)
}

/** 取某作品的全部外链，形如 { vndb: 'v17', steam: '702050' } */
export async function getExternalLinks(subjectId: number): Promise<Record<string, string>> {
  const db = await getDb()
  const rows = db
    .prepare('SELECT source, ext_id FROM subject_external_links WHERE subject_id = ?')
    .all(subjectId) as { source: string; ext_id: string }[]
  const map: Record<string, string> = {}
  for (const r of rows) map[r.source] = r.ext_id
  return map
}

/** 取某个具体来源的外链 id（无则 null） */
export async function getExt(subjectId: number, source: string): Promise<string | null> {
  const db = await getDb()
  const row = db
    .prepare('SELECT ext_id FROM subject_external_links WHERE subject_id = ? AND source = ?')
    .get(subjectId, source) as { ext_id: string } | undefined
  return row?.ext_id ?? null
}
