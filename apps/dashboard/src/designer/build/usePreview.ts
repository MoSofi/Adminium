// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the preview is showing, held above both its frame and the bar over
 * it: which side, at which size, the opening it is on (a new opening is a
 * new one-use ticket), whether the Designer looks at the page it builds, and
 * the page each side is on.
 *
 * Where a side is comes three ways. A customer side is another site: its own
 * script says its path and title, and a path is sent to it the same way. A
 * staff side is drawn in the dashboard's app frame, which is handed the path
 * and says the side's own moves. The dashboard is this site's own pages: its
 * address is read from the frame, and moved by replacing it. Every opening
 * carries the side's page, so a reload, a build and a change of side each
 * come back to it.
 *
 * The frame is kept while another tab shows, so all of this lives for as
 * long as the work area does, not for as long as the Preview tab is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';
import { systemInfoQuery } from '../../app/capabilities.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';
import { createRealtimeClient } from '../../app/ws.js';
import type { InstalledApp } from '../../studio/apps/appsApi.js';
import { designerApi, type DesignerPicked, type DesignerSession, type PhoneStatus } from '../api.js';
import { pickEnded, pickedFrom } from './picked.js';
import { isDesignerPath, locationFrom, tidyPagePath, visit, type VisitedPage } from './pagePath.js';
import { SHOT_WAIT_MS, shotFrom, type ShotArea } from './shot.js';
import { previewShows, seesPage, setSeesPage } from './sight.js';
import type { TurnView } from './turns.js';

/** `mobile` is the app's phone side: its preview is Expo's export for the web, in a phone's frame. */
export type PreviewSide = 'dashboard' | 'staff' | 'customer' | 'mobile';
export type PreviewWidth = 'desktop' | 'tablet' | 'phone';

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
  /** The address the frame is on, on the preview's site: the side's prefix, then its page. */
  to: string;
  /** The page the side being shown is on: `/`, `/menu/7`. */
  path: string;
  /** Whether the side, as it is open now, has said where it is. Until then the address cannot be changed. */
  spoken: boolean;
  /** Go to a page of the side being shown. The path is already in its one shape. */
  go: (path: string) => void;
  /** The customer pages opened in this session, newest first. */
  visited: readonly VisitedPage[];
  /** The plain frame (the dashboard's, the customer side's), for the preview to attach. */
  frame: RefObject<HTMLIFrameElement | null>;
  /** What the dashboard's frame opens on: the page that side was on when it was opened. */
  dashboardSrc: string;
  /** The staff side moved itself, as the app frame says it: a path with no slash in front. */
  onStaffNavigate: (path: string) => void;
  ticket: { url: string; origin: string; seenAs: readonly string[] | null } | null;
  ticketError: string | null;
  /** Whether the last turn is still running: only then is anybody waiting to see the page. */
  running: boolean;
  /** The app's phone side, where this server builds one: how it stands, the door a phone comes through. Null where there is none to speak of. */
  phone: PhoneStatus | null;
  /** A person's yes to the phone app: add it, or get its packages. */
  addPhone: () => void;
  openPhoneDoor: (address: string) => void;
  stopPhoneDoor: () => void;
  /** What the last of those three was refused with, in the server's words. */
  phoneError: string | null;
  openTab: () => void;
  /** False where there is nowhere to open it. */
  canOpenTab: boolean;
  /** Whether the side shown can be pointed at now: a side of the app's own that has said where it is, and that it can be. */
  canPick: boolean;
  /** The person is pointing: the next click in the frame picks an element and reaches nothing else. */
  picking: boolean;
  setPicking: (on: boolean) => void;
  /** Whether the side shown can draw a part of itself now: a side of the app's own that has said where it is, and that it can. */
  canShoot: boolean;
  /** The person is dragging over the frame for a picture of a part of it. */
  shooting: boolean;
  setShooting: (on: boolean) => void;
  /** The part dragged over, as a picture file drawn by the page in the frame; null when it drew none in time. */
  shoot: (area: ShotArea) => Promise<File | null>;
}

export function usePreview(session: DesignerSession, turns: readonly TurnView[], onPicked?: (picked: DesignerPicked) => void): PreviewModel {
  const queryClient = useQueryClient();
  const info = useQuery(systemInfoQuery());
  const noPreview = info.data?.designer?.mode === 'live';
  const installed = useQuery({ queryKey: installedKey, queryFn: () => api.get<{ apps: InstalledApp[] }>('/api/v1/apps') });
  const app = installed.data?.apps.find((entry) => entry.key === session.appKey) ?? null;
  // The phone side: asked of the server that builds it (`adminium design`, the desktop app); a live server has none.
  const phoneKey = ['designer', 'phone', session.id] as const;
  const phoneQuery = useQuery({
    queryKey: phoneKey,
    queryFn: async () => {
      try {
        return await designerApi.phone(session.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: !info.isPending && !noPreview,
    // While something is under way it is watched closely; an open door is looked at now and then (a phone connects, it closes).
    refetchInterval: (query) => {
      const now = query.state.data ?? null;
      if (now === null) return false;
      if (now.phone.state === 'working' || now.door.state === 'starting') return 1500;
      return now.door.state === 'open' ? 4000 : false;
    },
    retry: false,
  });
  const phone = phoneQuery.data ?? null;
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const phoneDid = (work: Promise<PhoneStatus>): void => {
    setPhoneError(null);
    void work.then(
      (status) => queryClient.setQueryData(phoneKey, status),
      (error: unknown) => setPhoneError(error instanceof Error ? error.message : String(error)),
    );
  };
  // The Phone side is there once the app has a phone app, and from the start in a session that asked for one.
  // (Not before the app is there: a session that has built nothing has no app to add a phone app to.)
  const hasPhone = phone !== null && (phone.phone.state !== 'none' || (session.target === 'mobile' && app !== null));
  const sides = useMemo<PreviewSide[]>(() => {
    const own = (app?.sides ?? []).map((side) => side.side as PreviewSide).filter((side) => side === 'staff' || side === 'customer');
    return ['dashboard', ...(['staff', 'customer'] as const).filter((side) => own.includes(side)), ...(hasPhone ? (['mobile'] as const) : [])];
  }, [app, hasPhone]);
  const [chosen, setChosen] = useState<PreviewSide | null>(null);
  const side: PreviewSide = chosen !== null && sides.includes(chosen) ? chosen : (sides.find((entry) => entry !== 'dashboard') ?? 'dashboard');
  const [width, setWidth] = useState<PreviewWidth>('desktop');
  const [round, setRound] = useState(0);
  const [sees, setSeesState] = useState(seesPage);

  const prefix = side === 'dashboard' ? '' : (app?.sides.find((entry) => entry.side === side)?.prefix ?? `/apps/${session.appKey}/${side}`);
  // The page each side is on. A ref beside the state: a ticket is asked for with the page as it is at that moment,
  // and a move inside the frame must not be a reason to ask for another.
  const [paths, setPaths] = useState<Record<PreviewSide, string>>({ dashboard: '/', staff: '/', customer: '/', mobile: '/' });
  const pathsNow = useRef(paths);
  const setPath = useCallback((which: PreviewSide, path: string): void => {
    if (pathsNow.current[which] === path) return;
    pathsNow.current = { ...pathsNow.current, [which]: path };
    setPaths(pathsNow.current);
  }, []);
  const path = paths[side];
  const to = `${prefix}${path}`;
  /** Which opening of which side last said where it is, and (a customer side) the window that said it. */
  const [spoke, setSpoke] = useState<{ side: PreviewSide; round: number; picks: boolean; shots: boolean } | null>(null);
  const speaker = useRef<{ side: PreviewSide; round: number; window: MessageEventSource | null } | null>(null);
  const spoken = spoke !== null && spoke.side === side && spoke.round === round;
  const said = useCallback((which: PreviewSide, opening: number, from: MessageEventSource | null, picks = false, shots = false): void => {
    speaker.current = { side: which, round: opening, window: from };
    setSpoke((before) => (before !== null && before.side === which && before.round === opening && before.picks === picks && before.shots === shots ? before : { side: which, round: opening, picks, shots }));
  }, []);
  const [visited, setVisited] = useState<VisitedPage[]>([{ path: '/', title: '' }]);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [picking, setPickingState] = useState(false);
  const pickingNow = useRef(false);
  pickingNow.current = picking;
  const onPickedNow = useRef(onPicked);
  onPickedNow.current = onPicked;
  const [shooting, setShootingState] = useState(false);
  /** The picture asked of the frame and not yet answered: its number, and what its answer is handed to. */
  const shotAsked = useRef<{ id: number; done: (file: File | null) => void } | null>(null);
  const shotSeq = useRef(0);

  const ticket = useQuery({
    // (A phone app built again is another page to open: its stamp is part of what is asked for.)
    queryKey: ['designer', 'preview', session.id, side, round, side === 'mobile' && phone?.phone.state === 'built' ? phone.phone.build : ''] as const,
    queryFn: async () => {
      const page = pathsNow.current[side];
      try {
        return await designerApi.previewTicket(session.id, `${prefix}${page}`);
      } catch (error) {
        // A page the server will not send a frame to (an address it does not take) is not the end of the preview: the side opens on its first page.
        if (!(error instanceof ApiError) || error.status !== 404 || page === '/') throw error;
        setPath(side, '/');
        return designerApi.previewTicket(session.id, `${prefix}/`);
      }
    },
    // The dashboard is the person's own, on the Designer's name: it needs no ticket. A phone app is shown once it is built.
    enabled: app !== null && !info.isPending && !noPreview && side !== 'dashboard' && (side !== 'mobile' || phone?.phone.state === 'built'),
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
        void queryClient.invalidateQueries({ queryKey: ['designer', 'phone', session.id] });
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
  // No screen of its own yet, and no tab picked by hand: the first screen a turn makes is the one this preview turns to.
  const firstToCome = !noPreview && chosen === null && !sides.some((entry) => entry === 'staff' || entry === 'customer');
  useEffect(() => {
    previewShows(showing, firstToCome);
    return () => previewShows(null);
  }, [showing, firstToCome]);

  const origin = ticket.data?.origin ?? null;

  // A side of the app's own says where it is, from inside its frame (a screen built for development only).
  useEffect(() => {
    // (A phone app has no addresses to say.)
    if (origin === null || side === 'dashboard' || side === 'mobile') return;
    const heard = (event: MessageEvent): void => {
      if (event.origin !== origin) return;
      // From a frame of this page, not from any window that happens to share the preview's address.
      if (!Array.from(document.querySelectorAll('iframe')).some((entry) => entry.contentWindow === event.source)) return;
      // An element is taken only while the person is pointing: a screen cannot hand one over unasked.
      const picked = pickedFrom(event.data, session.appKey, side);
      if (picked !== null || pickEnded(event.data, session.appKey)) {
        if (!pickingNow.current) return;
        setPickingState(false);
        if (picked !== null) onPickedNow.current?.(picked);
        return;
      }
      // A picture is taken only as the answer to the one asking that waits: a screen cannot hand one over unasked.
      const waiting = shotAsked.current;
      const shot = waiting === null ? null : shotFrom(event.data, session.appKey, side, waiting.id);
      if (waiting !== null && shot !== null) {
        waiting.done(shot === false ? null : shot);
        return;
      }
      const location = locationFrom(event.data, session.appKey, side);
      if (location === null) return;
      setPath(side, location.path);
      // A screen built before screens could be pointed at does not say it can: it would hear the asking and do nothing.
      const can = event.data as { picks?: unknown; shots?: unknown } | null;
      said(side, round, event.source, can?.picks === true, can?.shots === true);
      if (side === 'customer') setVisited((pages) => visit(pages, location));
    };
    window.addEventListener('message', heard);
    return () => window.removeEventListener('message', heard);
  }, [origin, side, round, session.appKey, setPath, said]);

  // The dashboard is this site's own: where its frame is can simply be read, while that side shows.
  const onDashboard = side === 'dashboard' && app !== null && !noPreview;
  useEffect(() => {
    if (!onDashboard) return;
    const read = (): void => {
      let pathname: string | undefined;
      try {
        pathname = frame.current?.contentWindow?.location.pathname;
      } catch {
        // A frame that went to another site: there is nothing of ours to read.
        return;
      }
      // Before its first page loads a frame is on `about:blank`.
      if (pathname === undefined || !pathname.startsWith('/')) return;
      const here = tidyPagePath(pathname);
      // The Designer inside its own preview is not a page to come back to.
      if (here === null || isDesignerPath(here)) return;
      setPath('dashboard', here);
      said('dashboard', round, null);
    };
    const timer = window.setInterval(read, 250);
    return () => window.clearInterval(timer);
  }, [onDashboard, round, setPath, said]);
  // What the dashboard's frame opens on: where that side was when it was opened, so a reload stays. Never read while it is open: a new address there would load the dashboard again.
  const dashboardSrc = useMemo(() => pathsNow.current.dashboard, [round, onDashboard]);

  // Pointing is done by the page in the frame: it is asked to start and to stop, and a frame opened again has forgotten.
  const canPick = !noPreview && (side === 'staff' || side === 'customer') && spoken && spoke.picks && origin !== null;
  const tellPicking = useCallback(
    (on: boolean): void => {
      const there = speaker.current;
      if (there === null || there.side !== side || there.round !== round || there.window === null || origin === null) return;
      try {
        (there.window as Window).postMessage({ type: 'adminium:host:pick', on }, origin);
      } catch {
        // A frame that is gone has nothing to stop.
      }
    },
    [origin, side, round],
  );
  const setPicking = (on: boolean): void => {
    if (on && !canPick) return;
    // One at a time: the layer a picture is dragged on would take the click that picks.
    if (on) setShootingState(false);
    tellPicking(on);
    setPickingState(on);
  };
  useEffect(() => setPickingState(false), [side, round]);

  // A picture of a part of the page is drawn by the page in the frame too: it is asked for with the part, and answers under the asking's number.
  const canShoot = !noPreview && (side === 'staff' || side === 'customer') && spoken && spoke.shots && origin !== null;
  const setShooting = (on: boolean): void => {
    if (on && !canShoot) return;
    if (on && pickingNow.current) {
      tellPicking(false);
      setPickingState(false);
    }
    setShootingState(on);
  };
  const shoot = useCallback(
    (area: ShotArea): Promise<File | null> => {
      const there = speaker.current;
      if (there === null || there.side !== side || there.round !== round || there.window === null || origin === null || shotAsked.current !== null) return Promise.resolve(null);
      shotSeq.current += 1;
      const id = shotSeq.current;
      return new Promise((resolve) => {
        // A screen that never answers (it was closed, it stopped) is not waited for.
        const timer = window.setTimeout(() => done(null), SHOT_WAIT_MS);
        const done = (file: File | null): void => {
          if (shotAsked.current?.id !== id) return;
          shotAsked.current = null;
          window.clearTimeout(timer);
          resolve(file);
        };
        shotAsked.current = { id, done };
        try {
          (there.window as Window).postMessage({ type: 'adminium:host:shot', id, area }, origin);
        } catch {
          done(null);
        }
      });
    },
    [origin, side, round],
  );
  // A frame opened again, or another side: the drag is over, and a picture still awaited will not come.
  useEffect(
    () => () => {
      setShootingState(false);
      shotAsked.current?.done(null);
    },
    [side, round],
  );
  useEffect(() => {
    if (!shooting) return;
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setShootingState(false);
      shotAsked.current?.done(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shooting]);
  // Escape ends it from this page too: the frame hears the key only while the pointer's last click was inside it.
  useEffect(() => {
    if (!picking) return;
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      tellPicking(false);
      setPickingState(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picking, tellPicking]);

  const go = (next: string): void => {
    const there = speaker.current !== null && speaker.current.side === side && speaker.current.round === round ? speaker.current : null;
    if (side === 'dashboard') {
      if (isDesignerPath(next)) return;
      const inside = there === null ? null : (frame.current?.contentWindow ?? null);
      if (inside !== null) {
        try {
          // In place, as an app's own moves are: nothing is added to what Back walks through. The dashboard's router hears the event.
          inside.history.replaceState(inside.history.state, '', next);
          inside.dispatchEvent(new PopStateEvent('popstate', { state: inside.history.state as unknown }));
          setPath('dashboard', next);
          return;
        } catch {
          // Opened again below.
        }
      }
      setPath('dashboard', next);
      setRound((value) => value + 1);
      return;
    }
    if (side === 'staff') {
      // The app frame is handed the path and tells the side; a side that never said hello is opened again on it.
      setPath('staff', next);
      if (there === null) setRound((value) => value + 1);
      return;
    }
    if (there !== null && there.window !== null && origin !== null) {
      // The side moves itself and says where it went: the path shown is always the one it is really on.
      (there.window as Window).postMessage({ type: 'adminium:host:set', path: next }, origin);
      return;
    }
    setPath('customer', next);
    setRound((value) => value + 1);
  };
  const onStaffNavigate = useCallback(
    (moved: string): void => {
      const here = tidyPagePath(`/${moved}`);
      if (here !== null) setPath('staff', here);
    },
    [setPath],
  );
  // Inside the desktop app there are no tabs: "a new tab" is the person's own browser, and the app hands it the
  // address. It is asked for with the address already in hand, because the app refuses a window and reads only that.
  const inApp = getDesktopApi() !== null;
  const canOpenTab = true;
  const openInBrowser = (): void => {
    if ((side === 'customer' || side === 'mobile') && origin !== null) {
      window.open(`${origin}${to}`, '_blank', 'noopener');
      return;
    }
    // The dashboard is signed into by this window's own session, which the system's browser does not hold: the owner is
    // given a link that signs them in there, once, and lands on the page shown here.
    if (side === 'dashboard') {
      void designerApi
        .browserLink(path)
        .then((reply) => {
          window.open(reply.data.url, '_blank', 'noopener');
        })
        .catch(() => undefined);
      return;
    }
    if (side !== 'staff') return;
    void designerApi
      .previewTicket(session.id, `/a/${session.appKey}${path === '/' ? '' : path}`)
      .then((reply) => {
        window.open(reply.url, '_blank', 'noopener');
      })
      .catch(() => undefined);
  };
  const openTab = (): void => {
    if (inApp) {
      openInBrowser();
      return;
    }
    // Opened now, filled when the ticket arrives: a window opened after a wait is a blocked pop-up.
    const tab = window.open('', '_blank');
    if (tab === null) return;
    tab.opener = null;
    // The dashboard is Adminium's own pages, not a model's: it opens on this name, as the owner.
    if (side === 'dashboard') {
      tab.location.href = path;
      return;
    }
    // A customer page is public: it opens as it is, with nobody signed in, and makes no preview session in the tab. A phone app's preview is the same.
    if ((side === 'customer' || side === 'mobile') && origin !== null) {
      tab.location.href = `${origin}${to}`;
      return;
    }
    // The staff side opens inside the dashboard, as staff meet it: there the bar says whose eyes this is.
    void designerApi
      .previewTicket(session.id, `/a/${session.appKey}${path === '/' ? '' : path}`)
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
    path,
    spoken,
    go,
    visited,
    frame,
    dashboardSrc,
    onStaffNavigate,
    ticket: ticket.data === undefined ? null : { url: ticket.data.url, origin: ticket.data.origin, seenAs: ticket.data.seenAs ?? null },
    ticketError: ticket.isError && side !== 'dashboard' ? ticket.error.message : null,
    running,
    phone,
    addPhone: () => phoneDid(designerApi.phoneAdd(session.id)),
    openPhoneDoor: (address) => phoneDid(designerApi.phoneOpen(session.id, address)),
    stopPhoneDoor: () => phoneDid(designerApi.phoneStop(session.id)),
    phoneError,
    openTab,
    canOpenTab,
    canPick,
    picking,
    setPicking,
    canShoot,
    shooting,
    setShooting,
    shoot,
  };
}
