// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE VISITOR BANNER — "Can we remember your visit?" on the install's own
 * pages at "Per visitor" (comp `Landing Pages States.dc.html` boards 1g-1…1g-5).
 *
 * Its own small chunk: a page loads it only when the server says "Per
 * visitor" applies here (`visitor` in the page's data), so a page at Counts
 * only or Off never fetches a byte of it. Any page of the `/x/` shell mounts
 * it the same way (a form's page here; a landing page's shell too):
 *
 *     const VisitorBanner = lazy(() => import('../banner/VisitorBanner.js'));
 *     <VisitorBanner visitor={page.visitor} privacyNotice={business.privacyNotice} reopen={n} onDocked={setDocked} />
 *
 * and puts the shell's "Cookie choice" button in its footer, which bumps
 * `reopen`.
 *
 * WHERE IT SITS. One band, right after the header in the document (so a
 * screen reader meets it early) and drawn at the bottom of the window, under
 * the page, never over it: the shell docks (`data-docked`: the page's own
 * part scrolls above the band). It takes no focus when it appears.
 *
 * WHAT IT DOES.
 *  - Shown only when no choice is kept: no "yes" (the server says, from its
 *    cookie) and no "no" in this browser (`adm.x.choice`, six months).
 *  - "Yes" asks the server (`POST /x/consent/visit`), which sets the cookie:
 *    nothing is stored before it.
 *  - "No" keeps the choice in this browser alone; after a "yes" it takes the
 *    yes back (`DELETE /x/consent/visit`: the visitor's history goes, and
 *    the cookie).
 *  - The two buttons are the same size and look: no is as easy as yes.
 *  - After a press, the band says the choice in a polite status line.
 *  - "Cookie choice" opens it again with focus on its title.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';

import type { XVisitor } from '../api.js';
import './banner.css';

/** Where "no" is kept, in this browser alone. */
export const CHOICE_KEY = 'adm.x.choice';
/** A "no" is asked again after six months, as a "yes" is (its cookie lapses). */
const CHOICE_KEEP_MS = 180 * 24 * 60 * 60 * 1000;

/** Whether this browser said no within six months. Storage that cannot be read is no choice. */
export function saidNo(now: number = Date.now()): boolean {
  try {
    const kept = window.localStorage.getItem(CHOICE_KEY);
    const at = kept === null || !kept.startsWith('no:') ? Number.NaN : Number(kept.slice(3));
    return Number.isFinite(at) && now - at < CHOICE_KEEP_MS;
  } catch {
    return false;
  }
}

function keepNo(now: number): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, `no:${String(now)}`);
  } catch {
    // Kept for this page only: the banner asks again next time.
  }
}

function forgetNo(): void {
  try {
    window.localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

async function answer(method: 'POST' | 'DELETE', language: string): Promise<boolean> {
  try {
    const response = await fetch('/x/consent/visit', {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ language }) } : {}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface VisitorBannerProps {
  visitor: XVisitor;
  /** The business's privacy notice, linked under the buttons. */
  privacyNotice: string | null;
  /** Bumped by the shell's "Cookie choice": the banner opens again, focus on its title. */
  reopen: number;
  /** Told whether the band is drawn, so the shell docks the page above it. */
  onDocked?: ((docked: boolean) => void) | undefined;
}

export default function VisitorBanner({ visitor, privacyNotice, reopen, onDocked }: VisitorBannerProps): ReactNode {
  const t = useT();
  const { banner } = visitor;
  const [choice, setChoice] = useState<'yes' | 'no' | null>(() => (visitor.said === 'yes' ? 'yes' : saidNo() ? 'no' : null));
  const [asking, setAsking] = useState(choice === null);
  const [saved, setSaved] = useState<'yes' | 'no' | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = useRef<HTMLHeadingElement | null>(null);
  const focusTitle = useRef(false);
  const titleId = 'x-banner-title';

  useEffect(() => {
    if (reopen === 0) return;
    setSaved(null);
    setFailed(false);
    setAsking(true);
    focusTitle.current = true;
  }, [reopen]);

  useEffect(() => {
    if (asking && focusTitle.current) {
      focusTitle.current = false;
      title.current?.focus();
    }
  });

  const docked = asking || saved !== null;
  useEffect(() => {
    onDocked?.(docked);
  }, [docked]);
  useEffect(() => () => onDocked?.(false), []);

  async function choose(next: 'yes' | 'no'): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (next === 'yes') {
        if (!(await answer('POST', banner.language))) {
          setFailed(true);
          return;
        }
        forgetNo();
      } else {
        // A "yes" taken back: the history goes with the cookie. A "no" before any yes asks nothing of the server.
        if (choice === 'yes' && !(await answer('DELETE', banner.language))) {
          setFailed(true);
          return;
        }
        keepNo(Date.now());
      }
      setChoice(next);
      setSaved(next);
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  if (!docked) return null;
  return (
    <div className="x-banner-band" lang={banner.language} dir={banner.language.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr'} data-testid="x-banner">
      {asking ? (
        <div role="region" aria-labelledby={titleId} className="x-banner">
          <h2 id={titleId} ref={title} tabIndex={-1} className="x-banner-title">
            {banner.title}
          </h2>
          <p className="x-banner-text">{banner.text}</p>
          <div className="x-banner-buttons">
            <button type="button" className="x-banner-button" aria-disabled={busy || undefined} onClick={() => void choose('yes')}>
              {banner.yes}
            </button>
            <button type="button" className="x-banner-button" aria-disabled={busy || undefined} onClick={() => void choose('no')}>
              {banner.no}
            </button>
          </div>
          {failed ? (
            <p className="x-banner-failed" role="alert">
              {t('x:banner.failed', 'Your choice could not be saved. Try again.')}
            </p>
          ) : null}
          {privacyNotice === null ? null : (
            <a className="x-banner-notice" href={privacyNotice} target="_blank" rel="noreferrer">
              {t('x:footer.privacyNotice', 'Privacy notice')}
            </a>
          )}
        </div>
      ) : null}
      <p role="status" className={saved === null ? 'x-sr' : 'x-banner-saved'}>
        {saved === 'yes'
          ? t('x:banner.savedYes', 'Saved: yes. Change it any time under Cookie choice.')
          : saved === 'no'
            ? t('x:banner.savedNo', 'Saved: no. Change it any time under Cookie choice.')
            : ''}
      </p>
    </div>
  );
}
