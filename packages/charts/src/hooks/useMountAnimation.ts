/**
 * Mount-animation gate (04-widget-registry.md §7.5 and
 * research/design-system.md §4.3): elements render in their "from" state,
 * then flip to the final state after a double requestAnimationFrame so the
 * browser commits the initial frame and CSS transitions run.
 *
 * `prefers-reduced-motion` renders the final state immediately (mandatory —
 * the comps lack this; tokens' motion.css additionally zeroes transition
 * durations globally under reduced motion).
 */
import { useEffect, useState } from 'react';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True once entrance transitions should be in their final state. */
export function useMountAnimation(): boolean {
  const [mounted, setMounted] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (mounted) return undefined;
    if (typeof requestAnimationFrame !== 'function') {
      setMounted(true);
      return undefined;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== 0) cancelAnimationFrame(second);
    };
    // Intentionally mount-only: `mounted` can only flip false→true.
  }, []);

  return mounted;
}
