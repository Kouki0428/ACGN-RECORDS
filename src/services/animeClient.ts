import type {
  Subject,
  AnimeDetail,
  AnimeWatchingItem,
  AnimeStats,
  EpisodeMarkPayload,
  EpisodeProgressState
} from '@shared/types'

/** 渲染进程对动画模块主进程能力的封装 */
export const animeClient = {
  addToWatching: (subject: Subject) => window.acgn.anime.addToWatching(subject),
  // 本地优先通道；若 preload 未暴露（旧构建）则回退到完整详情，避免详情打不开
  getDetailLocal: (subjectId: number) => {
    const a = window.acgn.anime as unknown as Record<string, (id: number) => Promise<AnimeDetail>>
    return typeof a.getDetailLocal === 'function'
      ? a.getDetailLocal(subjectId)
      : a.getDetail(subjectId)
  },
  // 批量本地详情（主页动画卡片一次 IPC）；preload 未暴露时回退逐条拉取
  getDetailsLocal: async (subjectIds: number[]): Promise<AnimeDetail[]> => {
    const a = window.acgn.anime as unknown as Record<
      string,
      ((ids: number[]) => Promise<AnimeDetail[]>) | ((id: number) => Promise<AnimeDetail>)
    >
    if (typeof a.getDetailsLocal === 'function') {
      return (a.getDetailsLocal as (ids: number[]) => Promise<AnimeDetail[]>)(subjectIds)
    }
    return Promise.all(
      subjectIds.map((id) =>
        (a.getDetailLocal as (id: number) => Promise<AnimeDetail>)(id).catch(
          () =>
            ({
              subject: null,
              collection: null,
              episodes: [],
              progress: {},
              characters: [],
              relations: []
            }) as unknown as AnimeDetail
        )
      )
    )
  },
  getDetail: (subjectId: number) => window.acgn.anime.getDetail(subjectId),
  toggleEpisode: (collectionId: number, episodeId: number) =>
    window.acgn.anime.toggleEpisode(collectionId, episodeId),
  setEpisodeStatus: (collectionId: number, payload: EpisodeMarkPayload) =>
    window.acgn.anime.setEpisodeStatus(collectionId, payload) as Promise<{
      progress: Record<number, EpisodeProgressState>
      epStatus: number
    }>,
  listWatching: (status = 3) => window.acgn.anime.listWatching(status) as Promise<AnimeWatchingItem[]>,
  getStats: () => window.acgn.anime.getStats() as Promise<AnimeStats>
}
