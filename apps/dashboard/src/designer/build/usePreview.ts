// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the preview is showing, held above both its frame and the bar over
 * it: which side, at which size, the opening it is on (a new opening is a
 * new one-use ticket), and whether the Designer looks at the page it builds.
 *
 * The frame is kept while another tab shows, so all of this lives for as
 * long as the work area does, not for as long as the Preview tab is open.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../app/api.js';
import { systemInfoQuery } from '../../app/capabilities.js';
import { createRealtimeClient } from '../../app/ws.js';
import type { InstalledApp } from '../../studio/apps/appsApi.js';
import { designerApi, type DesignerSession } from '../api.js';
import { previewShows, seesPage, setSeesPage } from './sight.js';
import type { TurnView } from './turns.js';

export type PreviewSide = 'dashboard' | 'staff' | 'customer';
export type PreviewWidth = 'desktop' | 'tablet' | 'phone';

/** The dashboard on the Designer's own name, where the session is the owner's. */
export const OWN_DASHBOARD = '/';

const installedKey = ['designer', 'installed'] as const;

export interface PreviewModel {
  /** A live server has one name, so model-written screens have no second one to be shown on. */
  noPreview: boolean;
  /** The app as the engine applied it; null before the first build. */
  app: InstalledApp | null;
  /** Whether the list of applied apps is still being read. */
  appPending: boolean;
  sides: readonly PreviewSide[];
  side: PreviewSide;
  setSide: (side: PreviewSide) => void;
  width: PreviewWidth;
  setWidth: (width: PreviewWidth) => void;
  /** How many times the frame was opened: each opening of a side of the app's own spends a ticket. */
  round: number;
  reload: () => void;
  /** Whether the Designer is shown the page after a build. */
  sees: boolean;
  setSees: (on: boolean) => void;
  /** Where the side being shown is mounted; empty for the dashboard. */
  prefix: string;
  /** The address the ticket sends the frame on to. */
  to: string;
  ticket: { url: string; origin: string; seenAs: readonly string[] | null } | null;
  ticketError: string | null;
  /** Whether the last turn is still running: only then is anybody waiting to see the page. */
  running: boolean;
  openTab: () => void;
}

export function usePreview(session: DesignerSession, turns: readonly TurnView[]): PreviewModel {
  const queryClient = useQueryClient();
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
  const [sees, setSeesState] = useState(seesPage);

  const prefix = side === 'dashboard' ? '' : (app?.sides.find((entry) => entry.side === side)?.prefix ?? `/apps/${session.appKey}/${side}`);
  const to = `${prefix}/`;
  const ticket = useQuery({
    queryKey: ['designer', 'preview', session.id, side, round] as const,
    queryFn: () => designerApi.previewTicket(session.id, to),
    // The dashboard is the person's own, on the Designer's name: it needs no ticket.
    enabled: app !== null && !info.isPending && !noPreview && side !== 'dashboard',
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

  // What this preview shows, for a turn about to start: only a side of the app's own can be looked at.
  // The frame is there whichever tab is open, so this holds on every tab.
  const showing = noPreview || app === null ? null : side;
  useEffect(() => {
    previewShows(showing);
    return () => previewShows(null);
  }, [showing]);

  const origin = ticket.data?.origin ?? null;
  const openTab = (): void => {
    // Opened now, filled when the ticket arrives: a window opened after a wait is a blocked pop-up.
    const tab = window.open('', '_blank');
    if (tab === null) return;
    tab.opener = null;
    // The dashboard is Adminium's own pages, not a model's: it opens on this name, as the owner.
    if (side === 'dashboard') {
      tab.location.href = OWN_DASHBOARD;
      return;
    }
    // A customer page is public: it opens as it is, with nobody signed in, and makes no preview session in the tab.
    if (side === 'customer' && origin !== null) {
      tab.location.href = `${origin}${to}`;
      return;
    }
    // The staff side opens inside the dashboard, as staff meet it: there the bar says whose eyes this is.
    void designerApi
      .previewTicket(session.id, `/a/${session.appKey}`)
      .then((reply) => {
        tab.location.href = reply.url;
      })
      .catch(() => tab.close());
  };

  return {
    noPreview,
    app,
    appPending: installed.isPending,
    sides,
    side,
    setSide: setChosen,
    width,
    setWidth,
    round,
    reload: () => setRound((value) => value + 1),
    sees,
    setSees: (on) => {
      setSeesPage(on);
      setSeesState(on);
    },
    prefix,
    to,
    ticket: ticket.data === undefined ? null : { url: ticket.data.url, origin: ticket.data.origin, seenAs: ticket.data.seenAs ?? null },
    ticketError: ticket.isError && side !== 'dashboard' ? ticket.error.message : null,
    running,
    openTab,
  };
}
