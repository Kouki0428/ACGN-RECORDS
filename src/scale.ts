// 应用界面缩放：封装对 preload 桥 window.acgn.view.setZoomFactor 的调用。
// 采用浏览器式 zoom（webFrame.setZoomFactor），作用于整个渲染进程窗口，
// 实时生效、无需重启；缩放系数随渲染进程存活，重载后会重置，故由启动入口按
// 持久化设置重新应用（见 src/main.ts）。非 Electron 环境（如纯网页预览）静默忽略。

export function applyUiScale(factor: number): void {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  try {
    window.acgn?.view?.setZoomFactor?.(f)
  } catch {
    /* 桥未就绪或非 Electron 环境：静默忽略 */
  }
}

// 应用「主页卡片大小」：把缩放系数写入 :root 的 --card-scale，
// 供全局 .card / 主页 .hcard 等卡片样式统一等比缩放（非窗口 zoom，不影响布局流）。
export function applyCardScale(factor: number): void {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1
  try {
    document.documentElement.style.setProperty('--card-scale', String(f))
  } catch {
    /* 非浏览器环境：静默忽略 */
  }
}
