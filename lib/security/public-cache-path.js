export function isPublicCataloguePath(pathname) {
  return pathname === '/places' ||
    pathname === '/date-ideas' ||
    /^\/places\/[^/]+$/.test(pathname) ||
    /^\/places\/in\/[^/]+(?:\/[^/]+)?$/.test(pathname) ||
    /^\/date-ideas\/[^/]+$/.test(pathname)
}

export function isPublicRecommendationPath(pathname) {
  return /^\/api\/public-location\/[^/]+\/similar$/.test(pathname)
}
