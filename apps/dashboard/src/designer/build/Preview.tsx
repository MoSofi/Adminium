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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Hammer, LayoutDashboard, LoaderCircle, Monitor, RotateCw, Smartphone, Tablet, UserRound, WandSparkles, IdCard } from 'lucide-react';

import { api } from '../../app/api.js';
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

/** The last turn's state for the preview: still building, or a build that failed with its first line. */
export function previewState(turns: readonly TurnView[]): { building: boolean; failed: string | null } {
  const last = turns.at(-1);
  if (last === undefined) return { building: false, failed: null };
  if (last.outcome === null) {
    const running = last.steps.some((row) => row.state === 'running' && (row.tool === 'build_sides' || row.tool === 'apply_app'));
    return { building: running, failed: null };
  }
  const broken = [...last.steps].reverse().find((row) => row.state === 'failed' && (row.tool === 'build' || row.tool === 'build_sides'));
  return { building: false, failed: broken === undefined ? null : (broken.detail?.split('\n')[0] ?? '') };
}

export function Preview({ session, turns, onFix, compact }: { session: DesignerSession; turns: readonly TurnView[]; onFix: (message: string) => void; compact: boolean }): ReactNode {
  const queryClient = useQueryClient();
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
    enabled: app !== null,
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

  const state = previewState(turns);
  const openTab = (): void => {
    // Opened now, filled when the ticket arrives: a window opened after a wait is a blocked pop-up.
    const tab = window.open('', '_blank');
    if (tab === null) return;
    tab.opener = null;
    void designerApi
      .previewTicket(session.id, to)
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
                <span className="text-[15px] font-extrabold tracking-tight">{failedTitle(side)}</span>
              </div>
              {state.failed === '' ? null : (
                <code dir="ltr" className="adm-always-dark block whitespace-pre-wrap break-words rounded-[10px] bg-bg px-3 py-2.5 text-start font-mono text-xs leading-normal text-danger">
                  {state.failed}
                </code>
              )}
              <button
                type="button"
                onClick={() => onFix(t('designer:preview.fixMessage', 'The screens did not build: {error} Please fix it.', { error: state.failed ?? '' }))}
                className="inline-flex items-center gap-1.5 self-start rounded-[10px] bg-accent px-3 py-2 text-[12.5px] font-bold text-accent-fg hover:brightness-105"
              >
                <WandSparkles aria-hidden="true" className="size-3.5" />
                {t('designer:preview.fix', 'Ask the Designer to fix it')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
