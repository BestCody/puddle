// Imported categories can be stale or over-broad. Do not recommend explicitly
// non-leisure services as cafes/bars merely because that category was imported.
// This is recommendation eligibility, not a deletion or a renamed catalogue row.
const nonLeisureSource = /\b(?:fire station|police station|government office|computer store|computer repair|marketing agency|advertising agency|seo services?)\b/
const serviceName = /\b(?:fire station(?:\s+\d+)?|police station|computers?|computer repair|seo|search engine optimi[sz]ation|digital marketing|marketing agency)\b/
const leisureName = /\b(?:caf[eé]|coffee|restaurant|pub|tavern|brewery|museum|gallery|arcade|gaming|internet caf[eé])\b/

function normalized(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function isPublicLeisurePlace(row) {
  const source = normalized([row?.source_category, row?.subcategory].filter(Boolean).join(' '))
  if (nonLeisureSource.test(source)) return false
  const name = normalized(row?.name)
  // Preserve real venues such as a computer museum or a converted fire-station
  // brewery. Generic generated summaries are not evidence of a venue's purpose.
  return !serviceName.test(name) || leisureName.test(name)
}
