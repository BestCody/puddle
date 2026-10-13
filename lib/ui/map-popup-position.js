// All distances come from the rendered map, popup and marker. The popup follows
// its point, shifts/flips near an edge, and hides when that point leaves view.
export function mapPopupPosition({ anchor, viewport, popup, gap, gutter, topInset = 0 }) {
  if (!anchor || !popup || viewport.width <= 0 || viewport.height <= 0 || popup.width <= 0 || popup.height <= 0) return null
  if (anchor.x < 0 || anchor.x > viewport.width || anchor.y < 0 || anchor.y > viewport.height) return null
  const insetX = Math.min(gutter, Math.max(0, (viewport.width - popup.width) / 2))
  const safeTop = Math.min(Math.max(0, topInset), Math.max(0, viewport.height - popup.height))
  const insetY = Math.min(gutter, Math.max(0, (viewport.height - safeTop - popup.height) / 2))
  const left = Math.max(insetX, Math.min(anchor.x - popup.width / 2, viewport.width - popup.width - insetX))
  const above = anchor.y - gap - popup.height
  const side = above >= safeTop + insetY ? 'above' : 'below'
  const top = Math.max(safeTop + insetY, Math.min(side === 'above' ? above : anchor.y + gap, viewport.height - popup.height - insetY))
  return { left, top, tip: anchor.x - left, side }
}
