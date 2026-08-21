// 网格方向键导航：焦点在列表卡片（.card[role=button] / .hcard）上时，
// ↑↓←→ 在网格卡片间移动焦点（按 offsetTop 分行、列内就近对齐），Enter/Space 打开
// 由卡片自身的 keydown 处理。输入框聚焦时不拦截。

const CARD_SELECTOR = '.card[role="button"], .hcard'

function onGridKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  const ae = document.activeElement as HTMLElement | null
  if (!ae || (!ae.classList.contains('card') && !ae.classList.contains('hcard'))) return
  if (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) return

  const grid = ae.parentElement
  if (!grid) return
  const items = Array.from(grid.querySelectorAll<HTMLElement>(`:scope > ${CARD_SELECTOR}`))
  const i = items.indexOf(ae)
  if (i < 0) return

  // 按 offsetTop 分行（4px 容差），行内按 DOM 序即列序
  const rows: HTMLElement[][] = []
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r[0].offsetTop - it.offsetTop) < 4)
    if (row) row.push(it)
    else rows.push([it])
  }
  const rowIdx = rows.findIndex((r) => r.includes(ae))
  if (rowIdx < 0) return
  const colIdx = rows[rowIdx].indexOf(ae)

  let target: HTMLElement | undefined
  if (e.key === 'ArrowLeft') target = rows[rowIdx][colIdx - 1]
  else if (e.key === 'ArrowRight') target = rows[rowIdx][colIdx + 1]
  else if (e.key === 'ArrowUp') {
    const up = rows[rowIdx - 1]
    // 上/下：优先同列，无同列则取该行最接近的列
    if (up) target = up[colIdx] ?? up.reduce((best, c) => (Math.abs(c.offsetLeft - ae.offsetLeft) < Math.abs(best.offsetLeft - ae.offsetLeft) ? c : best), up[0])
  } else {
    const down = rows[rowIdx + 1]
    if (down) target = down[colIdx] ?? down.reduce((best, c) => (Math.abs(c.offsetLeft - ae.offsetLeft) < Math.abs(best.offsetLeft - ae.offsetLeft) ? c : best), down[0])
  }

  if (target) {
    e.preventDefault()
    target.focus()
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

export function installGridNav() {
  window.addEventListener('keydown', onGridKey)
}
