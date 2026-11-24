// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/texts`: Conversations, each app's replies switch, and Marketing.
 *
 * Mounted bare, with the transport stubbed at `fetch` and the realtime socket
 * at `WebSocket`, so each claim is about what reaches the wire and what the
 * person reads.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery, type BootstrapData } from '../../app/bootstrap.js';
import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { PageActionsProvider, PageActionsSlot } from '../../shell/PageActionsProvider.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';

import { mayAnswer, readsAnyTexts, textReaderOf, type RepliesSwitch, type Thread, type ThreadDetail, type ThreadItem, type ThreadList } from './conversationsApi.js';
import type { MarketingSetup, Run, RunPreview } from './marketingApi.js';
import { TextsPage } from './TextsPage.js';

const AT = Date.UTC(2026, 6, 28, 13, 5);

// ─── fixtures ───────────────────────────────────────────────────────────────

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 'tth_zoe',
  app: 'hotel',
  phone: null,
  masked: '+1 ••• 161',
  line: '+12075550187',
  record: null,
  lastAt: AT,
  lastDirection: 'in',
  lastKind: 'message',
  preview: 'Can we check in a little early on Thursday?',
  unread: 1,
  readAt: null,
  readBy: null,
  stopped: false,
  theyCanReply: true,
  ...over,
});

const item = (over: Partial<ThreadItem>): ThreadItem => ({ id: 'ttm_1', source: 'message', direction: 'in', kind: 'message', body: null, template: null, at: AT, by: null, delivery: null, confirmed: null, refused: null, ...over });

const ZOE_ITEMS: ThreadItem[] = [
  item({ id: 'ttm_b', body: 'Can we check in a little early on Thursday?', at: AT }),
  item({ id: 'app_a', source: 'app', direction: 'out', kind: 'template', template: 'hotel-prearrival', at: AT - 40 * 60_000, delivery: { status: 'delivered', reason: null } }),
];

const detail = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({ thread: thread(), items: ZOE_ITEMS, next: null, answering: true, canReply: { ok: true, reason: null }, ...over });

const list = (over: Partial<ThreadList> = {}): ThreadList => ({ threads: [thread()], next: null, unread: 1, replies: { canArrive: true, state: 'reachable' }, ...over });

const SWITCHES: { apps: RepliesSwitch[]; noApp: 'on' | 'off' } = {
  apps: [
    { app: 'hotel', name: 'Hotel', replies: 'on', starts: 'on', changedAt: null, changedBy: null },
    { app: 'clinic', name: 'Clinic', replies: 'off', starts: 'off', changedAt: null, changedBy: null },
  ],
  noApp: 'off',
};

const setupOf = (over: Partial<MarketingSetup> = {}): MarketingSetup => ({
  preflight: { ok: true, refusals: [], sender: { kind: 'number', value: '+12075550187' }, replies: { canReceiveStop: true, state: 'reachable' } },
  hours: { from: '09:00', to: '20:00', days: 'monday-to-saturday' },
  daily: { limit: 500, used: 412 },
  countries: { noReplies: ['AE', 'CN', 'EG', 'SA', 'TW'], blockedCallingCodes: ['86'], doubleOptIn: ['DE'] },
  tables: [{ connectionId: 'c1', table: 'guests', label: 'Guests', appKey: 'hotel', appName: 'Hotel', phones: 'readable' }],
  templates: [{ key: 'autumn_offer', name: 'Autumn stays', languages: ['en_US', 'de_DE'] }],
  ...over,
});

const PREVIEW: RunPreview = {
  preflight: setupOf().preflight,
  template: { refusals: [], unfilled: [], languages: ['de_DE', 'en_US'] },
  people: 17,
  canSend: 3,
  skipped: { 'no-consent': 5, 'country-blocked-for-marketing': 4, 'unconfirmed-consent': 1, stopped: 1, 'country-blocked': 1, 'marketing-from-name': 2 },
  countries: [
    { country: 'AE', people: 1, canSend: 0, opensAt: null, noWindow: false },
    { country: 'DE', people: 1, canSend: 0, opensAt: null, noWindow: false },
    { country: 'US', people: 5, canSend: 3, opensAt: AT + 3_600_000, noWindow: false },
  ],
  daily: { limit: 500, used: 412, left: 88, days: 1 },
};

const run = (over: Partial<Run> = {}): Run => ({
  id: 'txr_1',
  name: 'Autumn stays',
  templateKey: 'autumn_offer',
  connectionId: 'c1',
  table: 'guests',
  viewId: null,
  status: 'done',
  reason: null,
  scheduledAt: AT,
  startedAt: AT,
  finishedAt: AT,
  waitingUntil: null,
  createdBy: 'u1',
  createdByName: 'Owen Tremayne',
  cancelledBy: null,
  createdAt: AT,
  totals: { people: 17, queued: 0, sending: 1, sent: 3, delivered: 2, failed: 0, unknown: 0, skipped: { 'no-consent': 5, stopped: 1 }, cancelled: 0, optOuts: 1 },
  ...over,
});

// ─── the harness ────────────────────────────────────────────────────────────

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}
type Reply = { status: number; body: unknown };

interface Stage {
  actions?: string[];
  textApps?: BootstrapData['textApps'];
  roles?: string[];
  /** Answers by `METHOD /path` (no query); a list is used up in order. */
  replies?: Record<string, Reply | Reply[]>;
}

const sockets: FakeWebSocket[] = [];
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor() {
    sockets.push(this);
  }
  send(frame: string): void {
    this.sent.push(frame);
  }
  close(): void {}
}

const DEFAULTS: Record<string, unknown> = {
  'GET /api/v1/texts/threads': { data: list() },
  'GET /api/v1/texts/threads/tth_zoe': { data: detail() },
  'GET /api/v1/texts/replies': { data: SWITCHES },
  'GET /api/v1/sms/marketing/setup': { data: setupOf() },
  'GET /api/v1/sms/marketing/runs': { data: [], next: null },
};

function mount(stage: Stage = {}) {
  const calls: Call[] = [];
  const replies = stage.replies ?? {};
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>) });
      const tail = `${method} ${url.replace(/\?.*$/, '')}`;
      const planned = replies[tail];
      const reply = Array.isArray(planned) ? (planned.length > 1 ? planned.shift() : planned[0]) : planned;
      if (reply !== undefined) return Promise.resolve(jsonResponse(reply.status, reply.body));
      if (DEFAULTS[tail] !== undefined) return Promise.resolve(jsonResponse(200, DEFAULTS[tail]));
      if (method === 'POST' && tail.endsWith('/read')) return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }));
    }),
  );
  const client = createQueryClient();
  client.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ roles: stage.roles ?? ['owner'], systemActions: (stage.actions ?? ['sms.manage', 'texts.reply', 'settings.manage']) as never, textApps: stage.textApps, appSections: [{ appKey: 'hotel', label: 'Hotel', version: '1.0.0', groups: [], staff: null }, { appKey: 'clinic', label: 'Clinic', version: '1.0.0', groups: [], staff: null }] } as never));
  render(
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <PageActionsProvider>
          <PageActionsSlot />
          <Suspense fallback={null}>
            <TextsPage />
          </Suspense>
        </PageActionsProvider>
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { calls, writes: () => calls.filter((call) => call.method !== 'GET'), reads: (path: string) => calls.filter((call) => call.method === 'GET' && call.url.replace(/\?.*$/, '') === path).length };
}

const refusal = (status: number, code: string, details: unknown): Reply => ({ status, body: { error: { code, message: 'English sentence the screen must not depend on', requestId: 'r', details } } });
const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(await screen.findByRole('tab', { name }));
const openZoe = async (user: ReturnType<typeof userEvent.setup>) => {
  await openTab(user, 'Conversations');
  await user.click(await screen.findByTestId('texts-thread-row'));
  return screen.findByTestId('texts-thread');
};

beforeAll(() => installTestI18n());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sockets.length = 0;
});
afterAll(() => vi.restoreAllMocks());

// ─── who may read ───────────────────────────────────────────────────────────

describe('who may read and answer', () => {
  it('reads the console-wide keys and an app role’s rights from the bootstrap, never a role’s name', () => {
    const owner = textReaderOf(makeBootstrap({ roles: ['super-admin'], systemActions: ['texts.reply'] as never }));
    expect(owner.everything).toBe('reply');
    const desk = textReaderOf(makeBootstrap({ roles: ['super-admin'], systemActions: [] as never, textApps: [{ app: 'hotel', may: 'read' }] } as never));
    expect(desk.everything).toBeNull();
    expect(readsAnyTexts(desk)).toBe(true);
    expect(mayAnswer(desk, 'hotel')).toBe(false);
    expect(mayAnswer(desk, null)).toBe(false);
    expect(readsAnyTexts(textReaderOf(makeBootstrap({ roles: ['super-admin'], systemActions: [] as never })))).toBe(false);
  });

  it('gives a desk with one app’s read right that app’s conversations alone, and no answer box', async () => {
    const user = userEvent.setup();
    const { calls } = mount({ actions: [], textApps: [{ app: 'hotel', may: 'read' }] });
    expect(await screen.findByRole('tab', { name: 'Conversations' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Setup' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Marketing' })).toBeNull();
    const apps = within(await screen.findByTestId('texts-conv-app')).getAllByRole('option').map((one) => one.textContent);
    expect(apps).toEqual(['Every app', 'Hotel']);
    await user.click(await screen.findByTestId('texts-thread-row'));
    expect((await screen.findByTestId('texts-reply-blocked')).textContent).toContain('You can read this conversation, but not answer it.');
    expect(screen.queryByTestId('texts-reply')).toBeNull();
    expect(screen.queryByTestId('texts-replies-open')).toBeNull();
    expect(calls.some((call) => call.url.includes('/sms/'))).toBe(false);
  });

  it('offers nothing to someone who holds no texts right at all', async () => {
    mount({ actions: ['settings.manage'] });
    expect(await screen.findByTestId('texts-no-access')).toBeTruthy();
  });
});

// ─── conversations ──────────────────────────────────────────────────────────

describe('Conversations', () => {
  it('says every read and answer is recorded, and plainly when replies can’t reach the server', async () => {
    const user = userEvent.setup();
    mount({ replies: { 'GET /api/v1/texts/threads': { status: 200, body: { data: list({ replies: { canArrive: false, state: 'not-set' } }) } } } });
    await openTab(user, 'Conversations');
    expect((await screen.findByTestId('texts-conv-recorded')).textContent).toBe('Reading and replying are recorded.');
    expect((await screen.findByTestId('texts-conv-no-door')).textContent).toContain('This server has no public https address.');
  });

  it('filters by app and by unread on the wire', async () => {
    const user = userEvent.setup();
    const { calls } = mount();
    await openTab(user, 'Conversations');
    await screen.findByTestId('texts-thread-row');
    await user.selectOptions(screen.getByTestId('texts-conv-app'), 'clinic');
    await user.click(screen.getByTestId('texts-conv-unread'));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/texts/threads?app=clinic&unread=true'))).toBe(true));
  });

  it('shows the customer’s words in their own direction, and an app’s text by its template alone', async () => {
    const user = userEvent.setup();
    mount({ replies: { 'GET /api/v1/texts/threads/tth_zoe': { status: 200, body: { data: detail({ items: [item({ id: 'ttm_ar', body: 'هل يمكنني الوصول مبكرًا؟' }), ...ZOE_ITEMS.slice(1)] }) } } } });
    const pane = await openZoe(user);
    const body = within(pane).getByTestId('texts-item-body');
    expect(body.getAttribute('dir')).toBe('auto');
    expect(within(pane).getByTestId('texts-item-template').textContent).toBe('Automated text from Hotel, template hotel-prearrival. Its words are not kept.');
    expect(within(pane).getByText('Delivered')).toBeTruthy();
  });

  it('shows the STOP and its one confirmation, and replaces the answer box', async () => {
    const user = userEvent.setup();
    const stopped = thread({ stopped: true, unread: 0, preview: 'STOP' });
    mount({
      replies: {
        'GET /api/v1/texts/threads': { status: 200, body: { data: list({ threads: [stopped] }) } },
        'GET /api/v1/texts/threads/tth_zoe': { status: 200, body: { data: detail({ thread: stopped, answering: false, items: [item({ id: 's', kind: 'stop', body: 'STOP', confirmed: true })], canReply: { ok: false, reason: 'stopped' } }) } },
      },
    });
    const pane = await openZoe(user);
    expect(within(pane).getByTestId('texts-item-stop').textContent).toContain('One plain confirmation went out');
    expect(within(pane).getByTestId('texts-reply-blocked').textContent).toBe('This person asked for no more texts. You can’t reply here.');
    expect(within(pane).queryByTestId('texts-reply')).toBeNull();
  });

  it('answers with a key made once, says when it waits for the hours, and words a refusal plainly', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      replies: {
        'POST /api/v1/texts/threads/tth_zoe/replies': [
          { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'down', requestId: 'r' } } },
          { status: 200, body: { data: { threadId: 'tth_zoe', item: null, result: { outcome: 'held', deliveryId: 'd1', opensAt: AT + 3_600_000, reason: null } } } },
          { status: 200, body: { data: { threadId: 'tth_zoe', item: null, result: { outcome: 'refused', deliveryId: null, opensAt: null, reason: 'stopped' } } } },
        ],
      },
    });
    const pane = await openZoe(user);
    await user.type(within(pane).getByTestId('texts-reply-body'), 'Yes, from 12:00.');
    expect(within(pane).getByTestId('texts-reply-counter').getAttribute('data-segments')).toBe('1');
    expect(within(pane).getByTestId('texts-reply-optout').textContent).toContain('“Reply STOP to opt out.” is added');
    await user.click(within(pane).getByTestId('texts-reply-send'));
    await screen.findByTestId('texts-reply-outcome');
    await user.click(within(pane).getByTestId('texts-reply-send'));
    await waitFor(() => expect(within(pane).getByTestId('texts-reply-outcome').textContent).toContain('Your answer waits for the sending hours.'));
    const sent = writes().filter((call) => call.url.endsWith('/replies'));
    expect(sent).toHaveLength(2);
    // The retry after a failed request carries the same key, so the server sends nothing twice.
    expect(sent[0]?.body?.clientKey).toBe(sent[1]?.body?.clientKey);
    expect(sent[0]?.body?.body).toBe('Yes, from 12:00.');
    await user.type(within(pane).getByTestId('texts-reply-body'), 'And parking?');
    await user.click(within(pane).getByTestId('texts-reply-send'));
    await waitFor(() => expect(within(pane).getByTestId('texts-reply-outcome').textContent).toBe('Not sent. This person asked for no more texts.'));
    const third = writes().filter((call) => call.url.endsWith('/replies'))[2];
    expect(third?.body?.clientKey).not.toBe(sent[0]?.body?.clientKey);
  });

  it('says a person who can’t reply by text can’t, and marks a thread read on the wire', async () => {
    const user = userEvent.setup();
    const quiet = thread({ theyCanReply: false });
    const { writes } = mount({ replies: { 'GET /api/v1/texts/threads/tth_zoe': { status: 200, body: { data: detail({ thread: quiet }) } } } });
    const pane = await openZoe(user);
    expect(within(pane).getByTestId('texts-thread-standing').textContent).toContain('This person can’t reply by text.');
    expect(within(pane).getByTestId('texts-reply-optout').textContent).toContain('your phone or e-mail');
    await user.click(within(pane).getByTestId('texts-thread-read'));
    await waitFor(() => expect(writes().some((call) => call.method === 'POST' && call.url.endsWith('/texts/threads/tth_zoe/read'))).toBe(true));
  });

  it('reads the list again when its socket opens and on every notice, so a missed notice never sticks', async () => {
    const user = userEvent.setup();
    const { reads } = mount();
    await openTab(user, 'Conversations');
    await screen.findByTestId('texts-thread-row');
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    const socket = sockets.at(-1) as FakeWebSocket;
    const before = reads('/api/v1/texts/threads');
    await act(async () => {
      socket.onopen?.();
      await Promise.resolve();
    });
    expect(socket.sent.map((frame) => JSON.parse(frame) as { channel: string })).toEqual([{ op: 'subscribe', channel: 'texts' }]);
    await waitFor(() => expect(reads('/api/v1/texts/threads')).toBeGreaterThan(before));
    const afterOpen = reads('/api/v1/texts/threads');
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ channel: 'texts', type: 'texts.changed', data: { thread: 'tth_other', app: 'hotel' }, ts: new Date(AT).toISOString() }) });
      await Promise.resolve();
    });
    await waitFor(() => expect(reads('/api/v1/texts/threads')).toBeGreaterThan(afterOpen));
  });

  it('listens on the apps a desk may read, never on every conversation', async () => {
    const user = userEvent.setup();
    mount({ actions: [], textApps: [{ app: 'hotel', may: 'reply' }] });
    await openTab(user, 'Conversations');
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    const socket = sockets.at(-1) as FakeWebSocket;
    await act(async () => {
      socket.onopen?.();
      await Promise.resolve();
    });
    expect(socket.sent.map((frame) => (JSON.parse(frame) as { channel: string }).channel)).toEqual(['texts:hotel']);
  });
});

// ─── each app's replies switch ──────────────────────────────────────────────

describe('Replies by app', () => {
  it('shows Clinic off from install with its reason, and asks before turning it on', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /api/v1/texts/replies/clinic': { status: 200, body: { data: { ...SWITCHES.apps[1], replies: 'on' } } } } });
    await openTab(user, 'Conversations');
    await user.click(await screen.findByTestId('texts-replies-open'));
    const drawer = await screen.findByTestId('texts-replies');
    expect(within(drawer).getByTestId('texts-replies-not-read').textContent).toContain('“This number is not read”');
    const clinic = (await within(drawer).findAllByTestId('texts-replies-row')).find((row) => row.getAttribute('data-app') === 'clinic') as HTMLElement;
    expect(within(clinic).getByTestId('texts-replies-starts-off').textContent).toContain('symptoms');
    await user.click(within(clinic).getByTestId('texts-replies-switch'));
    expect(writes()).toHaveLength(0);
    await user.click(await screen.findByTestId('texts-replies-ask-yes'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'PUT', url: '/api/v1/texts/replies/clinic', body: { replies: 'on' } }]));
  });

  it('turns an app’s replies off at once', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /api/v1/texts/replies/hotel': { status: 200, body: { data: { ...SWITCHES.apps[0], replies: 'off' } } } } });
    await openTab(user, 'Conversations');
    await user.click(await screen.findByTestId('texts-replies-open'));
    const hotel = (await screen.findAllByTestId('texts-replies-row')).find((row) => row.getAttribute('data-app') === 'hotel') as HTMLElement;
    await user.click(within(hotel).getByTestId('texts-replies-switch'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'PUT', url: '/api/v1/texts/replies/hotel', body: { replies: 'off' } }]));
  });
});

// ─── marketing ──────────────────────────────────────────────────────────────

describe('Marketing', () => {
  it('is offered to the holder of both settings.manage and sms.manage alone', async () => {
    mount({ actions: ['sms.manage'] });
    await screen.findByRole('tab', { name: 'Setup' });
    expect(screen.queryByRole('tab', { name: 'Marketing' })).toBeNull();
  });

  it('shows the run-level refusals as one panel, and keeps the dialog shut', async () => {
    const user = userEvent.setup();
    const refused = setupOf({ preflight: { ok: false, refusals: [{ reason: 'marketing-from-name', detail: 'name' }, { reason: 'marketing-without-replies', detail: 'not-set' }], sender: { kind: 'name', value: 'WrenHouse' }, replies: { canReceiveStop: false, state: 'not-set' } } });
    mount({ replies: { 'GET /api/v1/sms/marketing/setup': { status: 200, body: { data: refused } } } });
    await openTab(user, 'Marketing');
    const panel = await screen.findByTestId('texts-mkt-refusals');
    const reasons = within(panel).getAllByTestId('texts-mkt-refusal').map((one) => one.textContent);
    expect(reasons[0]).toBe('Marketing can’t go from a sender name because it can’t receive STOP. Add a number for this country in your provider’s account.');
    expect(reasons[1]).toBe('This server can’t receive STOP, so marketing texts are off. It has no public https address, so a STOP reply can’t reach it.');
    expect((screen.getByTestId('texts-mkt-open-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('while locked, says so calmly, lets the preview count, and offers no way to send', async () => {
    const user = userEvent.setup();
    const locked = setupOf({ preflight: { ok: false, refusals: [{ reason: 'marketing-not-yet-available', detail: null }], sender: { kind: 'number', value: '+12075550187' }, replies: { canReceiveStop: true, state: 'reachable' } } });
    const { writes } = mount({
      replies: {
        'GET /api/v1/sms/marketing/setup': { status: 200, body: { data: locked } },
        'POST /api/v1/sms/marketing/preview': { status: 200, body: { data: { ...PREVIEW, preflight: locked.preflight } } },
      },
    });
    await openTab(user, 'Marketing');
    const card = await screen.findByTestId('texts-mkt-locked');
    expect(card.textContent).toContain('Marketing texts are not yet available in this version. Service texts and conversations work as normal.');
    expect(screen.queryByTestId('texts-mkt-refusals')).toBeNull();
    await user.click(screen.getByTestId('texts-mkt-open-new'));
    await user.click(await screen.findByTestId('texts-mkt-check'));
    expect((await screen.findByTestId('texts-mkt-preview')).textContent).toContain('3 of 17 can get it.');
    expect(screen.queryByTestId('texts-mkt-send')).toBeNull();
    expect(screen.getByTestId('texts-mkt-locked-send').textContent).toBe('Not yet available in this version');
    expect(writes().map((call) => call.url)).toEqual(['/api/v1/sms/marketing/preview']);
  });

  it('counts who it reaches, each group with its exact reason, the countries that can’t reply, and +86', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      replies: {
        'POST /api/v1/sms/marketing/preview': { status: 200, body: { data: PREVIEW } },
        'POST /api/v1/sms/marketing/preview/people': { status: 200, body: { data: { people: [{ key: 'g05', name: 'Anna Keller', phone: '+49 ••• 34', country: 'DE', reason: 'unconfirmed-consent' }], more: false } } },
        'POST /api/v1/sms/marketing/consent/confirm-request': { status: 200, body: { data: { outcome: 'no-email' } } },
      },
    });
    await openTab(user, 'Marketing');
    await user.click(await screen.findByTestId('texts-mkt-open-new'));
    expect(screen.getByTestId('texts-mkt-only-agreed').textContent).toBe('Only people who agreed to marketing texts.');
    await user.click(screen.getByTestId('texts-mkt-check'));
    const preview = await screen.findByTestId('texts-mkt-preview');
    const groups = within(preview).getAllByTestId('texts-mkt-group');
    expect(groups.map((one) => one.getAttribute('data-reason'))).toEqual(['no-consent', 'country-blocked-for-marketing', 'marketing-from-name', 'unconfirmed-consent', 'stopped', 'country-blocked']);
    expect(groups[1]?.textContent).toContain('Not sent. Marketing texts can’t go to this country because people there can’t reply STOP.');
    expect(within(preview).getByTestId('texts-mkt-country-block').textContent).toContain('United Arab Emirates');
    expect(within(preview).getByTestId('texts-mkt-cn').textContent).toContain('Adminium does not send texts to mainland China (+86).');
    expect(within(preview).getByTestId('texts-mkt-daily').textContent).toBe('Today has 88 of 500 texts left.');
    // No group can be let through: each offers "See who" and nothing else.
    expect(within(groups[0] as HTMLElement).getAllByRole('button').map((one) => one.textContent)).toEqual(['See who']);
    await user.click(within(groups[3] as HTMLElement).getByRole('button', { name: 'See who' }));
    const who = await screen.findByTestId('texts-mkt-who');
    expect(who.getAttribute('data-reason')).toBe('unconfirmed-consent');
    await user.click(await within(who).findByTestId('texts-mkt-ask-confirm'));
    expect((await within(who).findByTestId('texts-mkt-person-said')).textContent).toBe('Can’t be confirmed yet: they have no e-mail address. Ask them in person.');
    expect(writes().find((call) => call.url.endsWith('/confirm-request'))?.body).toEqual({ connectionId: 'c1', table: 'guests', key: 'g05' });
  });

  it('records a marketing yes in the person’s own words, never by a YES reply', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      replies: {
        'POST /api/v1/sms/marketing/preview': { status: 200, body: { data: PREVIEW } },
        'POST /api/v1/sms/marketing/preview/people': { status: 200, body: { data: { people: [{ key: 'g06', name: 'Søren Holm', phone: '+45 ••• 17', country: 'DK', reason: 'no-consent' }], more: false } } },
        'POST /api/v1/sms/marketing/consent': { status: 200, body: { data: { state: 'yes', confirmed: true, needsConfirm: false, yes: null, asked: null, canEmail: true, phone: null, country: 'DK' } } },
      },
    });
    await openTab(user, 'Marketing');
    await user.click(await screen.findByTestId('texts-mkt-open-new'));
    await user.click(screen.getByTestId('texts-mkt-check'));
    const group = (await screen.findAllByTestId('texts-mkt-group')).find((one) => one.getAttribute('data-reason') === 'no-consent') as HTMLElement;
    await user.click(within(group).getByRole('button', { name: 'See who' }));
    await user.click(await screen.findByTestId('texts-mkt-record-yes'));
    const dialog = await screen.findByTestId('texts-mkt-yes');
    expect(dialog.textContent).toContain('Nobody is asked to reply YES.');
    await user.type(within(dialog).getByTestId('texts-mkt-yes-wording'), 'Yes, send me offers by text.');
    await user.click(screen.getByTestId('texts-mkt-yes-save'));
    await waitFor(() => expect(writes().find((call) => call.url === '/api/v1/sms/marketing/consent')?.body).toEqual({ connectionId: 'c1', table: 'guests', key: 'g06', how: 'in-person', wording: { text: 'Yes, send me offers by text.', version: '1' } }));
  });

  it('schedules a run with what was chosen, and shows a refusal made at creation as the same panel', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      replies: {
        'POST /api/v1/sms/marketing/preview': { status: 200, body: { data: PREVIEW } },
        'POST /api/v1/sms/marketing/runs': [refusal(409, 'TEXT_RUN_REFUSED', { refusals: [{ reason: 'marketing-without-replies', detail: 'not-set' }] }), { status: 202, body: { data: run({ status: 'scheduled' }) } }],
      },
    });
    await openTab(user, 'Marketing');
    await user.click(await screen.findByTestId('texts-mkt-open-new'));
    await user.type(screen.getByTestId('texts-mkt-name'), 'Autumn stays');
    await user.selectOptions(screen.getByTestId('texts-mkt-when'), 'later');
    await user.click(screen.getByTestId('texts-mkt-check'));
    await screen.findByTestId('texts-mkt-preview');
    const send = screen.getByTestId('texts-mkt-send');
    expect(send.textContent).toBe('Schedule for 3 people');
    await user.click(send);
    expect((await screen.findByTestId('texts-mkt-made-refusals')).textContent).toContain('This server can’t receive STOP, so marketing texts are off.');
    await user.click(screen.getByTestId('texts-mkt-send'));
    await waitFor(() => expect(screen.queryByTestId('texts-mkt-new')).toBeNull());
    const made = writes().filter((call) => call.url === '/api/v1/sms/marketing/runs').at(-1);
    expect(made?.body).toMatchObject({ name: 'Autumn stays', templateKey: 'autumn_offer', audience: { connectionId: 'c1', table: 'guests', viewId: null } });
    expect(typeof made?.body?.scheduleAt).toBe('number');
  });

  it('shows a run’s results, “sent” never called delivered, and cancels only after a confirm', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      replies: {
        'GET /api/v1/sms/marketing/runs': { status: 200, body: { data: [run()], next: null } },
        'GET /api/v1/sms/marketing/runs/txr_1/people': { status: 200, body: { data: [{ id: 'p1', name: 'Zoë Martin', phone: '+1 ••• 161', country: 'US', state: 'handed', reason: null, delivery: { id: 'd1', state: 'accepted', reason: null, providerStatus: 'delivered', segments: 1 } }], next: null } },
        'POST /api/v1/sms/marketing/runs/txr_1/cancel': { status: 200, body: { data: run({ status: 'cancelled' }) } },
      },
    });
    await openTab(user, 'Marketing');
    await user.click(await screen.findByTestId('texts-mkt-run-open'));
    const results = await screen.findByTestId('texts-mkt-results');
    expect(within(results).getByTestId('texts-mkt-total-sent').textContent).toBe('Handed to the provider3');
    expect(within(results).getByTestId('texts-mkt-total-delivered').textContent).toBe('Delivered2');
    expect(within(results).getByTestId('texts-mkt-total-optOuts').textContent).toBe('Opted out after it1');
    expect(within(results).getAllByTestId('texts-mkt-results-skip').map((one) => one.getAttribute('data-reason'))).toEqual(['no-consent', 'stopped']);
    expect((await within(results).findByTestId('texts-mkt-results-row')).textContent).toContain('Delivered');
    await user.click(within(results).getByTestId('texts-mkt-results-cancel'));
    expect(writes()).toHaveLength(0);
    await user.click(await screen.findByTestId('texts-mkt-cancel-yes'));
    await waitFor(() => expect(writes().map((call) => call.url)).toEqual(['/api/v1/sms/marketing/runs/txr_1/cancel']));
  });
});
