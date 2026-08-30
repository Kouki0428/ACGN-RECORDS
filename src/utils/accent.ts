// 自定义强调色：把用户选的颜色写入 :root 的 --accent / --accent-grad，
// 全局按钮渐变/激活态/边框高亮/进度条随之派生换色。null = 恢复样式表默认（粉）。

function hexToHsl(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hh = 0
  if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hh = ((b - r) / d + 2) / 6
  else hh = ((r - g) / d + 4) / 6
  return [Math.round(hh * 360), Math.round(s * 100), Math.round(l * 100)]
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (v: number) =>
    Math.round(255 * v)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

export function applyAccent(color: string | null) {
  const root = document.documentElement
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-grad')
    return
  }
  const [h, s, l] = hexToHsl(color)
  // 渐变第二停靠点：亮度 +10%（上限保护），形成同色系微渐变
  const lighter = hslToHex(h, s, Math.min(92, l + 10))
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-grad', `linear-gradient(135deg, ${color} 0%, ${lighter} 100%)`)
}

// 辅助色：控制卡片激活边框 / 输入框激活边框等次级强调元素，默认浅蓝（由 main.css 兜底）。
// null / 空 = 恢复样式表默认（--accent-aux: #5b9dff）。
export function applyAux(color: string | null) {
  const root = document.documentElement
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    root.style.removeProperty('--accent-aux')
    return
  }
  root.style.setProperty('--accent-aux', color)
}
