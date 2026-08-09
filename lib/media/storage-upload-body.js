export function storageUploadBody(buffer, mimeType = 'application/octet-stream') {
  if (!buffer || typeof buffer.byteLength !== 'number') throw new Error('A binary upload buffer is required.')
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const exactBytes = new Uint8Array(bytes.byteLength)
  exactBytes.set(bytes)
  return new Blob([exactBytes], { type: mimeType })
}
