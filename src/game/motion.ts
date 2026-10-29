/**
 * The OS-level motion preference. Used as the default when a franchise is
 * created or an older save is hydrated; after that the player's own setting in
 * SYSTEM wins, so turning the camera back on is never reverted on next launch.
 */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
