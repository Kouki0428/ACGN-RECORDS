import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * 自定义窗口控制（替代原生标题栏）。
 * 依赖 preload 暴露的 window.acgn.win（最小化 / 最大化切换 / 关闭 / 最大化状态）。
 */
export function useWindowChrome() {
  const maximized = ref(false)
  let unsub: (() => void) | null = null

  onMounted(async () => {
    const w = window.acgn?.win
    if (!w) return
    try {
      maximized.value = await w.isMaximized()
    } catch {
      /* 忽略：取状态失败不影响其余功能 */
    }
    unsub = w.onMaximizedChange((v) => {
      maximized.value = v
    })
  })

  onBeforeUnmount(() => {
    unsub?.()
  })

  return {
    maximized,
    minimize: () => window.acgn?.win?.minimize(),
    toggleMaximize: () => window.acgn?.win?.toggleMaximize(),
    close: () => window.acgn?.win?.close()
  }
}
