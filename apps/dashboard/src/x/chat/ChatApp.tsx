// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIVE CHAT'S PAGE (`/x/chat/<addOn>`), loaded as a chunk of its own so a
 * form's page never pays for it.
 *
 * Nothing is drawn until the chat's config is back, and a chat that is not
 * available draws nothing at all, not even the launcher: in the website
 * loader's frame, the frame then stays at no size.
 *
 * THE LOOK is the business's: its accent, and its theme (light, dark, or the
 * visitor's own device), painted through the tokens on the window alone so
 * the document stays light and the frame stays transparent over the website.
 *
 * IN THE LOADER'S FRAME (`?frame=1`, `link.ts`) the window sits on the host
 * page's side, sizes the frame to what it needs (the launcher, the open
 * panel, or the whole viewport for the phone sheet below 440 px), and tells
 * the loader when it opens, closes, and how many replies came while closed.
 * On its own page (a preview, or the address opened directly) it measures
 * its own window instead.
 *
 * ITS WORDS are a namespace of their own (`words.ts`), added before the
 * first render and before every language switch.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { switchLocale } from '@adminium/i18n/page';
import { useI18n } from '@adminium/i18n/react';

import { applyDirection } from '../XApp.js';
import { languageOfTag, X_LANGUAGES } from '../words.js';
import { chatDoor, type ChatConfig, type ChatDoorClient } from './api.js';
import { ChatWindow } from './ChatWindow.js';
import { readKept } from './keep.js';
import { addChatWords } from './words.js';
import { linkChatToLoader, type ChatLink, type HostView } from './link.js';
import { useChatSession } from './session.js';
import './chat.css';

/** The accents an install may have: anything else is the default. */
const ACCENTS = new Set(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']);
/** Below this width (the host page's), the open window is a sheet over the whole page. */
export const SHEET_BELOW = 440;
/** Room round the window inside the frame: its edge inset, and its shadow's room on the other sides. */
const INSET = 24;
const ROOM = 32;

export interface ChatRoute {
  addOn: string;
  frame: boolean;
  lang: string | null;
  preview?: true;
}

function darkNow(theme: ChatConfig['theme']): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function ChatApp({ route, door: given }: { route: ChatRoute; door?: ChatDoorClient }): ReactNode {
  const i18n = useI18n();
  const door = useRef(given ?? chatDoor(route.addOn)).current;
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [tag, setTag] = useState(() => document.documentElement.lang || 'en-US');

  async function words(next: string): Promise<void> {
    const language = languageOfTag(next);
    // The chat's own words in that language first, so the switch draws them at once.
    await addChatWords(i18n, language.tag);
    await switchLocale(i18n, language.id);
    applyDirection(language);
    setTag(language.tag);
  }

  async function load(lang: string | null): Promise<ChatConfig | null> {
    try {
      const read = await door.config({ lang, frame: route.frame, preview: route.preview === true });
      if (read === null) return null;
      if (ACCENTS.has(read.accent)) document.documentElement.dataset['accent'] = read.accent;
      if (read.business.name !== '') document.title = read.business.name;
      if (read.language !== document.documentElement.lang) await words(read.language);
      return read;
    } catch {
      // Not reached, or not understood: nothing is drawn, as for a chat that is not available.
      return null;
    }
  }

  useEffect(() => {
    // The language the visitor picked on an earlier page, else the website's.
    const kept = route.preview === true ? null : readKept(route.addOn)?.language;
    void addChatWords(i18n, tag)
      .then(() => load(kept ?? route.lang ?? tag))
      .then(setConfig);
  }, []);

  /** Another language, picked in the window: its words, then the business's own words (welcome, away) in it. */
  async function choose(next: string): Promise<void> {
    await words(next);
    const read = await load(next);
    if (read !== null) setConfig(read);
  }

  if (config === null) return null;
  return <ChatLive route={route} door={door} config={config} tag={tag} onWords={choose} onReload={async () => (await load(tag)) ?? config} />;
}

function ChatLive(props: { route: ChatRoute; door: ChatDoorClient; config: ChatConfig; tag: string; onWords: (tag: string) => Promise<void>; onReload: () => Promise<ChatConfig> }): ReactNode {
  const { route, config, tag } = props;
  const frame = route.frame && route.preview !== true;
  const [draft, setDraft] = useState('');
  const link = useRef<ChatLink | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const ownSide = (): HostView['side'] => (document.documentElement.dir === 'rtl' ? 'left' : 'right');
  // In the loader's frame the page is told by the loader; until it says hello, a desktop page is assumed (nothing is shown before it).
  const [view, setView] = useState<HostView>(() => (frame ? { width: 1280, height: 800, side: 'right' } : { width: window.innerWidth, height: window.innerHeight, side: ownSide() }));
  const [dark, setDark] = useState(() => darkNow(config.theme));

  const chat = useChatSession({
    addOn: route.addOn,
    door: props.door,
    hours: { open: config.open, closesAt: config.closesAt, nextOpen: config.nextOpen },
    language: tag,
    preview: route.preview === true,
    page: () => link.current?.page() ?? null,
    giveBack: (text) => setDraft((held) => (held.trim() === '' ? text : held)),
  });
  const { session } = chat;
  const sheet = session.open && view.width < SHEET_BELOW;

  // The website's frame: linked once its loader says hello, from a listed website only.
  useEffect(() => {
    if (!frame) return undefined;
    link.current = linkChatToLoader(window, config.frameOrigins ?? [], {
      view: setView,
      open: () => chat.setOpen(true),
      close: () => chat.setOpen(false),
    });
    return () => link.current?.stop();
  }, []);

  // On its own page, the window follows its own viewport and its own direction.
  useEffect(() => {
    if (frame) return undefined;
    const resize = (): void => setView({ width: window.innerWidth, height: window.innerHeight, side: ownSide() });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (!frame) setView((was) => ({ ...was, side: ownSide() }));
  }, [tag]);

  // The visitor's own device decides, when the business left it to them.
  useEffect(() => {
    setDark(darkNow(config.theme));
    if (config.theme !== 'visitor') return undefined;
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const change = (): void => setDark(query?.matches === true);
    query?.addEventListener?.('change', change);
    return () => query?.removeEventListener?.('change', change);
  }, [config.theme]);

  // The frame is as big as what it shows, and never bigger: the website stays clickable round it.
  useLayoutEffect(() => {
    if (!frame) return;
    if (sheet) {
      link.current?.size(view.width, view.height, true);
      return;
    }
    const layer = layerRef.current;
    if (layer === null) return;
    link.current?.size(layer.offsetWidth + INSET + ROOM, layer.offsetHeight + INSET + ROOM, false);
  });

  // The loader locks the page under the sheet, and takes focus back on close.
  const told = useRef<string | null>(null);
  useEffect(() => {
    // Nothing is told before the loader said hello; after it, what changed (and an open window at once).
    if (!frame || link.current?.parentOrigin() == null) return;
    const now = session.open ? (sheet ? 'sheet' : 'open') : 'closed';
    if (told.current === now) return;
    const initial = told.current === null;
    told.current = now;
    if (initial && now === 'closed') return;
    if (session.open) link.current?.opened(sheet);
    else link.current?.closed();
  }, [session.open, sheet, view]);

  useEffect(() => {
    if (frame) link.current?.unread(session.open ? 0 : session.unread);
  }, [session.unread, session.open, view]);

  async function language(next: string): Promise<void> {
    await props.onWords(next);
    chat.setLanguage(next);
  }

  return (
    <div className="xc" data-theme={dark ? 'dark' : undefined} data-sheet={sheet ? '' : undefined}>
      <ChatWindow
        config={config}
        chat={chat}
        tag={X_LANGUAGES.some((one) => one.tag === tag) ? tag : 'en-US'}
        sheet={sheet}
        side={view.side}
        layerRef={layerRef}
        onLanguage={(next) => void language(next)}
        onToggle={chat.setOpen}
        onInHours={() => {
          void props.onReload().then((read) => chat.setHours({ open: read.open, closesAt: read.closesAt, nextOpen: read.nextOpen }));
        }}
        draft={draft}
        setDraft={setDraft}
      />
    </div>
  );
}
