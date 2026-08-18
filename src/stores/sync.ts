import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SyncResult } from '@shared/types'

/** 同步状态管理：封装 push/pull/syncAll 调用与最近一次结果展示 */
export const useSyncStore = defineStore('sync', () => {
  const lastResult = ref<SyncResult | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)

  async function run(fn: () => Promise<SyncResult>): Promise<void> {
    busy.value = true
    error.value = null
    try {
      const r = await fn()
      lastResult.value = r
      if (r.error) error.value = r.error
    } catch (e) {
      error.value = String(e)
    } finally {
      busy.value = false
    }
  }

  function push() {
    return run(() => window.acgn.sync.pushAll())
  }
  function pull() {
    return run(() => window.acgn.sync.pullAll())
  }
  function pullFull() {
    return run(() => window.acgn.sync.pullAllFull())
  }
  function syncAll() {
    return run(() => window.acgn.sync.syncAll())
  }

  return { lastResult, busy, error, push, pull, pullFull, syncAll }
})
