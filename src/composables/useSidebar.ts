import { ref } from 'vue'

// 侧边栏折叠状态：模块级共享（SidebarNav 的 :class 与折叠逻辑共用同一实例）
const collapsed = ref(localStorage.getItem('acgn-sidebar-collapsed') === '1')

function toggleSidebar() {
  const target = !collapsed.value
  collapsed.value = target
  localStorage.setItem('acgn-sidebar-collapsed', target ? '1' : '0')
  // 列数变化（卡片滑动/尺寸 FLIP 动画）由 useGridResizeFlip 的 ResizeObserver 统一接管：
  // 侧栏宽度 CSS 过渡(0.32s)会改变 .content / .home-cards 宽度 → RO 检测到宽度变化，
  // 在“跨列数阈值”处自动做 FLIP，无需此处再介入（避免双系统冲突/基线污染）。
}

export function useSidebar() {
  return { collapsed, toggleSidebar }
}
