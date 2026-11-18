// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A landing page as a stranger sees it, against a pretend pages door and
 * forms door: every block drawn with one `h1`, the real form in a Form block
 * (asked once with the page's key as it nears the screen, sent with it, its
 * endings inside the page), a form left out, a picture that does not load,
 * right to left, loading and "not available", the banner as on a form's page.
 */
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@adminium/i18n/react';
import type { FormDefinition } from '@adminium/add-on-contracts/forms';
import type { LandingPage } from '@adminium/add-on-contracts/landing';

import { routeOf } from '../route.js';
import { initXWords, languageOfTag } from '../words.js';
import { applyDirection } from '../XApp.js';
import type { XLandingPage } from './api.js';
import { LandingApp } from './LandingApp.js';

const BUSINESS = { name: 'Meridian', legalName: 'Meridian Workplace Ltd', email: 'hello@meridian.example', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false };

const VISIT: FormDefinition = {
  v: 1,
  kind: 'form',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: { 'en-US': 'Book a showroom visit' },
  intro: { 'en-US': "See the new booths. We'll confirm your time within one working day." },
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, maxLength: 200, label: { 'en-US': 'Your name' } },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, maxLength: 200, label: { 'en-US': 'Work e-mail' } },
  ],
  ending: { kind: 'words', words: { 'en-US': "We'll confirm your time within one working day." } },
};

const BOOTHS: LandingPage = {
  v: 1,
  title: 'Acoustic booths for open offices',
  description: 'Booths that halve the noise of a busy floor.',
  blocks: [
    { id: 'h', kind: 'heading', text: 'Acoustic booths for open offices' },
    { id: 't', kind: 'text', text: 'Our booths cut the noise of a busy floor by half.\n\nEach one seats two.' },
    { id: 'p', kind: 'picture', picture: { file: 'booths', alt: 'Two grey acoustic booths in an open office' } },
    { id: 'b', kind: 'button', label: 'See them at our open day', link: { kind: 'page', key: '7' } },
    { id: 'b2', kind: 'button', label: 'Our spring offer', link: { kind: 'page', key: '9' } },
    { id: 'c', kind: 'columns', columns: [{ heading: 'What fits where', text: 'Single booths for calls.' }, { text: 'A floor sketch.', picture: { file: 'sketch', decorative: true } }] },
    { id: 's', kind: 'spacer', size: 'm' },
    { id: 'f', kind: 'features', items: [{ icon: 'volume-x', heading: 'Quiet inside', text: 'Talk at a normal voice.' }, { icon: 'wind', heading: 'Air that moves', text: 'A silent fan.' }] },
    { id: 'q', kind: 'quote', text: 'We hear ourselves think again.', who: 'Ana, office manager' },
    { id: 'qa', kind: 'questions', title: 'Questions and answers', items: [{ question: 'How long does fitting take?', answer: 'One day for up to four booths.' }] },
    { id: 'go', kind: 'button', label: 'Book a visit', link: { kind: 'form' } },
    { id: 'form', kind: 'form', addOn: 'forms', form: '12' },
  ],
};

function livePage(patch: Partial<Extract<XLandingPage, { state: 'live' }>> = {}): XLandingPage {
  return {
    state: 'live',
    business: BUSINESS,
    accent: 'teal',
    key: '5',
    language: 'en-US',
    dir: 'ltr',
    page: BOOTHS,
    forms: { forms: { '12': { slug: 'showroom-visit', form: { kind: 'form', language: 'en-US', languages: ['en-US'], definition: VISIT, anonymous: false }, today: '2026-11-18' } } },
    pictures: { booths: '/x/pages/api/acoustic-booths/pictures/booths', sketch: '/x/pages/api/acoustic-booths/pictures/sketch' },
    links: { '7': '/x/pages/open-day', '9': null },
    ...patch,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

let pages: Record<string, XLandingPage>;
let formReply: { status: number; body: unknown } | 'offline';
let answerReply: { status: number; body: unknown } | 'offline';
let calls: Call[];
/** The block watchers the page made, to bring a block near the screen by hand. */
let watchers: { callback: IntersectionObserverCallback; targets: Element[]; options: IntersectionObserverInit | undefined }[];

class FakeWatcher {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    watchers.push({ callback, targets: this.targets, options });
  }
  targets: Element[] = [];
  observe(target: Element): void {
    this.targets.push(target);
  }
  disconnect(): void {
    this.targets.length = 0;
  }
}

const near = async (): Promise<void> => {
  await act(async () => {
    for (const one of watchers) if (one.targets.length > 0) one.callback(one.targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry), {} as IntersectionObserver);
  });
};

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, credentials: init.credentials });
      const path = url.split('?')[0]!;
      if (path === '/x/consent/visit') return new Response(JSON.stringify({ state: 'yes' }), { status: 200 });
      if (path.startsWith('/x/forms/api/')) {
        if (path.endsWith('/challenge')) return new Response(JSON.stringify({ id: 'eyJ2IjoxfQ~sig', salt: 'salt', difficulty: 1, expiresAt: Date.now() + 60_000 }), { status: 200 });
        const reply = path.endsWith('/answers') ? answerReply : formReply;
        if (reply === 'offline') throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }
      const slug = path.split('/').pop()!;
      const page = pages[slug];
      if (page === undefined || page.state === 'unavailable') return new Response(JSON.stringify({ state: 'unavailable', business: BUSINESS, accent: 'teal' }), { status: 404 });
      return new Response(JSON.stringify(page), { status: 200 });
    }),
  );
}

async function show(address: string, tag = 'en-US', strict = false): Promise<void> {
  const [path = '', search = ''] = address.split('?');
  const route = routeOf(path, search === '' ? '' : `?${search}`);
  if (route.kind !== 'page') throw new Error(`${address} is not a landing page`);
  const language = languageOfTag(tag);
  applyDirection(language);
  const i18n = await initXWords(language.id);
  await act(async () => {
    const app = (
      <I18nProvider i18n={i18n}>
        <LandingApp route={route} />
      </I18nProvider>
    );
    render(strict ? <StrictMode>{app}</StrictMode> : app);
  });
}

const formCalls = () => calls.filter((call) => call.url.startsWith('/x/forms/api/showroom-visit') && !call.url.includes('/challenge'));

beforeEach(() => {
  pages = { 'acoustic-booths': livePage() };
  calls = [];
  watchers = [];
  formReply = { status: 200, body: { state: 'live', business: BUSINESS, accent: 'teal', today: '2026-11-18', form: { kind: 'form', language: 'en-US', languages: ['en-US'], definition: VISIT, anonymous: false } } };
  answerReply = { status: 200, body: { state: 'sent' } };
  window.localStorage.clear();
  vi.stubGlobal('IntersectionObserver', FakeWatcher);
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  delete document.documentElement.dataset['accent'];
});

describe('the address', () => {
  it('reads a landing page, never in a frame, with a preview naming its row', () => {
    expect(routeOf('/x/pages/acoustic-booths', '')).toMatchObject({ kind: 'page', slug: 'acoustic-booths', frame: false });
    expect(routeOf('/x/pages/acoustic-booths', '?frame=1')).toMatchObject({ kind: 'page', frame: false });
    expect(routeOf('/x/pages/acoustic-booths', '?preview=1&page=5')).toMatchObject({ kind: 'page', preview: { page: '5' } });
    expect(routeOf('/x/pages/acoustic-booths', '?preview=yes')).not.toHaveProperty('preview');
    expect(routeOf('/x/pages/api', '').kind).toBe('none');
    expect(routeOf('/x/pages/a/b', '').kind).toBe('none');
  });
});

describe('a live landing page', () => {
  it('draws every block, one h1, the shell round it, in the page language and light', async () => {
    await show('/x/pages/acoustic-booths');
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acoustic booths for open offices');
    // Block titles, feature items (no block title) and the form's title are h2.
    expect(screen.getAllByRole('heading', { level: 2 }).map((one) => one.textContent)).toEqual(['What fits where', 'Quiet inside', 'Air that moves', 'Questions and answers', 'Book a showroom visit']);
    expect(screen.getAllByText(/Our booths cut the noise|Each one seats two/)).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Two grey acoustic booths in an open office' }).getAttribute('src')).toBe('/x/pages/api/acoustic-booths/pictures/booths');
    // A decorative picture is drawn with no words.
    expect(document.querySelector('img[src$="/sketch"]')!.getAttribute('alt')).toBe('');
    expect(screen.getByRole('link', { name: 'See them at our open day' }).getAttribute('href')).toBe('/x/pages/open-day');
    // A page that is not live: its button goes nowhere, so it is left out.
    expect(screen.queryByText('Our spring offer')).toBeNull();
    expect(screen.getByRole('link', { name: 'Book a visit' }).getAttribute('href')).toBe('#lp-form-form');
    expect(screen.getByText('We hear ourselves think again.').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('How long does fitting take?').closest('details')).not.toBeNull();
    expect(document.querySelectorAll('.lp-feature-icon svg')).toHaveLength(2);
    // The shell: the business, the footer with the privacy notice; no language menu, no Cookie choice at Counts only.
    expect(screen.getByRole('banner').textContent).toContain('Meridian');
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Privacy notice' }).getAttribute('href')).toBe(BUSINESS.privacyNotice);
    expect(screen.queryByRole('button', { name: /Language/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cookie choice' })).toBeNull();
    expect(document.title).toBe('Acoustic booths for open offices');
    expect(document.documentElement.dataset['accent']).toBe('teal');
    const root = document.querySelector('.lp')!;
    expect(root.getAttribute('lang')).toBe('en-US');
    expect(root.getAttribute('data-mode')).toBe('stranger');
  });

  it('asks while it loads, and says so once', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => (await held, real(input, init))));
    await show('/x/pages/acoustic-booths');
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Loading the page…').getAttribute('role')).toBe('status');
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    await act(async () => release());
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.queryByText('Loading the page…')).toBeNull();
  });

  it('a page that is not there is not available, with where to write', async () => {
    await show('/x/pages/nothing-here');
    expect(await screen.findByRole('heading', { level: 1, name: 'This page isn’t available.' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('link', { name: /hello@meridian.example/ }).getAttribute('href')).toBe('mailto:hello@meridian.example');
    expect(document.querySelector('.lp')).toBeNull();
  });

  it('a page that cannot be reached says so, and tries again', async () => {
    const real = globalThis.fetch;
    let down = true;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => (down ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init))));
    await show('/x/pages/acoustic-booths');
    expect(await screen.findByRole('heading', { level: 1, name: 'This page could not be reached.' })).toBeTruthy();
    down = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acoustic booths for open offices' })).toBeTruthy();
  });

  it('a picture that does not load draws a quiet box with its description', async () => {
    await show('/x/pages/acoustic-booths');
    const picture = await screen.findByRole('img', { name: 'Two grey acoustic booths in an open office' });
    await act(async () => {
      picture.dispatchEvent(new Event('error'));
    });
    const box = screen.getByRole('img', { name: 'Two grey acoustic booths in an open office' });
    expect(box.tagName).toBe('DIV');
    expect(box.classList.contains('lp-picture-empty')).toBe(true);
    expect(box.textContent).toBe('Two grey acoustic booths in an open office');
    // A decorative one that fails is a box with no words, hidden from screen readers.
    await act(async () => {
      document.querySelector('img[src$="/sketch"]')!.dispatchEvent(new Event('error'));
    });
    expect(document.querySelectorAll('.lp-picture-empty[aria-hidden="true"]')).toHaveLength(1);
  });

  it('right to left in Arabic: the page, the document and the engine words', async () => {
    pages['acoustic-booths'] = livePage({ language: 'ar-EG', dir: 'rtl', page: { ...BOOTHS, title: 'كبائن هادئة', blocks: [{ id: 'h', kind: 'heading', text: 'كبائن هادئة للمكاتب المفتوحة' }] }, forms: {} });
    await show('/x/pages/acoustic-booths', 'en-US');
    expect(await screen.findByRole('heading', { level: 1, name: 'كبائن هادئة للمكاتب المفتوحة' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar-EG');
    expect(document.querySelector('.lp')!.getAttribute('dir')).toBe('rtl');
    await waitFor(() => expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'إشعار الخصوصية' })).toBeTruthy());
  });
});

describe('a Form block', () => {
  it('a form not live, or not in the page language, is left out: no band, and no button to it', async () => {
    pages['acoustic-booths'] = livePage({ forms: { forms: { '12': null } } });
    await show('/x/pages/acoustic-booths');
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.lp-form')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Book a showroom visit' })).toBeNull();
    expect(screen.queryByText('Book a visit')).toBeNull();
    await near();
    expect(formCalls()).toEqual([]);
  });

  it('asks the forms door once, with the page key, only as it nears the screen', async () => {
    await show('/x/pages/acoustic-booths');
    await screen.findByRole('heading', { name: 'Book a showroom visit', level: 2 });
    expect(formCalls()).toEqual([]);
    expect(watchers.some((one) => (one.options?.rootMargin ?? '') !== '')).toBe(true);
    await near();
    await near();
    expect(formCalls().map((call) => call.url)).toEqual(['/x/forms/api/showroom-visit?lang=en-US&on=5']);
    // The page's own host: its cookies go (Per visitor), as on a form's own page.
    expect(formCalls()[0]!.credentials).toBe('same-origin');
  });

  it('a browser with no way to watch the screen asks at once, and still once, however often the block is drawn', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await show('/x/pages/acoustic-booths', 'en-US', true);
    await screen.findAllByRole('heading', { name: 'Book a showroom visit', level: 2 });
    await waitFor(() => expect(formCalls()).toHaveLength(1));
    expect(formCalls()[0]!.url).toBe('/x/forms/api/showroom-visit?lang=en-US&on=5');
  });

  it('sends with the page key, and says Sent inside the page, focused, as tall as the form was', async () => {
    const user = userEvent.setup();
    await show('/x/pages/acoustic-booths?utm=spring');
    await screen.findByRole('heading', { name: 'Book a showroom visit', level: 2 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 480 } as DOMRect);
    await user.type(screen.getByLabelText(/Your name/), 'Marta Kovac');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobalt.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const sent = await screen.findByRole('heading', { level: 2, name: 'Thanks, Marta.' });
    await waitFor(() => expect(document.activeElement).toBe(sent));
    expect(screen.getByText("We'll confirm your time within one working day.")).toBeTruthy();
    expect((sent.closest('.xp-ending') as HTMLElement).style.getPropertyValue('--xp-form-height')).toBe('480px');
    // Still one page: its h1, and the rest of it, stay.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const answer = calls.find((call) => call.url.includes('/answers'))!;
    expect(answer.url).toBe('/x/forms/api/showroom-visit/answers?on=5');
    expect(answer.body).toMatchObject({ language: 'en-US', values: { qname: 'Marta Kovac', qemail: 'marta@cobalt.example' } });
  });

  it('a form closed meanwhile shows closed when it nears the screen', async () => {
    formReply = { status: 200, body: { state: 'closed', business: BUSINESS, accent: 'teal' } };
    await show('/x/pages/acoustic-booths');
    await screen.findByRole('heading', { name: 'Book a showroom visit', level: 2 });
    await near();
    expect(await screen.findByRole('heading', { level: 2, name: 'This form is closed.' })).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 2, name: 'This form is closed.' }));
  });

  it('a form gone meanwhile leaves the page', async () => {
    formReply = { status: 404, body: { state: 'unavailable', business: BUSINESS, accent: 'teal' } };
    await show('/x/pages/acoustic-booths');
    await screen.findByRole('heading', { name: 'Book a showroom visit', level: 2 });
    await near();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Book a showroom visit' })).toBeNull());
  });

  it('too many sends: an ending of the block, with where to write', async () => {
    const user = userEvent.setup();
    answerReply = { status: 429, body: { state: 'too-many', retryAfter: 3600 } };
    await show('/x/pages/acoustic-booths');
    await user.type(await screen.findByLabelText(/Your name/), 'Marta');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobalt.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Too many sends from here.' });
    const card = title.closest('.xp-ending') as HTMLElement;
    expect(card.textContent).toContain('Please try again in 1 hour, or write to hello@meridian.example.');
    expect(within(card).getByRole('link', { name: 'hello@meridian.example' }).getAttribute('href')).toBe('mailto:hello@meridian.example');
    expect(document.querySelector('[role="status"][aria-live="polite"]')!.textContent).toContain('Too many sends from here.');
  });

  it('not reached: says so, and "Try again" brings the form back with its answers', async () => {
    const user = userEvent.setup();
    answerReply = 'offline';
    await show('/x/pages/acoustic-booths');
    await user.type(await screen.findByLabelText(/Your name/), 'Marta');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobalt.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'This page could not be reached.' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe('Marta');
    answerReply = { status: 200, body: { state: 'sent' } };
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Thanks, Marta.' })).toBeTruthy();
  });

  it('two forms on one page keep their own control ids', async () => {
    pages['acoustic-booths'] = livePage({ page: { ...BOOTHS, blocks: [...BOOTHS.blocks, { id: 'again', kind: 'form', addOn: 'forms', form: '12' }] } });
    await show('/x/pages/acoustic-booths');
    await screen.findAllByRole('heading', { name: 'Book a showroom visit' });
    expect(screen.getAllByLabelText(/Your name/).map((one) => one.id)).toEqual(['x-q-form-qname', 'x-q-again-qname']);
    expect(new Set([...document.querySelectorAll('[id]')].map((one) => one.id)).size).toBe(document.querySelectorAll('[id]').length);
  });

  it('a preview asks nothing as it nears the screen and sends nothing', async () => {
    pages['acoustic-booths'] = livePage({ preview: true });
    await show('/x/pages/acoustic-booths?preview=1&page=5');
    await screen.findByRole('heading', { name: 'Book a showroom visit', level: 2 });
    expect(calls[0]!.url).toBe('/x/pages/api/acoustic-booths?preview=1&page=5');
    await near();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
    expect(formCalls()).toEqual([]);
    expect(screen.getByText('Nothing is sent from here.')).toBeTruthy();
  });
});

describe('the visitor banner on a landing page', () => {
  const visitor = { banner: { language: 'en-US', title: 'Can we remember your visit?', text: 'If you say yes, we remember which of our pages you look at.', yes: 'Yes', no: 'No', version: 'w-1' }, said: null };

  it('at Per visitor: docked as on a form page, with Cookie choice in the footer; nothing stored before an answer', async () => {
    pages['acoustic-booths'] = livePage({ visitor });
    await show('/x/pages/acoustic-booths');
    const banner = await screen.findByRole('region', { name: 'Can we remember your visit?' });
    expect(banner).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.x-page')!.hasAttribute('data-docked')).toBe(true));
    expect(window.localStorage.length).toBe(0);
    await userEvent.setup().click(within(banner).getByRole('button', { name: 'No' }));
    expect(await screen.findByText('Saved: no. Change it any time under Cookie choice.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cookie choice' }));
    const title = await screen.findByRole('heading', { name: 'Can we remember your visit?' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('never in a preview, even when told', async () => {
    pages['acoustic-booths'] = livePage({ visitor, preview: true });
    await show('/x/pages/acoustic-booths?preview=1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Can we remember your visit?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cookie choice' })).toBeNull();
  });
});
