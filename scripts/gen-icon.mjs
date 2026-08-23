// 应用图标：品牌粉纯色底 + 大型白色心形（喜爱 / 追踪 ACGN 作品）
// 扁平极简设计，4× 超采样抗锯齿
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'build')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c, t = []
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  let cr = 0xffffffff
  for (const b of buf) cr = t[(cr ^ b) & 0xff] ^ (cr >>> 8)
  return (cr ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td))
  return Buffer.concat([l, td, c])
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const stride = w * 4 + 1
  const raw = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4) }
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR',ihdr), chunk('IDAT',deflateSync(raw)), chunk('IEND',Buffer.alloc(0))
  ])
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t) }

// ── 白色心形判定（hx/hy 归一化 [-1,1]，y 向上为正）──
function inHeart(hx, hy) {
  // 上方两个圆瓣（左、右）
  const r = 0.48
  const dl = Math.hypot(hx + 0.33, hy - 0.28)
  const dr = Math.hypot(hx - 0.33, hy - 0.28)
  if (dl <= r || dr <= r) return true

  // 下方楔形连接到底尖
  if (hy < 0.2 && hy > -1.0) {
    const t = Math.max(0, Math.min(1, (hy + 1.0) / 1.2)) // 0=底尖 1=顶部
    const halfW = 0.95 * t
    if (Math.abs(hx) < halfW) return true
  }
  return false
}

/** 高分辨率绘制 */
function draw(size) {
  const px = Buffer.alloc(size * size * 4)

  // 品牌粉底色（微渐变：左上亮粉 #ff6b95 → 右下深粉 #e63764）
  const TL = [255, 107, 149]
  const BR = [230, 55, 100]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4

      // 圆角方块裁剪
      const rr = size * 0.22
      const rx = Math.min(Math.max(x, rr), size - rr)
      const ry = Math.min(Math.max(y, rr), size - rr)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rr ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // 微渐变品牌粉底
      const gt = (x / size + y / size) / 2
      px[o]   = Math.round(lerp(TL[0], BR[0], gt))
      px[o+1] = Math.round(lerp(TL[1], BR[1], gt))
      px[o+2] = Math.round(lerp(TL[2], BR[2], gt))
      px[o+3] = 255

      // ── 白色心形 ──
      // 归一化到 [-1,1]，y 翻转（屏幕坐标向下为正→数学坐标向上为正）
      const hx = ((x / size) * 2 - 1) * 0.82
      const hy = -(((y / size) * 2 - 1) * 0.82)

      if (inHeart(hx, hy)) {
        px[o] = 255; px[o+1] = 255; px[o+2] = 255
      }
    }
  }
  return px
}

// ── 输出 ──
const SIZES = [16,24,32,48,64,128,256]
for (const sz of SIZES) {
  writeFileSync(join(outDir, `icon-${sz}.png`), encodePNG(sz,sz,draw(sz)))
}
writeFileSync(join(outDir,'icon.png'), encodePNG(256,256,draw(256)))

const pngsForIco = SIZES.map(sz => ({s:sz,d:encodePNG(sz,sz,draw(sz))}))
const hdr = Buffer.alloc(6)
hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(SIZES.length,4)
const entries=[]; let off=6+SIZES.length*16
for(const p of pngsForIco){
  const e=Buffer.alloc(16)
  e.writeUInt8(p.s>=256?0:p.s,0); e.writeUInt8(p.s>=256?0:p.s,1)
  e.writeUInt8(0,2); e.writeUInt8(0,3)
  e.writeUInt16LE(1,4); e.writeUInt16LE(32,6)
  e.writeUInt32BE(p.d.length,8); e.writeUInt32LE(off,12)
  entries.push(e); off+=p.d.length
}
writeFileSync(join(outDir,'icon.ico'),Buffer.concat([hdr,...entries,...pngsForIco.map(p=>p.d)]))
console.log(`✓ icon.ico ${icoBufLen(pngsForIco)}B | icon.png OK`)
function icoBufLen(p){return p.reduce((a,x)=>a+x.d.length,0)+6+p.length*16}
