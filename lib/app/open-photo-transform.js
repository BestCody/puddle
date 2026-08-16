import { createHash } from 'node:crypto'
import sharp from 'sharp'

export async function openPhotoDifferenceHash(body) {
  const raw = await sharp(body).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = 0n
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = raw[row * 9 + column]
      const right = raw[row * 9 + column + 1]
      bits = (bits << 1n) | BigInt(left > right ? 1 : 0)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

export async function transformOpenPhoto(source) {
  if (!source?.length) throw new Error('Open-photo source is empty.')
  const result = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1000, fit: 'cover', position: 'attention', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  if (!result.data?.length || !result.info?.width || !result.info?.height) throw new Error('Normalized open photo is invalid.')
  const contentHash = createHash('sha256').update(result.data).digest('hex')
  return {
    body: result.data,
    width: result.info.width,
    height: result.info.height,
    contentHash,
    perceptualHash: await openPhotoDifferenceHash(result.data),
    byteSize: result.data.length
  }
}
