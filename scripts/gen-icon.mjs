// 应用图标：品牌粉渐变圆角方块 + 白色对话气泡（ACGN 核心符号）
// 4× 超采样抗锯齿，输出多尺寸 .ico + .png
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
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4) }
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR',ihdr), chunk('IDAT',deflateSync(raw)), chunk('IEND',Buffer.alloc(0))
  ])
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t) }

// 判定归一化坐标是否在白色对话气泡内（椭圆主体 + 三角尾巴）
function inBubble(nx, ny) {
  // 椭圆主体
  const ex = (nx - 0.50) / 0.23
  const ey = (ny - 0.40) / 0.19
  if (ex * ex + ey * ey <= 1) return true

  // 尾巴三角（气泡左下伸出）
  const tipX = 0.36, tipY = 0.68
  const lx1 = 0.41, ly1 = 0.52
  const lx2 = 0.55, ly2 = 0.52
  const d1 = (nx - lx1) * (tipY - ly1) - (tipX - lx1) * (ny - ly1)
  const d2 = (nx - lx2) * (ly1 - ly2) - (lx1 - lx2) * (ny - ly2)
  const d3 = (nx - tipX) * (ly2 - tipY) - (lx2 - tipX) * (ny - tipY)
  return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))
}

/** 以超采样倍数 SS 绘制 size×size 的最终图标 */
function render(size) {
  const hiS = size * 4
  const px = Buffer.alloc(hiS * hiS * 4)
  const rad = hiS * 0.22

  for (let y = 0; y < hiS; y++) {
    for (let x = 0; x < hiS; x++) {
      const o = (y * hiS + x) * 4

      // 圆角方块裁剪
      const rx = Math.min(Math.max(x, rad), hiS - rad)
      const ry = Math.min(Math.max(y, rad), hiS - rad)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rad ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // 品牌粉对角渐变底（135deg）
      const gt = (x / hiS + (hiS - y) / hiS) / 2
      px[o]   = lerp(255, 92, gt)
      px[o+1] = lerp(92, 138, gt)
      px[o+2] = lerp(138, 92, gt)
      px[o+3] = 255

      // 白色对话气泡（归一化坐标判定）
      const nx = x / hiS, ny = y / hiS
      if (inBubble(nx, ny)) {
        px[o] = 255; px[o+1] = 255; px[o+2] = 255
      }
    }
  }

  // 盒滤波降采样
  const out = Buffer.alloc(size * size * 4)
  const ratio = hiS / size
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r=0,g=0,b=0,cnt=0
      const sy0=Math.floor(y*ratio),sy1=Math.min(hiS,sy0+Math.ceil(ratio))
      const sx0=Math.floor(x*ratio),sx1=Math.min(hiS,sx0+Math.ceil(ratio))
      for(let sy=sy0;sy<sy1;sy++)for(let sx=sx0;sx<sx1;sx++){
        const so=(sy*hiS+sx)*4;r+=px[so];g+=px[so+1];b+=px[so+2];cnt++
      }
      const oo=(y*size+x)*4
      out[oo]=Math.round(r/cnt);out[oo+1]=Math.round(g/cnt);out[oo+2]=Math.round(b/cnt);out[oo+3]=255
    }
  return out
}

// ── 输出 ──
const SIZES = [16,24,32,48,64,128,256]
for (const sz of SIZES) {
  writeFileSync(join(outDir, `icon-${sz}.png`), encodePNG(sz,sz,render(sz)))
}
writeFileSync(join(outDir,'icon.png'), encodePNG(256,256,render(256)))

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
writeFileSync(join(outDir,'icon.ico'),Buffer.concat([hdr,...entries,...pngsForIco.map(p=>p.d)]))
console.log(`✓ icon.ico + icon.png`)
