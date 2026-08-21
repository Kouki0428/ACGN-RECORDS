import { ref } from 'vue'

// 全局右键菜单（模块级单例）：任意视图通过 open(event, items) 弹出，
// 组件 ContextMenu.vue 挂载于 App.vue 负责渲染与定位钳制。

export interface MenuItem {
  key: string
  label: string
  /** 当前选中（状态组打勾用） */
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  /** 该项之前显示分隔线 */
  separatorBefore?: boolean
  action?: () => void
}

interface MenuState {
  visible: boolean
  x: number
  y: number
  items: MenuItem[]
}

const state = ref<MenuState>({ visible: false, x: 0, y: 0, items: [] })

function open(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault()
  state.value = { visible: true, x: e.clientX, y: e.clientY, items }
}

function close() {
  if (!state.value.visible) return
  state.value = { ...state.value, visible: false }
}

function run(item: MenuItem) {
  if (item.disabled) return
  close()
  item.action?.()
}

export function useContextMenu() {
  return { state, open, close, run }
}
