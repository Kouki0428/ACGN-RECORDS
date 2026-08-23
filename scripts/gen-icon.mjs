// 应用图标：深色底 + 品牌粉大圆 + 白色播放三角（三层构图）
// 深蓝黑底 + 品牌粉渐变大圆居中 + 白色播放三角 = 深度感 + 品牌辨识 + 功能指向
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

const WHITE  = [255,255,255]
const PINK_A = [255,120,155]
const PINK_B = [255,80,125]

/** 绘制 size×size 图标 */
function draw(size) {
  const px = Buffer.alloc(size*size*4)
  const rad = size*0.22

  // 大粉圆参数：占 ~72%
  const bigR = size * 0.36
  // 白色播放三角参数
  const triW = size * 0.11
  const triH = size * 0.14

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y*size+x)*4

      // 圆角方块裁剪
      const rr = rad
      const rx = Math.min(Math.max(x,rr),size-rr)
      const ry = Math.min(Math.max(y,rr),size-rr)
      if ((x-rx)**2+(y-ry)**2 > rr**2) {
        px[o]=0;px[o+1]=0;px[o+2]=0;px[o+3]=0
        continue
      }

      // 深蓝黑底色微渐变
      const bt=(y/size+x/size)/4
      px[o]=Math.round(10+bt*20)
      px[o+1]=Math.round(12+bt*18)
      px[o+2]=Math.round(22+bt*28)

      // 品牌粉渐变大圆
      const dist=Math.hypot(x-size/2,y-size/2)
      if(dist<=bigR){
        const t=dist/bigR
        px[o]=lerp(PINK_A[0],PINK_B[0],t)
        px[o+1]=lerp(PINK_A[1],PINK_B[1],t)
        px[o+2]=lerp(PINK_A[2],PINK_B[2],t)
      }

      // 白色播放三角（居中）
      const tx=size/2+size*0.02, ty=size/2
      const dx=x-tx, dy=y-ty
      const halfH=(triH/2)*(1-Math.max(0,dx)/(triW*1.15))
      if(dx>=-triW*0.08&&dx<=triW&&Math.abs(dy)<=halfH){
        px[o]=255;px[o+1]=255;px[o+2]=255
      }
    }
  }
  return px
}

// ── 超采样渲染 ──
function render(size){
  const SS=3
  const S=size*SS
  const hiPx=draw(S)
  const lo=Buffer.alloc(size*size*4)
  const ratio=S/size
  for(let y=0;y<size;y++)
    for(let x=0;x<size;x++){
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
const SIZES=[16,24,32,48,64,128,256]
for(const sz of SIZES){
  writeFileSync(join(process.cwd(),'build',`icon-${sz}.png`),encodePNG(sz,sz,render(sz)))
}
writeFileSync(join(process.cwd(),'build','icon.png'),encodePNG(256,256,render(256)))

const pngsForIco=SIZES.map(sz=>({s:sz,d:encodePNG(sz,sz,render(sz))}))
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
