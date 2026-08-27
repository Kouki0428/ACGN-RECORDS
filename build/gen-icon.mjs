import fs from 'node:fs'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import toIco from 'to-ico'

const root = path.resolve('build')
const svg = fs.readFileSync(path.join(root, 'next-logo.svg'))

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const pngs = {}

for (const size of sizes) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  const png = resvg.render().asPng()
  const name = size === 1024 ? 'icon.png' : `icon-${size}.png`
  fs.writeFileSync(path.join(root, name), png)
  pngs[size] = png
  console.log('wrote', name, png.length, 'bytes')
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256, 512]
const ico = await toIco(icoSizes.map((s) => pngs[s]))
fs.writeFileSync(path.join(root, 'icon.ico'), ico)
console.log('wrote icon.ico', ico.length, 'bytes (with 512 entry)')
