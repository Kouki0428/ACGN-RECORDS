import electron from 'electron'
const { ipcMain } = electron
import type { EpisodeComment } from '../../shared/types'
import {
  getEpisode,
  getEpisodeComments,
  postEpisodeComment,
  postCommentReaction,
  getMe
} from '../services/api/bangumi'
import { getValidToken } from '../services/auth/oauth'
import { solveTurnstile } from '../services/captcha/turnstile'
import {
  addEpisodeComment,
  setEpisodeCommentSynced,
  listLocalEpisodeComments,
  getSyncedProviderCommentIds
} from '../services/db/repositories/episodeComments.repository'

/** 注册单集评论相关 IPC（详情 / 评论拉取 / 发评论 / 本地草稿）+ 当前用户信息。 */
export function registerEpisodeIpc(): void {
  // 单集详情（v0 /episodes/{id}，匿名可访问）：标题/集号/首播/时长/简介
  ipcMain.handle('episode:getDetail', async (_e, episodeId: number) => {
    if (!episodeId) throw new Error('缺少单集 id')
    return getEpisode(episodeId)
  })

  // 单集评论（p1 匿名 GET，裸数组）+ 本地自己发的评论（去重合并）。
  // 返回合并后按时间倒序的列表；mine=true 的本地评论优先（含未同步草稿，synced=false）。
  ipcMain.handle('episode:getComments', async (_e, episodeId: number, offset = 0) => {
    if (!episodeId) return { comments: [], total: 0 }
    const token = await getValidToken()
    const epKey = String(episodeId)
    const [remote, mine, syncedIds] = await Promise.all([
      getEpisodeComments(episodeId, offset, 20, token ?? undefined).catch(() => ({ comments: [], total: 0 })),
      listLocalEpisodeComments(epKey).catch(() => [] as any[]),
      getSyncedProviderCommentIds(epKey).catch(() => new Set<number>())
    ])
    // 已同步到 Bangumi 的本地评论会在 p1 列表里出现，按 provider_comment_id 去重避免重复
    const remoteFiltered = remote.comments.filter((c) => !syncedIds.has(c.id))
    // 顶层评论集合 + 按 id 建索引（远程评论用 provider id，本地草稿用本地 id），
    // 把本地子评论(parentId 非 null)归并到对应父评论的 replies；父评论未知则降级为顶层。
    const topLevel: EpisodeComment[] = []
    const byId = new Map<number, EpisodeComment>()
    for (const c of remoteFiltered) {
      c.replies = c.replies ?? []
      topLevel.push(c)
      byId.set(c.id, c)
    }
    for (const m of mine) {
      if (!m.parentId) {
        topLevel.push(m)
        byId.set(m.id, m)
      } else {
        const parent = byId.get(m.parentId)
        if (parent) {
          parent.replies = parent.replies ?? []
          parent.replies.push(m)
        } else {
          topLevel.push(m)
        }
      }
    }
    // 顶层按时间倒序；每条的 replies 按时间升序（回复从旧到新）
    topLevel.sort((a, b) => {
      const ta = typeof a.createdAt === 'number' ? a.createdAt : 0
      const tb = typeof b.createdAt === 'number' ? b.createdAt : 0
      return tb - ta
    })
    for (const c of topLevel) {
      if (c.replies && c.replies.length) {
        c.replies.sort((a, b) => {
          const ta = typeof a.createdAt === 'number' ? a.createdAt : 0
          const tb = typeof b.createdAt === 'number' ? b.createdAt : 0
          return ta - tb
        })
      }
    }
    return { comments: topLevel, total: remote.total + mine.length }
  })

  // 本地自己发的单集评论（含未同步草稿）
  ipcMain.handle('episode:listLocal', async (_e, episodeId: number) => {
    if (!episodeId) return []
    return listLocalEpisodeComments(String(episodeId))
  })

  // 发自己的单集评论：先存本地，已登录则 best-effort 真发 Bangumi（需 Turnstile）。
  // 未登录 / Turnstile 缺失 / 网络失败均仅本地存储（synced=false），绝不阻塞用户。
  ipcMain.handle(
    'episode:addComment',
    async (
      _e,
      payload: { providerSubjectId: string; episodeId: number; content: string; parentId?: number | null; relatedId?: number | null }
    ) => {
      const content = (payload.content || '').trim()
      if (!content) throw new Error('评论内容不能为空')
      if (!payload.episodeId) throw new Error('缺少单集 id')

      const localId = await addEpisodeComment(
        payload.providerSubjectId,
        String(payload.episodeId),
        content,
        payload.parentId ?? null
      )

      const token = await getValidToken()
      if (!token) return { id: localId, synced: false }

      const turnstile = await solveTurnstile()
      if (!turnstile) {
        console.warn('[episode:addComment] 未取得 Turnstile token，仅存本地')
        return { id: localId, synced: false }
      }
      try {
        const providerCommentId = await postEpisodeComment(
          payload.episodeId,
          content,
          token,
          turnstile,
          payload.relatedId ?? null
        )
        await setEpisodeCommentSynced(localId, providerCommentId)
        return { id: providerCommentId, synced: true }
      } catch (e) {
        console.warn('[episode:addComment] 真发 Bangumi 失败，仅存本地：', e)
        return { id: localId, synced: false }
      }
    }
  )

  // 给某条评论发表/取消表情回应（贴贴）：需登录，真发 Bangumi。
  // 端点 PUT /p1/episodes/-/comments/{id}/like（body {value}）；已做过该表情则 remove=true 用 DELETE 取消。
  // commentId 必须是 Bangumi 评论 id（远程评论=provider id；本地已同步评论=providerId）。
  // 未登录直接返回 synced=false；失败回退 synced=false 并带错误信息。
  ipcMain.handle(
    'episode:addReaction',
    async (_e, payload: { commentId: number; value: number; remove?: boolean }) => {
      const token = await getValidToken()
      if (!token) return { synced: false, error: '未登录' }
      try {
        await postCommentReaction(payload.commentId, payload.value, token, payload.remove ?? false)
        return { synced: true }
      } catch (e) {
        console.warn('[episode:addReaction] 发表表情回应失败：', e)
        return { synced: false, error: (e as Error)?.message ?? String(e) }
      }
    }
  )

  // 当前登录用户的头像/昵称（供单集评论「自己」卡显示）。未登录返回空对象。
  ipcMain.handle('auth:getMe', async () => {
    const token = await getValidToken()
    if (!token) return { username: undefined, nickname: undefined, avatar: undefined }
    const me = await getMe(token)
    if (!me) return { username: undefined, nickname: undefined, avatar: undefined }
    return {
      username: me.username ?? undefined,
      nickname: me.nickname ?? undefined,
      avatar: me.avatar ?? null
    }
  })
}
