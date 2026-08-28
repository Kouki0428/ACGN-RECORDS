import { computed, ref } from 'vue'

// 网格卡片分页：每页固定张数，页码越界自动钳制；总数不超一页时隐藏分页条（show=false）。
// 目的：把超长收藏（数百张卡）的 DOM 规模压到每页 ≤100，卡片布局/动画成本与总数解耦。
export function usePagination<T>(getSource: () => T[], pageSize = 100) {
  const page = ref(1)
  const total = computed(() => getSource().length)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
  const paged = computed(() => {
    const src = getSource()
    const p = Math.min(Math.max(1, page.value), totalPages.value)
    return src.slice((p - 1) * pageSize, p * pageSize)
  })
  const show = computed(() => total.value > pageSize)
  // 数据源切换（分类/状态 tab、重新加载）时回到第一页
  function reset() {
    page.value = 1
  }
  return { page, total, totalPages, paged, show, reset }
}
