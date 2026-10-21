import fs from 'node:fs/promises'
import sharp from 'sharp'
const { assets } = JSON.parse(
  await fs.readFile(new URL('./cosmetic-art.json', import.meta.url), 'utf8'),
)
await fs.mkdir('public/cosmetics', { recursive: true })
await fs.mkdir('/private/tmp/fordkall-cosmetics', { recursive: true })
const thumbs = []
for (const [index, asset] of assets.entries()) {
  const frame = asset.id.startsWith('frame-')
  await sharp(asset.path)
    .resize(frame ? 512 : 960, frame ? 512 : 540, { fit: 'cover' })
    .webp({ quality: 82, alphaQuality: 100 })
    .toFile(`public/cosmetics/${asset.id}.webp`)
  const tile = await sharp(`public/cosmetics/${asset.id}.webp`)
    .resize(180, 130, { fit: 'contain', background: '#283348' })
    .flatten({ background: '#283348' })
    .png()
    .toBuffer()
  thumbs.push({
    input: tile,
    left: (index % 8) * 180,
    top: Math.floor(index / 8) * 155,
  })
  const label = Buffer.from(
    `<svg width="180" height="25"><rect width="180" height="25" fill="#182233"/><text x="7" y="16" font-family="Arial" font-size="10" fill="white">${asset.id}</text></svg>`,
  )
  thumbs.push({
    input: label,
    left: (index % 8) * 180,
    top: Math.floor(index / 8) * 155 + 130,
  })
}
await sharp({
  create: {
    width: 1440,
    height: Math.ceil(assets.length / 8) * 155,
    channels: 4,
    background: '#182233',
  },
})
  .composite(thumbs)
  .png()
  .toFile('/private/tmp/fordkall-cosmetics/catalog.png')
console.log(`${assets.length} assets prepared`)
