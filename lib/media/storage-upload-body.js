export function storageUploadBody(buffer) {
  if (!buffer || typeof buffer.byteLength !== 'number') throw new Error('A binary upload buffer is required.')
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
