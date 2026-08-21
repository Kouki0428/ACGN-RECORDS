import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSearchOverlay } from './searchOverlay'

// 全局键盘快捷键：
// - Ctrl/Cmd + K：打开/关闭全局搜索（业界通用约定）
// - Ctrl/Cmd + ,：打开设置（macOS/VSCode 风格）
export function useAppHotkeys() {
  const router = useRouter()
  const search = useSearchOverlay()

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    const k = e.key.toLowerCase()
    if (k === 'k') {
      e.preventDefault()
      search.toggle()
    } else if (e.key === ',') {
      e.preventDefault()
      void router.push('/settings')
    }
  }

  onMounted(() => window.addEventListener('keydown', onKey))
  onUnmounted(() => window.removeEventListener('keydown', onKey))
}
