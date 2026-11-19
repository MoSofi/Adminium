// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page a stranger sees for a form or a survey, drawn from what the
 * server says of it (`/x/forms/api/<slug>`), in the page's language.
 *
 * THE SHELL. The business's logo (or its initial), name and the language
 * menu over the page; its name, where to write and its privacy notice under
 * it; the install's accent. Never the software's name. In a website's frame
 * (`?frame=1`) there is no header, footer or menu, and the page tells the
 * website loader its height whenever it changes (`frame.ts`).
 *
 * THE FORM. Every question kind of the forms vocabulary, "show if" live, the
 * vocabulary's own check before Send (the server checks again; the page
 * never decides), the summary over Send and focus to the first question to
 * fix, a trap field no person sees, and Send solving the human check first.
 *
 * PER VISITOR. Where the server says "Per visitor" asks on this page (its
 * own page, never a frame), the visitor banner's chunk is loaded and docked
 * under the page (`banner/VisitorBanner.tsx`), and the footer gains "Cookie
 * choice", which opens it again.
 *
 * A NAMED SURVEY is drawn for its invitation's link (`?t=`), which every call
 * carries: greeted by the invitee's first name once sent, with what it is
 * about under its title, when the server says so.
 *
 * THE ENDINGS. Sent (and the "check your e-mail" step when the visitor ticked
 * a sign-up that asks for one), closed, too many sends (the wait the server
 * gives), "not available", a survey answered already, and a link that does
 * not work. A state change is
 * read out in one polite region; after the visitor's own press removes the
 * control they used, focus goes to the new card's heading. Nothing moves
 * focus on load.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { switchLocale } from '@adminium/i18n/page';
import { useI18n, useT } from '@adminium/i18n/react';
import { Ban, Check, ChevronDown, CircleCheck, Globe, Link2Off, RotateCcw, SearchX, TriangleAlert, type LucideIcon } from 'lucide-react';

import { fetchForm, type XBusiness, type XPage } from './api.js';
import { FormBody, Icon, MailLink, sentWords, type Ending } from './FormBody.js';
import type { FrameLink } from './frame.js';
import type { XRoute } from './route.js';
import { XFooter, XHeader } from './Shell.js';
import { languageOfTag, X_LANGUAGES, type XLanguage } from './words.js';

export { monogram } from './Shell.js';

/** The visitor banner: its own chunk, fetched only where "Per visitor" asks on this page (`banner/VisitorBanner.tsx`). */
const VisitorBanner = lazy(() => import('./banner/VisitorBanner.js'));

/** The accents an install may have: anything else is the default. */
export const ACCENTS = new Set(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']);

type Tone = 'positive' | 'warning' | 'neutral';

/** The page's language and direction, on the document itself. */
export function applyDirection(language: XLanguage): void {
  document.documentElement.lang = language.tag;
  document.documentElement.dir = language.dir;
}

export function XApp({ route }: { route: XRoute }): ReactNode {
  const t = useT();
  const i18n = useI18n();
  const frame = route.frame;
  // The builder's look at a draft: drawn whole, and nothing is sent from it.
  const preview = route.kind === 'form' && route.preview === true;
  const [page, setPage] = useState<XPage | null>(null);
  const [language, setLanguage] = useState<XLanguage>(() => languageOfTag(document.documentElement.lang || 'en-US'));
  const [ending, setEnding] = useState<Ending | null>(null);
  const [live, setLive] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  // "Per visitor": the banner's band docks the page above it; "Cookie choice" opens it again.
  const [docked, setDocked] = useState(false);
  const [reopen, setReopen] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const languageButton = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const moveFocus = useRef<string | null>(null);
  const link = useRef<FrameLink | null>(null);

  const form = page?.state === 'live' ? page.form : null;
  // Never in a frame or a preview: the server says nothing of it there, and the page asks nothing either.
  const visitor = page?.state === 'live' && !frame && !preview ? page.visitor : undefined;
  const business: XBusiness = page?.business ?? { name: '', legalName: null, email: null, privacyNotice: null, hasLogo: false };
  const tag = language.tag;

  // ── Loading ────────────────────────────────────────────────────────────
  async function load(lang: string | null): Promise<void> {
    if (route.kind !== 'form') {
      setEnding({ kind: 'unavailable' });
      return;
    }
    try {
      const next = await fetchForm(route.slug, { lang, frame, token: route.token, preview: route.preview });
      setPage(next);
      setEnding(next.state === 'live' ? null : { kind: next.state });
      if (ACCENTS.has(next.accent)) document.documentElement.dataset['accent'] = next.accent;
      // The engine's words follow the language the form is drawn in.
      if (next.state === 'live' && next.form.language !== tag) await chooseWords(languageOfTag(next.form.language));
    } catch {
      setEnding({ kind: 'offline' });
    }
  }

  useEffect(() => {
    void load(route.lang ?? tag);
    // A frame's height goes to the website that drew it, once it says hello.
    return () => link.current?.stop();
  }, []);

  useEffect(() => {
    if (!frame || page === null || link.current !== null) return;
    const allowed = page.state === 'live' ? (page.frameOrigins ?? []) : [];
    // Only a frame talks to its website: the handshake is loaded there alone, off every page's first load.
    void import('./frame.js').then(({ linkToParent }) => {
      if (link.current === null) link.current = linkToParent(window, allowed, () => postHeight());
    });
  }, [page]);

  function postHeight(): void {
    const root = rootRef.current;
    if (root !== null) link.current?.postHeight(root.getBoundingClientRect().height);
  }

  // Every render may change the height: an error, a question "show if" brought, an ending.
  useLayoutEffect(() => {
    if (frame) postHeight();
  });
  useEffect(() => {
    if (!frame || typeof ResizeObserver !== 'function' || rootRef.current === null) return undefined;
    const watcher = new ResizeObserver(() => postHeight());
    watcher.observe(rootRef.current);
    return () => watcher.disconnect();
  }, []);

  // The tab says the business, never the software behind it.
  useEffect(() => {
    if (business.name !== '') document.title = business.name;
  }, [business.name]);

  useEffect(() => {
    const target = moveFocus.current;
    if (target === null) return;
    moveFocus.current = null;
    if (target === 'heading') headingRef.current?.focus();
    else document.getElementById(target)?.focus();
  });

  // The menu takes focus when it opens: the ticked language, else the first.
  useEffect(() => {
    if (!menuOpen) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [menuOpen]);

  async function chooseWords(next: XLanguage): Promise<void> {
    await switchLocale(i18n, next.id);
    applyDirection(next);
    setLanguage(next);
  }

  function closeMenu(): void {
    setMenuOpen(false);
    languageButton.current?.focus();
  }

  function chooseLanguage(next: XLanguage): void {
    closeMenu();
    if (next.tag === tag) return;
    void chooseWords(next).then(() => (form === null ? undefined : load(next.tag)));
  }

  // ── What an ending says ────────────────────────────────────────────────
  function endingCard(current: Ending): { tone: Tone; icon: LucideIcon; title: string; paras: ReactNode[]; contact: boolean; action?: ReactNode } {
    const write = business.email === null ? [] : [t('x:ending.write', 'Write to {email}.', { email: business.email })];
    switch (current.kind) {
      case 'sent': {
        const definition = form?.definition;
        const { title, paras } = sentWords(t, current, form);
        const onwards =
          definition?.ending.kind === 'page' ? (
            <a className="x-button-secondary" href={definition.ending.url} target="_top" rel="noreferrer">
              {t('x:ending.continue', 'Continue')}
            </a>
          ) : undefined;
        return { tone: 'positive', icon: CircleCheck, title, paras, contact: false, ...(onwards === undefined ? {} : { action: onwards }) };
      }
      case 'closed':
        return { tone: 'neutral', icon: Ban, title: t('x:ending.closed', 'This form is closed.'), paras: [], contact: true };
      case 'already':
        return { tone: 'neutral', icon: CircleCheck, title: t('x:ending.already', 'You’ve already answered this survey. Thank you.'), paras: [], contact: false };
      case 'dead':
        return { tone: 'neutral', icon: Link2Off, title: t('x:ending.dead', 'This link doesn’t work.'), paras: write, contact: false };
      case 'offline':
        return {
          tone: 'warning',
          icon: TriangleAlert,
          title: t('x:ending.offline', 'This page could not be reached.'),
          paras: [t('x:ending.offlineBody', 'Check your connection and try again.')],
          contact: true,
          action: (
            <button type="button" className="x-button" onClick={() => void load(tag)}>
              <Icon of={RotateCcw} size={16} />
              <span>{t('x:ending.retry', 'Try again')}</span>
            </button>
          ),
        };
      case 'unavailable':
        return { tone: 'neutral', icon: SearchX, title: t('x:ending.unavailable', 'This page isn’t available.'), paras: [], contact: true };
    }
  }

  // The polite region says an ending's title and its key sentence once it shows.
  const card = ending === null ? null : endingCard(ending);
  useEffect(() => {
    if (card === null) return;
    setLive([card.title, ...card.paras.filter((para): para is string => typeof para === 'string').slice(0, 1)].join(' '));
  }, [ending, tag]);

  // ── The language menu: the form's languages (all eight with no form), each named in itself ─
  const choices = form === null ? X_LANGUAGES : X_LANGUAGES.filter((one) => form.languages.includes(one.tag as never));
  const menu =
    frame || choices.length < 2 ? null : (
      <>
        <button
          ref={languageButton}
          type="button"
          className="x-language-button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('x:language.button', 'Language: {name}', { name: language.name })}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
        >
          <Icon of={Globe} size={16} />
          <span>{language.name}</span>
          <Icon of={ChevronDown} size={14} />
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('x:language.menu', 'Language')}
            className="x-menu"
            onKeyDown={(event) => {
              const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
              const at = items.indexOf(document.activeElement as HTMLButtonElement);
              const go = (index: number): void => {
                event.preventDefault();
                items[(index + items.length) % items.length]?.focus();
              };
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault();
                closeMenu();
              } else if (event.key === 'ArrowDown') go(at + 1);
              else if (event.key === 'ArrowUp') go(at - 1);
              else if (event.key === 'Home') go(0);
              else if (event.key === 'End') go(items.length - 1);
            }}
          >
            {choices.map((one) => (
              <button key={one.id} type="button" role="menuitemradio" aria-checked={one.tag === tag} lang={one.tag} dir={one.dir} className="x-menu-item" tabIndex={-1} onClick={() => chooseLanguage(one)}>
                <span>{one.name}</span>
                {one.tag === tag ? <Icon of={Check} size={16} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </>
    );

  const body =
    card !== null ? (
      <section className="x-card x-status" data-tone={card.tone} aria-labelledby="x-status-title">
        <div className="x-status-head">
          <span className="x-tile">
            <Icon of={card.icon} />
          </span>
          <div className="x-status-text">
            <h1 id="x-status-title" className="x-h2" tabIndex={-1} ref={headingRef}>
              {card.title}
            </h1>
            {card.paras.map((para, index) => (
              <p key={index}>{para}</p>
            ))}
          </div>
        </div>
        {card.action ?? null}
        {card.contact && business.email !== null ? <MailLink email={business.email} icon /> : null}
      </section>
    ) : form !== null && page?.state === 'live' && route.kind === 'form' ? (
      <FormBody
        slug={route.slug}
        token={route.token}
        query={route.query}
        preview={preview}
        frame={frame}
        parentOrigin={() => link.current?.parentOrigin() ?? null}
        form={form}
        today={page.today}
        business={business}
        invitation={page.invitation}
        tag={tag}
        rtl={language.dir === 'rtl'}
        heading="h1"
        say={setLive}
        onEnding={(next) => {
          moveFocus.current = 'heading';
          setEnding(next);
        }}
        onDrawn={frame ? postHeight : undefined}
      />
    ) : null;

  return (
    <div className="x-page" data-frame={frame ? '' : undefined} data-docked={docked ? '' : undefined} ref={rootRef} aria-busy={page === null && ending === null ? true : undefined}>
      <div role="status" aria-live="polite" className="x-sr">
        {live}
      </div>
      {frame ? null : <XHeader business={business}>{menu}</XHeader>}
      {visitor === undefined ? null : (
        <Suspense fallback={null}>
          <VisitorBanner visitor={visitor} privacyNotice={business.privacyNotice} reopen={reopen} onDocked={setDocked} />
        </Suspense>
      )}
      <div className="x-scroll">
        <main className="x-main">{body}</main>
        {frame ? null : <XFooter business={business} onCookieChoice={visitor === undefined ? undefined : () => setReopen((n) => n + 1)} />}
      </div>
    </div>
  );
}
