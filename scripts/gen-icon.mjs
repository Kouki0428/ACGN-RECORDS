// 应用图标 v8：Chrome 式圆形构图 + 品牌渐变扇区 + 白色播放按钮中心
// 参考：Chrome 三色圆环、Blender 橙色大圆、网易云深色底白标
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
  const st = w * 4 + 1
  const raw = Buffer.alloc(h * st)
  for (let y = 0; y < h; y++) { raw[y * st] = 0; rgba.copy(raw, y * st + 1, y * w * 4, (y + 1) * w * 4) }
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR',ihdr), chunk('IDAT',deflateSync(raw)), chunk('IEND',Buffer.alloc(0))
  ])
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t) }
function mix(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t))
  ]
}

// 调色板
const NAVY   = [13, 17, 28]      // #0d111c 深蓝黑背景
const PINK   = [255, 92, 138]     // 品牌粉
const PURPLE = [140, 82, 255]     // 紫
const ORANGE = [255, 138, 92]   // 暖橙
const BLUE   = [91, 157, 255]    // 蓝
const WHITE  = [255, 255, 255]

function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const rad = size * 0.22
  const cx = size / 2, cy = size / 2

  // 大圆参数：占图标面积 ~78%
  const bigR = size * 0.38
  // 内白色圆：大圆的 ~55%
  const innerR = size * 0.21

  // 播放三角（在大圆内居中略偏右）
  const triS = size * 0.10
  const triOffX = size * 0.02

  function inTri(x, y) {
    const tx = cx + triOffX, ty = cy
    const ax = tx - triS * 0.55, ay = ty - triS
    const bx = tx - triS * 0.55, by = ty + triS
    const cxp = tx + triS * 0.75, cyp = ty
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
    const d2 = (x - cxp) * (by - cyp) - (bx - cxp) * (y - cyp)
    const d3 = (x - ax) * (cyp - ay) - (cxp - ax) * (y - ay)
    return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))
  }

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

      const dist = Math.hypot(x - cx, y - cy)

      // ── 背景：深蓝黑对角微渐变 ──
      const bt = (x / size + y / size) / 2
      let r = lerp(NAVY[0], 22, bt)
      let g = lerp(NAVY[1], 26, bt)
      let b = lerp(NAVY[2], 40, bt)

      // ── 大圆：三色渐变分段（Chrome 式）──
      if (dist <= bigR) {
        // 计算角度（从顶部开始顺时针）
        const angle = Math.atan2(x - cx, -(y - cy)) // 从12点方向顺时针
        let normA = angle / (Math.PI * 2)
        if (normA < 0) normA += 1

        // 三段渐变扇区
        if (normA < 0.33) {
          // 扇区1：粉→紫
          const t = normA / 0.33
          const c = mix(PINK, PURPLE, t)
          r = c[0]; g = c[1]; b = c[2]
        } else if (normA < 0.66) {
          // 扇区2：紫→橙
          const t = (normA - 0.33) / 0.33
          const c = mix(PURPLE, ORANGE, t)
          r = c[0]; g = c[1]; b = c[2]
        } else {
          // 扇区3：橙→蓝
          const t = (normA - 0.66) / 0.34
          const c = mix(ORANGE, BLUE, t)
          r = c[0]; g = c[1]; b = c[2]
        }

        // 边缘微暗（增加立体感）
        if (dist > bigR * 0.85) {
          const edgeT = (dist - bigR * 0.85) / (bigR * 0.15)
          const dim = 1 - edgeT * 0.25
          r = Math.round(r * dim); g = Math.round(g * dim); b = Math.round(b * dim)
        }
      }

      // ── 内白色圆 ──
      if (dist <= innerR) {
        // 白色圆带轻微径向渐变
        const wt = dist / innerR
        r = lerp(255, 235, wt)
        g = lerp(255, 238, wt)
        b = lerp(255, 242, wt)
      }

      // ── 白色播放三角（在白色圆内用品牌色）──
      if (dist <= innerR * 0.72 && inTri(x, y)) {
        r = PINK[0]; g = PINK[1]; b = PINK[2]
      }

      px[o] = r; px[o+1] = g; px[o+2] = b; px[o+3] = 255
    }
  }
  return px
}

// ── 超采样渲染 ──
function render(size) {
  const SS = 3
  const S = size * SS
  const hiPx = draw(S)
  const lo = Buffer.alloc(size * size * 4)
  const ratio = S / size
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r=0,g=0,b=0,cnt=0
      const sy0=Math.floor(y*ratio),sy1=Math.min(S,sy0+Math.ceil(ratio))
      const sx0=Math.floor(x*ratio),sx1=Math.min(S,sx0+Math.ceil(ratio))
      for(let sy=sy0;sy<sy1;sy++)for(let sx=sx0;sx<sx1;sx++){
        const so=(sy*S+sx)*4;r+=hiPx[so];g+=hiPx[so+1];b+=hiPx[so+2];cnt++
      }
      const oo=(y*size+x)*4
      lo[oo]=r/cnt;lo[oo+1]=g/cnt;lo[oo+2]=b/cnt;lo[oo+3]=255
    }
  return lo
}

// ── 输出 ──
const SIZES = [16,24,32,48,64,128,256]
for (const sz of SIZES) {
  writeFileSync(join(process.cwd(),'build',`icon-${sz}.png`), encodePNG(sz,sz,render(sz)))
}
writeFileSync(join(process.cwd(),'build','icon.png'), encodePNG(256,256,render(256)))

const icoPngs = SIZES.map(sz => ({s:sz,d:encodePNG(sz,sz,render(sz))}))
const hdr = Buffer.alloc(6)
hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(SIZES.length,4)
const entries=[]; let off=6+SIZES.length*16
for(const p of icoPngs){
  const e=Buffer.alloc(16)
  e.writeUInt8(p.s>=256?0:p.s,0); e.writeUInt8(p.s>=256?0:p.s,1)
  e.writeUInt8(0,2); e.writeUInt8(0,3)
  e.writeUInt16LE(1,4); e.writeUInt16LE(32,6)
  e.writeUInt32BE(p.d.length,8); e.writeUInt32LE(off,12)
  entries.push(e); off+=p.d.length
}
writeFileSync(join(process.cwd(),'build','icon.ico'),Buffer.concat([hdr,...entries,...icoPngs.map(p=>p.d)]))
console.log(`✓ icon.ico ${icoBufLen(icoPngs)}B`)
function icoBufLen(p){return p.reduce((a,x)=>a+x.d.length,0)+6+p.length*16}
