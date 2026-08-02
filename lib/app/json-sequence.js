import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import readline from 'node:readline'

export function normalizeJsonSequenceLine(value) {
  return String(value ?? '').replace(/^[\u001e\uFEFF]+/, '').trim()
}

async function appendJsonSequence(inputPath, output) {
  const input = createReadStream(inputPath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  let records = 0
  try {
    for await (const line of lines) {
      const normalized = normalizeJsonSequenceLine(line)
      if (!normalized) continue
      if (!output.write(`${normalized}\n`)) await once(output, 'drain')
      records += 1
    }
    return records
  } finally {
    lines.close()
    input.destroy()
  }
}

export async function convertJsonSequenceToJsonLines(inputPaths, outputPath) {
  const paths = Array.isArray(inputPaths) ? inputPaths : [inputPaths]
  const output = createWriteStream(outputPath, { encoding: 'utf8' })
  let records = 0
  try {
    for (const inputPath of paths) records += await appendJsonSequence(inputPath, output)
    output.end()
    await once(output, 'finish')
    return records
  } catch (error) {
    output.destroy()
    throw error
  }
}
