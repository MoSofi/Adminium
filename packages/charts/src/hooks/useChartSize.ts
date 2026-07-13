/**
 * Responsive width via ResizeObserver. Charts are fluid in the inline axis
 * (grid cells set the block size); the SVG viewBox tracks the measured width
 * so geometry renders 1:1 with CSS pixels.
 *
 * Environments without ResizeObserver (SSR, happy-dom) keep `initialWidth`.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useMeasuredWidth<T extends HTMLElement>(
  initialWidth = 600,
): { ref: RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;

    const measure = (next: number) => {
      if (next > 0) setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    measure(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const inline = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        measure(inline);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
