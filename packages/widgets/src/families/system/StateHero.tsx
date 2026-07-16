/**
 * `state-hero` (annex §12) — parameterized full-page status: optional giant mono
 * HTTP code, tone-tinted icon chip, title, body, primary/secondary CTAs. The 404
 * variant adds a floating decorative ornament + quick-link chips.
 *
 * Built fresh in the widgets package rather than lifted from
 * `apps/dashboard/src/states/StateHero.tsx`: the app's hero is bound to that
 * app's `SystemStateSpec`/`stateMap` module, its router, and its `t()` — a widget
 * may never import an app (04 §2.1), and the annex's contract here is the
 * generic `stateMap` keyed by view id. The app keeps its own shell hero.
 */

import { Button, MonoText, cn } from '@adminium/ui';

import { stateHeroIcon, systemIcon } from './system-icons.js';
import { oneOf, recordRowOf, stringField } from './system-lib.js';
import type { StateHeroViewId, SystemTone } from './system-lib.js';
import { STATE_HERO_VIEWS, stateHeroConfigSchema, stateHeroDemoData } from './system-config.js';
import type { StateHeroConfig, StateHeroEntryConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { stateHeroConfigSchema, stateHeroDemoData };
export type { StateHeroConfig, StateHeroEntryConfig };

/** Tone-soft glyph chip classes — CSS variables only, no raw hex (04 hard rule). */
const TONE_TILE: Record<SystemTone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/**
 * Built-in copy per view id. Config `stateMap` overrides any field; these are
 * developer fallbacks in English (widgets are locale-agnostic — 04 §2), and the
 * dashboard passes translated copy through `stateMap`.
 */
const DEFAULT_STATE_MAP: Record<StateHeroViewId, Required<Pick<StateHeroEntryConfig, 'tone'>> & Omit<StateHeroEntryConfig, 'tone'>> = {
  '404': {
    tone: 'accent',
    code: '404',
    title: 'This page took a wrong turn',
    body: 'The page you are looking for was moved, renamed, or never existed.',
    primaryLabel: 'Back to dashboard',
    primaryHref: '/',
  },
  '500': {
    tone: 'danger',
    code: '500',
    title: 'Something broke on our side',
    body: 'The error was logged and the team notified. Trying again often works.',
    primaryLabel: 'Try again',
  },
  offline: {
    tone: 'warn',
    title: 'You are offline',
    body: 'Check your connection — the dashboard reconnects automatically.',
    primaryLabel: 'Retry',
  },
  forbidden: {
    tone: 'warn',
    code: '403',
    title: 'You do not have access',
    body: 'Ask a workspace admin to grant you permission for this page.',
    primaryLabel: 'Back to dashboard',
    primaryHref: '/',
  },
  maintenance: {
    tone: 'info',
    title: 'Down for maintenance',
    body: 'We are making things better. This usually takes a few minutes.',
  },
  'conn-error': {
    tone: 'danger',
    title: 'Cannot reach the database',
    body: 'The connection was refused or timed out. Check the connection settings.',
    primaryLabel: 'Test connection',
    primaryHref: '/studio',
  },
};

/** Merge the built-in entry for `view` with any config override. */
export function resolveStateHeroEntry(
  view: StateHeroViewId,
  stateMap: Partial<Record<StateHeroViewId, StateHeroEntryConfig>> | undefined,
): StateHeroEntryConfig {
  const base = DEFAULT_STATE_MAP[view];
  const override = stateMap?.[view];
  if (override === undefined) return base;
  // Only defined override fields win — a partial entry keeps the built-in rest.
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as StateHeroEntryConfig;
}

export interface StateHeroViewProps {
  view: StateHeroViewId;
  entry: StateHeroEntryConfig;
  ornament?: boolean | undefined;
  quickLinks?: readonly { label: string; href: string }[] | undefined;
  requestId?: string | undefined;
  onNavigate?: ((href: string) => void) | undefined;
  testId?: string | undefined;
}

export function StateHeroView({
  view,
  entry,
  ornament = false,
  quickLinks,
  requestId,
  onNavigate,
  testId,
}: StateHeroViewProps) {
  const tone = entry.tone;
  const icon = systemIcon(entry.icon) ?? stateHeroIcon(view);

  return (
    <div
      data-widget="state-hero"
      data-state={view}
      data-tone={tone}
      data-testid={testId}
      className="relative flex min-h-full w-full flex-col items-center justify-center overflow-hidden px-6 py-10 text-center"
    >
      {/*
        Decorative ornament (the 404 variant): purely presentational, so it is
        aria-hidden and sits behind the content. `inset-0` is the correct
        all-sides utility — `inset-block-0` is NOT a Tailwind utility and emits
        no CSS.
      */}
      {ornament && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn('size-64 rounded-full opacity-[0.07] blur-3xl', TONE_TILE[tone])} />
        </div>
      )}

      <div className="relative flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center">
          {entry.code !== undefined && (
            <MonoText
              aria-hidden="true"
              className="absolute select-none text-[80px] font-bold leading-none text-fg opacity-[0.06]"
            >
              {entry.code}
            </MonoText>
          )}
          <span
            data-part="state-glyph"
            className={cn('relative flex size-16 items-center justify-center rounded-2xl [&_svg]:size-7', TONE_TILE[tone])}
          >
            {icon}
          </span>
        </div>

        {entry.title !== undefined && <h2 className="text-title-md font-bold text-fg">{entry.title}</h2>}
        {entry.body !== undefined && <p className="max-w-[36ch] text-body-sm text-fg-muted">{entry.body}</p>}

        {(entry.primaryLabel !== undefined || entry.secondaryLabel !== undefined) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {entry.primaryLabel !== undefined && (
              <Button size="sm" onClick={() => entry.primaryHref !== undefined && onNavigate?.(entry.primaryHref)}>
                {entry.primaryLabel}
              </Button>
            )}
            {entry.secondaryLabel !== undefined && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => entry.secondaryHref !== undefined && onNavigate?.(entry.secondaryHref)}
              >
                {entry.secondaryLabel}
              </Button>
            )}
          </div>
        )}

        {quickLinks !== undefined && quickLinks.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-1.5 p-0">
            {quickLinks.map((link) => (
              <li key={link.href}>
                <button
                  type="button"
                  data-part="quick-link"
                  onClick={() => onNavigate?.(link.href)}
                  className="rounded-full bg-surface-2 px-3 py-1 text-caption font-semibold text-fg-muted hover:bg-surface-3 hover:text-fg"
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {requestId !== undefined && (
          <MonoText className="text-caption text-fg-subtle">{requestId}</MonoText>
        )}
      </div>
    </div>
  );
}

export function StateHeroWidget({ config, data, onEvent }: WidgetProps<StateHeroConfig>) {
  const row = recordRowOf(data);
  // The payload may steer which view renders (a health check returning
  // `conn-error`); config.view is the default and the story/demo path.
  const bound = row === null ? undefined : stringField(row, config.viewField);
  const view = oneOf(bound, STATE_HERO_VIEWS, config.view);

  return (
    <StateHeroView
      view={view}
      entry={resolveStateHeroEntry(view, config.stateMap)}
      ornament={config.ornament}
      quickLinks={config.quickLinks}
      requestId={config.requestId}
      onNavigate={(href) => onEvent({ type: 'drill-through', href })}
      testId={config.testId}
    />
  );
}
