import { ref } from 'vue'

/**
 * 单集评论的「纯数据持有」单例。
 * 它不再管理自己的 overlay / 开关 / 过渡——单集评论现已作为 useEntityCard 导航栈的
 * 第 4 种 body（kind === 'episode'）并入 EntitySubjectCard 同一 overlay 容器：
 * 从作品悬浮窗点剧集进入单集评论时，悬浮窗容器不卸载、仅把头部「作品名」替换为「单集标题」、
 * 下方内容进行加载（与角色↔作品在同一 overlay 内只换内部内容的体验完全一致）。
 *
 * 因此本文件只负责保存「当前要展示哪一集」的数据（providerSubjectId / episodeId / meta），
 * 由 setData() 写入；overlay 的挂载/卸载、层级、关闭语义全部交给 useEntityCard + EntitySubjectCard。
 * 点击剧集格子（EpisodeGrid）/ 站内 ep 链接（BgmBbcode）会先 setData 再 entity.push('episode', id)。
 */
export interface EpisodeMeta {
  epNumber?: number | null
  title?: string | null
  airDate?: string | null
  duration?: string | null
}

const providerSubjectId = ref('')
const episodeId = ref(0)
const meta = ref<EpisodeMeta>({})

export function useEpisodeCommentModal() {
  /** 写入当前单集数据（不触发任何 overlay 开关；overlay 由 useEntityCard 统一控制） */
  function setData(pid: string, epId: number, m?: EpisodeMeta) {
    providerSubjectId.value = pid
    episodeId.value = epId
    meta.value = m ?? {}
  }

  return {
    providerSubjectId,
    episodeId,
    meta,
    setData
  }
}
