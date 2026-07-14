/**
 * Read-only, virtualized monospace viewer for a BYO enrichment prompt
 * (06-llm-assist.md §10.2 step 4). The flattened prompt (`=== SYSTEM ===` /
 * `=== USER ===`) can run to thousands of lines on large schemas, so only the
 * visible line window renders; copy/download operate on the full text upstream.
 *
 * Prompt/JSON content is always LTR (`dir="ltr"`) even under an RTL locale so
 * the code reads correctly in ar_EG (14 §14 RTL correctness).
 */
import { useEffect, useMemo, useRef, useState } from 'react';

/** px — must match `text-[12px] leading-5` (1.25rem) below. */
const LINE_HEIGHT = 20;
const OVERSCAN = 24;

export interface MonoPromptViewerProps {
  text: string;
  label: string;
}

export function MonoPromptViewer({ text, label }: MonoPromptViewerProps) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return undefined;
    const measure = () => setViewport(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Unmeasured (SSR/happy-dom, no layout) ⇒ render every line so tests and
  // no-JS-layout environments still show the whole prompt.
  const measured = viewport > 0;
  const firstLine = measured ? Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN) : 0;
  const windowSize = measured ? Math.ceil(viewport / LINE_HEIGHT) + OVERSCAN * 2 : lines.length;
  const lastLine = Math.min(lines.length, firstLine + windowSize);
  const topPad = firstLine * LINE_HEIGHT;
  const bottomPad = Math.max(0, (lines.length - lastLine) * LINE_HEIGHT);
  const visible = lines.slice(firstLine, lastLine);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      role="region"
      aria-label={label}
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-2 font-mono text-[12px] leading-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="min-w-max px-3.5 py-3">
        {topPad > 0 ? (
          <div aria-hidden="true" style={{ '--adm-pad': `${topPad}px` }} className="h-[var(--adm-pad)]" />
        ) : null}
        {visible.map((line, index) => (
          <div key={firstLine + index} className="whitespace-pre text-fg-muted">
            {line === '' ? ' ' : line}
          </div>
        ))}
        {bottomPad > 0 ? (
          <div aria-hidden="true" style={{ '--adm-pad': `${bottomPad}px` }} className="h-[var(--adm-pad)]" />
        ) : null}
      </div>
    </div>
  );
}
