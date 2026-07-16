/**
 * `status-pill` (annex §12) — the UNIVERSAL enum renderer: soft tone bg,
 * colored dot, label. Every enum column in the generated app registers one of
 * these with an LLM/heuristic-assigned tone map (annex §12 auto-instantiation:
 * `active|paid|success|healthy`→pos, `pending|trial|warn`→warn,
 * `failed|error|churned|breached`→danger).
 *
 * Renders @adminium/ui's `Badge` — the primitive behind `<StatusPill>` — and
 * reuses the shared `statusTone` registry for the tone vocabulary and the
 * `DEFAULT_STATUS_TONES` fallback map. It binds `Badge` rather than `StatusPill`
 * for one reason: `StatusPillProps` is `Omit<BadgeProps, 'tone' | 'dot' | …>`
 * and hard-codes `dot`, but the annex exposes `dot` as widget config, so the
 * dot-less variant is only reachable through the primitive.
 */

import { Badge, statusTone } from '@adminium/ui';

import { recordRowOf, stringField } from './system-lib.js';
import { statusPillConfigSchema, statusPillDemoData } from './system-config.js';
import type { StatusPillConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { statusPillConfigSchema, statusPillDemoData };
export type { StatusPillConfig };

export interface StatusPillWidgetProps {
  status: string | undefined;
  map?: Record<string, { label?: string | undefined; tone?: string | undefined }> | undefined;
  fallbackTone?: 'neutral' | 'accent' | 'pos' | 'warn' | 'danger' | 'info' | undefined;
  dot?: boolean | undefined;
  testId?: string | undefined;
}

const TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;
type Tone = (typeof TONES)[number];

function toneOf(value: string | undefined): Tone | undefined {
  return value !== undefined && (TONES as readonly string[]).includes(value) ? (value as Tone) : undefined;
}

/**
 * Presentational status pill. `map` overrides the label and/or tone per enum
 * value; anything unmapped falls back to @adminium/ui's shared `statusTone`
 * vocabulary and then to `fallbackTone`, so an unrecognised enum still renders
 * a readable pill rather than nothing.
 */
export function StatusPillWidgetView({ status, map, fallbackTone = 'neutral', dot = true, testId }: StatusPillWidgetProps) {
  if (status === undefined || status === '') return null;
  const entry = map?.[status];
  const tone = toneOf(entry?.tone) ?? statusTone(status, fallbackTone);
  return (
    <Badge
      tone={tone}
      dot={dot}
      data-widget="status-pill"
      data-status={status}
      data-testid={testId}
      className="align-middle"
    >
      {entry?.label ?? status}
    </Badge>
  );
}

export function StatusPillWidget({ config, data }: WidgetProps<StatusPillConfig>) {
  const row = recordRowOf(data);
  const status = row === null ? undefined : stringField(row, config.statusField);

  return (
    <div className="flex h-full items-center px-4 pb-4">
      <StatusPillWidgetView
        status={status}
        map={config.map}
        fallbackTone={config.fallbackTone}
        dot={config.dot}
        testId={config.testId}
      />
    </div>
  );
}
