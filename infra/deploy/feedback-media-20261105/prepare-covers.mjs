// Offline only: reads three existing source images and creates new 5:4 JPEGs.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url))
const sharp = require('sharp')
const output = new URL('./prepared/', import.meta.url)
await mkdir(output, { recursive: true })
for (const key of ['meeting', 'office', 'workshop']) {
  const source = fileURLToPath(new URL(`../demo-20261019/assets/${key}.jpg`, import.meta.url))
  const bytes = await sharp(source).rotate().resize(1250, 1000, { fit: 'cover', position: 'centre' }).jpeg({ quality: 88 }).toBuffer()
  const metadata = await sharp(bytes).metadata()
  if (metadata.width !== 1250 || metadata.height !== 1000 || bytes.length > 2 * 1024 * 1024) throw new Error(`Invalid prepared cover: ${key}`)
  await writeFile(new URL(`${key}-cover.jpg`, output), bytes, { flag: 'wx' })
  process.stdout.write(`${key}: 1250x1000, ${bytes.length} bytes\n`)
}
