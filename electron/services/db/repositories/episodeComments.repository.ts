import { getDb } from '../connection'
import type { EpisodeComment } from '../../../../shared/types'

/**
 * 单集评论本地草稿仓储（episode_comments 表）。
 * 用户发表单集评论时：先落本地（synced=0），真发 Bangumi 成功后回填 provider_comment_id + synced=1。
 * 与 p1 取回的他人评论按 provider_comment_id 去重，避免重复展示自己已同步的评论。
 */

/** 新增一条本地评论草稿，返回本地自增 id（synced=0）。
 *  parentId 为父评论 id（发表子评论时填；顶层评论省略）。 */
export async function addEpisodeComment(
  providerSubjectId: string,
  providerEpisodeId: string,
  content: string,
  parentId?: number | null
): Promise<number> {
  const db = await getDb()
  const now = Math.floor(Date.now() / 1000)
  const info = db
    .prepare(
      `INSERT INTO episode_comments
        (provider_subject_id, provider_episode_id, provider_comment_id, parent_id, content, created_at, updated_at, synced)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 0)`
    )
    .run(providerSubjectId, providerEpisodeId, parentId ?? null, content, now, now)
  return Number(info.lastInsertRowid)
}

/** 真发成功后回填 Bangumi 评论 id 并标记已同步。 */
export async function setEpisodeCommentSynced(
  localId: number,
  providerCommentId: number
): Promise<void> {
  const db = await getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `UPDATE episode_comments
     SET provider_comment_id = ?, synced = 1, updated_at = ?
     WHERE id = ?`
  ).run(providerCommentId, now, localId)
}

/** 读某单集的本地评论（含未同步草稿），按创建时间升序。creator 占位由调用方按当前用户填充。 */
export async function listLocalEpisodeComments(
  providerEpisodeId: string
): Promise<EpisodeComment[]> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT id, content, created_at, synced, provider_comment_id, parent_id
       FROM episode_comments
       WHERE provider_episode_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(providerEpisodeId) as Array<{
    id: number
    content: string
    created_at: number
    synced: number
    provider_comment_id: number | null
    parent_id: number | null
  }>
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    createdAt: r.created_at,
    creator: { username: '', nickname: '', avatar: null },
    mine: true,
    synced: !!r.synced,
    parentId: r.parent_id ?? null,
    providerId: r.provider_comment_id ?? null
  }))
}

/** 取已同步的本地评论对应的 Bangumi 评论 id 集合（用于与 p1 评论去重）。 */
export async function getSyncedProviderCommentIds(
  providerEpisodeId: string
): Promise<Set<number>> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT provider_comment_id FROM episode_comments
       WHERE provider_episode_id = ? AND synced = 1 AND provider_comment_id IS NOT NULL`
    )
    .all(providerEpisodeId) as Array<{ provider_comment_id: number }>
  return new Set(rows.map((r) => r.provider_comment_id))
}
