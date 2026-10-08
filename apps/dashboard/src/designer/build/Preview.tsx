// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The preview: the app being built, as its people will see it.
 *
 * It is served on the preview's own host name (`localhost` beside the
 * Designer's `127.0.0.1`), a different site: code the model wrote cannot act
 * for the person through it. The Designer asks for a one-use ticket, and the
 * frame opens the ticket's address, which signs the frame in as a user that
 * holds only the app's own roles and sends it on to the page.
 *
 * Sides: the Dashboard (the person's own dashboard, as the owner they are,
 * on the Designer's name: no ticket, no preview user),
 * Staff and Customer — a side the app does not have is absent. Widths:
 * desktop fills, tablet is 768 wide, phone 360 in a bezel. The frame reloads
 * when the app is applied again (`app-changed`), and on Reload.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ExternalLink, Eye, Hammer, LayoutDashboard, LoaderCircle, Monitor, RotateCw, Smartphone, Tablet, UserRound, WandSparkles, IdCard } from 'lucide-react';

import { AppFrame } from '../../apps/AppFrame.js';
import { t } from '../../i18n/t.js';
import { designerApi, type DesignerSession } from '../api.js';
import { seesPage, sightFrom } from './sight.js';
import type { TurnView } from './turns.js';
import { OWN_DASHBOARD, type PreviewModel, type PreviewSide } from './usePreview.js';

export type { PreviewSide, PreviewWidth } from './usePreview.js';

function sideName(side: PreviewSide): string {
  switch (side) {
    case 'dashboard':
      return t('designer:preview.dashboard', 'Dashboard');
    case 'staff':
      return t('designer:preview.staff', 'Staff');
    case 'customer':
      return t('designer:preview.customer', 'Customer');
  }
}

function building(side: PreviewSide): string {
  switch (side) {
    case 'dashboard':
      return t('designer:preview.buildingDashboard', 'Building the dashboard…');
    case 'staff':
      return t('designer:preview.buildingStaff', 'Building the staff side…');
    case 'customer':
      return t('designer:preview.buildingCustomer', 'Building the customer side…');
  }
}

function failedTitle(side: PreviewSide): string {
  switch (side) {
    case 'dashboard':
      return t('designer:preview.failedDashboard', 'The app was not applied.');
    case 'staff':
      return t('designer:preview.failedStaff', 'The staff side did not build.');
    case 'customer':
      return t('designer:preview.failedCustomer', 'The customer side did not build.');
  }
}

function crashedTitle(side: PreviewSide): string {
  return side === 'staff'
    ? t('designer:preview.crashedStaff', 'The staff screen stopped with an error.')
    : t('designer:preview.crashedCustomer', 'The customer screen stopped with an error.');
}

/** Whose eyes the preview is: the owner's own for the dashboard, the app's roles for the staff side, nobody for the customer side. */
export function seenAs(side: PreviewSide, roles: readonly string[] | null): string {
  if (side === 'dashboard') return t('designer:preview.seenAsOwner', 'Seen as: you, the owner');
  if (side === 'customer') return t('designer:preview.seenAsVisitor', 'Seen as: a visitor, not signed in');
  if (roles === null) return t('designer:preview.seenAsStaff', 'Seen as: staff — a preview');
  if (roles.length === 0) return t('designer:preview.seenAsNoRole', 'Seen as: a person with no role yet — a preview');
  return t('designer:preview.seenAs', 'Seen as: {who} — a preview', { who: roles.join(', ') });
}

/** The screen went on, and something in it threw: a part of it is empty or wrong, and says nothing. */
function wentOnTitle(side: PreviewSide): string {
  return side === 'staff'
    ? t('designer:preview.wentOnStaff', 'The staff screen hit an error and went on. A part of it may be empty.')
    : t('designer:preview.wentOnCustomer', 'The customer screen hit an error and went on. A part of it may be empty.');
}

function refusedTitle(side: PreviewSide): string {
  return side === 'staff'
    ? t('designer:preview.refusedStaff', 'The staff screen asked for something Adminium refuses.')
    : t('designer:preview.refusedCustomer', 'The customer screen asked for something Adminium refuses.');
}

/** The side a build's own words name ("Could not build the customer side of …"), whichever one is being looked at. */
export function sideNamed(problem: string): PreviewSide | null {
  const found = /\bthe (staff|customer) side\b/.exec(problem);
  return found === null ? null : (found[1] as PreviewSide);
}

/** The last turn's state for the preview: still building, or a build that failed with its first line. */
export function previewState(turns: readonly TurnView[]): { building: boolean; failed: string | null } {
  const last = turns.at(-1);
  if (last === undefined) return { building: false, failed: null };
  if (last.outcome === null) {
    const running = last.steps.some((row) => row.state === 'running' && (row.tool === 'build_sides' || row.tool === 'apply_app'));
    return { building: running, failed: null };
  }
  // The turn's LAST build decides, a tool's or the engine's own at the end: one that failed and was then fixed is no longer what the preview shows.
  if (last.buildFailed === null) return { building: false, failed: null };
  // The first line names the side; the next says what is wrong with it.
  const lines = last.buildFailed.split('\n').filter((line) => line.trim() !== '');
  const named = /^Could not build the /.test(lines[0] ?? '');
  return { building: false, failed: lines.slice(0, named ? 2 : 1).join('\n') };
}

/**
 * The frame and what is drawn over it. Its bar is drawn by the work area,
 * from the same {@link PreviewModel}; `compact` is a phone-wide window, where
 * the frame always fills.
 */
export function Preview({ preview, session, turns, onFix, compact }: { preview: PreviewModel; session: DesignerSession; turns: readonly TurnView[]; onFix: (message: string) => void; compact: boolean }): ReactNode {
  const { app, side, width, round, noPreview } = preview;
  // The frame's own page has loaded (the dashboard then paints on its own); reset whenever its address changes.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const runningNow = useRef(preview.running);
  runningNow.current = preview.running;
  /** The sights sent on for the frame as it is open now: which opening, when the last went, how many. */
  const sentSight = useRef({ round: -1, at: 0, count: 0 });

  const built = previewState(turns);
  // A screen that built and then stopped as it opened says so from inside its frame (dev bundles only).
  /** `refused`: the screen goes on working, and a call it made was refused as wrongly asked. */
  const [crashed, setCrashed] = useState<{ side: PreviewSide; message: string; round: number; refused: boolean; went: boolean } | null>(null);
  const previewOrigin = preview.ticket?.origin ?? null;
  useEffect(() => {
    const heard = (event: MessageEvent): void => {
      if (previewOrigin === null || event.origin !== previewOrigin) return;
      // From a frame of this page, not from any window that happens to share the preview's address.
      if (!Array.from(document.querySelectorAll('iframe')).some((frame) => frame.contentWindow === event.source)) return;
      const data = event.data as { type?: unknown; app?: unknown; side?: unknown; message?: unknown; refused?: unknown; went?: unknown } | null;
      // What the screen saw of itself, once it stood still: sent on for the turn that built it, while that turn runs and the person lets it look.
      const sight = sightFrom(event.data, session.appKey);
      if (sight !== null) {
        // Once for each time the frame was opened, and never twice within two seconds: a screen that posts without end sends nothing more.
        const due = sentSight.current.round !== round || Date.now() - sentSight.current.at > 2000;
        if (runningNow.current && seesPage() && due && sentSight.current.count < 3) {
          sentSight.current = { round, at: Date.now(), count: sentSight.current.round === round ? sentSight.current.count + 1 : 1 };
          void designerApi.sendSight(session.id, sight).catch(() => undefined);
        }
        return;
      }
      if (data?.type !== 'adminium:side-error' || data.app !== session.appKey) return;
      if (data.side !== 'staff' && data.side !== 'customer') return;
      setCrashed({ side: data.side, message: typeof data.message === 'string' ? data.message.slice(0, 600) : '', round, refused: data.refused === true, went: data.went === true });
    };
    window.addEventListener('message', heard);
    return () => window.removeEventListener('message', heard);
  }, [previewOrigin, session.appKey, round]);
  const crash = crashed !== null && crashed.round === round && crashed.side === side ? crashed : null;
  const state = { building: built.building, failed: built.failed ?? (crash === null ? null : crash.message) };

  // What the plain frame shows, and the mark of its having loaded (a Reload opens the same dashboard again).
  const frameUrl = side === 'dashboard' ? OWN_DASHBOARD : preview.ticket?.url;
  const frameMark = frameUrl === undefined ? null : `${String(round)} ${frameUrl}`;
  const frame =
    frameUrl === undefined ? null : side === 'staff' && preview.ticket !== null ? (
      <AppFrame key={`${side}.${String(round)}`} appKey={session.appKey} path="" title={sideName(side)} onNavigate={() => undefined} src={preview.ticket.url} origin={preview.ticket.origin} />
    ) : (
      <iframe
        key={`${side}.${String(round)}`}
        src={frameUrl}
        title={sideName(side)}
        onLoad={() => setLoadedFor(frameMark)}
        className="h-full w-full border-0"
        allow=""
      />
    );

  // One element tree for every width, so a width change restyles the frame and never reloads it
  // (a reload would spend a new ticket, and the old one is already used).
  const wide = width === 'desktop' || compact;
  const ground = wide
    ? 'flex min-h-0 flex-1 bg-surface'
    : 'flex min-h-0 flex-1 justify-center overflow-auto bg-surface-2 bg-[radial-gradient(var(--border-strong)_1px,transparent_1px)] bg-[size:16px_16px] p-5';
  const device = wide
    ? 'flex min-h-0 flex-1'
    : width === 'tablet'
      ? 'flex h-full w-[768px] max-w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface shadow-md'
      : 'adm-always-dark flex h-[min(760px,100%)] w-[380px] shrink-0 rounded-[36px] bg-bg p-2.5 shadow-lg';
  const screenBox = wide || width === 'tablet' ? 'flex min-h-0 flex-1' : 'flex w-[360px] overflow-hidden rounded-[28px] bg-surface';
  const sized = (
    <div className={ground}>
      <div className={device}>
        <div className={screenBox}>{frame}</div>
      </div>
    </div>
  );

  if (noPreview) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
          {t('designer:preview.offLive', 'The preview is off on a live server. Open the app from the dashboard once it is applied.')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        {app === null ? (
          <p className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
            {preview.appPending ? null : t('designer:preview.nothing', 'Nothing to show yet. Once the Designer applies the app, it shows here.')}
          </p>
        ) : preview.ticketError !== null ? (
          <p role="alert" className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
            {t('designer:preview.unavailable', 'The preview could not be opened: {message}', { message: preview.ticketError })}
          </p>
        ) : (
          sized
        )}

        {app !== null && side !== 'staff' && !state.building && state.failed === null && (frameMark === null || loadedFor !== frameMark) && preview.ticketError === null ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <LoaderCircle aria-label={t('designer:preview.loading', 'Opening the preview')} className="size-5 animate-spin text-fg-subtle" />
          </div>
        ) : null}

        {state.building ? (
          <div aria-live="polite" className="absolute inset-0 flex items-center justify-center bg-surface/80">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] font-bold text-fg shadow-sm">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
              {building(side)}
            </span>
          </div>
        ) : null}

        {state.failed !== null && !state.building ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/85 p-5">
            <div role="alert" className="flex w-full max-w-[460px] flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-md">
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className="flex size-[34px] items-center justify-center rounded-[10px] bg-danger-soft text-danger">
                  <Hammer className="size-[17px]" />
                </span>
                <span className="text-[15px] font-extrabold tracking-tight">{built.failed === null && crash !== null ? (crash.refused ? refusedTitle(crash.side) : crash.went ? wentOnTitle(crash.side) : crashedTitle(crash.side)) : failedTitle(sideNamed(state.failed) ?? side)}</span>
              </div>
              {state.failed === '' ? null : (
                <code dir="ltr" className="adm-always-dark block whitespace-pre-wrap break-words rounded-[10px] bg-bg px-3 py-2.5 text-start font-mono text-xs leading-normal text-danger">
                  {state.failed}
                </code>
              )}
              <button
                type="button"
                onClick={() =>
                  onFix(
                    built.failed === null && crash !== null && crash.refused
                      ? t('designer:preview.fixRefusedMessage', 'The {side} screen asks Adminium for something it refuses, so people see an error there: {error} Please fix the screen.', { side: crash.side, error: crash.message })
                      : built.failed === null && crash !== null && crash.went
                      ? t('designer:preview.fixWentOnMessage', 'The {side} screen opens, and something in it fails with an error, so a part of it stays empty: {error} Please fix the screen.', { side: crash.side, error: crash.message })
                      : built.failed === null && crash !== null
                      ? t('designer:preview.fixCrashMessage', 'The screen builds, and stops with an error when it opens: {error} Please fix it.', { error: `the ${crash.side} screen reported “${crash.message}”` })
                      : t('designer:preview.fixMessage', 'The screens did not build: {error} Please fix it.', { error: state.failed ?? '' }),
                  )
                }
                className="inline-flex items-center gap-1.5 self-start rounded-[10px] bg-accent px-3 py-2 text-[12.5px] font-bold text-accent-fg hover:brightness-105"
              >
                <WandSparkles aria-hidden="true" className="size-3.5" />
                {t('designer:preview.fix', 'Ask the Designer to fix it')}
              </button>
              {built.failed === null && crash !== null && (crash.refused || crash.went) ? (
                <button type="button" onClick={() => setCrashed(null)} className="self-start text-[12.5px] font-bold text-accent hover:underline">
                  {t('designer:preview.keepLooking', 'Keep looking at the page')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The preview's own controls, in a bar over its frame. */
export function PreviewTools({ preview, compact }: { preview: PreviewModel; compact: boolean }): ReactNode {
  const { app, side, sides, width, sees } = preview;
  const segmented = 'inline-flex items-center rounded-[10px] border border-border bg-surface-2 p-[3px]';
  const segment = 'inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:text-fg aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-sm';
  const iconFor = (entry: PreviewSide): ReactNode =>
    entry === 'dashboard' ? <LayoutDashboard aria-hidden="true" className="size-3.5" /> : entry === 'staff' ? <IdCard aria-hidden="true" className="size-3.5" /> : <UserRound aria-hidden="true" className="size-3.5" />;

  if (preview.noPreview) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <div role="group" aria-label={t('designer:preview.side', 'Side')} className={segmented}>
        {sides.map((entry) => (
          <button key={entry} type="button" aria-pressed={side === entry} onClick={() => preview.setSide(entry)} className={segment}>
            {iconFor(entry)}
            {sideName(entry)}
          </button>
        ))}
      </div>
      {compact ? null : (
        <div role="group" aria-label={t('designer:preview.width', 'Width')} className={segmented}>
          {(
            [
              ['desktop', Monitor, t('designer:preview.desktop', 'Desktop')],
              ['tablet', Tablet, t('designer:preview.tablet', 'Tablet')],
              ['phone', Smartphone, t('designer:preview.phone', 'Phone')],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} type="button" aria-pressed={width === id} aria-label={label} title={label} onClick={() => preview.setWidth(id)} className={segment}>
              <Icon aria-hidden="true" className="size-3.5" />
            </button>
          ))}
        </div>
      )}
      {app === null ? null : (
        <span
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-fg-muted"
          title={side === 'dashboard' ? undefined : t('designer:preview.seenAsHint', 'The preview is not your own sign-in. It shows the app as its people will see it.')}
        >
          <Eye aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{seenAs(side, preview.ticket?.seenAs ?? null)}</span>
        </span>
      )}
      <div className="ms-auto flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={sees}
          onClick={() => {
            preview.setSees(!sees);
          }}
          aria-label={t('designer:preview.sees', 'The Designer looks at the page after it builds')}
          title={
            sees
              ? t('designer:preview.seesOn', 'After a build, the Designer is shown this page and what is broken on it, and fixes what it sees. Press to switch that off.')
              : t('designer:preview.seesOff', 'The Designer does not look at the page it builds. Press to let it.')
          }
          className="flex size-8 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-subtle hover:text-fg aria-pressed:border-accent aria-pressed:text-accent"
        >
          <Camera aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={preview.reload}
          aria-label={t('designer:preview.reload', 'Reload')}
          title={t('designer:preview.reload', 'Reload')}
          className="flex size-8 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:text-fg"
        >
          <RotateCw aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={preview.openTab}
          disabled={app === null}
          className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 text-[12.5px] font-bold text-fg-muted hover:text-fg disabled:opacity-50"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="max-lg:sr-only">{t('designer:preview.newTab', 'Open in a new tab')}</span>
        </button>
      </div>
    </div>
  );
}
