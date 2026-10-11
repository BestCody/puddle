// Keep stable DOM hooks for navigation, appearance and browser tests while
// assigning styling exclusively to the component's CSS Module.
export function scopedClasses(styles, className) {
  if (!className) return ''
  return className.split(/\s+/).filter(Boolean).map((name) =>
    styles[name] ? `${name} ${styles[name]}` : name
  ).join(' ')
}
