// 应用图标：黄昏渐变天空 + 白色鸟居（Torii）剪影
// 鸟居 = 日本/ACGN 最具代表性的视觉符号，一眼即知
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

// ── 黄昏天空渐变 ──
// 顶部：深蓝紫 #1a1035 → 中间：品红紫 #6b2154 → 底部：暖橙粉 #ff8a65
const SKY_TOP    = [26, 16, 53]
const SKY_MID    = [107, 33, 84]
const SKY_BOT    = [255, 138, 101]

// ── 鸟居颜色：白色偏暖 ──
const TORII      = [255, 250, 245]

/** 判定是否在鸟居轮廓内（归一化坐标 [0,1]，y=0 在顶部）*/
function inTorii(nx, ny) {
  // 柱子参数
  const pilL = 0.30, pilR = 0.70     // 柱子中心线
  const pilW = 0.055                  // 柱子半宽
  const topY = 0.14                   // 笠木顶部
  const botY = 0.86                   // 柱底

  // 笠木（最顶横梁，比柱子宽）
  if (ny >= topY && ny <= topY + 0.07 && nx >= 0.14 && nx <= 0.86) return true

  // 貳の木（第二横梁）
  if (ny >= topY + 0.12 && ny <= topY + 0.17 && nx >= 0.22 && nx <= 0.78) return true

  // 左柱
  const lpilL = pilL - pilW, lpilR = pilL + pilW
  if (nx >= lpilL && nx <= lpilR && ny >= topY + 0.07 && ny <= botY) return true

  // 右柱
  const rpilL = pilR - pilW, rpilR = pilR + pilW
  if (nx >= rpilL && nx <= rpilR && ny >= topY + 0.07 && ny <= botY) return true

  return false
}

/** 高分辨率绘制 */
function draw(size) {
  const px = Buffer.alloc(size * size * 4)

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

      const nx = x / size, ny = y / size

      // ── 黄昏天空三段渐变 ──
      let r, g, b
      if (ny < 0.45) {
        // 上段：深蓝紫 → 品红紫
        const t = smoothstep(0, 0.45, ny)
        r = lerp(SKY_TOP[0], SKY_MID[0], t)
        g = lerp(SKY_TOP[1], SKY_MID[1], t)
        b = lerp(SKY_TOP[2], SKY_MID[2], t)
      } else {
        // 下段：品红紫 → 暖橙粉
        const t = smoothstep(0.45, 1, ny)
        r = lerp(SKY_MID[0], SKY_BOT[0], t)
        g = lerp(SKY_MID[1], SKY_BOT[1], t)
        b = lerp(SKY_MID[2], SKY_BOT[2], t)
      }

      // ── 星星点缀（上半部分）──
      const stars = [[0.22,0.08],[0.78,0.06],[0.10,0.20],[0.90,0.18],[0.50,0.04],[0.30,0.28],[0.68,0.25]]
      for (const [sx,sy] of stars) {
        const d = Math.hypot(nx-sx, ny-sy)
        if (d < 0.025) {
          const br = 1 - d / 0.025
          r = lerp(r, 255, br*0.9); g = lerp(g, 255, br*0.9); b = lerp(b, 255, br*0.9)
        }
      }

      // ── 鸟居剪影（白色）──
      if (inTorii(nx, ny)) {
        r = TORII[0]; g = TORII[1]; b = TORII[2]
      }

      px[o] = r; px[o+1] = g; px[o+2] = b; px[o+3] = 255
    }
  }

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
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

const pngsForIco = SIZES.map(sz => ({s:sz,d:encodePNG(sz,sz,render(sz))}))
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
writeFileSync(join(process.cwd(),'build','icon.ico'),Buffer.concat([hdr,...entries,...pngsForIco.map(p=>p.d)]))
console.log(`✓ icon.ico ${icoBufLen(pngsForIco)}B | icon.png OK`)
function icoBufLen(p){return p.reduce((a,x)=>a+x.d.length,0)+6+p.length*16}
