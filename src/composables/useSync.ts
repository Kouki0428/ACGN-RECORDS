import { ref } from 'vue'

/** 同步动作的通用封装：调用主进程 sync:pushAll 并反馈结果。 */
export function useSync() {
  const syncing = ref(false)
  const lastResult = ref<{ pushed: number; failed: number } | null>(null)

  async function pushAll(opts?: { episodeMarks?: boolean }) {
    syncing.value = true
    try {
      lastResult.value = await window.acgn.sync.pushAll(opts)
    } finally {
      syncing.value = false
    }
    return lastResult.value
  }

  return { syncing, lastResult, pushAll }
}
