import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SyncResult } from '@shared/types'
import { parseAppError } from '@/utils/appError'

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
      // 统一错误解析：剥离 [CODE] 前缀并附可行动提示，用户可见报错形态一致
      const info = parseAppError(e, '同步失败')
      error.value = info.hint ? `${info.message}（${info.hint}）` : info.message
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
