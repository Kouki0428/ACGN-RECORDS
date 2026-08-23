// 应用图标：深空底 + 品牌粉渐变月牙 + 白色星星（ACGN 经典美学意象）
// 月牙+星星 = 动漫最具代表性的视觉符号（美少女战士、魔卡少女樱…）
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

// ── 调色板 ──
const SKY_A   = [16, 14, 36]     // 深紫夜空顶 #100e24
const SKY_B   = [30, 18, 50]     // 深紫夜空底 #1e1232
const MOON_A  = [255, 140, 160]  // 月亮亮端（品牌粉偏暖）
const MOON_B  = [255, 92, 138]   // 月亮暗端（品牌粉）
const STAR    = [255, 220, 120]   // 星星金色

function lerp(a, b, t) { return Math.round(a + (b - a) * t) }

/** 判定是否在五角星内（cx,cy 为中心，R 外接圆半径）*/
function inStar(px_, py_, cx_, cy_, R) {
  const dx = px_ - cx_, dy = py_ - cy_
  const dist = Math.hypot(dx, dy)
  if (dist > R) return false
  const angle = Math.atan2(dy, dx)
  // 五角星半径公式：交替外接半径和内切半径
  const k = Math.abs(((angle / (Math.PI / 5)) % 2 + 2) % 2 - 1) // 0..1 锯齿波
  const r = R * (0.42 + 0.58 * k)
  return dist <= r
}

/** 高分辨率绘制 */
function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const rad = size * 0.22
  const cx = size / 2, cy = size / 2

  // 月亮参数
  const moonX = size * 0.44, moonY = size * 0.46
  const moonR = size * 0.26
  // 遮挡暗圆参数（制造月牙效果）
  const shadX = moonX + moonR * 0.38, shadY = moonY - moonR * 0.28
  const shadR = moonR * 0.82

  // 小星星位置（归一化）
  const miniStars = [
    [0.20, 0.22], [0.80, 0.15], [0.15, 0.60], [0.85, 0.55],
    [0.28, 0.88], [0.72, 0.82]
  ]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const rr = rad
      const rx = Math.min(Math.max(x, rr), size - rr)
      const ry = Math.min(Math.max(y, rr), size - rr)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rr ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // ── 深紫渐变夜空背景 ──
      const bt = y / size
      let r = lerp(SKY_A[0], SKY_B[0], bt)
      let g = lerp(SKY_A[1], SKY_B[1], bt)
      let b = lerp(SKY_A[2], SKY_B[2], bt)

      // ── 小星星点缀 ──
      for (const [sx, sy] of miniStars) {
        const d = Math.hypot((x / size - sx) * 2, (y / size - sy) * 2)
        if (d < 0.06) {
          const br = 1 - d / 0.06
          r = lerp(r, STAR[0], br * 0.8)
          g = lerp(g, STAR[1], br * 0.8)
          b = lerp(b, STAR[2], br * 0.8)
        }
      }

      // ── 月亮（品牌粉渐变圆）──
      const md = Math.hypot(x - moonX, y - moonY)
      if (md <= moonR) {
        // 径向渐变：中心亮粉 → 边缘品牌粉
        const mt = md / moonR
        r = lerp(MOON_A[0], MOON_B[0], mt)
        g = lerp(MOON_A[1], MOON_B[1], mt)
        b = lerp(MOON_B[2], MOON_B[2], mt)

        // 表面微光纹理（几个浅色弧形条纹模拟月面）
        const crater1 = Math.hypot(x - (moonX - moonR*0.25), y - (moonY - moonR*0.15))
        if (crater1 < moonR * 0.12) {
          const ct = 1 - crater1 / (moonR * 0.12)
          r = lerp(r, 255, ct * 0.15); g = lerp(g, 200, ct * 0.15); b = lerp(b, 190, ct * 0.15)
        }
        const crater2 = Math.hypot(x - (moonX + moonR*0.2), y - (moonY + moonR*0.2))
        if (crater2 < moonR * 0.08) {
          const ct = 1 - crater2 / (moonR * 0.08)
          r = lerp(r, 255, ct * 0.1); g = lerp(g, 190, ct * 0.1); b = lerp(b, 180, ct * 0.1)
        }
      }

      // ── 遮挡暗圆（月牙效果：右上偏移的暗色圆盖住月亮一部分）──
      const sd = Math.hypot(x - shadX, y - shadY)
      if (sd <= shadR && md <= moonR) {
        const shadeT = Math.max(0, Math.min(1, sd / shadR))
        const darkness = Math.round(lerp(10, 5, shadeT))
        const coverStrength = Math.max(0, Math.min(1, (shadR - sd) / (shadR * 0.3) + 0.7))
        if (coverStrength > 0.5) {
          r = darkness; g = Math.round(darkness * 1.05); b = Math.round(darkness * 1.4)
        }
      }

      px[o] = r; px[o+1] = g; px[o+2] = b; px[o+3] = 255
    }
  }
  return px
}

// ── 输出 ──
const SIZES = [16,24,32,48,64,128,256]
for (const sz of SIZES) {
  const lo = draw(sz)
  writeFileSync(join(outDir, `icon-${sz}.png`), encodePNG(sz,sz,lo))
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
