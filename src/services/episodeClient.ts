import type { EpisodeComment, EpisodeDetail } from '@shared/types'

/** 单集评论客户端：拉取单集详情/评论、发表自己的评论（真发 Bangumi + 本地）、取当前用户头像昵称 */
export const episodeClient = {
  /** 单集详情（标题/集号/首播/时长/简介），驱动评论悬浮窗上半部分 */
  getDetail: (episodeId: number): Promise<EpisodeDetail> =>
    window.acgn.episode.getDetail(episodeId),
  /** 单集评论（他人 + 自己已发，去重合并，按时间倒序） */
  getComments: (episodeId: number, offset = 0) =>
    window.acgn.episode.getComments(episodeId, offset) as Promise<{
      comments: EpisodeComment[]
      total: number
    }>,
  /** 发自己的单集评论/子评论：先存本地，已登录则 best-effort 真发 Bangumi（子评论带 parentId/relatedId） */
  addComment: (payload: {
    providerSubjectId: string
    episodeId: number
    content: string
    parentId?: number | null
    relatedId?: number | null
  }) =>
    window.acgn.episode.addComment(payload) as Promise<{ id: number; synced: boolean }>,
  /** 仅读本地自己发的评论（含未同步草稿） */
  listLocal: (episodeId: number): Promise<EpisodeComment[]> =>
    window.acgn.episode.listLocal(episodeId),
  /** 给某条评论发表/取消表情回应（贴贴）：需登录，真发 Bangumi。
   *  commentId = Bangumi 评论 id，value = 表情类别整数，remove=true 表示取消（已选该表情再次点击）。 */
  toggleReaction: (payload: { commentId: number; value: number; remove?: boolean }) =>
    window.acgn.episode.toggleReaction(payload) as Promise<{ synced: boolean; error?: string }>,
  /** 当前登录用户的头像/昵称（评论「自己」卡显示） */
  getMe: () =>
    window.acgn.auth.getMe() as Promise<{ username?: string; nickname?: string; avatar?: string | null }>
}
