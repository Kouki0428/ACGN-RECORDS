// 应用图标：品牌粉圆角方块 + 白色播放三角（极简设计）
// 3× 超采样抗锯齿，输出多尺寸 .ico + .png
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

// 品牌粉底色
const R = 255, G = 92, B = 138

function draw(size) {
  const px = Buffer.alloc(size * size * 4)
  const rad = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4

      // 圆角方块裁剪
      const rx = Math.min(Math.max(x, rad), size - rad)
      const ry = Math.min(Math.max(y, rad), size - rad)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rad ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // 粉色背景
      px[o] = R; px[o+1] = G; px[o+2] = B; px[o+3] = 255

      // 白色播放三角（居中略偏右）
      const cx = size / 2 + size * 0.03
      const cy = size / 2
      const w = size * 0.14
      const h = size * 0.16

      // 三角形顶点
      const ax = cx - w / 2, ay = cy - h / 2
      const bx = cx - w / 2, by = cy + h / 2
      const cxx = cx + w / 2, cyy = cy

      // 点在三角形内判定（叉积法）
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
      const d2 = (x - cxx) * (by - cyy) - (bx - cxx) * (y - cyy)
      const d3 = (x - ax) * (cyy - ay) - (cxx - ax) * (y - ay)
      if (!(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))) {
        px[o] = 255; px[o+1] = 255; px[o+2] = 255
      }
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
console.log(`✓ done`)
