import { ref } from 'vue'
import type { UserStats } from '@shared/types'

/**
 * 数据统计悬浮窗（UserStatsModal）的全局单例状态。
 * 任何位置（个人页「数据统计」按钮）调用 open() 即可打开同一个模态，
 * 关闭后状态复位。App 的鼠标侧键后退拦截据此感知悬浮窗是否打开：
 * 打开时后退直接关闭悬浮窗，而不是触发路由后退。
 */
const isOpen = ref(false)
const stats = ref<UserStats | null>(null)

export function useUserStatsModal() {
  function open(s: UserStats | null) {
    stats.value = s
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
  }
  return { isOpen, stats, open, close }
}