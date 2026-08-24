// 用 Electron Chromium 渲染 SVG 并截图生成应用图标
// 矢量质量 + Chromium 抗锯齿，效果远超像素公式绘制
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = join(here, '..', 'build')

// ── PNG 编码 ──
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

// ── 面积平均降采样（高质量 box filter）──
function downscale(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4)
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor(dy * sh / dh), sy1 = Math.max(sy0+1, Math.floor((dy+1) * sh / dh))
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor(dx * sw / dw), sx1 = Math.max(sx0+1, Math.floor((dx+1) * sw / dw))
      let r=0,g=0,b=0,a=0,cnt=0
      for (let sy=sy0; sy<sy1; sy++)
        for (let sx=sx0; sx<sx1; sx++) {
          const so=(sy*sw+sx)*4
          // 预乘 alpha 混合避免边缘发灰
          const pa=src[so+3]/255
          r+=src[so]*pa; g+=src[so+1]*pa; b+=src[so+2]*pa; a+=src[so+3]; cnt++
        }
      const o=(dy*dw+dx)*4
      const avgA=a/cnt, pa=avgA/255
      dst[o]  =pa>0?Math.round(r/cnt/pa):0
      dst[o+1]=pa>0?Math.round(g/cnt/pa):0
      dst[o+2]=pa>0?Math.round(b/cnt/pa):0
      dst[o+3]=Math.round(avgA)
    }
  }
  return dst
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024,
    show: false,
    // 关键：透明无边框窗口，圆角外的像素保持 alpha=0，
    // 否则默认白底会混进圆角抗锯齿边缘形成白边
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  await win.loadFile(join(here, 'icon.html'))
  await new Promise(r => setTimeout(r, 500))

  const img = win.webContents.capturePage()
  const master = await img
  const { width: mw, height: mh } = master.getSize()
  const srcBuf = master.toBitmap()   // BGRA on Windows!
  const src = Buffer.from(srcBuf)

  // BGRA → RGBA 转换
  const rgba = Buffer.alloc(mw*mh*4)
  for (let i=0;i<mw*mh;i++){
    rgba[i*4]  =src[i*4+2]
    rgba[i*4+1]=src[i*4+1]
    rgba[i*4+2]=src[i*4]
    rgba[i*4+3]=src[i*4+3]
  }

  writeFileSync(join(buildDir,'icon-1024.png'), encodePNG(mw,mh,rgba))

  // 各尺寸降采样
  const SIZES=[16,24,32,48,64,128,256]
  const pngs=[]
  for (const sz of SIZES) {
    const small=downscale(rgba,mw,mh,sz,sz)
    const png=encodePNG(sz,sz,small)
    writeFileSync(join(buildDir,`icon-${sz}.png`),png)
    pngs.push({s:sz,d:png})
  }
  writeFileSync(join(buildDir,'icon.png'),encodePNG(256,256,downscale(rgba,mw,mh,256,256)))

  // ── ICO 条目编码：≤48px 必须用未压缩 BMP(DIB)，Windows 规范要求 ──
// （全 PNG 条目会导致大量加载路径失败回退默认图标）
function encodeIcoEntryBMP(size, rgba) {
  const headerSize = 40
  const pixelDataSize = size * size * 4
  const maskRowBytes = Math.ceil(size / 32) * 4   // 1bpp AND mask，每行 4 字节对齐
  const maskSize = maskRowBytes * size
  const buf = Buffer.alloc(headerSize + pixelDataSize + maskSize)
  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, 0)            // biSize
  buf.writeInt32LE(size, 4)           // biWidth
  buf.writeInt32LE(size * 2, 8)       // biHeight（XOR + AND 两倍高）
  buf.writeUInt16LE(1, 12)            // biPlanes
  buf.writeUInt16LE(32, 14)           // biBitCount
  buf.writeUInt32LE(pixelDataSize + maskSize, 20)  // biSizeImage
  // 像素 BGRA bottom-up
  let off = headerSize
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const so = (y * size + x) * 4
      buf[off++] = rgba[so+2]; buf[off++] = rgba[so+1]; buf[off++] = rgba[so]; buf[off++] = rgba[so+3]
    }
  }
  // AND mask 全 0（透明度由 32 位 alpha 通道表达）
  return buf
}

// ── 打包 ICO：≤48px 用 BMP，≥64px 用 PNG ──
const hdr=Buffer.alloc(6)
hdr.writeUInt16LE(0,0);hdr.writeUInt16LE(1,2);hdr.writeUInt16LE(SIZES.length,4)
const entries=[];const datas=[];let off=6+SIZES.length*16
for(const p of pngs){
  const d = p.s<=48 ? encodeIcoEntryBMP(p.s, downscale(rgba,mw,mh,p.s,p.s)) : p.d
  const e=Buffer.alloc(16)
  e.writeUInt8(p.s>=256?0:p.s,0);e.writeUInt8(p.s>=256?0:p.s,1)
  e.writeUInt8(0,2);e.writeUInt8(0,3)
  e.writeUInt16LE(1,4);e.writeUInt16LE(32,6)
  e.writeUInt32BE(d.length,8);e.writeUInt32LE(off,12)
  entries.push(e);datas.push(d);off+=d.length
}
writeFileSync(join(buildDir,'icon.ico'),Buffer.concat([hdr,...entries,...datas]))

  console.log(`✓ icon generated from ${mw}×${mh} master`)
  app.quit()
})
