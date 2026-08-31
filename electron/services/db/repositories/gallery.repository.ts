import { getDb } from '../connection'
import type { GalleryItem } from '../../../../shared/types'

/** 取已缓存的画廊（离线可用）。仅信任 v>=3 的新版缓存，旧版作废重新抓取。
 *  v=3：画廊匹配逻辑修正后，作废可能配错游戏/漏 VNDB 的旧缓存（v=2）。 */
export async function getCachedGallery(subjectId: number): Promise<GalleryItem[]> {
  const db = await getDb()
  const rows = db
    .prepare('SELECT source, url, thumb, caption, nsfw FROM subject_gallery WHERE subject_id = ? AND v >= 3 ORDER BY id')
    .all(subjectId) as {
    source: string
    url: string
    thumb: string | null
    caption: string | null
    nsfw: number
  }[]
  return rows.map((r) => ({
    source: r.source,
    url: r.url,
    thumb: r.thumb ?? undefined,
    caption: r.caption ?? undefined,
    nsfw: !!r.nsfw
  }))
}

/** 覆盖写入画廊缓存（标记 v=3，便于后续作废旧格式） */
export async function cacheGallery(subjectId: number, items: GalleryItem[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction((sid: number, its: GalleryItem[]) => {
    db.prepare('DELETE FROM subject_gallery WHERE subject_id = ?').run(sid)
    const ins = db.prepare(
      `INSERT INTO subject_gallery (subject_id, source, url, thumb, caption, nsfw, v, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))`
    )
    for (const it of its) ins.run(sid, it.source, it.url, it.thumb ?? null, it.caption ?? null, it.nsfw ? 1 : 0, 3)
  })
  tx(subjectId, items)
}
