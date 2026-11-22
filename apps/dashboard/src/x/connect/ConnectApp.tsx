// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONNECT PAGE: where one person connects their own calendar, from a link,
 * with no account here. Drawn from `Calendars and Embeds`, part 3.
 *
 * THE STATES. The link opened (one button, or one per provider when the link
 * names no provider), done, and each way nothing was connected: refused, a box
 * left unticked, a different account, another service, "needs admin approval",
 * the business's own setup, and a link that no longer works.
 *
 * A LINK THAT NO LONGER WORKS is one page. The server answers the same for a
 * link that was used, expired or replaced, so a stranger holding an old link
 * learns nothing about it.
 *
 * Nothing here decides anything: the server's answer is what is shown. A state
 * change is read out once, and focus goes to the new heading after a press.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';
import { CalendarPlus, CalendarX2, Check, CircleSlash, EyeOff, Link2Off, RotateCcw, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react';

import type { XBusiness } from '../api.js';
import { Icon, MailLink } from '../FormBody.js';
import { XFooter, XHeader } from '../Shell.js';
import { completeSignIn, forgetToken, openLink, startSignIn, takeReturn, takeToken, type ConnectOpened, type ConnectOutcome } from './api.js';
export { addConnectWords } from './words.js';
import './connect.css';

type View =
  | { kind: 'loading' }
  | { kind: 'start' }
  | { kind: 'done'; address: string | null; addressDiffers: boolean }
  | { kind: 'denied' | 'partial' | 'different-account' | 'other-provider' | 'needs-admin' | 'setup' | 'nothing' }
  | { kind: 'dead' | 'cannot-connect' | 'offline' };

type T = ReturnType<typeof useT>;

/** How a provider is named in a sentence: the company whose page the person will see. */
export function providerWord(provider: { key: string; name: string }): string {
  if (provider.key === 'calendar-google') return 'Google';
  if (provider.key === 'calendar-microsoft') return 'Microsoft';
  return provider.name;
}

const firstName = (name: string | null): string | null => name?.trim().split(/\s+/)[0] ?? null;

function storeOf(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function viewOf(answer: ConnectOutcome): View {
  if (answer.outcome === 'connected') return { kind: 'done', address: answer.address, addressDiffers: answer.addressDiffers };
  return { kind: answer.outcome };
}

export function ConnectApp(): ReactNode {
  const t = useT();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [opened, setOpened] = useState<ConnectOpened | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const token = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pressed = useRef(false);
  const began = useRef(false);

  useEffect(() => {
    // Once: a sign-in's answer can be handed in only one time, and strict mode draws twice.
    if (began.current) return;
    began.current = true;
    const store = storeOf();
    const back = takeReturn(window.location, window.history);
    token.current = takeToken(window.location, window.history, store);
    void (async () => {
      try {
        // Read before the answer is handed in: a successful connect spends the link.
        const link = token.current === null ? null : await openLink(token.current);
        setOpened(link);
        if (window.location.pathname === '/x/connect/back') {
          if (back === null) {
            setView({ kind: link === null ? 'dead' : 'nothing' });
            return;
          }
          const answer = await completeSignIn(back);
          if (answer.outcome === 'connected') forgetToken(store);
          setView(viewOf(answer));
          return;
        }
        setView(link === null ? { kind: 'dead' } : { kind: 'start' });
      } catch {
        setView({ kind: 'offline' });
      }
    })();
  }, []);

  useEffect(() => {
    if (opened !== null) document.title = opened.business;
  }, [opened]);

  useEffect(() => {
    if (view.kind === 'loading') return;
    setLive(heading.current?.textContent ?? '');
    if (pressed.current) {
      pressed.current = false;
      heading.current?.focus();
    }
  }, [view.kind]);

  async function connect(providerKey: string): Promise<void> {
    if (token.current === null) {
      setView({ kind: 'dead' });
      return;
    }
    setLeaving(providerKey);
    pressed.current = true;
    try {
      const started = await startSignIn(token.current, providerKey);
      if ('url' in started) {
        window.location.assign(started.url);
        return;
      }
      setLeaving(null);
      setView({ kind: started.refused });
    } catch {
      setLeaving(null);
      setView({ kind: 'offline' });
    }
  }

  function again(): void {
    pressed.current = true;
    setView(opened === null ? { kind: 'dead' } : { kind: 'start' });
  }

  const business: XBusiness = { name: opened?.business ?? '', legalName: null, email: opened?.contact ?? null, privacyNotice: null, hasLogo: false };
  const providers = opened?.providers ?? [];
  const single = providers.length === 1 ? providerWord(providers[0]!) : null;
  const sender = firstName(opened?.sentBy ?? null);

  return (
    <div className="x-page" aria-busy={view.kind === 'loading' ? true : undefined}>
      <div role="status" aria-live="polite" className="x-sr">
        {live}
      </div>
      <XHeader business={business} />
      <div className="x-scroll">
        <main className="x-main x-connect">
          {view.kind === 'loading' ? <Icon of="spinner" /> : null}
          {view.kind === 'start' && opened !== null ? <Start opened={opened} t={t} heading={heading} leaving={leaving} onConnect={(key) => void connect(key)} /> : null}
          {view.kind !== 'loading' && view.kind !== 'start' ? <Ending view={view} opened={opened} provider={single} sender={sender} t={t} heading={heading} onAgain={again} /> : null}
        </main>
        {opened?.sentBy != null ? (
          <p className="x-connect-sent">
            {t('xConnect:sentBy', 'Sent by {name} at {business}. You don’t need an account for this.', { name: opened.sentBy, business: opened.business })}
          </p>
        ) : null}
        <XFooter business={business} />
      </div>
    </div>
  );
}

function Line({ of, tone, children }: { of: LucideIcon; tone: 'pos' | 'muted'; children: ReactNode }): ReactNode {
  return (
    <li>
      <span className="x-connect-mark" data-tone={tone}>
        <Icon of={of} size={17} />
      </span>
      <span>{children}</span>
    </li>
  );
}

function Start({ opened, t, heading, leaving, onConnect }: { opened: ConnectOpened; t: T; heading: React.RefObject<HTMLHeadingElement | null>; leaving: string | null; onConnect: (key: string) => void }): ReactNode {
  const first = firstName(opened.person);
  const sender = firstName(opened.sentBy);
  const reconnect = opened.purpose === 'reconnect';
  const names = opened.providers.map(providerWord);
  const account = names.length === 1 ? names[0]! : t('xConnect:yourAccount', 'calendar');
  const title =
    sender === null
      ? reconnect
        ? t('xConnect:titleReconnect', 'Reconnect your calendar to {business}', { business: opened.business })
        : t('xConnect:title', 'Connect your calendar to {business}', { business: opened.business })
      : reconnect
        ? t('xConnect:titleReconnectBy', '{sender} asked you to reconnect your calendar to {business}', { sender, business: opened.business })
        : t('xConnect:titleBy', '{sender} asked you to connect your calendar to {business}', { sender, business: opened.business });
  return (
    <>
      <div className="x-connect-head">
        {first === null ? null : <p className="x-connect-hi">{t('xConnect:hi', 'Hi {name},', { name: first })}</p>}
        <h1 className="x-connect-title" tabIndex={-1} ref={heading}>
          {title}
        </h1>
      </div>
      <section className="x-card x-connect-card" aria-labelledby="x-connect-will">
        <h2 id="x-connect-will" className="x-connect-eyebrow">
          {t('xConnect:willHeading', 'What it will and won’t do')}
        </h2>
        <ul className="x-connect-lines">
          <Line of={CalendarPlus} tone="pos">
            {t('xConnect:will1', 'Your {business} bookings appear in a calendar called {calendar} in your {account} account, and move or disappear when a booking changes.', { business: opened.business, calendar: opened.calendar ?? opened.business, account })}
          </Line>
          <Line of={CalendarX2} tone="pos">
            {t('xConnect:will2', 'When you’re busy in your own calendar, you can’t be booked then. The desk sees a grey Busy block, never what it is.')}
          </Line>
          <Line of={EyeOff} tone="muted">
            {t('xConnect:will3', 'Only “busy” is read — never what an event is called.')}
          </Line>
        </ul>
      </section>
      <div className="x-connect-buttons">
        {opened.providers.map((provider) => (
          <button key={provider.key} type="button" className="x-button" aria-disabled={leaving !== null ? true : undefined} onClick={() => (leaving === null ? onConnect(provider.key) : undefined)}>
            {leaving === provider.key ? <Icon of="spinner" size={16} /> : null}
            <span>{t('xConnect:button', 'Connect with {provider}', { provider: providerWord(provider) })}</span>
          </button>
        ))}
      </div>
      <p className="x-connect-note">
        {names.length === 1
          ? t('xConnect:signInOne', '{provider} asks you to sign in on its own page. {business} never sees your password.', { provider: names[0]!, business: opened.business })
          : t('xConnect:signInMany', '{providers} asks you to sign in on its own page. {business} never sees your password.', { providers: names.join(t('xConnect:or', ' or ')), business: opened.business })}
      </p>
      {opened.address === null ? (
        <p className="x-connect-fine">{t('xConnect:worksOnce', 'This link works once.')}</p>
      ) : (
        <p className="x-connect-fine">
          {t('xConnect:linkFor', 'This link is for {address} and works once.', { address: '⁨' + opened.address + '⁩' })}
        </p>
      )}
    </>
  );
}

function Ending({ view, opened, provider, sender, t, heading, onAgain }: { view: Exclude<View, { kind: 'loading' | 'start' }>; opened: ConnectOpened | null; provider: string | null; sender: string | null; t: T; heading: React.RefObject<HTMLHeadingElement | null>; onAgain: () => void }): ReactNode {
  const business = opened?.business ?? '';
  const who = provider ?? t('xConnect:theProvider', 'the provider');
  const ask = sender ?? t('xConnect:whoSent', 'whoever sent it');
  const retry = (
    <button type="button" className="x-button x-connect-action" onClick={onAgain}>
      <Icon of={RotateCcw} size={16} />
      <span>{t('xConnect:tryAgain', 'Try again')}</span>
    </button>
  );
  const mail = opened?.contact != null ? <MailLink email={opened.contact} icon /> : null;
  let tone: 'positive' | 'warning' | 'neutral' = 'neutral';
  let icon: LucideIcon = CircleSlash;
  let title = t('xConnect:nothingTitle', 'Nothing was connected');
  let paras: ReactNode[] = [];
  let action: ReactNode = null;
  switch (view.kind) {
    case 'done':
      tone = 'positive';
      icon = Check;
      title = t('xConnect:doneTitle', 'Done — your {business} bookings will appear in a calendar called {calendar}.', { business, calendar: opened?.calendar ?? business });
      paras = [
        view.address === null ? t('xConnect:doneClose', 'You can close this page.') : t('xConnect:doneAs', 'Connected as {address}. You can close this page.', { address: '⁨' + view.address + '⁩' }),
        ...(view.addressDiffers ? [t('xConnect:doneDiffers', 'That isn’t the address {business} has for you, so they have been told. If it’s the wrong account, ask {who} for a new link.', { business, who: ask })] : []),
        t('xConnect:doneLater', 'To disconnect later, ask {who}, or remove {business}’s access in your {provider} account.', { who: ask, business, provider: who }),
      ];
      break;
    case 'denied':
      title = t('xConnect:nothingTitle', 'Nothing was connected');
      paras = [
        t('xConnect:deniedBody', 'You didn’t allow access on {provider}’s page, so your calendar is unchanged and {business} can’t see it.', { provider: who, business }),
        // Microsoft's "Need admin approval" page may answer as a plain refusal.
        ...(provider === 'Microsoft' ? [t('xConnect:adminWhat', 'Ask your admin to open Microsoft Entra, go to App registrations → this app → API permissions, and press “Grant admin consent”. Then open this link again.')] : []),
      ];
      action = retry;
      break;
    case 'partial':
      tone = 'warning';
      icon = TriangleAlert;
      title = t('xConnect:partialTitle', 'One box was left unticked');
      paras = [t('xConnect:partialBody', '{business} needs every box on {provider}’s page, or your bookings or busy times would silently go missing. Nothing was connected.', { business, provider: who })];
      action = retry;
      break;
    case 'different-account':
      tone = 'warning';
      icon = TriangleAlert;
      title = t('xConnect:differentTitle', 'That’s a different account');
      paras = [t('xConnect:differentBody', 'This link reconnects the account you used before. Sign in with that one, or ask {who} for a new link.', { who: ask })];
      action = retry;
      break;
    case 'other-provider':
      tone = 'warning';
      icon = TriangleAlert;
      title = t('xConnect:otherTitle', 'You’re already connected another way');
      paras = [t('xConnect:otherBody', 'One calendar is connected for you already. Ask {who} to disconnect it first.', { who: ask })];
      break;
    case 'needs-admin':
      tone = 'warning';
      icon = ShieldAlert;
      title = t('xConnect:adminTitle', 'Your Microsoft 365 admin has to approve this app first');
      paras = [
        t('xConnect:adminBody', 'Your organisation doesn’t let people approve calendar access themselves. Nothing was connected.'),
        t('xConnect:adminWhat', 'Ask your admin to open Microsoft Entra, go to App registrations → this app → API permissions, and press “Grant admin consent”. Then open this link again.'),
      ];
      action = retry;
      break;
    case 'setup':
      tone = 'warning';
      icon = TriangleAlert;
      title = t('xConnect:setupTitle', 'This can’t be connected yet');
      paras = [t('xConnect:setupBody', '{business} still has to finish setting this up. Nothing is wrong on your side, and you don’t need to do anything. Ask {who} to check the setup.', { business: business === '' ? t('xConnect:theBusiness', 'The business') : business, who: ask })];
      action = mail;
      break;
    case 'cannot-connect':
      tone = 'warning';
      icon = TriangleAlert;
      title = t('xConnect:cannotTitle', 'This can’t be connected here');
      paras = [t('xConnect:cannotBody', 'This address isn’t reachable from the internet, so {provider} can’t send you back to it.', { provider: who })];
      action = mail;
      break;
    case 'dead':
      icon = Link2Off;
      title = t('xConnect:deadTitle', 'This link doesn’t work any more');
      paras = [t('xConnect:deadBody', 'It may have been used already, or be more than 7 days old. Nothing was changed. Ask whoever sent it for a new one.')];
      break;
    case 'offline':
      tone = 'warning';
      icon = TriangleAlert;
      title = t('x:ending.offline', 'This page could not be reached.');
      paras = [t('x:ending.offlineBody', 'Check your connection and try again.')];
      action = (
        <button type="button" className="x-button x-connect-action" onClick={() => window.location.reload()}>
          <Icon of={RotateCcw} size={16} />
          <span>{t('x:ending.retry', 'Try again')}</span>
        </button>
      );
      break;
    case 'nothing':
      paras = [t('xConnect:nothingBody', 'That sign-in couldn’t be finished, so your calendar is unchanged. Try again from this page.')];
      action = opened === null ? null : retry;
      break;
  }
  return (
    <section className="x-connect-ending x-status" data-tone={tone} aria-labelledby="x-connect-ending-title">
      <span className="x-connect-tile">
        <Icon of={icon} size={24} />
      </span>
      <h1 id="x-connect-ending-title" className="x-connect-title" tabIndex={-1} ref={heading}>
        {title}
      </h1>
      {paras.map((para, index) => (
        <p key={index} className={index === 0 ? 'x-connect-body' : 'x-connect-note'}>
          {para}
        </p>
      ))}
      {action}
    </section>
  );
}
