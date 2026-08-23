// 生成应用图标：品牌粉渐变圆角方块 + 白色 "A" 字母，输出多尺寸 .ico + .png
// 运行：node scripts/gen-icon.mjs（写入 build/icon.ico 与 build/icon.png）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

// ── PNG 编码 ──
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
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
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

// ── 绘制 ──
const GRAD_FROM = [255, 92, 138]   // #ff5c8a
const GRAD_TO   = [255, 138, 92]   // #ff8a5c
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const r = size * 0.22 // 圆角半径
  const cx = size / 2, cy = size / 2
  // 字母 "A" 的笔画参数（归一化坐标 → 像素）
  function drawA(x, y) {
    // 归一化到 0..1 空间
    const nx = x / size, ny = y / size
    // A 的左斜线、右斜线、横杠（用简单区域判断）
    // 左笔画：(0.28,0.82)→(0.44,0.18)，宽 ~0.07
    // 右笔画：(0.72,0.82)→(0.56,0.18)，宽 ~0.07
    // 横杠：(0.35,0.58)→(0.65,0.58)，高 ~0.06
    function distToSeg(px_, py_, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay
      const t = Math.max(0, Math.min(1, ((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy))
    }
    const halfW = 0.042
    // 左斜
    if (distToSeg(nx, ny, 0.30, 0.84, 0.46, 0.16) < halfW && ny > 0.14 && ny < 0.86) return true
    // 右斜
    if (distToSeg(nx, ny, 0.70, 0.84, 0.54, 0.16) < halfW && ny > 0.14 && ny < 0.86) return true
    // 横杠
    if (ny > 0.52 && ny < 0.60 && nx > 0.34 && nx < 0.66) return true
    return false
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      // 圆角方块判定
      const rr = r
      const rx = Math.min(Math.max(x, rr), size - rr)
      const ry = Math.min(Math.max(y, rr), size - rr)
      const inRound = (x - rx) ** 2 + (y - ry) ** 2 <= rr ** 2
      if (!inRound) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }
      // 对角线渐变（左上→右下）
      const t = (x + y) / (size * 2)
      const cr = Math.round(GRAD_FROM[0] + (GRAD_TO[0] - GRAD_FROM[0]) * t)
      const cg = Math.round(GRAD_FROM[1] + (GRAD_TO[1] - GRAD_FROM[1]) * t)
      const cb = Math.round(GRAD_FROM[2] + (GRAD_TO[2] - GRAD_FROM[2]) * t)
      px[o] = cr; px[o+1] = cg; px[o+2] = cb; px[o+3] = 255
      // 白色 "A" 字母
      if (drawA(x, y)) {
        px[o] = 255; px[o+1] = 255; px[o+2] = 255
      }
    }
  }
  return px
}

// ── ICO 容器 ──
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const pngs = SIZES.map(s => ({ s, data: encodePNG(s, s, drawIcon(s)) }))

// ICO header
const count = SIZES.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type=icon
header.writeUInt16LE(count, 4)

// Directory entries (16 bytes each)
const dirEntries = []
let offset = 6 + count * 16
for (const p of pngs) {
  const e = Buffer.alloc(16)
  e.writeUInt8(p.s >= 256 ? 0 : p.s, 0) // width
  e.writeUInt8(p.s >= 256 ? 0 : p.s, 1) // height
  e.writeUInt8(0, 2) // colors
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32BE(p.data.length, 8)
  e.writeUInt32LE(offset, 12)
  dirEntries.push(e)
  offset += p.data.length
}

// Assemble
const icoData = [header, ...dirEntries, ...pngs.map(p => p.data)]
const icoBuf = Buffer.concat(icoData)
writeFileSync(join(outDir, 'icon.ico'), icoBuf)

// Also save 256px PNG (for Linux/Mac/general use)
writeFileSync(join(outDir, 'icon.png'), pngs[pngs.length - 1].data)

console.log(`✓ icon.ico (${SIZES.join(',')}) ${icoBuf.length} bytes`)
console.log(`✓ icon.png 256×256`)
