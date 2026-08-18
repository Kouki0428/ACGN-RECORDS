import type {
  SubjectComment,
  EntityDetail,
  SubjectFullDetail,
  SubjectCharacter,
  SubjectPerson,
  EpisodeProgressState,
  SubjectFullEpisode
} from '@shared/types'

/** 条目维度客户端：当前用于拉取 Bangumi 条目吐槽区中其它用户的吐槽，以及角色/人物/作品详情 */
export const subjectClient = {
  getComments: (subjectId: string, offset = 0) =>
    window.acgn.subject.getComments(subjectId, offset) as Promise<{
      comments: SubjectComment[]
      total: number
      notFound?: boolean
    }>,
  /** 取角色/人物详情（替代跳转 bgm 网页） */
  getEntity: (kind: 'character' | 'person', id: number): Promise<EntityDetail> =>
    window.acgn.subject.getEntity(kind, id),
  /** 取作品完整详情（点击角色卡「出演作品」打开的卡片）；withCn=false 首屏快开，中文名再用 getCharacters 补 */
  detailFull: (id: number, opts?: { withCn?: boolean }): Promise<SubjectFullDetail> =>
    window.acgn.subject.detailFull(id, opts),
  /** 本地优先：先返回离线/缓存详情（含 Archive 站点均分、角色、关联），不联网、瞬时。悬浮窗打开即调用，再 detailFull 静默替换 */
  detailLocal: (id: number): Promise<SubjectFullDetail | null> =>
    window.acgn.subject.detailLocal(id),
  /** 首屏后异步补全角色/CV 中文名（结构与 detailFull.characters 一致，前端按 id 合并） */
  getCharacters: (id: number): Promise<SubjectCharacter[]> =>
    window.acgn.subject.characters(id),
  /** 取作品制作人员（staff：作者/导演/原画/制作公司 等），供制作信息按名匹配后跳转人物卡 */
  getPersons: (id: number): Promise<SubjectPerson[]> =>
    window.acgn.subject.persons(id),
  /** 取某作品本地收藏与逐集进度（悬浮窗剧集着色用） */
  getProgress: (providerSubjectId: string) =>
    window.acgn.subject.getProgress(providerSubjectId) as Promise<{
      collectionId: number | null
      progress: Record<number, EpisodeProgressState>
    }>,
  /** 从 Bangumi 拉取单集标记并合并/对比进本地（详情页 force+reconcile；悬浮窗缓存模式）。
   *  force 模式会同时返回真实剧集骨架 episodes，使首次打开即可即时显色。 */
  pullEpisodeProgress: (providerSubjectId: string, opts?: { force?: boolean; reconcile?: boolean }) =>
    window.acgn.subject.pullEpisodeProgress(providerSubjectId, opts) as Promise<{
      collectionId: number | null
      progress: Record<number, EpisodeProgressState>
      episodes: SubjectFullEpisode[]
    }>,
  /** 取某作品本地缓存的剧集（瞬时，不联网），悬浮窗打开时优先用于瞬时显示真实集号/标题 */
  getEpisodes: (providerSubjectId: string): Promise<SubjectFullEpisode[]> =>
    window.acgn.subject.getEpisodes(providerSubjectId)
}
