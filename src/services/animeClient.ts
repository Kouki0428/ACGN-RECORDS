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
