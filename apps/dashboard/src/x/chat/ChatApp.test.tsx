// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A live chat's window, against a pretend door: every state the visitor's
 * comp draws, by its words and roles.
 *
 * - nothing at all while the chat is not available;
 * - the launcher, its new-message pill and count;
 * - the first line, A, B or C, as is true now (never A outside hours);
 * - the first message's check, and its failure; a message not sent, one
 *   waiting for the door, a tripped cap by which cap, one too long;
 * - automatic answers marked, in another language when they are, with
 *   "Talk to a person" under the latest; the hand-over card and its checks;
 *   a person's reply under their first name; closed, reopened, and a new chat;
 * - coming back on another page, and an earlier chat the door lost;
 * - outside hours, the question card, with and without e-mail; the hours
 *   ending in a chat; still waiting;
 * - the language button, right to left, dark, the phone sheet, a preview.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@adminium/i18n/react';

import { applyDirection } from '../XApp.js';
import { initXWords, languageOfTag } from '../words.js';
import { ChatOffline, type ChatConfig, type ChatDoorClient, type ChatHours, type ChatMessage, type ChatRefusal, type ChatState } from './api.js';
import { ChatApp } from './ChatApp.js';
import { clockOf } from './say.js';
import { firstLineOf, WAITING_LONG_MS } from './ChatWindow.js';
import { pollEvery } from './session.js';

/** The few DOM checks these tests read as words (the suite carries no DOM matcher library). */
interface DomMatchers<R = unknown> {
  toBeInTheDocument(): R;
  toHaveAttribute(name: string, value?: string): R;
  toHaveTextContent(text: string | RegExp): R;
  toHaveFocus(): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toHaveValue(value: string): R;
  toHaveClass(name: string): R;
}
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the matchers above, on every assertion
  interface Assertion<T> extends DomMatchers<T> {}
}
const textOf = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
expect.extend({
  toBeInTheDocument: (element: Element | null) => ({ pass: element !== null && element.ownerDocument.contains(element), message: () => 'expected the element in the document' }),
  toHaveAttribute: (element: Element, name: string, value?: string) => ({
    pass: element.hasAttribute(name) && (value === undefined || element.getAttribute(name) === value),
    message: () => `expected ${name}=${String(value)}, got ${String(element.getAttribute(name))}`,
  }),
  toHaveTextContent: (element: Element, text: string | RegExp) => ({
    pass: typeof text === 'string' ? textOf(element).includes(text.replace(/\s+/g, ' ').trim()) : text.test(textOf(element)),
    message: () => `expected text ${String(text)}, got "${textOf(element)}"`,
  }),
  toHaveFocus: (element: Element) => ({ pass: element.ownerDocument.activeElement === element, message: () => 'expected the element to have focus' }),
  toBeDisabled: (element: Element) => ({ pass: (element as HTMLButtonElement).disabled === true, message: () => 'expected the control disabled' }),
  toBeEnabled: (element: Element) => ({ pass: (element as HTMLButtonElement).disabled !== true, message: () => 'expected the control enabled' }),
  toHaveValue: (element: Element, value: string) => ({ pass: (element as HTMLInputElement).value === value, message: () => `expected value ${value}, got ${(element as HTMLInputElement).value}` }),
  toHaveClass: (element: Element, name: string) => ({ pass: element.classList.contains(name), message: () => `expected class ${name}` }),
});

const BUSINESS = { name: 'Meridian', legalName: 'Meridian Workplace Ltd', email: 'hello@meridian.example', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false };
const OPEN: ChatHours = { open: true, closesAt: '2026-07-28T16:30:00.000Z', nextOpen: null };
const CLOSED: ChatHours = { open: false, closesAt: null, nextOpen: { at: '2026-07-29T08:00:00.000Z', date: '2026-07-29', time: '09:00', day: 'tomorrow' } };
const A4 = 'Yes, we can clear and recycle your old furniture as part of the job.';
const A2 = 'Yes: Leeds, Monday to Friday 9:00–17:30. Book a time here: https://crm.meridian.example/x/forms/showroom-visit';

function config(patch: Partial<ChatConfig> = {}): ChatConfig {
  return {
    state: 'live',
    business: BUSINESS,
    accent: 'teal',
    language: 'en-US',
    languages: ['en-US'],
    defaultLanguage: 'en-US',
    theme: 'light',
    timeZone: 'Europe/London',
    welcome: null,
    outsideWords: null,
    automatic: true,
    miloDrafts: false,
    aiService: 'Anthropic',
    mail: true,
    ...OPEN,
    ...patch,
  };
}

/** A local time today, as a message's ISO stamp. */
const at = (hour: number, minute: number): string => new Date(2026, 6, 28, hour, minute).toISOString();

type Reply<T> = T | ChatRefusal;

/** A chat door that keeps one conversation in memory, and says what the test tells it to. */
class FakeDoor implements ChatDoorClient {
  reply: ChatConfig | null = config();
  calls: string[] = [];
  messages: ChatMessage[] = [];
  state: ChatState = 'bot';
  hours: ChatHours = OPEN;
  seq = 10;
  /** How many first tries the human check fails. */
  proofFails = 0;
  hold: Promise<void> | null = null;
  startNext: (() => Reply<never> | Promise<never>) | null = null;
  postNext: (() => Reply<never> | Promise<never>) | null = null;
  pollNext: (() => Reply<never>) | null = null;
  details: ChatDoorClient['details'];
  question: ChatDoorClient['question'];
  detailsSent: unknown[] = [];
  questionSent: unknown[] = [];

  constructor() {
    this.details = async (_token, sent) => {
      this.calls.push('details');
      this.detailsSent.push(sent);
      return { state: 'saved', conversation: { state: this.state, language: 'en-US' }, token: 'tok' };
    };
    this.question = async (_proof, sent) => {
      this.calls.push('question');
      this.questionSent.push(sent);
      return { state: 'sent', token: 'tok-q' };
    };
  }

  add(kind: ChatMessage['kind'], body: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    this.seq += 1;
    const message: ChatMessage = { id: String(this.seq), kind, body, sentAt: new Date().toISOString(), ...extra };
    this.messages.push(message);
    return message;
  }

  async config() {
    this.calls.push('config');
    return this.reply;
  }

  async challenge() {
    this.calls.push('challenge');
    return { id: 'c', salt: 's', difficulty: 1 };
  }

  async start(_proof: string, sent: { body: string; language: string; cameFrom: string | null }) {
    this.calls.push('start');
    if (this.hold !== null) await this.hold;
    if (this.proofFails > 0) {
      this.proofFails -= 1;
      return { state: 'proof' } as const;
    }
    if (this.startNext !== null) return this.startNext();
    const message = this.add('visitor', sent.body);
    return { token: 'tok', conversation: { state: this.state, language: sent.language }, messages: [message], cursor: message.id, ...this.hours };
  }

  async post(_token: string, sent: { body: string } | { talk: true }) {
    this.calls.push('post');
    if (this.postNext !== null) return this.postNext();
    if ('talk' in sent) {
      this.state = 'waiting';
      const message = this.add('system', 'The visitor asked for a person.', { event: 'handed-over', by: 'visitor' });
      return { state: 'sent' as const, message, conversation: { state: this.state }, token: 'tok' };
    }
    const message = this.add('visitor', sent.body);
    return { state: 'sent' as const, message, conversation: { state: this.state }, token: 'tok' };
  }

  async poll(_token: string, after: string) {
    this.calls.push(`poll:${after}`);
    if (this.pollNext !== null) return this.pollNext();
    const messages = this.messages.filter((one) => BigInt(one.id) > BigInt(after));
    return { state: this.state, staff: false, messages, cursor: messages[messages.length - 1]?.id ?? after, ...this.hours };
  }
}

let door: FakeDoor;

async function show(opts: { tag?: string; preview?: boolean; kept?: boolean } = {}): Promise<void> {
  // Each window starts on a fresh tab, unless the test kept a conversation for it.
  if (opts.kept !== true) window.sessionStorage.clear();
  const language = languageOfTag(opts.tag ?? 'en-US');
  applyDirection(language);
  const i18n = await initXWords(language.id);
  await act(async () => {
    render(
      <I18nProvider i18n={i18n}>
        <ChatApp route={{ addOn: 'live-chat', frame: false, lang: null, ...(opts.preview === true ? { preview: true as const } : {}) }} door={door} />
      </I18nProvider>,
    );
  });
}

const launcher = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^Chat with Meridian/ });
async function openPanel(): Promise<HTMLElement> {
  await userEvent.click(await launcher());
  return screen.findByRole('dialog', { name: 'Chat with Meridian' });
}
const box = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: /^(Write a message…|Nachricht schreiben…|اكتب رسالة…)$/ }) as HTMLTextAreaElement;
/** A whole line of the log (its times and addresses are runs of their own), found by its full text. */
async function line(container: HTMLElement, text: string | RegExp): Promise<HTMLElement> {
  const matches = (element: Element): boolean => {
    const said = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    return typeof text === 'string' ? said === text : text.test(said);
  };
  return waitFor(() => {
    const found = [...container.querySelectorAll<HTMLElement>('p, .xc-hours, .xc-done-text')].find(matches);
    if (found === undefined) throw new Error(`no line "${String(text)}"`);
    return found;
  });
}
async function say(text: string): Promise<void> {
  await userEvent.type(box(), `${text}{Enter}`);
}
/** One poll now, as the window does when the browser comes back online. */
async function pollNow(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  door = new FakeDoor();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-accent');
});

describe('the chat window: not ready, and the launcher', () => {
  it('draws nothing at all while the chat is not available: no launcher, ever', async () => {
    door.reply = null;
    await show();
    await waitFor(() => expect(door.calls).toContain('config'));
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.xc')).toBeNull();
  });

  it('shows the launcher closed with its pill, opens the window into the box, and hides it back to the launcher', async () => {
    await show();
    const button = await launcher();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('Chat with Meridian');
    expect(document.documentElement.dataset['accent']).toBe('teal');
    const panel = await openPanel();
    expect(box()).toHaveFocus();
    // The first line describes the window.
    expect(panel.getAttribute('aria-describedby')).toBe('xc-notice');
    expect(within(panel).getByRole('log', { name: 'Messages' })).toHaveAttribute('aria-live', 'polite');
    const hide = screen.getByRole('button', { name: 'Hide chat', expanded: true });
    expect(hide.textContent).toBe('');
    await userEvent.click(within(panel).getByRole('button', { name: 'Hide chat' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await launcher()).toHaveFocus();
  });

  it('Escape closes the window, and the language menu first when it is open', async () => {
    door.reply = config({ languages: ['en-US', 'de-DE', 'ar-EG'] });
    await show();
    const panel = await openPanel();
    await userEvent.click(within(panel).getByRole('button', { name: 'Language: English' }));
    expect(screen.getByRole('list', { name: 'Language' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Language' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the first line says what is true now', () => {
  it('A with automatic answers on in hours, naming the AI service; B with only drafting; C with no AI', () => {
    expect(firstLineOf({ automatic: true, miloDrafts: false, aiService: 'Anthropic' }, true)).toBe('automatic');
    expect(firstLineOf({ automatic: false, miloDrafts: true, aiService: 'Anthropic' }, true)).toBe('drafts');
    expect(firstLineOf({ automatic: false, miloDrafts: false, aiService: null }, true)).toBe('person');
    // Drafting switched on with no AI service usable: nobody's words go anywhere.
    expect(firstLineOf({ automatic: false, miloDrafts: true, aiService: null }, true)).toBe('person');
  });

  it('never A outside hours, whatever automatic says: B with drafting, else C', () => {
    expect(firstLineOf({ automatic: true, miloDrafts: true, aiService: 'Anthropic' }, false)).toBe('drafts');
    expect(firstLineOf({ automatic: true, miloDrafts: false, aiService: 'Anthropic' }, false)).toBe('person');
  });

  it('draws line A with the privacy notice opening in a new tab', async () => {
    await show();
    const panel = await openPanel();
    const notice = panel.querySelector('#xc-notice')!;
    expect(notice).toHaveTextContent(
      'Some answers here are automatic, picked from answers Meridian wrote. A person can take over at any time. Your messages are read by an AI service (Anthropic). Privacy notice.(opens in a new tab)',
    );
    const link = within(notice as HTMLElement).getByRole('link', { name: /Privacy notice/ });
    expect(link).toHaveAttribute('href', 'https://www.meridian.example/privacy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('draws B and C', async () => {
    door.reply = config({ automatic: false, miloDrafts: true });
    await show();
    expect((await openPanel()).querySelector('#xc-notice')).toHaveTextContent(/^A person answers here\. Staff may use an AI service \(Anthropic\) to help write replies\. Privacy notice\./);
    cleanup();
    door = new FakeDoor();
    door.reply = config({ automatic: false, miloDrafts: false, aiService: null });
    await show();
    expect((await openPanel()).querySelector('#xc-notice')).toHaveTextContent(/^A person answers here\. Privacy notice\./);
  });

  it('outside hours with drafting on, the window says B, never A (the door says automatic, the hours say closed)', async () => {
    door.reply = config({ ...CLOSED, automatic: true, miloDrafts: true });
    await show();
    const notice = (await openPanel()).querySelector('#xc-notice')!;
    expect(notice).toHaveTextContent(/^A person answers here\. Staff may use/);
    expect(notice).not.toHaveTextContent(/automatic/);
  });
});

describe('sending', () => {
  it('checks the first message is from a person while it starts the chat, then shows it with its time', async () => {
    let release: () => void = () => undefined;
    door.hold = new Promise((resolve) => (release = resolve));
    await show();
    await openPanel();
    await say('do you take away our old desks?');
    expect(await screen.findByRole('status')).toHaveTextContent('Checking you’re a person…');
    expect(box().value).toBe('');
    await act(async () => release());
    await waitFor(() => expect(screen.queryByText('Checking you’re a person…')).toBeNull());
    expect(screen.getByText('do you take away our old desks?')).toBeInTheDocument();
    expect(screen.getByText(clockOf(door.messages[0]!.sentAt, 'en-US'))).toBeInTheDocument();
  });

  it('says when the check did not pass; Try again checks again', async () => {
    door.proofFails = 2;
    await show();
    await openPanel();
    await say('do you take away our old desks?');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We couldn’t check that you’re a person.Try again');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(door.calls.filter((call) => call === 'start')).toHaveLength(3);
  });

  it('a message the door refused is not sent, with Try again; one it could not reach waits, under the band', async () => {
    await show();
    await openPanel();
    await say('do you take away our old desks?');
    await screen.findByText('do you take away our old desks?');
    door.postNext = () => {
      throw new Error('500');
    };
    await say('Great. Can someone look at our office layout? About 40 desks.');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not sent.Try again');
    door.postNext = () => {
      throw new ChatOffline();
    };
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Waiting to send')).toBeInTheDocument();
    expect(screen.getByText('Can’t reach Meridian. Trying again…').closest('[role="status"]')).not.toBeNull();
    // The door answers again: the band goes and the message is sent.
    door.postNext = null;
    await pollNow();
    await waitFor(() => expect(screen.queryByText('Waiting to send')).toBeNull());
    expect(screen.queryByText('Can’t reach Meridian. Trying again…')).toBeNull();
    expect(door.messages.map((one) => one.body)).toContain('Great. Can someone look at our office layout? About 40 desks.');
  });

  it('a per-minute cap greys the box for that minute', async () => {
    await show();
    await openPanel();
    await say('hello');
    await screen.findByText('hello');
    door.postNext = () => ({ state: 'too-many', cap: 'minute', retryAfter: 40 }) as never;
    await say('hello?');
    expect(await screen.findByText('You’ve sent a lot of messages. Wait a minute, then try again.')).toBeInTheDocument();
    expect(box()).toBeDisabled();
    expect(box().value).toBe('');
    expect(screen.queryByText('hello?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('the hour cap says how long; the chat cap says so and offers a new chat instead of the box', async () => {
    await show();
    await openPanel();
    await say('hello');
    await screen.findByText('hello');
    door.postNext = () => ({ state: 'too-many', cap: 'hour', retryAfter: 40 * 60 }) as never;
    await say('hello?');
    expect(await screen.findByText('You’ve sent a lot of messages. Wait 40 minutes, then try again.')).toBeInTheDocument();
    cleanup();
    door = new FakeDoor();
    await show();
    await openPanel();
    await say('hello');
    await screen.findByText('hello');
    door.postNext = () => ({ state: 'too-many', cap: 'conversation', retryAfter: null }) as never;
    await say('hello?');
    expect(await screen.findByText('You’ve sent a lot of messages in this chat.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a message…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start a new chat' })).toBeInTheDocument();
  });

  it('a message over 2,000 characters (as code points, after NFC) shows the count, marks the box and keeps Send off', async () => {
    await show();
    await openPanel();
    const long = 'é'.repeat(2140);
    await act(async () => {
      const input = box();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(input, long);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(screen.getByText('2,140 / 2,000')).toHaveAttribute('dir', 'ltr');
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveAttribute('aria-describedby', 'xc-counter');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    // Exactly 2,000 (an e and its accent as two code points become one after NFC): no count.
    await act(async () => {
      const input = box();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(input, 'é'.repeat(2000));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(screen.queryByText(/\/ 2,000/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});

describe('the conversation', () => {
  async function startChat(): Promise<HTMLElement> {
    await show();
    const panel = await openPanel();
    await say('do you take away our old desks?');
    await screen.findByText('do you take away our old desks?');
    return panel;
  }

  it('marks an automatic answer, with Talk to a person under the latest while answers run; Talk hands it to a person', async () => {
    const panel = await startChat();
    door.add('automatic', A4, { language: 'en-US' });
    await pollNow();
    expect(await within(panel).findByText('Automatic answer')).toBeInTheDocument();
    expect(within(panel).getByText(A4).closest('[lang]')).toHaveAttribute('lang', 'en-US');
    await userEvent.click(within(panel).getByRole('button', { name: 'Talk to a person' }));
    expect(await within(panel).findByText('You asked for a person.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Talk to a person' })).toBeNull();
    expect(within(panel).getByText('A person will answer here.')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Your name (optional)')).toHaveAttribute('autocomplete', 'name');
    const email = within(panel).getByLabelText('Your e-mail (optional)');
    expect(email).toHaveAttribute('dir', 'ltr');
    expect(email).toHaveAttribute('placeholder', 'name@company.example');
    expect(email.getAttribute('aria-describedby')).toBe(within(panel).getByText('So we can reply if you close this page.').id);
  });

  it('a hand-over the answerer made says nothing about asking: the card carries it', async () => {
    const panel = await startChat();
    door.state = 'waiting';
    door.add('system', 'Handed to a person.', { event: 'handed-over', by: 'automatic' });
    await pollNow();
    expect(await within(panel).findByText('A person will answer here.')).toBeInTheDocument();
    expect(within(panel).queryByText(/You asked for a person/)).toBeNull();
  });

  it('the hand-over card checks before it saves, then thanks by name with the address, and can be changed', async () => {
    const panel = await startChat();
    door.state = 'waiting';
    door.add('system', 'x', { event: 'handed-over', by: 'visitor' });
    await pollNow();
    const save = await within(panel).findByRole('button', { name: 'Save' });
    await userEvent.click(save);
    expect(within(panel).getByRole('alert')).toHaveTextContent('Add your name or e-mail first.');
    await userEvent.type(within(panel).getByLabelText('Your e-mail (optional)'), 'marta@cobaltlegal');
    await userEvent.click(save);
    expect(within(panel).getByRole('alert')).toHaveTextContent('Enter an e-mail like name@company.example');
    expect(within(panel).getByLabelText('Your e-mail (optional)')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(within(panel).getByLabelText('Your e-mail (optional)'), '.example');
    await userEvent.type(within(panel).getByLabelText('Your name (optional)'), 'Marta');
    await userEvent.click(save);
    expect(await line(panel, 'Thanks, Marta. If you leave, we’ll reply to marta@cobaltlegal.example.')).toBeInTheDocument();
    expect(within(panel).getByText('marta@cobaltlegal.example').tagName).toBe('BDI');
    expect(door.detailsSent).toEqual([{ name: 'Marta', email: 'marta@cobaltlegal.example' }]);
    await userEvent.click(within(panel).getByRole('button', { name: 'Change' }));
    expect(within(panel).getByLabelText('Your name (optional)')).toHaveValue('Marta');
  });

  it('with e-mail not set up, the card asks for nothing', async () => {
    door.reply = config({ mail: false });
    const panel = await startChat();
    door.state = 'waiting';
    door.add('system', 'x', { event: 'handed-over', by: 'visitor' });
    await pollNow();
    expect(await within(panel).findByText('A person will answer here. Keep this page open to see the reply.')).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox', { name: /e-mail/ })).toBeNull();
  });

  it('a person’s reply comes under their first name and initials, its links open in a new tab', async () => {
    const panel = await startChat();
    door.state = 'open';
    door.add('staff', 'Hi Marta, I’m Dana. See https://www.meridian.example/layouts please.', { author: { firstName: 'Dana', initials: 'DW' } });
    await pollNow();
    expect(await within(panel).findByText('Dana from Meridian')).toBeInTheDocument();
    expect(within(panel).getByText('DW')).toHaveAttribute('aria-hidden', 'true');
    const link = within(panel).getByRole('link', { name: /https:\/\/www\.meridian\.example\/layouts/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('(opens in a new tab)');
  });

  it('closed by a person: who closed it and when, and Start a new chat in place of the box, which starts afresh', async () => {
    const panel = await startChat();
    door.state = 'closed';
    door.add('system', 'The chat was closed.', { event: 'closed', author: { firstName: 'Dana', initials: 'DW' }, sentAt: at(10, 4) });
    await pollNow();
    expect(await line(panel, `Dana closed this chat · ${clockOf(at(10, 4), 'en-US')}`)).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox', { name: 'Write a message…' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Start a new chat' }));
    expect(within(panel).queryByText('do you take away our old desks?')).toBeNull();
    expect(within(panel).getByRole('textbox', { name: 'Write a message…' })).toBeInTheDocument();
    expect(panel.querySelector('#xc-notice')).not.toBeNull();
  });

  it('reopened by a person: the line says who, and the box comes back', async () => {
    const panel = await startChat();
    door.state = 'closed';
    door.add('system', 'x', { event: 'closed', author: { firstName: 'Dana', initials: 'DW' } });
    await pollNow();
    await within(panel).findByRole('button', { name: 'Start a new chat' });
    door.state = 'open';
    door.add('system', 'x', { event: 'reopened', author: { firstName: 'Dana', initials: 'DW' }, sentAt: at(10, 9) });
    await pollNow();
    expect(await line(panel, `Dana reopened this chat · ${clockOf(at(10, 9), 'en-US')}`)).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', { name: 'Write a message…' })).toBeInTheDocument();
  });

  it('a person taking the chat leaves no line on the visitor’s side', async () => {
    const panel = await startChat();
    door.state = 'open';
    door.add('system', 'A person joined the chat.', { event: 'taken', author: { firstName: 'Dana', initials: 'DW' } });
    await pollNow();
    await waitFor(() => expect(door.calls.some((call) => call.startsWith('poll'))).toBe(true));
    expect(within(panel).queryByText(/joined|took/)).toBeNull();
  });

  it('still waiting after a while: the quiet line, then the card with no sentence of its own', async () => {
    const panel = await startChat();
    door.state = 'waiting';
    door.add('system', 'x', { event: 'handed-over', by: 'visitor', sentAt: new Date(Date.now() - WAITING_LONG_MS - 60_000).toISOString() });
    await pollNow();
    expect(await line(panel, 'Still waiting for someone at Meridian. You can leave your e-mail and close this page.')).toBeInTheDocument();
    expect(within(panel).queryByText('A person will answer here.')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('still waiting with e-mail not set up: no e-mail sentence, and no card', async () => {
    door.reply = config({ mail: false });
    const panel = await startChat();
    door.state = 'waiting';
    door.add('system', 'x', { event: 'handed-over', by: 'visitor', sentAt: new Date(Date.now() - WAITING_LONG_MS - 60_000).toISOString() });
    await pollNow();
    expect(await line(panel, 'Still waiting for someone at Meridian.')).toBeInTheDocument();
    expect(within(panel).queryByText(/Keep this page open/)).toBeNull();
  });

  it('the hours ending mid-chat are said once, after the last message, and the header says when it opens', async () => {
    const panel = await startChat();
    door.hours = CLOSED;
    door.add('visitor', 'About 400 square metres, on one floor.');
    await pollNow();
    expect(await line(panel, 'Meridian’s hours ended at 17:30. A person may still answer; if not, we’ll reply after 9:00 tomorrow.')).toBeInTheDocument();
    expect(await line(panel, 'Opens tomorrow at 9:00')).toHaveClass('xc-hours');
    expect(within(panel).getByRole('textbox', { name: 'Write a message…' })).toBeInTheDocument();
  });
});

describe('coming back, and the launcher while closed', () => {
  it('a reply while the window is closed shows as a count and a pill; opening clears it', async () => {
    await show();
    await openPanel();
    await say('do you take away our old desks?');
    await screen.findByText('do you take away our old desks?');
    await userEvent.click(screen.getByRole('button', { name: 'Hide chat', expanded: true }));
    door.state = 'open';
    door.add('staff', 'Hi, Dana here.', { author: { firstName: 'Dana', initials: 'DW' } });
    await pollNow();
    const button = await screen.findByRole('button', { name: 'Chat with Meridian, 1 new message' });
    expect(button).toHaveTextContent('1 new message from Meridian');
    const badge = button.querySelector('.xc-badge')!;
    expect(badge).toHaveTextContent('1');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(button);
    expect(screen.queryByText('1 new message from Meridian')).toBeNull();
  });

  it('on another page, the chat is taken up again from its start, saying when it began', async () => {
    door.add('visitor', 'do you take away our old desks?', { sentAt: at(9, 12) });
    door.add('automatic', A4, { language: 'en-US', sentAt: at(9, 12) });
    window.sessionStorage.setItem('adminium:chat:live-chat', JSON.stringify({ token: 'tok', cursor: '12', open: true }));
    await show({ kept: true });
    const panel = await screen.findByRole('dialog');
    expect(await line(panel, `Your chat from ${clockOf(at(9, 12), 'en-US')}`)).toBeInTheDocument();
    expect(within(panel).getByText(A4)).toBeInTheDocument();
    expect(door.calls).toContain('poll:0');
    expect(within(panel).getByRole('button', { name: 'Talk to a person' })).toBeInTheDocument();
  });

  it('an earlier chat the door no longer knows starts afresh, saying so', async () => {
    door.pollNext = () => ({ state: 'lost' }) as never;
    window.sessionStorage.setItem('adminium:chat:live-chat', JSON.stringify({ token: 'old', cursor: '3', open: true }));
    await show({ kept: true });
    expect(await screen.findByText('We couldn’t find your earlier chat. Start a new one below.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Write a message…' })).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem('adminium:chat:live-chat')!)).not.toHaveProperty('token');
  });
});

describe('outside hours', () => {
  it('takes a question with the e-mail to reply to, checked first, then thanks with when', async () => {
    door.reply = config({ ...CLOSED, automatic: false });
    await show();
    const panel = await openPanel();
    expect(await line(panel, 'Opens tomorrow at 9:00')).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox', { name: 'Write a message…' })).toBeNull();
    expect(await line(panel, 'We’re away until 9:00 tomorrow. Leave your question and your e-mail, and we’ll reply by e-mail.')).toBeInTheDocument();
    const send = within(panel).getByRole('button', { name: 'Send' });
    await userEvent.click(send);
    expect(within(panel).getByRole('alert')).toHaveTextContent('Write your question first.');
    await userEvent.type(within(panel).getByLabelText('Your question'), 'Can we visit on Saturday?');
    await userEvent.click(send);
    expect(within(panel).getByRole('alert')).toHaveTextContent('Enter your e-mail so we can reply.');
    await userEvent.type(within(panel).getByLabelText('Your e-mail'), 'marta.kovac@cobaltlegal');
    await userEvent.click(send);
    expect(within(panel).getByRole('alert')).toHaveTextContent('Enter an e-mail like name@company.example');
    await userEvent.type(within(panel).getByLabelText('Your e-mail'), '.example');
    await userEvent.click(send);
    expect(await line(panel, 'Thanks. We’ll reply to marta.kovac@cobaltlegal.example after 9:00.')).toBeInTheDocument();
    expect(door.calls).toEqual(expect.arrayContaining(['challenge', 'question']));
    expect(door.questionSent).toEqual([{ question: 'Can we visit on Saturday?', name: '', email: 'marta.kovac@cobaltlegal.example', language: 'en-US', cameFrom: null }]);
  });

  it('the check under Send says when it did not pass', async () => {
    door.reply = config({ ...CLOSED, automatic: false });
    door.question = async () => ({ state: 'proof' });
    await show();
    const panel = await openPanel();
    await userEvent.type(within(panel).getByLabelText('Your question'), 'Hello?');
    await userEvent.type(within(panel).getByLabelText('Your e-mail'), 'a@b.example');
    await userEvent.click(within(panel).getByRole('button', { name: 'Send' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('We couldn’t check that you’re a person.Try again');
  });

  it('with e-mail not set up: when to write again, no first line, no box', async () => {
    door.reply = config({ ...CLOSED, automatic: false, mail: false });
    await show();
    const panel = await openPanel();
    expect(await line(panel, 'We’re away until 9:00 tomorrow. Write to us again then.')).toBeInTheDocument();
    expect(panel.querySelector('#xc-notice')).toBeNull();
    expect(panel.getAttribute('aria-describedby')).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
  });

  it('opens on another weekday, or on a date', async () => {
    door.reply = config({ ...CLOSED, automatic: false, nextOpen: { at: '2026-08-03T08:00:00.000Z', date: '2026-08-03', time: '09:00', day: 'mon' } });
    await show();
    expect((await openPanel()).querySelector('.xc-hours')).toHaveTextContent('Opens Monday at 9:00');
    cleanup();
    door = new FakeDoor();
    door.reply = config({ ...CLOSED, automatic: false, nextOpen: { at: '2026-08-03T08:00:00.000Z', date: '2026-08-03', time: '09:00', day: 'date' } });
    await show();
    const panel = await openPanel();
    expect(panel.querySelector('.xc-hours')).toHaveTextContent('Opens on 3 August at 9:00');
    expect(await line(panel, 'We’re away until 3 August at 9:00. Leave your question and your e-mail, and we’ll reply by e-mail.')).toBeInTheDocument();
  });
});

describe('languages, direction, theme and the phone sheet', () => {
  it('one language hides the button; several list each in its own name, the current one ticked', async () => {
    await show();
    let panel = await openPanel();
    expect(within(panel).queryByRole('button', { name: /^Language/ })).toBeNull();
    cleanup();
    door = new FakeDoor();
    door.reply = config({ languages: ['en-US', 'de-DE', 'ar-EG'] });
    await show();
    panel = await openPanel();
    const button = within(panel).getByRole('button', { name: 'Language: English' });
    expect(button).toHaveTextContent('EN');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    await userEvent.click(button);
    const items = within(screen.getByRole('list', { name: 'Language' })).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual(['English', 'Deutsch', 'العربية']);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[2]).toHaveAttribute('dir', 'rtl');
    expect(items[2]).toHaveAttribute('lang', 'ar-EG');
  });

  it('picking a language changes the window’s words and tells the conversation', async () => {
    door.reply = config({ languages: ['en-US', 'de-DE'] });
    await show();
    const panel = await openPanel();
    await say('Hallo');
    await screen.findByText('Hallo');
    await userEvent.click(within(panel).getByRole('button', { name: 'Language: English' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deutsch' }));
    expect(await screen.findByRole('textbox', { name: 'Nachricht schreiben…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sprache: Deutsch' })).toHaveTextContent('DE');
    expect(door.detailsSent).toEqual([{ language: 'de-DE' }]);
  });

  it('a German window marks an answer only in English, in German, and says the answer’s language', async () => {
    door.reply = config({ language: 'de-DE', languages: ['en-US', 'de-DE'] });
    await show({ tag: 'de-DE' });
    await userEvent.click(await screen.findByRole('button', { name: /^Chat mit Meridian/ }));
    await say('Können wir uns den Showroom ansehen?');
    await screen.findByText('Können wir uns den Showroom ansehen?');
    door.add('automatic', A2, { language: 'en-US' });
    await pollNow();
    expect(await screen.findByText('Automatische Antwort · auf Englisch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mit einer Person sprechen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /crm\.meridian\.example/ }).closest('[lang]')).toHaveAttribute('lang', 'en-US');
    expect(document.querySelector('.xc-hours')).toHaveTextContent('Heute geöffnet bis 17:30');
  });

  it('Arabic reads right to left, with times left to right in the mono face; dark paints the window, not the page', async () => {
    door.reply = config({ language: 'ar-EG', languages: ['en-US', 'ar-EG'], theme: 'dark' });
    await show({ tag: 'ar-EG' });
    await userEvent.click(await screen.findByRole('button', { name: /^محادثة مع Meridian/ }));
    const panel = screen.getByRole('dialog', { name: 'محادثة مع Meridian' });
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(panel).toHaveAttribute('lang', 'ar-EG');
    expect(document.querySelector('.xc')).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.dataset['theme']).not.toBe('dark');
    const time = within(panel.querySelector('.xc-hours') as HTMLElement).getByText('17:30');
    expect(time.tagName).toBe('BDI');
    expect(time).toHaveAttribute('dir', 'ltr');
    expect(time).toHaveClass('x-mono');
    // Empty, the box reads right to left like its placeholder; with text, each message takes its own direction.
    expect(screen.getByRole('textbox', { name: 'اكتب رسالة…' })).toHaveAttribute('dir', 'rtl');
    await userEvent.type(screen.getByRole('textbox', { name: 'اكتب رسالة…' }), 'hello');
    expect(screen.getByRole('textbox', { name: 'اكتب رسالة…' })).toHaveAttribute('dir', 'auto');
    // Only the send arrow turns round.
    expect(screen.getByRole('button', { name: 'إرسال' }).querySelector('.xc-flip')).not.toBeNull();
  });

  it('below 440 px the window is a sheet: modal, closed from its own header, with no launcher', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    await show();
    await userEvent.click(await launcher());
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(document.querySelector('.xc')).toHaveAttribute('data-sheet', '');
    expect(screen.queryByRole('button', { name: /^Chat with Meridian/ })).toBeNull();
    // Tab goes round inside the sheet.
    const close = within(panel).getByRole('button', { name: 'Close chat' });
    close.focus();
    await userEvent.tab({ shift: true });
    expect(panel.contains(document.activeElement)).toBe(true);
    await userEvent.click(close);
    expect(await launcher()).toBeInTheDocument();
  });

  it('a preview shows the window open and sends nothing', async () => {
    await show({ preview: true });
    const panel = await screen.findByRole('dialog');
    await say('Is this how it looks?');
    expect(within(panel).getByText('Is this how it looks?')).toBeInTheDocument();
    expect(door.calls).toEqual(['config']);
    expect(window.sessionStorage.getItem('adminium:chat:live-chat')).toBeNull();
  });
});

describe('polling, the heartbeat', () => {
  const base = { token: 'tok', state: 'bot' as ChatState, open: true, offline: false, pending: [], messages: [] as ChatMessage[] };
  const opts = { hidden: false, failures: 0, preview: false };

  it('asks every 4 s while a person is wanted or answering, or an answer is due; every 15 s when quiet', () => {
    expect(pollEvery({ ...base, state: 'waiting' }, opts)).toBe(4_000);
    expect(pollEvery({ ...base, state: 'open' }, opts)).toBe(4_000);
    expect(pollEvery({ ...base, messages: [{ id: '1', kind: 'visitor', body: 'x', sentAt: '' }] }, opts)).toBe(4_000);
    expect(pollEvery({ ...base, messages: [{ id: '2', kind: 'automatic', body: 'x', sentAt: '' }] }, opts)).toBe(15_000);
  });

  it('every 60 s while closed or the window hidden; never without a conversation or in a preview; less often in a hidden tab or offline', () => {
    expect(pollEvery({ ...base, state: 'closed' }, opts)).toBe(60_000);
    expect(pollEvery({ ...base, state: 'waiting', open: false }, opts)).toBe(60_000);
    expect(pollEvery({ ...base, token: null }, opts)).toBeNull();
    expect(pollEvery(base, { ...opts, preview: true })).toBeNull();
    expect(pollEvery({ ...base, state: 'waiting' }, { ...opts, hidden: true })).toBe(16_000);
    expect(pollEvery({ ...base, offline: true }, { ...opts, failures: 1 })).toBe(8_000);
    expect(pollEvery({ ...base, offline: true }, { ...opts, failures: 9 })).toBe(30_000);
  });
});

describe('the badge in the dark', () => {
  /** WCAG's contrast of two `#rrggbb` colours. */
  function contrast(a: string, b: string): number {
    const lum = (hex: string): number => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  }

  it('reads at 4.5:1 or better on the dark theme’s red', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'x', 'chat', 'chat.css'), 'utf8');
    const tokens = readFileSync(join(process.cwd(), '..', '..', 'packages', 'tokens', 'src', 'tokens.css'), 'utf8');
    const darkRed = /\[data-theme="dark"\][^}]*?--danger:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1];
    expect(darkRed).toBe('#ff6b6b');
    // The dark rule's ink, else the light rule's (what the dark theme would inherit).
    const ink = /\.xc\[data-theme="dark"\]\s+\.xc-badge\s*\{[^}]*?\bcolor:\s*(#[0-9a-f]{6})/i.exec(css)?.[1] ?? /\.xc-badge\s*\{[^}]*?\bcolor:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(contrast(ink!, darkRed!)).toBeGreaterThanOrEqual(4.5);
  });
});
