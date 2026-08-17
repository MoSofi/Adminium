// SPDX-License-Identifier: AGPL-3.0-only
/**
 * StateHero — the `page-system-state` hero (09-generated-app.md §6.1),
 * composed per System States.dc.html: giant mono status code behind a
 * 64px tone-soft glyph tile, headline + guidance, optional diagnostics
 * readout (db-unreachable), CTA row, and the faded Adminium mark.
 *
 * Renders full-bleed (`fullPage`) for app-wide failures and inline inside the
 * content outlet for page-scoped ones (shell + nav stay usable).
 */
import { Button, MonoText, cn } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { BrandMark } from '../shell/BrandMark.js';
import { CopyButton } from '../studio/connect/CopyButton.js';
import type { StateTone, SystemStateSpec } from './stateMap.js';

/**
 * Whether the clipboard API is reachable at all. `navigator.clipboard` is
 * undefined outside a secure context, so `http://192.168.1.50:4600` — an
 * entirely ordinary way to reach a self-hosted instance — has none.
 */
function canCopy(): boolean {
  return typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
}

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
          {t(spec.banner.key, spec.banner.en)}
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
        <h1 className="mb-2 mt-[18px] text-[24px] font-extrabold tracking-[-0.03em]">{t(spec.title.key, spec.title.en)}</h1>
        <p className="m-0 max-w-[400px] text-[14px] leading-relaxed text-fg-muted">{t(spec.body.key, spec.body.en)}</p>

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
                <dd className="m-0 text-danger">{t(spec.diagnostics.status.key, spec.diagnostics.status.en)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[52px] shrink-0 text-fg-subtle">hint</dt>
                <dd className="m-0 text-fg-muted">{t(spec.diagnostics.hint.key, spec.diagnostics.hint.en)}</dd>
              </div>
            </dl>
          </div>
        )}

        {/*
          A CTA renders only when something is wired to it. The label used to be
          enough on its own, so five states shipped a button that swallowed the
          click and did nothing — worst of all on this screen, where "Status
          page" was the only thing on a 500 that looked like a way out. A
          missing button is a smaller lie than a dead one.
        */}
        <div className="mt-[26px] flex gap-2.5">
          {spec.primary === undefined || onPrimary === undefined ? null : (
            <Button onClick={onPrimary}>
              {PrimaryIcon === undefined ? null : <PrimaryIcon aria-hidden="true" />}
              {t(spec.primary.label.key, spec.primary.label.en)}
            </Button>
          )}
          {spec.secondary === undefined || onSecondary === undefined ? null : (
            <Button variant="outline" onClick={onSecondary}>
              {t(spec.secondary.key, spec.secondary.en)}
            </Button>
          )}
        </div>

        {/*
          The reference used to be a bare `req_9f2a…` with nothing to say what
          it was or what to do with it — on a screen that had just told the user
          an unspecified something went wrong. It is the join key between this
          screen and the server's log line for the same request, so it now says
          so, and can be lifted in one click instead of transcribed off a
          screenshot.
        */}
        {requestId === null || requestId === undefined ? null : (
          <div className="mt-5 flex flex-col items-center gap-1.5">
            {/*
              `select-all` so one click takes the whole token. This is the path
              that always works: the copy button below needs
              `navigator.clipboard`, which needs a secure context, and a
              self-host reached over plain HTTP on a LAN address does not have
              one. Without this the reference would be recoverable only by
              retyping it, which is how it started.
            */}
            <p className="m-0 text-[11px] text-fg-subtle">
              {t('states.reference.label', 'Reference')}{' '}
              <MonoText className="select-all">{requestId}</MonoText>
            </p>
            {/*
              Same rule as the CTAs above: no control that cannot act. Where
              there is no clipboard the button would take the click, fail
              silently and never flip to "Copied" — a dead button on the screen
              built to explain a failure.
            */}
            {canCopy() ? (
              <CopyButton
                value={requestId}
                variant="ghost"
                label={t('states.reference.copy', 'Copy reference')}
                copiedLabel={t('states.reference.copied', 'Copied')}
              />
            ) : null}
            <p className="m-0 max-w-[320px] text-[11px] text-fg-subtle">
              {t(
                'states.reference.hint',
                'Quote this when reporting the problem — your server log records the same id.',
              )}
            </p>
          </div>
        )}

        <BrandMark tone="muted" className="mt-9 gap-2 opacity-60" />
      </div>
    </div>
  );
}
