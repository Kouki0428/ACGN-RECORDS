// 重新设计应用图标 v2：
// 深色圆角方块底 + 品牌渐变播放三角 + 环形进度弧线（追踪感）
// 运行：node scripts/gen-icon.mjs → build/icon.ico + build/icon.png
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c, table = []
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const stride = w * 4 + 1
  const raw = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── 调色板 ──
const BG_TOP   = [15, 18, 26]     // #0f121a 深色顶
const BG_BOT   = [22, 27, 38]     // #161b26 深色底
const PINK     = [255, 92, 138]   // #ff5c8a 品牌粉
const ORANGE   = [255, 138, 92]   // #ff8a5c 暖橙
const BLUE     = [91, 157, 255]   // #5b9dff 蓝
const WHITE    = [235, 239, 245]  // #ebeff5 白

function lerp(a, b, t) { return a + (b - a) * t }
function gradColor(t, from, to) {
  return [
    Math.round(lerp(from[0], to[0], t)),
    Math.round(lerp(from[1], to[1], t)),
    Math.round(lerp(from[2], to[2], t))
  ]
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const s = size
  const radius = s * 0.225
  const cx = s / 2, cy = s / 2

  function inRoundRect(x, y) {
    if (x < 0 || x >= s || y < 0 || y >= s) return false
    const rr = radius
    const rx = Math.min(Math.max(x, rr), s - rr)
    const ry = Math.min(Math.max(y, rr), s - rr)
    return (x - rx) ** 2 + (y - ry) ** 2 <= rr ** 2
  }

  // 归一化坐标 [-1, 1]
  const nx = (x) => (x - cx) / (s / 2)
  const ny = (y) => (y - cy) / (s / 2)

  // 渐变三角形的三个顶点（归一化）
  const tri = [
    { x: -0.18, y: -0.34 },  // 左上
    { x: -0.18, y: 0.34 },   // 左下
    { x: 0.42, y: 0.0 }      // 右中（尖端）
  ]
  function inTriangle(px_, py_) {
    const ax = tri[0].x, ay = tri[0].y
    const bx = tri[1].x, by = tri[1].y
    const cx2 = tri[2].x, cy2 = tri[2].y
    const d1 = (px_ - bx) * (ay - by) - (ax - bx) * (py_ - by)
    const d2 = (px_ - cx2) * (by - cy2) - (bx - cx2) * (py_ - cy2)
    const d3 = (px_ - ax) * (cy2 - ay) - (cx2 - ax) * (py_ - ay)
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0)
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0)
    return !(hasNeg && hasPos)
  }
  // 三角形内渐变 t：从左到右 0→1
  function triT(px_, py_) {
    return (px_ - tri[0].x) / (tri[2].x - tri[0].x)
  }

  // 进度弧线参数：半径、粗细、起始角/结束角
  const arcR = 0.72
  const arcW = 0.075
  const arcStart = -Math.PI * 0.5  // 从顶部开始
  const arcEnd = Math.PI * 0.65    // 约 230°

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      if (!inRoundRect(x, y)) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }
      const _x = nx(x), _y = ny(y)
      const dist = Math.hypot(_x, _y)

      // 背景：深色垂直微渐变
      let bgT = (y / s)
      let r = Math.round(lerp(BG_TOP[0], BG_BOT[0], bgT))
      let g = Math.round(lerp(BG_TOP[1], BG_BOT[1], bgT))
      let b = Math.round(lerp(BG_TOP[2], BG_BOT[2], bgT))

      // 进度弧线（品牌粉→蓝渐变）
      const angle = Math.atan2(_y, _x)
      let normAngle = angle
      if (normAngle < arcStart) normAngle += Math.PI * 2
      const arcSpan = arcEnd - arcStart
      if (normAngle >= arcStart && normAngle <= arcStart + arcSpan) {
        const arcDist = Math.abs(dist - arcR)
        if (arcDist < arcW / 2) {
          const at = (normAngle - arcStart) / arcSpan
          const c = gradColor(at, PINK, BLUE)
          r = c[0]; g = c[1]; b = c[2]
        }
      }

      // 播放三角形（品牌粉→暖橙渐变）
      if (inTriangle(_x, _y)) {
        const tt = triT(_x, _y)
        const c = gradColor(tt, PINK, ORANGE)
        r = c[0]; g = c[1]; b = c[2]
      }

      px[o] = r; px[o+1] = g; px[o+2] = b; px[o+3] = 255
    }
  }
  return px
}

// ── ICO 容器 ──
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const pngs = SIZES.map(s => ({ s, data: encodePNG(s, s, drawIcon(s)) }))
const count = SIZES.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(count, 4)

const dirEntries = []
let offset = 6 + count * 16
for (const p of pngs) {
  const e = Buffer.alloc(16)
  e.writeUInt8(p.s >= 256 ? 0 : p.s, 0)
  e.writeUInt8(p.s >= 256 ? 0 : p.s, 1)
  e.writeUInt8(0, 2)
  e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32BE(p.data.length, 8)
  e.writeUInt32LE(offset, 12)
  dirEntries.push(e)
  offset += p.data.length
}
const icoBuf = Buffer.concat([header, ...dirEntries, ...pngs.map(p => p.data)])
writeFileSync(join(outDir, 'icon.ico'), icoBuf)
writeFileSync(join(outDir, 'icon.png'), pngs[pngs.length - 1].data)
console.log(`✓ icon.ico ${icoBuf.length}B | icon.png ${pngs[pngs.length-1].data.length}B`)
