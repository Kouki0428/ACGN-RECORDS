import { ref } from 'vue'

// 模态搜索开关：模块级单例，SidebarNav（打开）与 SearchOverlay（读取/关闭）共享
const isOpen = ref(false)

export function useSearchOverlay() {
  return {
    isOpen,
    open: () => {
      isOpen.value = true
    },
    close: () => {
      isOpen.value = false
    },
    toggle: () => {
      isOpen.value = !isOpen.value
    }
  }
}
