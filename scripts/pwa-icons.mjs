import sharp from 'sharp'
import { mkdir, readFile } from 'node:fs/promises'

// Use the existing vector identity. Keep the complete mark inside the maskable safe zone.
const mark = await readFile(new URL('../public/favicon.svg', import.meta.url))
const output = new URL('../public/icons/', import.meta.url)
await mkdir(output, { recursive: true })
for (const size of [192, 512]) {
  await sharp(mark).resize(size, size).png().toFile(new URL(`icon-${size}.png`, output).pathname)
  const inset = Math.round(size * .2)
  const logo = await sharp(mark).resize(size - inset * 2).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: '#171d29' } })
    .composite([{ input: logo, top: inset, left: inset }]).png()
    .toFile(new URL(`maskable-${size}.png`, output).pathname)
}
await sharp(mark).resize(180, 180).flatten({ background: '#171d29' }).png()
  .toFile(new URL('apple-touch-icon.png', output).pathname)
const android = new URL('../android/app/src/main/res/drawable-nodpi/', import.meta.url)
await mkdir(android, { recursive: true })
const launcher = await sharp(mark).resize(384, 384).png().toBuffer()
await sharp({ create: { width: 576, height: 576, channels: 4, background: '#00000000' } })
  .composite([{ input: launcher, top: 96, left: 96 }]).png()
  .toFile(new URL('launcher_foreground.png', android).pathname)
await sharp(mark).resize(192, 192).png().toFile(new URL('splash_logo.png', android).pathname)
console.log('PWA icons generated from the Ford Kall vector identity.')
