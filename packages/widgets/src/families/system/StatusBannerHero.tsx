/**
 * `status-banner-hero` (annex §12) — state-driven hero whose bg/border/icon/
 * title derive from the WORST child state (up/degraded/down), with an inline
 * end-aligned mono KPI trio. Evidence: Status Page.
 *
 * The derivation is the whole point of the widget: it binds to the SERVICE LIST
 * (`record-list`), not to a pre-computed status, so one degraded service is
 * enough to flip the hero — the page can never claim "All systems operational"
 * while a row says otherwise.
 */

import { MonoText, cn } from '@adminium/ui';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { numberField, oneOf, recordRowsOf, stringField, worstServiceState } from './system-lib.js';
import type { ServiceState } from './system-lib.js';
import { SERVICE_STATES, statusBannerHeroConfigSchema, statusBannerHeroDemoData } from './system-config.js';
import type { StatusBannerHeroConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { statusBannerHeroConfigSchema, statusBannerHeroDemoData };
export type { StatusBannerHeroConfig };

/** Per-state hero shell — tone-soft bg + `color-mix`-free tone border, CSS vars only. */
const STATE_SHELL: Record<ServiceState, string> = {
  up: 'border-pos/30 bg-pos-soft',
  degraded: 'border-warn/30 bg-warn-soft',
  down: 'border-danger/30 bg-danger-soft',
};

const STATE_GLYPH: Record<ServiceState, string> = {
  up: 'text-pos',
  degraded: 'text-warn',
  down: 'text-danger',
};

/** Developer fallbacks (English); the dashboard passes translated copy via config. */
const DEFAULT_TITLES: Record<ServiceState, string> = {
  up: 'All systems operational',
  degraded: 'Degraded performance',
  down: 'Major outage',
};

const DEFAULT_BODIES: Record<ServiceState, string> = {
  up: 'Every monitored service is responding normally.',
  degraded: 'Some services are slower than usual. We are investigating.',
  down: 'One or more services are unavailable. We are on it.',
};

export interface HeroStat {
  key: string;
  label?: string | undefined;
  unit?: string | undefined;
  value?: number | undefined;
}

export interface StatusBannerHeroViewProps {
  state: ServiceState;
  stats?: readonly HeroStat[] | undefined;
  title?: string | undefined;
  body?: string | undefined;
  testId?: string | undefined;
}

function StateGlyph({ state }: { state: ServiceState }) {
  if (state === 'up') return <CheckCircle2 className="size-5" />;
  if (state === 'degraded') return <AlertTriangle className="size-5" />;
  return <XCircle className="size-5" />;
}

export function StatusBannerHeroView({ state, stats, title, body, testId }: StatusBannerHeroViewProps) {
  const shown = (stats ?? []).filter((stat) => stat.value !== undefined);

  return (
    <div className="px-4 pb-4">
      <div
        data-widget="status-banner-hero"
        data-state={state}
        data-testid={testId}
        role="status"
        aria-live="polite"
        className={cn('flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3.5', STATE_SHELL[state])}
      >
        <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center', STATE_GLYPH[state])}>
          <StateGlyph state={state} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-bold text-fg">{title ?? DEFAULT_TITLES[state]}</p>
          <p className="truncate text-caption text-fg-muted">{body ?? DEFAULT_BODIES[state]}</p>
        </div>

        {shown.length > 0 && (
          <dl data-part="hero-stats" className="m-0 flex shrink-0 items-center gap-5">
            {shown.map((stat) => (
              <div key={stat.key} className="text-end">
                <dd className="m-0">
                  <MonoText className="text-body font-bold text-fg">
                    {stat.value}
                    {stat.unit ?? ''}
                  </MonoText>
                </dd>
                <dt className="text-caption text-fg-subtle">{stat.label ?? stat.key}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

export function StatusBannerHeroWidget({ config, data }: WidgetProps<StatusBannerHeroConfig>) {
  const rows = recordRowsOf(data);
  const states = rows.map((row) => oneOf(row[config.stateField], SERVICE_STATES, 'up'));
  const state = worstServiceState(states);

  // The KPI trio reads off the FIRST row (annex §12: the hero's stats are the
  // roll-up the payload carries alongside the service list).
  const first = rows[0];
  const stats = (config.stats ?? []).map((stat) => ({
    ...stat,
    value: first === undefined ? undefined : numberField(first, stat.key),
  }));

  return (
    <StatusBannerHeroView
      state={state}
      stats={stats}
      title={config.titles?.[state]}
      body={config.bodies?.[state]}
      testId={config.testId}
    />
  );
}

/** Re-exported for template composition + tests. */
export { worstServiceState, stringField };
