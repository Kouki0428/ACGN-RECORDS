// 应用图标 v3：深色底 + 品牌渐变圆角菱形 + 白色中心圆 + 柔光晕
// 极简几何、高辨识度、小尺寸清晰
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

const BG_A = [10, 13, 20]
const BG_B = [16, 20, 30]
const PINK  = [255, 92, 138]
const PEACH = [255, 138, 92]
const WHITE = [240, 244, 250]

function lerp(a, b, t) { return a + (b - a) * t }
function mix(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t))
  ]
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const s = size
  const radius = s * 0.22
  const cx = s / 2, cy = s / 2
  const diaR = s * 0.31
  const diaRound = s * 0.04

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

      // 背景：深蓝黑垂直渐变
      const bt = y / s
      let r = Math.round(lerp(BG_A[0], BG_B[0], bt))
      let g = Math.round(lerp(BG_A[1], BG_B[1], bt))
      let b = Math.round(lerp(BG_A[2], BG_B[2], bt))

      // 菱形 SDF 距离
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy)
      const sdD = (dx + dy) - diaR

      // 外发光
      if (sdD > -diaRound && sdD < diaRound + s * 0.08) {
        const glowT = Math.max(0, 1 - Math.abs(sdD) / (s * 0.08))
        if (glowT > 0 && sdD > -diaRound) {
          const ga = glowT * glowT * 0.15
          r = Math.round(lerp(r, PINK[0], ga))
          g = Math.round(lerp(g, PINK[1], ga))
          b = Math.round(lerp(b, PINK[2], ga))
        }
      }

      // 菱形内部：对角粉→橙渐变
      if (sdD < -diaRound) {
        const t = ((x / s - 0.5) + (y / s - 0.5)) / 2 + 0.5
        const c = mix(PINK, PEACH, Math.max(0, Math.min(1, t)))
        r = c[0]; g = c[1]; b = c[2]

        // 内圆点（白色）
        const innerDist = Math.hypot(x - cx, y - cy)
        const innerR = s * 0.065
        const aaW = s * 0.006
        const alpha = Math.max(0, Math.min(1, (innerR - innerDist) / aaW + 0.5))
        r = Math.round(lerp(r, WHITE[0], alpha))
        g = Math.round(lerp(g, WHITE[1], alpha))
        b = Math.round(lerp(b, WHITE[2], alpha))
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
