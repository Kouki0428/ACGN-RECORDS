// 应用图标 v4：全屏品牌渐变 + 白色播放按钮负空间
// 设计参考 YouTube/Netflix 模式——全出血渐变底 + 白色几何元素，最简洁最有辨识度
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'build')
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

const PINK   = [255, 92, 138]
const PURPLE = [140, 82, 255]
const ORANGE = [255, 138, 92]

function lerp(a, b, t) { return a + (b - a) * t }

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const s = size
  const radius = s * 0.22
  const cx = s / 2, cy = s / 2

  // 播放三角形顶点（居中略偏右，视觉平衡）
  const triCx = cx + s * 0.03
  const triSize = s * 0.18
  const tri = [
    { x: triCx - triSize * 0.58, y: cy - triSize },
    { x: triCx - triSize * 0.58, y: cy + triSize },
    { x: triCx + triSize * 0.72, y: cy }
  ]
  function inTriangle(x, y) {
    const [a, b, c] = tri
    const d1 = (x - b.x) * (a.y - b.y) - (a.x - b.x) * (y - b.y)
    const d2 = (x - c.x) * (b.y - c.y) - (b.x - c.x) * (y - c.y)
    const d3 = (x - a.x) * (c.y - a.y) - (c.x - a.x) * (y - a.y)
    return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))
  }

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const o = (y * s + x) * 4

      // 圆角方形裁剪
      const rr = radius
      const rx = Math.min(Math.max(x, rr), s - rr)
      const ry = Math.min(Math.max(y, rr), s - rr)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rr ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // 全屏对角渐变：紫→粉→橙
      const gx = x / s, gy = y / s
      const diagT = Math.max(0, Math.min(1, (gx + gy) / 2))
      let r, g, b
      if (diagT < 0.5) {
        const t = diagT / 0.5
        r = Math.round(lerp(PURPLE[0], PINK[0], t))
        g = Math.round(lerp(PURPLE[1], PINK[1], t))
        b = Math.round(lerp(PURPLE[2], PINK[2], t))
      } else {
        const t = (diagT - 0.5) / 0.5
        r = Math.round(lerp(PINK[0], ORANGE[0], t))
        g = Math.round(lerp(PINK[1], ORANGE[1], t))
        b = Math.round(lerp(PINK[2], ORANGE[2], t))
      }

      // 播放三角（白色）
      if (inTriangle(x, y)) {
        r = 255; g = 255; b = 255
      }

      px[o] = r; px[o+1] = g; px[o+2] = b; px[o+3] = 255
    }
  }
  return px
}

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
console.log(`✓ icon.ico ${icoBuf.length}B | icon.png ${pngs[pngs.length - 1].data.length}B`)
