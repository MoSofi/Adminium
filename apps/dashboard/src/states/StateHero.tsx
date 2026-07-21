/**
 * StateHero — the `page-system-state` hero (09-generated-app.md §6.1),
 * composed per designs/System States.dc.html: giant mono status code behind a
 * 64px tone-soft glyph tile, headline + guidance, optional diagnostics
 * readout (db-unreachable), CTA row, and the faded Adminium mark.
 *
 * Renders full-bleed (`fullPage`) for app-wide failures and inline inside the
 * content outlet for page-scoped ones (shell + nav stay usable).
 */
import { Database } from 'lucide-react';
import { Button, MonoText, cn } from '@adminium/ui';

import { t } from '../i18n/t.js';
import type { StateTone, SystemStateSpec } from './stateMap.js';

const toneTile: Record<StateTone, string> = {
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-3 text-fg-muted',
};

export interface StateHeroProps {
  spec: SystemStateSpec;
  onPrimary?: (() => void) | undefined;
  onSecondary?: (() => void) | undefined;
  /** `req_…` support-handshake footer line, when the failure carried one. */
  requestId?: string | null | undefined;
  fullPage?: boolean | undefined;
  className?: string | undefined;
}

export function StateHero({ spec, onPrimary, onSecondary, requestId, fullPage = true, className }: StateHeroProps) {
  const Icon = spec.icon;
  const PrimaryIcon = spec.primary?.icon;
  return (
    <div
      data-part="state-hero"
      data-state={spec.id}
      className={cn(
        'flex w-full items-center justify-center px-6 py-10',
        fullPage ? 'min-h-dvh bg-bg text-fg' : 'min-h-full',
        className,
      )}
    >
      {spec.banner === undefined ? null : (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-warn px-3 py-2.5 text-[12.5px] font-bold text-accent-fg"
        >
          <Icon className="size-[15px]" aria-hidden="true" />
          {spec.banner}
        </div>
      )}
      <div className="flex w-full max-w-[440px] flex-col items-center text-center">
        {spec.code === undefined ? null : (
          <MonoText
            aria-hidden="true"
            className="-mb-2 text-[96px] font-extrabold leading-none tracking-[-0.05em] text-surface-3"
          >
            {spec.code}
          </MonoText>
        )}
        <div className={cn('flex size-16 items-center justify-center rounded-[17px]', toneTile[spec.tone])}>
          <Icon className="size-[30px]" aria-hidden="true" />
        </div>
        <h1 className="mb-2 mt-[18px] text-[24px] font-extrabold tracking-[-0.03em]">{spec.title}</h1>
        <p className="m-0 max-w-[400px] text-[14px] leading-relaxed text-fg-muted">{spec.body}</p>

        {spec.diagnostics === undefined ? null : (
          <div className="mt-[22px] w-full overflow-hidden rounded-lg border border-border bg-surface text-start shadow-card">
            <div className="flex items-center gap-2 border-b border-border px-[15px] py-[11px]">
              <span className="text-[12px] font-bold">{t('states.diagnostics', 'Diagnostics')}</span>
              <span className="ms-auto text-[11px] text-fg-subtle">{t('states.checked', 'checked 8s ago')}</span>
            </div>
            <dl className="m-0 px-[15px] py-3 font-mono text-[11.5px] leading-[1.8]">
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 text-fg-subtle">host</dt>
                <dd className="m-0 text-fg">{spec.diagnostics.host}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 text-fg-subtle">status</dt>
                <dd className="m-0 text-danger">{spec.diagnostics.status}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 text-fg-subtle">hint</dt>
                <dd className="m-0 text-fg-muted">{spec.diagnostics.hint}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="mt-[26px] flex gap-2.5">
          {spec.primary === undefined ? null : (
            <Button onClick={onPrimary}>
              {PrimaryIcon === undefined ? null : <PrimaryIcon aria-hidden="true" />}
              {spec.primary.label}
            </Button>
          )}
          {spec.secondary === undefined ? null : (
            <Button variant="outline" onClick={onSecondary}>
              {spec.secondary}
            </Button>
          )}
        </div>

        {requestId === null || requestId === undefined ? null : (
          <MonoText className="mt-5 text-[11px] text-fg-subtle">{requestId}</MonoText>
        )}

        <div className="mt-9 flex items-center gap-2 opacity-60">
          <span className="flex size-[22px] items-center justify-center rounded-[7px] bg-accent text-accent-fg">
            <Database className="size-3" aria-hidden="true" />
          </span>
          <span className="text-[12px] font-bold">Adminium</span>
        </div>
      </div>
    </div>
  );
}
