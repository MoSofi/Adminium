// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/texts`.
 *
 * Mounted bare (no router), with the transport stubbed at `fetch`, so each
 * claim is about what reaches the wire and what the person reads. The keys
 * typed are deliberately not shaped like any provider's.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { PageActionsProvider, PageActionsSlot } from '../../shell/PageActionsProvider.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';

import type { Delivery, SendingLimits, SmsAccount, SmsSetup, StopEntry, TextTemplate } from './textsApi.js';
import { TextsPage } from './TextsPage.js';

const AT = Date.UTC(2026, 6, 28, 13, 5);

const account = (over: Partial<SmsAccount> = {}): SmsAccount => ({
  provider: 'twilio',
  accountName: 'Wr•••se',
  accountHint: '…7c1e',
  accountType: 'full',
  keyReadable: true,
  sender: { kind: 'number', value: '+12075550187' },
  senderTakesReplies: 'yes',
  defaultCountry: 'US',
  check: { ok: true, reason: null, at: AT },
  savedAt: AT,
  timeoutRetry: 'never',
  ...over,
});

const setupOf = (over: Partial<SmsSetup> = {}): SmsSetup => ({ reachability: { state: 'reachable', origin: 'https://admin.wren.example', notPort443: false }, repliesCanArrive: true, replies: { state: 'reachable', heardAt: AT }, account: account(), ...over });
const limitsOf = (over: Partial<SendingLimits> = {}): SendingLimits => ({ dailyLimit: 500, serviceHours: { from: '08:00', to: '21:00' }, usedToday: 412, warnAt: 400, day: '2026-07-28', dayZone: 'UTC', ...over });

const delivery = (over: Partial<Delivery>): Delivery => ({
  id: 'd1',
  createdAt: AT,
  updatedAt: AT,
  phoneMasked: '+1 ••• 177',
  textClass: 'service',
  state: 'accepted',
  reason: null,
  provider: 'twilio',
  providerStatus: 'delivered',
  providerErrorCode: null,
  segments: 1,
  price: { amount: '0.0420', currency: 'USD' },
  estimatedSegments: 1,
  encoding: 'gsm-7',
  attempts: 1,
  mayHaveGoneAt: AT,
  source: { app: 'hotel', table: 'stays' },
  ...over,
});

const PREARRIVAL: TextTemplate = {
  key: 'hotel-prearrival',
  name: 'Before you arrive',
  app: 'hotel',
  languages: [
    { locale: 'en_US', body: '{{hotel}}: Hi {{name}}, we expect you on {{date}}. Rooms are ready from 15:00.', enabled: true, edited: false, updatedAt: AT },
    { locale: 'de_DE', body: '{{hotel}}: Hallo {{name}}, wir erwarten Sie am {{date}}.', enabled: true, edited: false, updatedAt: AT },
  ],
};

const STOPS: StopEntry[] = [
  { id: 's1', phone: '+12075550169', masked: '+1 ••• 169', reason: 'text-stop', origin: '+12075550187', addedAt: AT, addedBy: null, erasedAt: null },
  { id: 's3', phone: '+97150000177', masked: '+971 ••• 177', reason: 'staff', origin: 'phone', addedAt: AT, addedBy: 'Maeve R.', erasedAt: null },
  { id: 's6', phone: null, masked: null, reason: 'erased', origin: null, addedAt: AT, addedBy: null, erasedAt: AT },
];

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}
type Reply = { status: number; body: unknown };

interface Stage {
  actions?: string[];
  roles?: string[];
  setup?: SmsSetup;
  limits?: SendingLimits;
  deliveries?: Delivery[];
  stops?: StopEntry[];
  templates?: TextTemplate[];
  connected?: boolean;
  /** The answer to a write, by `METHOD /tail`; a list is used up in order. */
  replies?: Record<string, Reply | Reply[]>;
}

function mount(stage: Stage = {}) {
  const calls: Call[] = [];
  const replies = stage.replies ?? {};
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>) });
      const tail = `${method} ${url.replace('/api/v1/sms', '').replace(/\?.*$/, '')}`;
      const planned = replies[tail];
      const reply = Array.isArray(planned) ? planned.shift() : planned;
      if (reply !== undefined) return Promise.resolve(jsonResponse(reply.status, reply.body));
      if (tail === 'GET /setup') return Promise.resolve(jsonResponse(200, { data: stage.setup ?? setupOf() }));
      if (tail === 'GET /sending-limits') return Promise.resolve(jsonResponse(200, { data: stage.limits ?? limitsOf() }));
      if (tail === 'GET /deliveries') return Promise.resolve(jsonResponse(200, { data: stage.deliveries ?? [], next: null }));
      if (tail === 'GET /stop-list') return Promise.resolve(jsonResponse(200, { data: stage.stops ?? [], next: null }));
      if (tail === 'GET /text-templates') return Promise.resolve(jsonResponse(200, { data: stage.templates ?? [PREARRIVAL], connected: stage.connected ?? true }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }));
    }),
  );
  const client = createQueryClient();
  client.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ roles: stage.roles ?? ['owner'], systemActions: (stage.actions ?? ['sms.manage']) as never }));
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
  return { calls, writes: () => calls.filter((call) => call.method !== 'GET') };
}

const refusal = (status: number, code: string, details: unknown): Reply => ({ status, body: { error: { code, message: 'English sentence the screen must not depend on', requestId: 'r', details } } });
const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(await screen.findByRole('tab', { name }));

beforeAll(() => installTestI18n());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => vi.restoreAllMocks());

describe('the gate', () => {
  it('shows a notice to someone with neither grant, and asks the server nothing', async () => {
    const { calls } = mount({ actions: ['settings.manage'] });
    expect(await screen.findByTestId('texts-no-access')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(calls.some((call) => call.url.includes('/sms/'))).toBe(false);
  });

  it('gives a desk Activity and the list, no Templates, and Setup as “ask the owner”', async () => {
    const { calls } = mount({ actions: ['privacy.people'] });
    expect(await screen.findByTestId('texts-setup-readonly')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Templates' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy();
    expect(calls.some((call) => call.url.includes('/sms/setup'))).toBe(false);
  });
});

describe('Setup', () => {
  it('says plainly when replies cannot arrive, and keeps the provider card usable', async () => {
    mount({ setup: setupOf({ repliesCanArrive: false, replies: { state: 'not-set', heardAt: null }, reachability: { state: 'not-set', origin: null, notPort443: false }, account: null }) });
    expect((await screen.findByTestId('texts-reach-problem')).textContent).toContain('can’t receive STOP replies or delivery reports. Marketing texts are off.');
    expect(screen.getByTestId('texts-connect')).toBeTruthy();
  });

  it('says “not yet heard from” until a reply arrives, and gives the address only when asked', async () => {
    const user = userEvent.setup();
    const address = 'https://admin.wren.example/api/v1/inbound/sms/twilio/made-up-door#rp=all&rc=5';
    const { calls } = mount({
      setup: setupOf({ repliesCanArrive: false, replies: { state: 'not-heard', heardAt: null } }),
      replies: { 'GET /reply-address': { status: 200, body: { data: { provider: 'twilio', state: 'not-heard', heardAt: null, inbound: address, statusCallback: address } } } },
    });
    const card = await screen.findByTestId('texts-reach');
    expect(card.textContent).toContain('Not yet heard from');
    expect(screen.getByTestId('texts-reach-waiting').textContent).toContain('marketing texts are off');
    expect(calls.some((call) => call.url.includes('/reply-address'))).toBe(false);
    await user.click(screen.getByTestId('texts-address-show'));
    expect((await screen.findByTestId('texts-address-inbound')).textContent).toBe(address);
    expect(screen.getByTestId('texts-address-steps-twilio').textContent).toContain('A message comes in');
    expect(calls.filter((call) => call.url.includes('/reply-address'))).toHaveLength(1);
  });

  it('says replies arrive once one has, with the day the first came', async () => {
    mount();
    expect((await screen.findByTestId('texts-reach')).textContent).toContain('Replies arrive');
    expect(screen.getByTestId('texts-reach-heard')).toBeTruthy();
  });

  it('connects Twilio: secrets are password fields, and the keys go out once', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ setup: setupOf({ account: null }), replies: { 'PUT /account': { status: 200, body: { data: account() } } } });
    await screen.findByTestId('texts-connect');
    expect(screen.getByTestId('texts-billed-on').textContent).toContain('billed on your Twilio account');
    expect((screen.getByTestId('texts-field-authToken') as HTMLInputElement).type).toBe('password');
    expect((screen.getByTestId('texts-field-accountSid') as HTMLInputElement).type).toBe('text');
    await user.type(screen.getByTestId('texts-field-accountSid'), 'sid-fixture-1');
    await user.type(screen.getByTestId('texts-field-authToken'), 'token-fixture-2');
    await user.click(screen.getByTestId('texts-key-check'));
    expect(await screen.findByTestId('texts-connected')).toBeTruthy();
    expect(writes()).toEqual([{ method: 'PUT', url: '/api/v1/sms/account', body: { provider: 'twilio', accountSid: 'sid-fixture-1', authToken: 'token-fixture-2' } }]);
  });

  it('shows Telnyx’s own fields when Telnyx is chosen', async () => {
    const user = userEvent.setup();
    mount({ setup: setupOf({ account: null }) });
    await user.click(await screen.findByTestId('texts-provider-telnyx'));
    expect((screen.getByTestId('texts-field-apiKey') as HTMLInputElement).type).toBe('password');
    expect(screen.getByTestId('texts-field-messagingProfileId')).toBeTruthy();
    expect(screen.getByTestId('texts-steps-telnyx')).toBeTruthy();
  });

  it('says a wrong paste beside its field', async () => {
    const user = userEvent.setup();
    mount({ setup: setupOf({ account: null }), replies: { 'PUT /account': refusal(422, 'VALIDATION_FAILED', { reason: 'SID_IN_TOKEN_FIELD', field: 'authToken' }) } });
    await user.type(await screen.findByTestId('texts-field-accountSid'), 'a');
    await user.type(screen.getByTestId('texts-field-authToken'), 'b');
    await user.click(screen.getByTestId('texts-key-check'));
    expect(await screen.findByText('That value is an Account SID. Paste the Auth Token here.')).toBeTruthy();
  });

  it('asks before keys of another account replace the current one, then sends the yes', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /account': [refusal(409, 'CONFLICT', { reason: 'account-changed', accountName: 'Ha•••gs' }), { status: 200, body: { data: account({ accountName: 'Ha•••gs', sender: null }) } }] } });
    await user.click(await screen.findByTestId('texts-replace'));
    await user.type(screen.getByTestId('texts-field-accountSid'), 'a');
    await user.type(screen.getByTestId('texts-field-authToken'), 'b');
    await user.click(screen.getByTestId('texts-key-check'));
    const asking = await screen.findByTestId('texts-changed');
    expect(asking.textContent).toContain('Ha•••gs');
    await user.click(screen.getByTestId('texts-changed-confirm'));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]?.body).toMatchObject({ confirmAccountChange: true });
  });

  it('names the account, and disconnects only after saying texts stop and keys go', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'DELETE /account': { status: 204, body: null } } });
    const card = await screen.findByTestId('texts-connected');
    expect(card.textContent).toContain('Connected to Wr•••se');
    expect(card.textContent).toContain('…7c1e');
    await user.click(screen.getByTestId('texts-disconnect'));
    expect((await screen.findByTestId('texts-disconnect-confirm')).textContent).toContain('Texts stop at once, and the keys are deleted');
    expect(writes()).toEqual([]);
    await user.click(screen.getByTestId('texts-disconnect-yes'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'DELETE', url: '/api/v1/sms/account', body: undefined }]));
  });

  it('never claims a registration state, and says it is between the business and the provider', async () => {
    mount();
    const card = await screen.findByTestId('texts-registration');
    expect(card.textContent).toContain('Twilio doesn’t tell us this for your sender. Check it there.');
    expect(card.textContent).toContain('Adminium can’t see it, approve it or speed it up.');
  });

  it('refuses mainland China in the countries table with the exact sentence, and marks service-only countries', async () => {
    mount();
    const cn = await screen.findByTestId('texts-country-CN');
    expect(cn.textContent).toContain('Adminium does not send texts to mainland China (+86). Neither provider can promise delivery, replies or a working opt-out there. Taiwan and Hong Kong are not affected.');
    expect(within(cn).queryByRole('button')).toBeNull();
    for (const code of ['AE', 'EG', 'SA', 'TW']) expect(screen.getByTestId(`texts-country-${code}`).textContent).toContain('Service only');
    expect(screen.getByTestId('texts-country-GB').textContent).not.toContain('Service only');
  });

  it('shows the meter in the warning tone from 80%, and the limit reached', async () => {
    mount();
    expect((await screen.findByTestId('texts-limits-meter')).textContent).toContain('412 / 500');
    expect(screen.queryByTestId('texts-limit-reached')).toBeNull();
    cleanup();
    mount({ limits: limitsOf({ usedToday: 500 }) });
    expect((await screen.findByTestId('texts-limit-reached')).textContent).toContain('Today’s limit is reached.');
  });

  it('saves the limit and the hours', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /sending-limits': { status: 200, body: { data: limitsOf({ dailyLimit: 600 }) } } } });
    const limit = await screen.findByTestId('texts-limit');
    await user.clear(limit);
    await user.type(limit, '600');
    await user.click(screen.getByTestId('texts-limits-save'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'PUT', url: '/api/v1/sms/sending-limits', body: { dailyLimit: 600, serviceHours: { from: '08:00', to: '21:00' } } }]));
  });

  it('sends the one fixed test text and says it was handed over, never delivered', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'POST /test': { status: 200, body: { data: { outcome: 'accepted', reason: null, detail: null, resend: null, providerCode: null } } } } });
    await user.click(await screen.findByTestId('texts-test-open'));
    await user.type(screen.getByTestId('texts-test-to'), '+12075550161');
    await user.click(screen.getByTestId('texts-test-send'));
    expect((await screen.findByTestId('texts-test-result')).textContent).toContain('Handed to Twilio');
    expect(writes()).toEqual([{ method: 'POST', url: '/api/v1/sms/test', body: { to: '+12075550161' } }]);
  });
});

describe('Templates', () => {
  it('lists the templates, and opens the editor with the counter on the filled text', async () => {
    const user = userEvent.setup();
    mount();
    await openTab(user, 'Templates');
    await user.click(await screen.findByTestId('texts-template-hotel-prearrival'));
    const counter = await screen.findByTestId('texts-counter');
    expect(counter.getAttribute('data-encoding')).toBe('gsm-7');
    expect(screen.getByTestId('texts-editor-optout').textContent).toContain('Reply STOP to opt out.');
    expect(screen.getByTestId('texts-preview-text').textContent).toContain('Reply STOP to opt out.');
  });

  it('turns Unicode on one character, points at it, and offers a plain one', async () => {
    const user = userEvent.setup();
    mount();
    await openTab(user, 'Templates');
    await user.click(await screen.findByTestId('texts-template-hotel-prearrival'));
    const body = await screen.findByTestId('texts-editor-body');
    await user.clear(body);
    await user.type(body, 'We’re ready');
    expect(screen.getByTestId('texts-counter').getAttribute('data-encoding')).toBe('ucs-2');
    expect(screen.getByTestId('texts-editor-unicode').textContent).toContain('’');
    await user.click(screen.getByTestId('texts-editor-plain'));
    expect((screen.getByTestId('texts-editor-body') as HTMLTextAreaElement).value).toBe("We're ready");
    expect(screen.getByTestId('texts-counter').getAttribute('data-encoding')).toBe('gsm-7');
  });

  it('refuses Reply YES beside the words and will not save it', async () => {
    const user = userEvent.setup();
    const { writes } = mount();
    await openTab(user, 'Templates');
    await user.click(await screen.findByTestId('texts-template-hotel-prearrival'));
    const body = await screen.findByTestId('texts-editor-body');
    await user.clear(body);
    await user.type(body, 'Reply YES to confirm');
    expect(screen.getByTestId('texts-problem-asks-for-yes').textContent).toContain('Ask people to agree on a form instead.');
    expect((screen.getByTestId('texts-editor-save') as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('changes the opt-out line for a sender name, and refuses +86 in the preview', async () => {
    const user = userEvent.setup();
    mount();
    await openTab(user, 'Templates');
    await user.click(await screen.findByTestId('texts-template-hotel-prearrival'));
    await user.selectOptions(await screen.findByTestId('texts-editor-sender'), 'name');
    expect(screen.getByTestId('texts-editor-optout').textContent).toContain('To stop these texts, contact +1 555 0100.');
    await user.selectOptions(screen.getByTestId('texts-editor-country'), 'CN');
    expect((await screen.findByTestId('texts-preview-cn')).textContent).toContain('Adminium does not send texts to mainland China (+86).');
  });

  it('falls back to English for an empty language, and saves a language', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /text-templates/hotel-prearrival/da_DK': { status: 200, body: { data: PREARRIVAL } } } });
    await openTab(user, 'Templates');
    await user.click(await screen.findByTestId('texts-template-hotel-prearrival'));
    await user.click(await screen.findByTestId('texts-language-da_DK'));
    expect(screen.getByTestId('texts-preview').textContent).toContain('People who read Dansk get this in English.');
    await user.type(screen.getByTestId('texts-editor-body'), 'Hej');
    await user.click(screen.getByTestId('texts-editor-save'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'PUT', url: '/api/v1/sms/text-templates/hotel-prearrival/da_DK', body: { body: 'Hej' } }]));
  });

  it('explains an empty list', async () => {
    const user = userEvent.setup();
    mount({ templates: [] });
    await openTab(user, 'Templates');
    expect((await screen.findByTestId('texts-templates-empty')).textContent).toContain('No app has installed a text template yet');
  });
});

describe('Activity', () => {
  const rows = [
    delivery({ id: 'u1', state: 'unknown', reason: 'timeout', providerStatus: null, segments: null, price: null }),
    delivery({ id: 'd2' }),
    delivery({ id: 'd3', state: 'accepted', providerStatus: 'queued', price: null, segments: null }),
    delivery({ id: 'd4', state: 'skipped', reason: 'country-blocked', provider: null, providerStatus: null, price: null, mayHaveGoneAt: null }),
  ];

  it('calls handed-over texts sent, never delivered, and words each skip', async () => {
    const user = userEvent.setup();
    mount({ deliveries: rows });
    await openTab(user, 'Activity');
    const table = await screen.findByTestId('texts-activity-table');
    expect(table.textContent).toContain('Delivered');
    expect(table.textContent).toContain('Handed to the provider');
    expect(table.textContent).toContain('Not sent. Adminium does not send texts to mainland China (+86).');
  });

  it('lets the owner say an unknown was not sent, after declaring it', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ deliveries: rows, replies: { 'POST /deliveries/u1/settle': { status: 200, body: { data: { ...rows[0], state: 'checked-not-sent' } } } } });
    await openTab(user, 'Activity');
    const unknown = await screen.findByTestId('texts-unknown-card');
    expect(unknown.textContent).toContain('We didn’t get an answer from Twilio. It may have sent this text. Adminium won’t send it again by itself.');
    await user.click(within(unknown).getByTestId('texts-settle-not-sent'));
    const confirm = await screen.findByTestId('texts-settle-confirm');
    expect(confirm.textContent).toContain('I checked Twilio and this text was not sent.');
    expect(confirm.textContent).toContain('the person gets it twice and the business pays twice');
    expect(writes()).toEqual([]);
    await user.click(screen.getByTestId('texts-settle-not-sent-yes'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'POST', url: '/api/v1/sms/deliveries/u1/settle', body: { answer: 'not-sent' } }]));
  });

  it('shows a desk “ask the owner” and no way to settle', async () => {
    const user = userEvent.setup();
    mount({ actions: ['privacy.people'], deliveries: rows });
    await openTab(user, 'Activity');
    expect((await screen.findByTestId('texts-unknown-ask')).textContent).toContain('Ask the owner');
    expect(screen.queryByTestId('texts-settle-went')).toBeNull();
  });
});

describe('the do-not-text list', () => {
  it('says what the list does, keeps an erased person with no Remove, and gives Remove to the Super Admin only', async () => {
    const user = userEvent.setup();
    mount({ stops: STOPS });
    await openTab(user, 'Do-not-text list');
    expect((await screen.findByTestId('texts-stop-line')).textContent).toBe('Nobody here gets any text from this business, including service texts.');
    expect(screen.getByTestId('texts-stop-erased').textContent).toContain('Erased person, kept so they’re never texted again');
    expect(screen.queryByTestId('texts-stop-remove')).toBeNull();
    cleanup();
    mount({ stops: STOPS, roles: ['super-admin'] });
    await openTab(user, 'Do-not-text list');
    expect(await screen.findAllByTestId('texts-stop-remove')).toHaveLength(2);
  });

  it('lets a desk record a stop request made in person', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ actions: ['privacy.people'], replies: { 'POST /stop-list': { status: 200, body: { data: STOPS[1], added: true } } } });
    await openTab(user, 'Do-not-text list');
    await user.click(await screen.findByTestId('texts-stop-add'));
    await user.type(screen.getByTestId('texts-stop-phone'), '+971500000177');
    await user.selectOptions(screen.getByTestId('texts-stop-how'), 'in-person');
    await user.click(screen.getByTestId('texts-stop-save'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'POST', url: '/api/v1/sms/stop-list', body: { phone: '+971500000177', asked: 'in-person' } }]));
  });
});
