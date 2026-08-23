// 应用图标：QQ 企鹅风格——纯色底 + 简洁白色轮廓图标
// QQ 设计语言：品牌色大面积填充 + 白色简洁图形居中 + 无渐变无纹理
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
const BG      = [255, 92, 138]   // 品牌粉 #ff5c8a 纯色底（QQ 式大色块）
const BG_DARK = [235, 70, 118]   // 底部微暗（增加深度但不做渐变）
const WHITE   = [255, 255, 255]

function draw(size) {
  const px = Buffer.alloc(size*size*4)
  const rad = size*0.22

  // 播放三角参数（白色，居中）
  const triW = size*0.14
  const triH = size*0.16
  const tx = size/2 + size*0.02
  const ty = size/2

  for (let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const o=(y*size+x)*4

      // 圆角方块裁剪
      const rr=rad
      const rx=Math.min(Math.max(x,rr),size-rr)
      const ry=Math.min(Math.max(y,rr),size-rr)
      if((x-rx)**2+(y-ry)**2>rr**2){
        px[o]=0;px[o+1]=0;px[o+2]=0;px[o+3]=0
        continue
      }

      // 品牌粉纯色底（底部微暗增加深度，不做渐变）
      if(y>size*0.6){
        const t=(y-size*0.6)/(size*0.4)
        px[o]=Math.round(lerp(BG[0],BG_DARK[0],t))
        px[o+1]=Math.round(lerp(BG[1],BG_DARK[1],t))
        px[o+2]=Math.round(lerp(BG[2],BG_DARK[2],t))
      }else{
        px[o]=BG[0];px[o+1]=BG[1];px[o+2]=BG[2]
      }
      px[o+3]=255

      // ── 白色播放三角（圆角感）──
      const dx=x-tx, dy=y-ty
      const halfH=(triH/2)*(1-Math.max(0,dx)/(triW*1.15))
      if(dx>=-triW*0.08&&dx<=triW&&Math.abs(dy)<=halfH){
        px[o]=WHITE[0];px[o+1]=WHITE[1];px[o+2]=WHITE[2]
      }
    }
  }
  return px
}

function lerp(a,b,t){return Math.round(a+(b-a)*t)}

// ── 输出 ──
const SIZES=[16,24,32,48,64,128,256]
for(const sz of SIZES){
  writeFileSync(join(process.cwd(),'build',`icon-${sz}.png`),encodePNG(sz,sz,draw(sz)))
}
writeFileSync(join(process.cwd(),'build','icon.png'),encodePNG(256,256,draw(256)))

const pngsForIco=SIZES.map(sz=>({s:sz,d:encodePNG(sz,sz,draw(sz))}))
const hdr=Buffer.alloc(6)
hdr.writeUInt16LE(0,0);hdr.writeUInt16LE(1,2);hdr.writeUInt16LE(SIZES.length,4)
const entries=[];let off=6+SIZES.length*16
for(const p of pngsForIco){
  const e=Buffer.alloc(16)
  e.writeUInt8(p.s>=256?0:p.s,0);e.writeUInt8(p.s>=256?0:p.s,1)
  e.writeUInt8(0,2);e.writeUInt8(0,3)
  e.writeUInt16LE(1,4);e.writeUInt16LE(32,6)
  e.writeUInt32BE(p.d.length,8);e.writeUInt32LE(off,12)
  entries.push(e);off+=p.d.length
}
writeFileSync(join(process.cwd(),'build','icon.ico'),Buffer.concat([hdr,...entries,...pngsForIco.map(p=>p.d)]))
console.log(`✓ done`)
