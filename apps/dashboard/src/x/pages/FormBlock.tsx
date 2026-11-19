// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGE'S FORM BLOCK, for a stranger: the real form, drawn by the
 * forms page's own component (`../FormBody.tsx`), in the page's language,
 * its title a section's heading (`h2`) inside the page.
 *
 * WHEN IT ASKS. The form comes with the page's own data, so it is drawn at
 * once. As the block nears the screen, it asks the forms door once per page
 * load with the page's key (`?on=<page key>`): that read is what counts the
 * form as opened on this page (`views/counter.ts`), and its answer is the
 * form as it is now (a form closed meanwhile shows "closed"; one no longer
 * there leaves the page). A preview asks nothing.
 *
 * ITS ENDINGS stay inside the page, in the block (comp boards 1e-1…1e-4):
 * sent, closed, too many sends, not reached. The card keeps the form's height
 * as its least, so nothing under it moves. "Sent" takes focus (the visitor's
 * own press took the button away); the others are said in the page's polite
 * region. "Not reached" goes back to the form, the answers kept.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';
import { CircleCheck, Clock, Lock, RotateCw, WifiOff, type LucideIcon } from 'lucide-react';
import type { LandingBlockOf } from '@adminium/add-on-contracts/landing';

import { fetchForm, type XBusiness } from '../api.js';
import { FormBody, Icon, sentWords, waitWords, type Ending } from '../FormBody.js';
import type { PageForm } from './api.js';

/** How near the screen the block is when it asks: about a phone's screen ahead. */
const NEAR = '0px 0px 600px 0px';

type BlockEnding = Ending | { kind: 'too-many'; retryAfter: number | null; day: boolean };

export interface FormBlockProps {
  block: LandingBlockOf<'form'>;
  /** The form as the page's data gave it. */
  entry: PageForm;
  /** The page's key: what the block asks and sends with. */
  pageKey: string;
  preview: boolean;
  business: XBusiness;
  /** The page's address, for the form's hidden values. */
  query: URLSearchParams;
  tag: string;
  rtl: boolean;
  say: (words: string) => void;
}

/** A sentence with the business's address in it as a link: the words are split where the address goes. */
function withMail(sentence: string, email: string): ReactNode {
  const MARK = '⁣mail⁣';
  const [before, after] = sentence.split(MARK) as [string, string | undefined];
  if (after === undefined) return sentence;
  return (
    <>
      {before}
      <a href={`mailto:${email}`} className="xp-mail">
        <bdi dir="ltr">{email}</bdi>
      </a>
      {after}
    </>
  );
}

export function FormBlock(props: FormBlockProps): ReactNode {
  const t = useT();
  const { block, pageKey, preview, business, tag, say } = props;
  const [entry, setEntry] = useState<PageForm>(props.entry);
  const [gone, setGone] = useState(false);
  const [ending, setEnding] = useState<BlockEnding | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const height = useRef(0);
  const asked = useRef(false);
  const focusSent = useRef(false);

  // Once per page load, as the block nears the screen: the form as it is now, counted as opened on this page.
  useEffect(() => {
    if (preview || holder.current === null) return undefined;
    const ask = (): void => {
      if (asked.current) return;
      asked.current = true;
      fetchForm(entry.slug, { lang: entry.form.language, frame: false, token: null, on: pageKey })
        .then((reply) => {
          if (reply.state === 'live') setEntry({ slug: entry.slug, form: reply.form, today: reply.today });
          else if (reply.state === 'closed') setEnding((now) => now ?? { kind: 'closed' });
          else setGone(true);
        })
        // Not reached now: the form drawn from the page stays, and Send says so if it still cannot reach.
        .catch(() => undefined);
    };
    if (typeof IntersectionObserver !== 'function') {
      ask();
      return undefined;
    }
    const watcher = new IntersectionObserver(
      (seen) => {
        if (!seen.some((one) => one.isIntersecting)) return;
        watcher.disconnect();
        ask();
      },
      { rootMargin: NEAR },
    );
    watcher.observe(holder.current);
    return () => watcher.disconnect();
  }, []);

  function end(next: BlockEnding): void {
    // The form's height, measured while it is still drawn: the card keeps it as its least.
    height.current = holder.current?.querySelector('form')?.getBoundingClientRect().height ?? 0;
    focusSent.current = next.kind === 'sent';
    setEnding(next);
  }

  useLayoutEffect(() => {
    const element = card.current;
    if (element === null) return;
    if (height.current > 0) element.style.setProperty('--xp-form-height', `${String(Math.ceil(height.current))}px`);
    if (focusSent.current) {
      focusSent.current = false;
      heading.current?.focus();
    }
  }, [ending]);

  const words = ending === null ? null : endingWords(ending);
  useEffect(() => {
    if (words !== null) say([words.title, ...words.said].join(' '));
  }, [ending]);

  function endingWords(current: BlockEnding): { tone: string; icon: LucideIcon; title: string; paras: ReactNode[]; said: string[]; retry: boolean } {
    switch (current.kind) {
      case 'sent': {
        const { title, paras } = sentWords(t, current, entry.form);
        return { tone: 'positive', icon: CircleCheck, title, paras, said: paras.slice(0, 1), retry: false };
      }
      case 'too-many': {
        const when = waitWords(current.retryAfter, tag, current.day);
        const line =
          business.email === null
            ? t('x:pages.tooManyLater', 'Please try again {when}.', { when })
            : t('x:pages.tooManyWrite', 'Please try again {when}, or write to {email}.', { when, email: '⁣mail⁣' });
        return {
          tone: 'warning',
          icon: Clock,
          title: t('x:pages.tooManyTitle', 'Too many sends from here.'),
          paras: [business.email === null ? line : withMail(line, business.email)],
          said: [business.email === null ? line : line.replace('⁣mail⁣', business.email)],
          retry: false,
        };
      }
      case 'offline': {
        const body = t('x:ending.offlineBody', 'Check your connection and try again.');
        return { tone: 'danger', icon: WifiOff, title: t('x:ending.offline', 'This page could not be reached.'), paras: [body], said: [body], retry: true };
      }
      default:
        // Closed, or no longer taking answers in any other way: the block says the form is closed.
        return { tone: 'neutral', icon: Lock, title: t('x:ending.closed', 'This form is closed.'), paras: [], said: [], retry: false };
    }
  }

  if (gone) return null;
  // Not reached: the form stays in the page, hidden, so "Try again" brings it back with the answers kept.
  const keepForm = ending === null || ending.kind === 'offline' || ending.kind === 'too-many';
  return (
    <div className="xp-form-block">
      {keepForm ? (
        <div ref={holder} hidden={ending !== null}>
          <FormBody
            slug={entry.slug}
            token={null}
            query={props.query}
            preview={preview}
            frame={false}
            on={pageKey}
            form={entry.form}
            today={entry.today}
            business={business}
            tag={tag}
            rtl={props.rtl}
            heading="h2"
            scope={`${block.id}-`}
            say={say}
            onEnding={end}
            onTooMany={(retryAfter, day) => end({ kind: 'too-many', retryAfter, day })}
          />
        </div>
      ) : null}
      {words === null ? null : (
        <div ref={card} className="x-card xp-ending" data-tone={words.tone}>
          <span className="xp-ending-tile">
            <Icon of={words.icon} size={19} />
          </span>
          <div className="xp-ending-text">
            <h2 className="xp-ending-title" tabIndex={-1} ref={heading}>
              {words.title}
            </h2>
            {words.paras.map((para, index) => (
              <p key={index}>{para}</p>
            ))}
            {words.retry ? (
              <button type="button" className="xp-retry" onClick={() => setEnding(null)}>
                <Icon of={RotateCw} size={16} />
                <span>{t('x:ending.retry', 'Try again')}</span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
