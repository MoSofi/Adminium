/**
 * progress-log-console (09 §8.2 step 2) — mono introspection log with the
 * comps' storytelling lines; tones per line kind. The comp left several
 * template bindings unbound (ia-mapping §5) — every line here is bound data.
 */
import { Check, CircleAlert, Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

export type LogLineKind = 'info' | 'ok' | 'warn' | 'error' | 'running';

export interface LogLine {
  id: string;
  kind: LogLineKind;
  text: string;
}

export function LogConsole({ lines, label }: { lines: readonly LogLine[]; label: string }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [lines.length]);

  return (
    <div
      role="log"
      aria-label={label}
      aria-live="polite"
      className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-2 p-3.5 font-mono text-[12px] leading-6"
    >
      {lines.map((line) => (
        <div key={line.id} data-kind={line.kind} className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 flex size-4 shrink-0 items-center justify-center">
            {line.kind === 'ok' ? (
              <Check className="size-3.5 text-pos" />
            ) : line.kind === 'error' ? (
              <CircleAlert className="size-3.5 text-danger" />
            ) : line.kind === 'warn' ? (
              <TriangleAlert className="size-3.5 text-warn" />
            ) : line.kind === 'running' ? (
              <Loader2 className="size-3.5 animate-spin text-accent" />
            ) : (
              <span className="size-1 rounded-full bg-fg-subtle" />
            )}
          </span>
          <span className={line.kind === 'error' ? 'text-danger' : line.kind === 'warn' ? 'text-warn' : 'text-fg-muted'}>
            {line.text}
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
