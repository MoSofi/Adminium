// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page a stranger sees for a form or a survey, against a pretend server:
 * every question kind with its label wired, "show if" live, the summary and
 * focus after a Send, the endings, right to left, the language menu, and a
 * frame's height going only to the website the owner listed.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@adminium/i18n/react';
import type { FormDefinition } from '@adminium/add-on-contracts/forms';

import type { XPage } from './api.js';
import { HEIGHT, HELLO, READY } from './frame.js';
import { routeOf } from './route.js';
import { initXWords, languageOfTag } from './words.js';
import { applyDirection, monogram, XApp } from './XApp.js';

const BUSINESS = { name: 'Meridian', legalName: 'Meridian Workplace Ltd', email: 'hello@meridian.example', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false };

const SHOWROOM: FormDefinition = {
  v: 1,
  kind: 'form',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: { 'en-US': 'Book a showroom visit' },
  intro: { 'en-US': 'See the new booths.' },
  sections: [{ id: 'sfiles', title: { 'en-US': 'Your space' } }],
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, maxLength: 200, label: { 'en-US': 'Your name' } },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, maxLength: 200, label: { 'en-US': 'Work e-mail' } },
    { id: 'qday', kind: 'date', from: 'tomorrow', required: false, label: { 'en-US': 'Which day suits you?' } },
    { id: 'qcount', kind: 'number', min: 1, max: 20, whole: true, required: false, label: { 'en-US': 'How many of you?' } },
    {
      id: 'qsee',
      kind: 'several',
      required: false,
      label: { 'en-US': 'What would you like to see?' },
      choices: [
        { id: 'booths', label: { 'en-US': 'Acoustic booths' } },
        { id: 'seating', label: { 'en-US': 'Seating' } },
      ],
    },
    { id: 'qseats', kind: 'number', required: false, label: { 'en-US': 'Roughly how many seats?' }, showIf: { question: 'qsee', includes: 'seating' } },
    {
      id: 'qtopic',
      kind: 'one',
      required: false,
      label: { 'en-US': 'What is it for?' },
      choices: [
        { id: 'office', label: { 'en-US': 'An office' } },
        { id: 'home', label: { 'en-US': 'A home' } },
      ],
    },
    { id: 'qnote', kind: 'long', required: false, maxLength: 2000, label: { 'en-US': 'Anything else?' }, help: { 'en-US': 'A line or two is plenty.' } },
    { id: 'qfrom', kind: 'hidden', param: 'from', required: false, label: { 'en-US': 'Source' } },
    { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 2, wordingChangedAt: '2026-10-01', confirm: true, required: false, label: { 'en-US': "Send me Meridian's newsletter." } },
    { id: 'qfiles', kind: 'file', section: 'sfiles', maxMb: 10, kinds: ['pdf', 'jpg', 'png'], many: true, required: false, label: { 'en-US': 'Drawings of your space' } },
  ],
  ending: { kind: 'words', words: { 'en-US': "We'll confirm your visit within one working day." } },
};

const SURVEY: FormDefinition = {
  v: 1,
  kind: 'survey',
  languages: ['en-US', 'ar-EG'],
  defaultLanguage: 'en-US',
  title: { 'en-US': 'How did your fit-out go?' },
  questions: [
    { id: 'qnps', kind: 'score', recommend: true, required: true, label: { 'en-US': 'How likely are you to recommend Meridian?' } },
    { id: 'qday', kind: 'stars', required: false, label: { 'en-US': 'How was the install day?' } },
    { id: 'qdiff', kind: 'long', required: false, maxLength: 2000, label: { 'en-US': 'Anything we should do differently?' } },
  ],
  ending: { kind: 'words', words: { 'en-US': 'We read every answer.' } },
};

function live(definition: FormDefinition, patch: Partial<Extract<XPage, { state: 'live' }>> = {}, anonymous = false): XPage {
  return {
    state: 'live',
    business: BUSINESS,
    accent: 'teal',
    today: '2026-11-01',
    form: { kind: definition.kind, language: definition.defaultLanguage, languages: definition.languages, definition, anonymous },
    ...patch,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let pages: Record<string, XPage | (() => XPage)>;
let answerReply: { status: number; body: unknown; headers?: Record<string, string> };
let calls: Call[];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, headers: (init.headers ?? {}) as Record<string, string> });
      const path = url.split('?')[0]!;
      if (path.endsWith('/challenge')) return new Response(JSON.stringify({ id: 'eyJ2IjoxfQ~sig', salt: 'salt', difficulty: 1, expiresAt: Date.now() + 60_000 }), { status: 200 });
      if (path.endsWith('/answers') && method === 'POST') return new Response(JSON.stringify(answerReply.body), { status: answerReply.status, headers: answerReply.headers ?? {} });
      const slug = path.split('/').pop()!;
      const found = pages[slug];
      const page = typeof found === 'function' ? found() : found;
      if (page === undefined) return new Response(JSON.stringify({ state: 'unavailable', business: BUSINESS, accent: 'teal' }), { status: 404 });
      return new Response(JSON.stringify(page), { status: page.state === 'unavailable' ? 404 : 200 });
    }),
  );
}

async function show(address: string, tag = 'en-US'): Promise<void> {
  const [path = '', search = ''] = address.split('?');
  const language = languageOfTag(tag);
  applyDirection(language);
  const i18n = await initXWords(language.id);
  await act(async () => {
    render(
      <I18nProvider i18n={i18n}>
        <XApp route={routeOf(path, search === '' ? '' : `?${search}`)} />
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  pages = {};
  calls = [];
  answerReply = { status: 200, body: { state: 'sent' } };
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  delete document.documentElement.dataset['accent'];
});

describe('a form a stranger fills', () => {
  it('draws every kind of question with its label wired, and never a hidden field', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    await show('/x/forms/showroom-visit');
    expect(await screen.findByRole('heading', { level: 1, name: 'Book a showroom visit' })).toBeTruthy();
    expect(screen.getByLabelText(/Your name/)).toHaveProperty('type', 'text');
    expect(screen.getByLabelText(/Work e-mail/)).toHaveProperty('type', 'email');
    const day = screen.getByLabelText(/Which day suits you/) as HTMLInputElement;
    expect(day.type).toBe('date');
    // From tomorrow, counted in the business's days.
    expect(day.min).toBe('2026-11-02');
    expect(screen.getByLabelText(/How many of you/).getAttribute('dir')).toBe('ltr');
    const see = screen.getByRole('group', { name: /What would you like to see/ });
    expect(within(see).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: /What is it for/ })).getAllByRole('radio')).toHaveLength(2);
    const note = screen.getByLabelText(/Anything else/);
    expect(note.getAttribute('aria-describedby')).toBe(screen.getByText('A line or two is plenty.').id);
    expect(screen.getByRole('checkbox', { name: "Send me Meridian's newsletter." })).toHaveProperty('checked', false);
    // The file control is drawn, named with its question, and takes nothing until the file door is open.
    const choose = screen.getByRole('button', { name: /Drawings of your space.*Choose files/ });
    expect(choose).toHaveProperty('disabled', true);
    expect(screen.getByText('PDF, JPG, or PNG, up to 10 MB')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Your space' })).toBeTruthy();
    expect(screen.queryByText('Source')).toBeNull();
    // Required and Optional beside each label; the tick has neither.
    expect(screen.getAllByText('Required')).toHaveLength(2);
    // The business, never the software.
    expect(document.body.textContent).not.toMatch(/adminium/i);
    expect(document.title).toBe('Meridian');
    expect(document.documentElement.dataset['accent']).toBe('teal');
    expect(screen.getByText('Meridian Workplace Ltd')).toBeTruthy();
  });

  it('shows a question when its "show if" holds, and sends nothing of one that is not shown', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    const user = userEvent.setup();
    await show('/x/forms/showroom-visit?from=flyer&utm=x');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByLabelText(/Roughly how many seats/)).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Seating' }));
    const seats = screen.getByLabelText(/Roughly how many seats/);
    await user.type(seats, '40');
    await user.click(screen.getByRole('checkbox', { name: 'Seating' }));
    expect(screen.queryByLabelText(/Roughly how many seats/)).toBeNull();
    await user.type(screen.getByLabelText(/Your name/), 'Marta Kovac');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobaltlegal.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const sent = await waitFor(() => calls.find((call) => call.method === 'POST')!);
    expect(sent.body).toEqual({ language: 'en-US', values: { qname: 'Marta Kovac', qemail: 'marta@cobaltlegal.example' }, query: { from: 'flyer' }, website: '' });
    expect(sent.headers['x-adminium-proof']).toMatch(/^eyJ2IjoxfQ~sig\.[0-9a-z]+$/);
  });

  it('marks what to fix after Send, says so over the button, and moves focus to the first one', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    const user = userEvent.setup();
    await show('/x/forms/showroom-visit');
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Work e-mail/), 'not-an-address');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const name = screen.getByLabelText(/Your name/);
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(screen.getAllByText('Check the answers marked below.').length).toBeGreaterThan(0);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('Enter your name');
    expect(screen.getByText('Enter an e-mail address like name@company.com')).toBeTruthy();
    // Nothing went to the server.
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    // Fixed as it is typed.
    await user.type(name, 'Marta');
    expect(name.getAttribute('aria-invalid')).toBeNull();
  });

  it('sends, then says thanks by first name, the owner’s ending, and the e-mail step only when the tick was ticked', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    const user = userEvent.setup();
    await show('/x/forms/showroom-visit');
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Your name/), 'Marta Kovac');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobaltlegal.example');
    await user.click(screen.getByRole('checkbox', { name: "Send me Meridian's newsletter." }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Thanks, Marta.' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText("We'll confirm your visit within one working day.")).toBeTruthy();
    expect(screen.getByText('One more step for the newsletter: check your e-mail and press Confirm.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Thanks, Marta.');
  });

  it('never says the e-mail step when the box was left empty', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    const user = userEvent.setup();
    await show('/x/forms/showroom-visit');
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Your name/), 'Marta');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobaltlegal.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('heading', { level: 1, name: 'Thanks, Marta.' });
    expect(screen.queryByText(/check your e-mail/)).toBeNull();
  });

  it('keeps the answers and says when to try again after too many sends', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    answerReply = { status: 429, body: { state: 'too-many', retryAfter: 600 } };
    const user = userEvent.setup();
    await show('/x/forms/showroom-visit');
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Your name/), 'Marta');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobaltlegal.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Too many sends from here. Please try again in 10 minutes, or write to hello@meridian.example.');
    expect(screen.getByLabelText(/Your name/)).toHaveProperty('value', 'Marta');
  });

  it('marks what the server refused, and moves focus there', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    answerReply = { status: 400, body: { state: 'refused', errors: { qemail: 'email' } } };
    const user = userEvent.setup();
    await show('/x/forms/showroom-visit');
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Your name/), 'Marta');
    await user.type(screen.getByLabelText(/Work e-mail/), 'marta@cobaltlegal.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const email = screen.getByLabelText(/Work e-mail/);
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });

  it('a closed form says so with the business’s address; one that is not there says it is not available', async () => {
    pages['old-offer'] = { state: 'closed', business: BUSINESS, accent: 'teal' };
    await show('/x/forms/old-offer');
    expect(await screen.findByRole('heading', { level: 1, name: 'This form is closed.' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'hello@meridian.example' })).toBeTruthy();
    cleanup();
    await show('/x/forms/no-such-form');
    expect(await screen.findByRole('heading', { level: 1, name: 'This page isn’t available.' })).toBeTruthy();
    // Focus is never moved on load.
    expect(document.activeElement).toBe(document.body);
  });

  it('a survey link with a token says it does not work until the survey door takes one', async () => {
    pages['fit-out'] = live(SURVEY);
    await show('/x/forms/fit-out?t=abcdef');
    expect(await screen.findByRole('heading', { level: 1, name: 'This link doesn’t work.' })).toBeTruthy();
    expect(screen.getByText('Write to hello@meridian.example.')).toBeTruthy();
  });
});

describe('a survey', () => {
  it('draws the score as a radio group with one tab stop, moved by the arrows, Home and End, and its ends in its description', async () => {
    pages['fit-out'] = live(SURVEY, {}, true);
    const user = userEvent.setup();
    await show('/x/forms/fit-out');
    const group = await screen.findByRole('radiogroup', { name: /How likely are you to recommend Meridian/ });
    const chips = within(group).getAllByRole('radio');
    expect(chips).toHaveLength(11);
    expect(chips.filter((chip) => chip.tabIndex === 0)).toHaveLength(1);
    expect(document.getElementById(group.getAttribute('aria-describedby')!.split(' ')[0]!)!.textContent).toBe('0 is not likely, 10 is very likely.');
    await user.click(chips[7]!);
    expect(chips[7]!.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(chips[8]);
    expect(chips[8]!.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(chips[10]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(chips[0]);
    expect(screen.getByText('Your answers are not linked to your name.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send answers' })).toBeTruthy();
  });

  it('draws five star buttons, 44 by 44, each named, with the pick said beside them', async () => {
    pages['fit-out'] = live(SURVEY);
    const user = userEvent.setup();
    await show('/x/forms/fit-out');
    const stars = within(await screen.findByRole('radiogroup', { name: /How was the install day/ })).getAllByRole('radio');
    expect(stars.map((star) => star.getAttribute('aria-label'))).toEqual(['1 star', '2 stars', '3 stars', '4 stars', '5 stars']);
    expect(stars.every((star) => star.classList.contains('x-star'))).toBe(true);
    await user.click(stars[2]!);
    expect(screen.getByText('3 of 5')).toBeTruthy();
  });

  it('thanks an anonymous survey by no name', async () => {
    pages['fit-out'] = live(SURVEY, {}, true);
    const user = userEvent.setup();
    await show('/x/forms/fit-out');
    await user.click(within(await screen.findByRole('radiogroup', { name: /recommend/ })).getAllByRole('radio')[9]!);
    await user.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Thank you.' })).toBeTruthy();
    expect(screen.getByText('Your answers help us.')).toBeTruthy();
    expect(screen.getByText('We read every answer.')).toBeTruthy();
  });

  it('right to left in Arabic: the page’s direction, its words, and the arrows flipped', async () => {
    pages['fit-out'] = live({ ...SURVEY, defaultLanguage: 'ar-EG', title: { 'ar-EG': 'كيف كان تجهيز مكتبك؟' }, questions: SURVEY.questions.map((q) => ({ ...q, label: { 'ar-EG': `${q.label['en-US']!} (AR)` } })) as FormDefinition['questions'], ending: { kind: 'words', words: { 'ar-EG': 'شكرًا' } } });
    const user = userEvent.setup();
    await show('/x/forms/fit-out', 'ar-EG');
    const group = await screen.findByRole('radiogroup', { name: /recommend/ });
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('button', { name: 'إرسال الإجابات' })).toBeTruthy();
    const chips = within(group).getAllByRole('radio');
    await user.click(chips[5]!);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(chips[6]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(chips[5]);
  });
});

describe('the language menu', () => {
  it('lists the form’s languages, each in itself, ticked, and moves by keys', async () => {
    pages['fit-out'] = () => live(SURVEY);
    const user = userEvent.setup();
    await show('/x/forms/fit-out');
    await screen.findByRole('radiogroup', { name: /recommend/ });
    const button = screen.getByRole('button', { name: 'Language: English' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(button);
    const items = within(screen.getByRole('menu', { name: 'Language' })).getAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('lang'), item.getAttribute('dir')])).toEqual([
      ['English', 'en-US', 'ltr'],
      ['العربية', 'ar-EG', 'rtl'],
    ]);
    expect(document.activeElement).toBe(items[0]);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('a form in one language has no menu', async () => {
    pages['showroom-visit'] = live(SHOWROOM);
    await show('/x/forms/showroom-visit');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /Language/ })).toBeNull();
  });
});

describe('in a website’s frame', () => {
  it('draws no header, footer or menu, and sends its height only to the website that said hello from its parent', async () => {
    pages['showroom-visit'] = live(SHOWROOM, { frameOrigins: ['https://shop.example'] });
    const posted: { message: unknown; origin: string }[] = [];
    const parent = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
    // A page with a height from the start: nothing of it goes anywhere before a listed website says hello.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 640 } as DOMRect);
    await show('/x/forms/showroom-visit?frame=1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    // Typed into before any hello: the page changes, and still nothing of it goes anywhere.
    await userEvent.setup().type(screen.getByLabelText(/Your name/), 'M');
    // Ready, with nothing in it, to any parent.
    expect(posted).toEqual([{ message: { type: READY }, origin: '*' }]);
    // A hello from another website, and one from another window, are not taken.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: HELLO }, origin: 'https://evil.example', source: parent as unknown as Window }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: HELLO }, origin: 'https://shop.example', source: window }));
    });
    expect(posted.filter((one) => (one.message as { type: string }).type === HEIGHT)).toEqual([]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 812 } as DOMRect);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: HELLO }, origin: 'https://shop.example', source: parent as unknown as Window }));
    });
    expect(posted.at(-1)).toEqual({ message: { type: HEIGHT, h: 812 }, origin: 'https://shop.example' });
    // An error shown changes the height: sent again, to the same origin only.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 900 } as DOMRect);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posted.at(-1)).toEqual({ message: { type: HEIGHT, h: 900 }, origin: 'https://shop.example' }));
    expect(new Set(posted.filter((one) => (one.message as { type: string }).type === HEIGHT).map((one) => one.origin))).toEqual(new Set(['https://shop.example']));
  });
});

describe('the business’s initial', () => {
  it('is the first mark of its first two words', () => {
    expect(monogram('Meridian Workplace Ltd')).toBe('MW');
    expect(monogram('  ')).toBe('');
  });
});
