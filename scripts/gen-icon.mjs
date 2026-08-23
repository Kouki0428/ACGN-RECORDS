// 应用图标：QQ 式设计语言 + B站小电视图形
// 品牌粉纯色底 + 白色小电视（双天线+圆角机身+双眼）
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

// ── 几何辅助 ──
// 点到线段距离
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx*dx + dy*dy
  let t = len2 ? ((px-x1)*dx + (py-y1)*dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + dx*t), py - (y1 + dy*t))
}
// 圆角矩形内含判断
function inRoundRect(px, py, rx, ry, rw, rh, rr) {
  if (px < rx || px > rx+rw || py < ry || py > ry+rh) return false
  const cx = Math.min(Math.max(px, rx+rr), rx+rw-rr)
  const cy = Math.min(Math.max(py, ry+rr), ry+rh-rr)
  return (px-cx)**2 + (py-cy)**2 <= rr*rr
}

const BG      = [255, 92, 138]   // 品牌粉 #ff5c8a
const BG_DARK = [235, 70, 118]
const WHITE   = [255, 255, 255]

function draw(size) {
  const px = Buffer.alloc(size*size*4)
  const rad = size*0.22
  const s = size

  // ── 小电视几何参数 ──
  // 机身：圆角矩形，占中下部
  const tvX = s*0.26, tvY = s*0.38
  const tvW = s*0.48, tvH = s*0.34
  const tvR = s*0.07
  // 双眼：两个竖长圆角矩形
  const eyeW = s*0.055, eyeH = s*0.12, eyeR = s*0.02
  const eyeY = tvY + (tvH-eyeH)/2
  const eyeLX = tvX + tvW*0.24 - eyeW/2
  const eyeRX = tvX + tvW*0.76 - eyeW/2
  // 天线：V 形两根，从机身顶部向上外张
  const antW = s*0.045   // 天线线宽
  const aLx1 = tvX + tvW*0.32, aLy1 = tvY + s*0.02
  const aLx2 = s*0.20,        aLy2 = s*0.16
  const aRx1 = tvX + tvW*0.68, aRy1 = tvY + s*0.02
  const aRx2 = s*0.80,        aRy2 = s*0.16

  for (let y=0;y<s;y++){
    for(let x=0;x<s;x++){
      const o=(y*s+x)*4

      // 圆角方块裁剪
      const rr=rad
      const rx=Math.min(Math.max(x,rr),s-rr)
      const ry=Math.min(Math.max(y,rr),s-rr)
      if((x-rx)**2+(y-ry)**2>rr**2){
        px[o]=0;px[o+1]=0;px[o+2]=0;px[o+3]=0
        continue
      }

      // 品牌粉纯色底
      let r,g,b
      if(y>s*0.6){
        const t=(y-s*0.6)/(s*0.4)
        r=Math.round(BG[0]+(BG_DARK[0]-BG[0])*t)
        g=Math.round(BG[1]+(BG_DARK[1]-BG[1])*t)
        b=Math.round(BG[2]+(BG_DARK[2]-BG[2])*t)
      }else{ r=BG[0];g=BG[1];b=BG[2] }

      // ── 白色小电视 ──
      let isWhite = false
      // 机身
      if (inRoundRect(x,y,tvX,tvY,tvW,tvH,tvR)) isWhite = true
      // 双眼（挖穿显示底色 → 用底色覆盖）
      let isEye = false
      if (inRoundRect(x,y,eyeLX,eyeY,eyeW,eyeH,eyeR)) isEye = true
      if (inRoundRect(x,y,eyeRX,eyeY,eyeW,eyeH,eyeR)) isEye = true
      // 天线
      if (distSeg(x,y,aLx1,aLy1,aLx2,aLy2)<=antW/2) isWhite = true
      if (distSeg(x,y,aRx1,aRy1,aRx2,aRy2)<=antW/2) isWhite = true
      // 天线端点圆头
      if (Math.hypot(x-aLx2,y-aLy2)<=antW/2) isWhite = true
      if (Math.hypot(x-aRx2,y-aRy2)<=antW/2) isWhite = true

      if (isEye) {
        // 眼睛区域：透回底色
      } else if (isWhite) {
        r=WHITE[0];g=WHITE[1];b=WHITE[2]
      }

      px[o]=r;px[o+1]=g;px[o+2]=b;px[o+3]=255
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
  writeFileSync(join(outDir,`icon-${sz}.png`),encodePNG(sz,sz,render(sz)))
}
writeFileSync(join(outDir,'icon.png'),encodePNG(256,256,render(256)))

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
writeFileSync(join(outDir,'icon.ico'),Buffer.concat([hdr,...entries,...pngsForIco.map(p=>p.d)]))
console.log(`✓ done`)
