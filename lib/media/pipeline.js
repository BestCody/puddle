import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const PUBLIC_IMAGE_PURPOSES = new Set([
  'event_cover', 'event_gallery', 'location_cover', 'location_gallery', 'host_logo', 'profile_photo'
])
const PRIVATE_IMAGE_PURPOSES = new Set(['chat_image'])
const DOCUMENT_PURPOSES = new Set(['verification_document'])

const POLICIES = {
  event_cover: { kind: 'image', target: 'event', maxBytes: 10_000_000, maxDimension: 2400, public: true },
  event_gallery: { kind: 'image', target: 'event', maxBytes: 10_000_000, maxDimension: 2400, public: true },
  location_cover: { kind: 'image', target: 'location', maxBytes: 10_000_000, maxDimension: 2400, public: true },
  location_gallery: { kind: 'image', target: 'location', maxBytes: 10_000_000, maxDimension: 2400, public: true },
  host_logo: { kind: 'image', target: 'host', maxBytes: 5_000_000, maxDimension: 1600, public: true },
  profile_photo: { kind: 'image', target: 'profile', maxBytes: 5_000_000, maxDimension: 1600, public: true },
  chat_image: { kind: 'image', target: 'conversation', maxBytes: 8_000_000, maxDimension: 2000, public: false },
  verification_document: { kind: 'document', target: 'verification', maxBytes: 15_000_000, public: false }
}

export function mediaPolicy(purpose) {
  const policy = POLICIES[String(purpose || '')]
  if (!policy) throw new Error('Unsupported media purpose.')
  return policy
}

function detectedMime(buffer) {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.subarray(4, 12).toString('ascii').includes('ftypavif')) return 'image/avif'
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  return 'application/octet-stream'
}

function safeOriginalName(name) {
  return String(name || 'upload')
    .normalize('NFKC')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'upload'
}

function pdfLooksSafe(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 1_000_000)).toString('latin1').toLowerCase()
  const tail = buffer.subarray(Math.max(0, buffer.length - 16_384)).toString('latin1').toLowerCase()
  if (!tail.includes('%%eof')) return false
  const activeTokens = ['/javascript', '/js ', '/launch', '/embeddedfile', '/openaction', '/richmedia', '/xfa', '/encrypt']
  if (activeTokens.some((token) => head.includes(token) || tail.includes(token))) return false
  return !/(?:^|[\s<\[])(?:\/aa)(?:[\s>\[]|$)/i.test(head)
}

export async function processMediaFile(file, purpose) {
  const policy = mediaPolicy(purpose)
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose a file to upload.')
  if (Number.isFinite(Number(file.size)) && Number(file.size) > policy.maxBytes) throw new Error(`This file is larger than ${Math.round(policy.maxBytes / 1_000_000)} MB.`)
  const source = Buffer.from(await file.arrayBuffer())
  if (!source.length) throw new Error('The uploaded file is empty.')
  if (source.length > policy.maxBytes) throw new Error(`This file is larger than ${Math.round(policy.maxBytes / 1_000_000)} MB.`)

  const mime = detectedMime(source)
  const declared = String(file.type || '').toLowerCase().trim()
  if (policy.kind === 'image') {
    if (!IMAGE_MIMES.has(mime) || !declared || declared !== mime) throw new Error('The image file type does not match its contents. Upload a JPEG, PNG, WebP, or AVIF image.')
    const image = sharp(source, { failOn: 'error', limitInputPixels: 40_000_000, animated: false })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height) throw new Error('The image dimensions could not be verified.')
    if (metadata.width * metadata.height > 40_000_000) throw new Error('The image resolution is too large.')
    if ((metadata.pages || 1) > 1) throw new Error('Animated images are not accepted.')
    const result = await image
      .rotate()
      .resize({ width: policy.maxDimension, height: policy.maxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toBuffer({ resolveWithObject: true })

    if (result.data.length > policy.maxBytes) throw new Error('The processed image is still too large.')
    return {
      buffer: result.data,
      mimeType: 'image/webp',
      extension: 'webp',
      width: result.info.width,
      height: result.info.height,
      sha256: createHash('sha256').update(result.data).digest('hex'),
      originalName: safeOriginalName(file.name),
      bytes: result.data.length,
      bucket: policy.public ? 'puddle-public-media' : 'puddle-private-media',
      visibility: policy.public ? 'public' : 'private',
      status: 'approved',
      scanStatus: 'clean',
      scanner: 'sharp-decode-reencode-v1'
    }
  }

  if (!DOCUMENT_PURPOSES.has(purpose) || mime !== 'application/pdf' || declared !== 'application/pdf') {
    throw new Error('Verification documents must be valid PDF files whose type matches their contents.')
  }
  if (!pdfLooksSafe(source)) throw new Error('This PDF is incomplete, encrypted, or contains unsupported active content.')
  return {
    buffer: source,
    mimeType: 'application/pdf',
    extension: 'pdf',
    width: null,
    height: null,
    sha256: createHash('sha256').update(source).digest('hex'),
    originalName: safeOriginalName(file.name),
    bytes: source.length,
    bucket: 'puddle-quarantine',
    visibility: 'private',
    status: 'quarantined',
    scanStatus: 'pending',
    scanner: null
  }
}

export function mediaObjectPath(userId, extension) {
  return `${userId}/${randomUUID()}/${randomUUID()}.${extension}`
}

export function isPublicImagePurpose(purpose) {
  return PUBLIC_IMAGE_PURPOSES.has(purpose)
}

export function isPrivateImagePurpose(purpose) {
  return PRIVATE_IMAGE_PURPOSES.has(purpose)
}
