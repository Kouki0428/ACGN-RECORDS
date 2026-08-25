import { ref } from 'vue'

/**
 * 讨论板的「纯数据持有」单例（与 useEpisodeCommentModal 同构）。
 * 讨论板作为 useEntityCard 导航栈的第 5 种 body（kind === 'topic'）并入
 * EntitySubjectCard 同一 overlay 容器：从作品悬浮窗/详情页点讨论进入时，
 * 悬浮窗容器不卸载、仅切换内容；返回按钮 = 卡片导航栈 back() 回到上一层（通常是作品卡）。
 *
 * 本文件只保存「当前要展示哪个讨论串」的 id；overlay 的挂载/卸载、层级、关闭语义
 * 全部交给 useEntityCard + EntitySubjectCard。
 */
const topicId = ref<number | null>(null)

export function useTopicBoard() {
  /** 写入当前讨论串 id（不触发任何 overlay 开关；overlay 由 useEntityCard 统一控制） */
  function setData(id: number) {
    topicId.value = id
  }

  return { topicId, setData }
}
