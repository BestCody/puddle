export function serializeStructuredData(value) {
  return JSON.stringify(value).replaceAll('<', String.raw`\u003c`)
}
