export function historyContinuationRow(visibleRows, scannedRow, hasOverflow) {
  return hasOverflow ? visibleRows.at(-1) || null : scannedRow || null
}
