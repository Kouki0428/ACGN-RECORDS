import { ref } from 'vue'

// 全局 Toast 通知（模块级单例）：轻量操作反馈（保存成功/失败等），
// 不打断流程、自动消失；宿主组件 ToastHost 挂载在 App.vue。
export interface ToastItem {
  id: number
  text: string
  kind: 'ok' | 'err' | 'info'
}

const toasts = ref<ToastItem[]>([])
let seq = 0
let maxCount = 4

function push(text: string, kind: ToastItem['kind'] = 'ok', duration = 2600) {
  const id = ++seq
  toasts.value.push({ id, text, kind })
  // 超出上限时移除最早的，防止连续操作堆积
  while (toasts.value.length > maxCount) toasts.value.shift()
  window.setTimeout(() => dismiss(id), duration)
}

function dismiss(id: number) {
  const i = toasts.value.findIndex((t) => t.id === id)
  if (i !== -1) toasts.value.splice(i, 1)
}

export function useToast() {
  return {
    toasts,
    dismiss,
    ok: (text: string) => push(text, 'ok'),
    err: (text: string) => push(text, 'err'),
    info: (text: string) => push(text, 'info')
  }
}
