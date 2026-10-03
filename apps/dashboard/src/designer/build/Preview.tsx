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
 * Sides: the Dashboard (the dashboard itself, with the app's real pages),
 * Staff and Customer — a side the app does not have is absent. Widths:
 * desktop fills, tablet is 768 wide, phone 360 in a bezel. The frame reloads
 * when the app is applied again (`app-changed`), and on Reload.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Eye, Hammer, LayoutDashboard, LoaderCircle, Monitor, RotateCw, Smartphone, Tablet, UserRound, WandSparkles, IdCard } from 'lucide-react';

import { api } from '../../app/api.js';
import { systemInfoQuery } from '../../app/capabilities.js';
import { createRealtimeClient } from '../../app/ws.js';
import { AppFrame } from '../../apps/AppFrame.js';
import { t } from '../../i18n/t.js';
import type { InstalledApp } from '../../studio/apps/appsApi.js';
import { designerApi, type DesignerSession } from '../api.js';
import type { TurnView } from './turns.js';

export type PreviewSide = 'dashboard' | 'staff' | 'customer';
export type PreviewWidth = 'desktop' | 'tablet' | 'phone';

const installedKey = ['designer', 'installed'] as const;

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

/** Whose eyes the preview is: the app's own roles for the dashboard and the staff side, nobody for the customer side. */
export function seenAs(side: PreviewSide, roles: readonly string[] | null): string {
  if (side === 'customer') return t('designer:preview.seenAsVisitor', 'Seen as: a visitor, not signed in');
  if (roles === null) return t('designer:preview.seenAsStaff', 'Seen as: staff — a preview');
  if (roles.length === 0) return t('designer:preview.seenAsNoRole', 'Seen as: a person with no role yet — a preview');
  return t('designer:preview.seenAs', 'Seen as: {who} — a preview', { who: roles.join(', ') });
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

export function Preview({ session, turns, onFix, compact }: { session: DesignerSession; turns: readonly TurnView[]; onFix: (message: string) => void; compact: boolean }): ReactNode {
  const queryClient = useQueryClient();
  // A live server has one name, so model-written screens have no second one to be shown on.
  const info = useQuery(systemInfoQuery());
  const noPreview = info.data?.designer?.mode === 'live';
  const installed = useQuery({ queryKey: installedKey, queryFn: () => api.get<{ apps: InstalledApp[] }>('/api/v1/apps') });
  const app = installed.data?.apps.find((entry) => entry.key === session.appKey) ?? null;
  const sides = useMemo<PreviewSide[]>(() => {
    const own = (app?.sides ?? []).map((side) => side.side as PreviewSide).filter((side) => side === 'staff' || side === 'customer');
    return ['dashboard', ...(['staff', 'customer'] as const).filter((side) => own.includes(side))];
  }, [app]);
  const [chosen, setChosen] = useState<PreviewSide | null>(null);
  const side: PreviewSide = chosen !== null && sides.includes(chosen) ? chosen : (sides.find((entry) => entry !== 'dashboard') ?? 'dashboard');
  const [width, setWidth] = useState<PreviewWidth>('desktop');
  const [round, setRound] = useState(0);
  // The frame's own page has loaded (the dashboard then paints on its own); reset whenever its address changes.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const prefix = side === 'dashboard' ? '' : (app?.sides.find((entry) => entry.side === side)?.prefix ?? `/apps/${session.appKey}/${side}`);
  const to = `${prefix}/`;
  const ticket = useQuery({
    queryKey: ['designer', 'preview', session.id, side, round] as const,
    queryFn: () => designerApi.previewTicket(session.id, to),
    enabled: app !== null && !info.isPending && !noPreview,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });

  // The app applied again: its sides may have changed, and the frame shows the old one.
  useEffect(() => {
    const client = createRealtimeClient({
      channels: ['config-changed'],
      onEvent: (event) => {
        if (event.type !== 'app-changed') return;
        const data = event.data as { key?: unknown } | null;
        if (data?.key !== session.appKey) return;
        void queryClient.invalidateQueries({ queryKey: installedKey });
        setRound((value) => value + 1);
      },
    });
    client.start();
    return () => client.stop();
  }, [queryClient, session.appKey]);

  // Rows loaded from an attached file: the app did not change, what its pages show did.
  const loads = turns.reduce((sum, turn) => sum + turn.steps.filter((step) => step.tool === 'load_rows' && step.outcome === 'added' && step.state !== 'running').length, 0);
  const seenLoads = useRef(loads);
  // Only a load that finishes while its turn runs: a session opened later already shows those rows, and its past loads arriving with the first read of events are no reason to spend a ticket.
  const running = turns.length > 0 && turns[turns.length - 1]?.outcome === null;
  useEffect(() => {
    if (loads > seenLoads.current && running) setRound((value) => value + 1);
    seenLoads.current = loads;
  }, [loads, running]);

  const built = previewState(turns);
  // A screen that built and then stopped as it opened says so from inside its frame (dev bundles only).
  /** `refused`: the screen goes on working, and a call it made was refused as wrongly asked. */
  const [crashed, setCrashed] = useState<{ side: PreviewSide; message: string; round: number; refused: boolean } | null>(null);
  const previewOrigin = ticket.data?.origin ?? null;
  useEffect(() => {
    const heard = (event: MessageEvent): void => {
      if (previewOrigin === null || event.origin !== previewOrigin) return;
      // From a frame of this page, not from any window that happens to share the preview's address.
      if (!Array.from(document.querySelectorAll('iframe')).some((frame) => frame.contentWindow === event.source)) return;
      const data = event.data as { type?: unknown; app?: unknown; side?: unknown; message?: unknown; refused?: unknown } | null;
      if (data?.type !== 'adminium:side-error' || data.app !== session.appKey) return;
      if (data.side !== 'staff' && data.side !== 'customer') return;
      setCrashed({ side: data.side, message: typeof data.message === 'string' ? data.message.slice(0, 600) : '', round, refused: data.refused === true });
    };
    window.addEventListener('message', heard);
    return () => window.removeEventListener('message', heard);
  }, [previewOrigin, session.appKey, round]);
  const crash = crashed !== null && crashed.round === round && crashed.side === side ? crashed : null;
  const state = { building: built.building, failed: built.failed ?? (crash === null ? null : crash.message) };
  const openTab = (): void => {
    // Opened now, filled when the ticket arrives: a window opened after a wait is a blocked pop-up.
    const tab = window.open('', '_blank');
    if (tab === null) return;
    tab.opener = null;
    // A customer page is public: it opens as it is, with nobody signed in, and makes no preview session in the tab.
    if (side === 'customer' && previewOrigin !== null) {
      tab.location.href = `${previewOrigin}${to}`;
      return;
    }
    // The staff side opens inside the dashboard, as staff meet it: there the bar says whose eyes this is.
    void designerApi
      .previewTicket(session.id, side === 'staff' ? `/a/${session.appKey}` : to)
      .then((reply) => {
        tab.location.href = reply.url;
      })
      .catch(() => tab.close());
  };

  const frame =
    ticket.data === undefined ? null : side === 'staff' ? (
      <AppFrame key={`${side}.${String(round)}`} appKey={session.appKey} path="" title={sideName(side)} onNavigate={() => undefined} src={ticket.data.url} origin={ticket.data.origin} />
    ) : (
      <iframe
        key={`${side}.${String(round)}`}
        src={ticket.data.url}
        title={sideName(side)}
        onLoad={() => setLoadedFor(ticket.data?.url ?? null)}
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

  const segmented = 'inline-flex items-center rounded-[10px] border border-border bg-surface-2 p-[3px]';
  const segment = 'inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:text-fg aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-sm';
  const iconFor = (entry: PreviewSide): ReactNode =>
    entry === 'dashboard' ? <LayoutDashboard aria-hidden="true" className="size-3.5" /> : entry === 'staff' ? <IdCard aria-hidden="true" className="size-3.5" /> : <UserRound aria-hidden="true" className="size-3.5" />;

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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <div role="group" aria-label={t('designer:preview.side', 'Side')} className={segmented}>
          {sides.map((entry) => (
            <button key={entry} type="button" aria-pressed={side === entry} onClick={() => setChosen(entry)} className={segment}>
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
              <button key={id} type="button" aria-pressed={width === id} aria-label={label} title={label} onClick={() => setWidth(id)} className={segment}>
                <Icon aria-hidden="true" className="size-3.5" />
              </button>
            ))}
          </div>
        )}
        {app === null ? null : (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-fg-muted" title={t('designer:preview.seenAsHint', 'The preview is not your own sign-in. It shows the app as its people will see it.')}>
            <Eye aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{seenAs(side, ticket.data?.seenAs ?? null)}</span>
          </span>
        )}
        <div className="ms-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRound((value) => value + 1)}
            aria-label={t('designer:preview.reload', 'Reload')}
            title={t('designer:preview.reload', 'Reload')}
            className="flex size-8 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:text-fg"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={openTab}
            disabled={app === null}
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 text-[12.5px] font-bold text-fg-muted hover:text-fg disabled:opacity-50"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="max-lg:sr-only">{t('designer:preview.newTab', 'Open in a new tab')}</span>
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {app === null ? (
          <p className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
            {installed.isPending ? null : t('designer:preview.nothing', 'Nothing to show yet. Once the Designer applies the app, it shows here.')}
          </p>
        ) : ticket.isError ? (
          <p role="alert" className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
            {t('designer:preview.unavailable', 'The preview could not be opened: {message}', { message: ticket.error.message })}
          </p>
        ) : (
          sized
        )}

        {app !== null && side !== 'staff' && !state.building && state.failed === null && (ticket.data === undefined || loadedFor !== ticket.data.url) && !ticket.isError ? (
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
                <span className="text-[15px] font-extrabold tracking-tight">{built.failed === null && crash !== null ? (crash.refused ? refusedTitle(crash.side) : crashedTitle(crash.side)) : failedTitle(sideNamed(state.failed) ?? side)}</span>
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
              {built.failed === null && crash !== null && crash.refused ? (
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
