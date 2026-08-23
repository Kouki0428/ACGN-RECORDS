// 应用图标生成器：复刻侧边栏 logo —— 品牌粉渐变圆角方块 + 白色 "A"
// 与 .sidebar .brand .logo 完全一致的视觉：accent-grad 渐变底 + 白色粗体 A
// 4× 超采样抗锯齿，输出多尺寸 .ico + .png
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

// ── 调色板（与 --accent-grad 一致）──
const GRAD_A = [255, 92, 138]   // #ff5c8a
const GRAD_B = [255, 138, 92]   // #ff8a5c
const WHITE  = [255, 255, 255]

// ── 绘制 ──
// size 为目标渲染尺寸（建议 ≥256 保证清晰度）
function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const rad = size * 0.22  // 圆角比例与 .logo 的 border-radius:7px/22px ≈ 32% 一致

  // "A" 字母几何参数（归一化 [0,1]，映射到 size）
  // 左斜线：(0.28,0.82)→(0.46,0.16)，右斜线：(0.72,0.82)→(0.54,0.16)
  // 横杠：(0.36,0.56)→(0.64,0.56)
  const strokeW = size * 0.055  // 笔画宽度
  const barH = size * 0.048     // 横杠厚度

  // 线段距离函数：点到线段的最近距离
  function distToSeg(px_, py_, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.hypot(px_ - ax, py_ - ay)
    let t = ((px_ - ax) * dx + (py_ - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy))
  }

  // 归一化坐标转像素坐标
  const N = (v) => v * size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4

      // 圆角方块裁剪
      const rr = rad
      const rx = Math.min(Math.max(x, rr), size - rr)
      const ry = Math.min(Math.max(y, rr), size - rr)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rr ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // 品牌粉对角渐变（与 --accent-grad 一致）
      const gt = (x / size + (size - y) / size) / 2  // 135deg 方向
      px[o]   = Math.round(lerp(GRAD_A[0], GRAD_B[0], gt))
      px[o+1] = Math.round(lerp(GRAD_A[1], GRAD_B[1], gt))
      px[o+2] = Math.round(lerp(GRAD_A[2], GRAD_B[2], gt))
      px[o+3] = 255

      // ── 白色 "A" 字母（三笔画）──
      const nx = x / size, ny = y / size
      let inA = false

      // 左斜线：(0.30,0.84)→(0.46,0.14)
      if (distToSeg(x, y, N(0.30), N(0.84), N(0.46), N(0.14)) < strokeW / 2) inA = true
      // 右斜线：(0.70,0.84)→(0.54,0.14)
      if (!inA && distToSeg(x, y, N(0.70), N(0.84), N(0.54), N(0.14)) < strokeW / 2) inA = true
      // 横杠：(0.36,0.58)→(0.64,0.58)
      if (!inA && ny > 0.52 && ny < 0.62 && nx > 0.34 && nx < 0.66) inA = true

      if (inA) {
        px[o] = WHITE[0]; px[o+1] = WHITE[1]; px[o+2] = WHITE[2]
      }
    }
  }
  return px
}

function lerp(a, b, t) { return a + (b - a) * t }

// ── 超采样降质 ──
function downsample(hiBuf, hiSize, loSize) {
  const out = Buffer.alloc(loSize * loSize * 4)
  const ratio = hiSize / loSize
  for (let y = 0; y < loSize; y++)
    for (let x = 0; x < loSize; x++) {
      let r=0,g=0,b=0,cnt=0
      const sy0=Math.floor(y*ratio),sy1=Math.min(hiSize,sy0+Math.ceil(ratio))
      const sx0=Math.floor(x*ratio),sx1=Math.min(hiSize,sx0+Math.ceil(ratio))
      for(let sy=sy0;sy<sy1;sy++)for(let sx=sx0;sx<sx1;sx++){
        const so=(sy*hiSize+sx)*4;r+=hiBuf[so];g+=hiBuf[so+1];b+=hiBuf[so+2];cnt++
      }
      const oo=(y*loSize+x)*4
      out[oo]=r/cnt;out[oo+1]=g/cnt;out[oo+2]=b/cnt;out[oo+3]=255
    }
  return out
}

// ── 输出 ──
// 高分辨率源图（1024×1024）
const hiPx = draw(1024)

// 各尺寸 PNG
writeFileSync(join(outDir,'icon.png'), encodePNG(256,256,downsample(hiPx,1024,256)))

const SIZES = [16,24,32,48,64,128,256]
const pngsForIco = SIZES.map(sz => ({ s:sz, d:encodePNG(sz,sz,downsample(hiPx,1024,sz)) }))

// ICO 容器
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
