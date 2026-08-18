import { ref, watch, onMounted } from 'vue'
import { collectionClient } from '@/services/collectionClient'
import { useCollectionModal } from '@/composables/useCollectionModal'

/**
 * 查询某个作品（按 providerSubjectId）是否已收藏，并返回其收藏状态（status 1-5）。
 * - 挂载时查询一次；providerSubjectId 变化（换条目）时重查。
 * - 监听全局收藏悬浮窗的 refreshTick：当本作品被保存 / 删除后自动刷新状态，
 *   使「收藏」按钮能即时切换为「已收藏状态」徽标（或反之）。
 * 传入 getPid 为返回 providerSubjectId 的 getter（保持响应式）。
 */
export function useCollectedStatus(getPid: () => string) {
  const status = ref<number | null>(null)
  const loading = ref(false)
  const modal = useCollectionModal()

  async function load() {
    const pid = getPid()
    if (!pid) {
      status.value = null
      return
    }
    loading.value = true
    try {
      const r = await collectionClient.getExisting(pid)
      status.value = r.status
    } catch {
      status.value = null
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  watch(getPid, load)
  watch(
    () => [modal.refreshTick.value, modal.providerSubjectId.value],
    () => {
      if (modal.providerSubjectId.value === getPid()) load()
    }
  )

  return { status, loading }
}
