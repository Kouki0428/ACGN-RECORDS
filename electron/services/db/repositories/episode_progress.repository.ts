import { getDb } from '../connection'

/** 单集进度状态：已看 / 想看 / 抛弃（三者互斥） */
export interface EpisodeProgressState {
  watched: boolean
  want: boolean
  dropped?: boolean
}

/** 切换某集的已看状态，返回切换后的「是否已看」。
 *  标记已看时同时清除「想看」与「抛弃」（三者互斥）。 */
export async function setWatched(
  collectionId: number,
  episodeId: number,
  watched: boolean
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO episode_progress (collection_id, episode_id, watched, watched_at)
     VALUES (?, ?, ?, strftime('%s','now'))
     ON CONFLICT(collection_id, episode_id) DO UPDATE SET
       watched = excluded.watched,
       dropped = 0,
       watched_at = CASE WHEN excluded.watched = 1 THEN strftime('%s','now') ELSE watched_at END`
  ).run(collectionId, episodeId, watched ? 1 : 0)
  if (watched) {
    db.prepare(
      'UPDATE episode_progress SET want = 0, dropped = 0 WHERE collection_id = ? AND episode_id = ?'
    ).run(collectionId, episodeId)
  }
}

/** 设置/清除某集「想看」。标记想看时同时清除「已看」与「抛弃」（三者互斥）。 */
export async function setWant(
  collectionId: number,
  episodeId: number,
  want: boolean
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO episode_progress (collection_id, episode_id, want)
     VALUES (?, ?, ?)
     ON CONFLICT(collection_id, episode_id) DO UPDATE SET want = excluded.want, dropped = 0`
  ).run(collectionId, episodeId, want ? 1 : 0)
  if (want) {
    db.prepare(
      'UPDATE episode_progress SET watched = 0, dropped = 0 WHERE collection_id = ? AND episode_id = ?'
    ).run(collectionId, episodeId)
  }
}

/** 设置/清除某集「抛弃」（Bangumi episode type=3）。标记抛弃时清除已看/想看（互斥）。 */
export async function setDropped(
  collectionId: number,
  episodeId: number,
  dropped: boolean
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO episode_progress (collection_id, episode_id, dropped)
     VALUES (?, ?, ?)
     ON CONFLICT(collection_id, episode_id) DO UPDATE SET
       dropped = excluded.dropped,
       watched = 0,
       want = 0`
  ).run(collectionId, episodeId, dropped ? 1 : 0)
}

/** 「看到」：把给定有序剧集列表（含当前集及之前所有集）全部标记为已看、清除想看与抛弃。 */
export async function setWatchedUpTo(
  collectionId: number,
  episodeIds: number[]
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction((ids: number[]) => {
    for (const eid of ids) {
      db.prepare(
        `INSERT INTO episode_progress (collection_id, episode_id, watched, want, dropped, watched_at)
         VALUES (?, ?, 1, 0, 0, strftime('%s','now'))
         ON CONFLICT(collection_id, episode_id) DO UPDATE SET
           watched = 1, want = 0, dropped = 0, watched_at = strftime('%s','now')`
      ).run(collectionId, eid)
    }
  })
  tx(episodeIds)
}

/** 「撤销」单集：清除已看、想看与抛弃（回到未标记）。 */
export async function clearEpisode(
  collectionId: number,
  episodeId: number
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `INSERT INTO episode_progress (collection_id, episode_id, watched, want, dropped)
     VALUES (?, ?, 0, 0, 0)
     ON CONFLICT(collection_id, episode_id) DO UPDATE SET watched = 0, want = 0, dropped = 0`
  ).run(collectionId, episodeId)
}

/** 读取某集当前状态（已看/想看/抛弃）。 */
export async function getProgressEntry(
  collectionId: number,
  episodeId: number
): Promise<EpisodeProgressState> {
  const db = await getDb()
  const row = db
    .prepare('SELECT watched, want, dropped FROM episode_progress WHERE collection_id = ? AND episode_id = ?')
    .get(collectionId, episodeId) as { watched: number; want: number; dropped: number } | undefined
  return { watched: !!row?.watched, want: !!row?.want, dropped: !!row?.dropped }
}

/** 返回某收藏的完整逐集进度映射：episodeId -> { watched, want, dropped }。 */
export async function listProgressFull(
  collectionId: number
): Promise<Record<number, EpisodeProgressState>> {
  const db = await getDb()
  const rows = db
    .prepare('SELECT episode_id, watched, want, dropped FROM episode_progress WHERE collection_id = ?')
    .all(collectionId) as { episode_id: number; watched: number; want: number; dropped: number }[]
  const map: Record<number, EpisodeProgressState> = {}
  for (const r of rows) {
    map[r.episode_id] = { watched: !!r.watched, want: !!r.want, dropped: !!r.dropped }
  }
  return map
}

/** 统计某收藏已看集数。 */
export async function countWatched(collectionId: number): Promise<number> {
  const db = await getDb()
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM episode_progress WHERE collection_id = ? AND watched = 1')
    .get(collectionId) as { n: number }
  return row.n
}

/**
 * 把 Bangumi 拉回的逐集标记合并写入本地（pull 用）。
 * 冲突策略：远端 1/2/3 覆盖本地对应集（Bangumi 优先），watched/want/dropped 互斥；
 * 远端未出现的集、或 status 为 0 的集不在 marks 中，故不会被清除（保留本地离线标记）。
 * 事务批量写入。
 */
export async function applyRemoteEpisodeProgress(
  collectionId: number,
  marks: Record<number, { watched: boolean; want: boolean; dropped?: boolean }>
): Promise<void> {
  const entries = Object.entries(marks).map(([id, v]) => ({
    episodeId: Number(id),
    watched: !!v.watched,
    want: !!v.want,
    dropped: !!v.dropped
  }))
  if (!entries.length) return
  const db = await getDb()
  const tx = db.transaction(
    (rows: { episodeId: number; watched: boolean; want: boolean; dropped: boolean }[]) => {
      for (const r of rows) {
        db.prepare(
          `INSERT INTO episode_progress (collection_id, episode_id, watched, want, dropped, watched_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(
             (SELECT watched_at FROM episode_progress WHERE collection_id = ? AND episode_id = ?),
             strftime('%s','now')))
           ON CONFLICT(collection_id, episode_id) DO UPDATE SET
             watched = excluded.watched,
             want = excluded.want,
             dropped = excluded.dropped,
             watched_at = CASE WHEN excluded.watched = 1 THEN strftime('%s','now') ELSE watched_at END`
        ).run(
          collectionId,
          r.episodeId,
          r.watched ? 1 : 0,
          r.want ? 1 : 0,
          r.dropped ? 1 : 0,
          collectionId,
          r.episodeId
        )
      }
    }
  )
  tx(entries)
}

/**
 * 把 Bangumi 拉回的逐集标记与本地做「对比/调和」后写入（全量同步用，Bangumi 权威）。
 * - 远端有标记的集（marks 中）：覆盖为远端状态（watched/want/dropped 互斥）。
 * - 本地有标记但远端没有的集：清为未标记（Bangumi 视为未收藏），使本地完全对齐 Bangumi。
 * 在同步流程中，本地离线改动会先由 pushAll 上传、或 dirty 收藏被跳过拉取，
 * 故此处清除不会误删尚未上传的离线标记（除非用户明确执行拉取覆盖）。
 */
export async function reconcileRemoteEpisodeProgress(
  collectionId: number,
  marks: Record<number, { watched: boolean; want: boolean; dropped?: boolean }>
): Promise<void> {
  const db = await getDb()
  const existing = db
    .prepare(
      'SELECT episode_id, watched, want, dropped FROM episode_progress WHERE collection_id = ? AND (watched = 1 OR want = 1 OR dropped = 1)'
    )
    .all(collectionId) as { episode_id: number; watched: number; want: number; dropped: number }[]
  const markEntries = Object.entries(marks).map(([id, v]) => ({
    episodeId: Number(id),
    watched: !!v.watched,
    want: !!v.want,
    dropped: !!v.dropped
  }))
  const tx = db.transaction(
    (rows: { episodeId: number; watched: boolean; want: boolean; dropped: boolean }[]) => {
      for (const r of rows) {
        db.prepare(
          `INSERT INTO episode_progress (collection_id, episode_id, watched, want, dropped, watched_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(
             (SELECT watched_at FROM episode_progress WHERE collection_id = ? AND episode_id = ?),
             strftime('%s','now')))
           ON CONFLICT(collection_id, episode_id) DO UPDATE SET
             watched = excluded.watched,
             want = excluded.want,
             dropped = excluded.dropped,
             watched_at = CASE WHEN excluded.watched = 1 THEN strftime('%s','now') ELSE watched_at END`
        ).run(
          collectionId,
          r.episodeId,
          r.watched ? 1 : 0,
          r.want ? 1 : 0,
          r.dropped ? 1 : 0,
          collectionId,
          r.episodeId
        )
      }
      // 本地有标记但远端没有的集：清为未标记（对齐 Bangumi 的「未收藏」）
      const markedRemote = new Set(rows.map((r) => r.episodeId))
      for (const row of existing) {
        if (!markedRemote.has(row.episode_id)) {
          db.prepare(
            'UPDATE episode_progress SET watched = 0, want = 0, dropped = 0 WHERE collection_id = ? AND episode_id = ?'
          ).run(collectionId, row.episode_id)
        }
      }
    }
  )
  tx(markEntries)
}

/** 清空某收藏的全部单集标记（全量同步且远端该作品无任何单集标记时，使本地完全对齐 Bangumi）。 */
export async function clearAllEpisodeProgress(collectionId: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    'UPDATE episode_progress SET watched = 0, want = 0, dropped = 0 WHERE collection_id = ?'
  ).run(collectionId)
}
