// 应用图标生成器：品牌粉圆角方块 + 白色书签形状
// 4× 超采样抗锯齿，输出多尺寸 .ico + .png
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'build')
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
  ihdr[8] = 8; ihdr[9] = 6
  const stride = w * 4 + 1
  const raw = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4) }
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR',ihdr), chunk('IDAT',deflateSync(raw)), chunk('IEND',Buffer.alloc(0))
  ])
}

function lerp(a, b, t) { return a + (b - a) * t }

// ── 高分辨率绘制 ──
function drawHi(size) {
  const px = Buffer.alloc(size * size * 4)
  const rad = size * 0.22

  // 书签参数（归一化 [0,1]，映射时乘 size）
  const bxN = 0.36, byN = 0.26
  const bwN = 0.28, bhN = 0.42
  const notchHN = bhN * 0.18

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4

      // 圆角方块背景裁剪
      const rr = rad
      const rx = Math.min(Math.max(x, rr), size - rr)
      const ry = Math.min(Math.max(y, rr), size - rr)
      if ((x - rx) ** 2 + (y - ry) ** 2 > rr ** 2) {
        px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0
        continue
      }

      // 品牌粉微渐变底（上浅下深）
      const bgT = y / size
      let r = lerp(255, 235, bgT), g = lerp(105, 70, bgT), b = lerp(148, 118, bgT)

      // 白色书签判定（归一化坐标）
      const nx = x / size, ny = y / size
      const inBX = nx >= bxN && nx <= bxN + bwN
      const inBY = ny >= byN && ny <= byN + bhN
      if (inBX && inBY) {
        // 底部三角缺口
        const relY = (ny - byN) / bhN
        if (relY > 1 - notchHN / bhN) {
          const notchT = (relY - (1 - notchHN / bhN)) / (notchHN / bhN)
          const halfW = (bwN / 2) * notchT
          const centerX = bxN + bwN / 2
          if (Math.abs(nx - centerX) < halfW) {
            // 缺口内 → 保持底色
            px[o] = Math.round(r); px[o+1] = Math.round(g); px[o+2] = Math.round(b); px[o+3] = 255
            continue
          }
        }
        r = 255; g = 255; b = 255
      }

      px[o] = Math.round(r); px[o+1] = Math.round(g); px[o+2] = Math.round(b); px[o+3] = 255
    }
  }
  return { buf: px, w: size, h: size }
}

// ── 盒滤波降采样 ──
function downsample(hiBuf, hiW, hiH, loSize) {
  const out = Buffer.alloc(loSize * loSize * 4)
  const ratio = hiW / loSize
  for (let y = 0; y < loSize; y++) {
    for (let x = 0; x < loSize; x++) {
      let r=0,g=0,b=0,cnt=0
      const sy0=Math.floor(y*ratio), sy1=Math.max(sy0+1,Math.floor((y+1)*ratio))
      const sx0=Math.floor(x*ratio), sx1=Math.max(sx0+1,Math.floor((x+1)*ratio))
      for(let sy=sy0;sy<sy1&&sy<hiH;sy++)for(let sx=sx0;sx<sx1;sx++){
        const so=(sy*hiW+sx)*4;r+=hiBuf[so];g+=hiBuf[so+1];b+=hiBuf[so+2];cnt++
      }
      const oo=(y*loSize+x)*4
      out[oo]=r/cnt;out[oo+1]=g/cnt;out[oo+2]=b/cnt;out[oo+3]=255
    }
  }
  return out
}

// ── 输出 ──
const hiRes = drawHi(256 * 4)

writeFileSync(join(outDir,'icon.png'), encodePNG(256,256,downsample(hiRes.buf,hiRes.w,hiRes.h,256)))

const SIZES = [16,24,32,48,64,128,256]
const pngsForIco = SIZES.map(sz => ({s:sz,d:encodePNG(sz,sz,downsample(hiRes.buf,hiRes.w,hiRes.h,sz))}))
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
function icoBufLen(p){return p.reduce((a,p)=>a+p.d.length,0)+6+p.length*16}
