// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/shipping`.
 *
 * Mounted bare (no router), with the transport stubbed at `fetch`, so each
 * claim is about what reaches the wire and what the person reads. The pasted
 * value is deliberately not shaped like any provider's key.
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

import { ShippingPage } from './ShippingPage.js';
import type { CarrierAccount, CarrierView, ShippingStatus, TrackingView } from './shippingApi.js';

const PASTED = 'plain-fixture-value-7f3a';
const STATUS_URL = '/api/v1/apps/print-shop/shipping';

const account = (over: Partial<CarrierAccount> = {}): CarrierAccount => ({ mode: 'live', keyHint: '••••a1B2', state: 'ok', carriers: ['Evri', 'DPD'], checkedAt: 1_700_000_000_000, ...over });
const shippo = (over: Partial<CarrierView> = {}): CarrierView => ({ key: 'shipping-shippo', name: 'Shipping labels', locked: false, on: true, connected: false, account: null, openBookings: { count: 0, orders: [] }, ...over });
const connected = (over: Partial<CarrierAccount> = {}, more: Partial<CarrierView> = {}) => shippo({ connected: true, account: account(over), ...more });
const dhl = (): CarrierView => ({ key: 'shipping-dhl', name: 'DHL Shipping', locked: true, on: true, connected: false, account: null, openBookings: { count: 0, orders: [] } });

function statusOf(carriers: CarrierView[], over: Partial<ShippingStatus> = {}): ShippingStatus {
  return {
    appUpdated: true,
    carriers,
    activeCarrier: null,
    shipFrom: { country: 'GB' },
    shipFromMissing: [],
    international: false,
    labelSize: 'a4',
    limits: { perLabel: null, dailyLabels: null, packersAbroad: false, usedToday: 0 },
    ...over,
  };
}

function trackingOf(over: Partial<TrackingView['webhook']> = {}, parcels: Partial<TrackingView['parcels']> = {}): TrackingView {
  return {
    carrier: 'shipping-shippo',
    webhook: { supported: true, address: null, made: false, ended: false, publicAddress: true, madeAt: null, firstAt: null, lastAt: null, lastBadAt: null, ...over },
    parcels: { open: 3, neverChecked: 1, oldestCheckedAt: 1_700_000_000_000, quiet: 2, ...parcels },
    polling: { allowed: false, on: false },
  };
}

function addOn(key: string, name: string, app = 'print-shop', hostInstall = 'ins_print') {
  return {
    key,
    name,
    version: '1.0.0',
    connectionId: 'con_shop',
    connectionName: 'Shop',
    connectKind: 'api-key',
    connected: false,
    missing: false,
    connectionExpiresAt: null,
    attachments: [{ attachedTo: app, enabled: true, connectionId: 'con_shop', hostInstall }],
    slots: [],
    provides: [{ contract: 'shipping-carrier', version: 2 }],
    networkAllow: [],
    settings: key === 'shipping-shippo' ? [{ key: 'api_key', type: 'string', required: true, secret: true, label: { key: 'k', fallback: 'API key' }, help: null, options: [] }] : [],
    settingValues: {},
    bundles: [],
  };
}

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

type Reply = { status: number; body: unknown };

interface Stage {
  status?: ShippingStatus;
  tracking?: TrackingView;
  actions?: string[];
  addOns?: unknown[];
  /** The answer to a write, by `METHOD /tail`; a list is used up in order. */
  replies?: Record<string, Reply | Reply[]>;
}

function mount(stage: Stage) {
  const calls: Call[] = [];
  let status = stage.status ?? statusOf([shippo(), dhl()]);
  const tracking = stage.tracking ?? trackingOf();
  const replies = stage.replies ?? {};
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>) });
      if (url === '/api/v1/add-ons') return Promise.resolve(jsonResponse(200, { addOns: stage.addOns ?? [addOn('shipping-shippo', 'Shipping labels'), addOn('shipping-dhl', 'DHL Shipping')] }));
      if (url === '/api/v1/apps') return Promise.resolve(jsonResponse(200, { apps: [{ key: 'print-shop', installId: 'ins_print', name: 'Print Shop', connectionId: 'con_shop', connectionName: 'Shop', version: '1', source: 'package', installedAt: 1, sides: [], missing: false }], staged: [] }));
      if (method === 'GET' && url.startsWith(STATUS_URL) && url.endsWith('/tracking')) return Promise.resolve(jsonResponse(200, { data: structuredClone(tracking) }));
      if (method === 'GET' && url.endsWith('/shipping')) return Promise.resolve(jsonResponse(200, { data: status }));
      const tail = `${method} ${url.slice(url.indexOf('/shipping') + '/shipping'.length)}`;
      const planned = replies[tail];
      const reply = Array.isArray(planned) ? planned.shift() : planned;
      if (reply !== undefined) {
        const data = (reply.body as { data?: ShippingStatus } | null)?.data;
        if (reply.status === 200 && data !== undefined && 'carriers' in data) status = data;
        return Promise.resolve(jsonResponse(reply.status, reply.body));
      }
      return Promise.resolve(jsonResponse(200, { data: status }));
    }),
  );
  const client = createQueryClient();
  client.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ roles: ['editor'], systemActions: (stage.actions ?? ['shipping.manage']) as never }));
  const view = render(
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <PageActionsProvider>
          <PageActionsSlot />
          <Suspense fallback={null}>
            <ShippingPage />
          </Suspense>
        </PageActionsProvider>
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { calls, client, view, writes: () => calls.filter((call) => call.method !== 'GET') };
}

const refusal = (status: number, code: string, details: unknown): Reply => ({ status, body: { error: { code, message: 'English sentence the screen must not depend on', requestId: 'r', details } } });

async function openConnection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('shipping-more-shipping-shippo'));
  return screen.findByTestId('shipping-carrier-shipping-shippo');
}

const textOf = (element: Element | null): string => element?.textContent ?? '';
/** What `aria-describedby` points at, as a screen reader would read it. */
const describedBy = (element: Element): string =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => textOf(id === '' ? null : document.getElementById(id)))
    .join(' ');

const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(await screen.findByRole('tab', { name }));

beforeAll(() => installTestI18n());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => vi.restoreAllMocks());

describe('the gate', () => {
  it('shows the notice without the grant, whatever the role, and asks the server nothing', async () => {
    const { calls } = mount({ actions: ['settings.manage'] });
    expect(await screen.findByText('You need permission to manage shipping')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(calls.some((call) => call.url.includes('/shipping'))).toBe(false);
    expect(screen.getAllByTestId('shipping-not-affiliated')).toHaveLength(1);
  });

  it('opens for a custom role that holds the grant', async () => {
    mount({});
    expect(await screen.findByRole('tab', { name: 'Setup' })).toBeTruthy();
    expect(screen.queryByTestId('shipping-no-access')).toBeNull();
  });

  it('says so plainly when no app ships', async () => {
    mount({ addOns: [] });
    expect(await screen.findByTestId('shipping-no-apps')).toBeTruthy();
  });
});

describe('Ship with', () => {
  it('cannot pick a carrier before a check has passed', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([shippo({ connected: true }), dhl()]) });
    const row = within(await screen.findByTestId('shipping-row-shipping-shippo')).getByRole('radio');
    expect((row).getAttribute('aria-disabled')).toBe('true');
    expect(within(screen.getByTestId('shipping-row-shipping-shippo')).getByText('Not checked')).toBeTruthy();
    await user.click(row);
    expect(writes()).toHaveLength(0);
  });

  it('picks a checked carrier once, and an arrow key alone changes nothing', async () => {
    const user = userEvent.setup();
    const after = statusOf([connected(), dhl()], { activeCarrier: 'shipping-shippo' });
    const { writes } = mount({ status: statusOf([connected(), dhl()], { activeCarrier: 'shipping-dhl' }), replies: { 'PUT /active-carrier': { status: 200, body: { data: after } } } });
    const dhlRow = within(await screen.findByTestId('shipping-row-shipping-dhl')).getByRole('radio');
    dhlRow.focus();
    await user.keyboard('{ArrowDown}');
    expect(writes()).toHaveLength(0);
    await user.keyboard(' ');
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ carrier: 'shipping-shippo' });
  });

  it('a locked carrier shows no key input and no switch, and the sentence word for word', async () => {
    const user = userEvent.setup();
    mount({});
    await user.click(await screen.findByTestId('shipping-more-shipping-dhl'));
    const card = await screen.findByTestId('shipping-locked-card');
    expect(within(card).getByText("Real DHL booking is not available yet. This add-on is a demo. To ship now, use Shippo, or book on DHL's own site and type the tracking number.")).toBeTruthy();
    expect(card.querySelector('input')).toBeNull();
    expect(within(card).queryByRole('switch')).toBeNull();
    const link = within(card).getByRole('link', { name: /DHL's own site/ });
    expect((link).getAttribute('rel')).toBe('noopener noreferrer');
    expect(textOf(link)).toContain('opens in a new tab');
  });

  it('gives each attached app a card, and a picker once you are inside one', async () => {
    const user = userEvent.setup();
    const both = [{ ...addOn('shipping-shippo', 'Shipping labels'), attachments: [{ attachedTo: 'print-shop', enabled: true, connectionId: 'con_shop', hostInstall: 'ins_print' }, { attachedTo: 'maker-shop', enabled: true, connectionId: 'con_shop', hostInstall: 'ins_maker' }] }];
    mount({ addOns: both, status: statusOf([shippo()]) });
    expect(await screen.findByTestId('shipping-app-ins_print')).toBeTruthy();
    expect(await screen.findByTestId('shipping-app-ins_maker')).toBeTruthy();
    expect(screen.queryByTestId('shipping-app-picker')).toBeNull();
    await openTab(user, 'Label size');
    expect(await screen.findByTestId('shipping-app-picker')).toBeTruthy();
  });
});

describe('the key', () => {
  it('sends the field the add-on declares, then shows only the hint', async () => {
    const user = userEvent.setup();
    const saved = statusOf([connected(), dhl()]);
    const { writes, view } = mount({ replies: { 'PUT /carriers/shipping-shippo/key': { status: 200, body: { data: saved } } } });
    const card = await openConnection(user);
    const input = within(card).getByLabelText('Shippo API key');
    expect((input).getAttribute('type')).toBe('password');
    expect((input).getAttribute('autocomplete')).toBe('new-password');
    await user.type(input, PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    expect(textOf(await screen.findByTestId('shipping-key-hint'))).toContain('••••a1B2');
    expect(writes()[0]!.body).toEqual({ fields: { api_key: PASTED } });
    expect(view.container.innerHTML).not.toContain(PASTED);
    expect(document.body.innerHTML).not.toContain(PASTED);
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
  });

  it('takes the field names from the refusal when the list cannot say, and resends once', async () => {
    const user = userEvent.setup();
    const saved = statusOf([connected(), dhl()]);
    const { writes } = mount({
      addOns: [{ ...addOn('shipping-shippo', 'Shipping labels'), settings: [] }, addOn('shipping-dhl', 'DHL Shipping')],
      replies: { 'PUT /carriers/shipping-shippo/key': [refusal(422, 'KEY_FIELDS', { carrier: 'shipping-shippo', expected: ['api_key'] }), { status: 200, body: { data: saved } }] },
    });
    const card = await openConnection(user);
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    await screen.findByTestId('shipping-key-hint');
    expect(writes().map((call) => Object.keys((call.body as { fields: object }).fields))).toEqual([['key'], ['api_key']]);
  });

  it('keeps the paste under its real field name through a different-account confirmation, then clears it', async () => {
    const user = userEvent.setup();
    const saved = statusOf([connected({ keyHint: '••••z9Y8' }), dhl()]);
    const { writes } = mount({
      status: statusOf([connected(), dhl()]),
      addOns: [{ ...addOn('shipping-shippo', 'Shipping labels'), settings: [] }, addOn('shipping-dhl', 'DHL Shipping')],
      replies: {
        'PUT /carriers/shipping-shippo/key': [
          refusal(422, 'KEY_FIELDS', { carrier: 'shipping-shippo', expected: ['api_key'] }),
          refusal(409, 'KEY_OTHER_ACCOUNT', { carrier: 'shipping-shippo', from: { mode: 'live', keyHint: '••••a1B2' }, to: { mode: 'live' } }),
          { status: 200, body: { data: saved } },
        ],
      },
    });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    await screen.findByTestId('shipping-other-account');
    await user.click(screen.getByTestId('shipping-other-confirm'));
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[2]!.body).toEqual({ fields: { api_key: PASTED }, confirmAccountChange: true });
    expect(textOf(await screen.findByTestId('shipping-key-hint'))).toContain('••••z9Y8');
    expect(document.body.innerHTML).not.toContain(PASTED);
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
  });

  it('says how many bookings hold the key when it may name none of their orders', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected({}, { openBookings: { count: 3, orders: [] } }), dhl()]) });
    const card = await openConnection(user);
    const locked = within(card).getByTestId('shipping-key-locked');
    expect(textOf(within(locked).getByTestId('shipping-key-locked-unnamed'))).toContain('3 bookings hold it, on orders you cannot open here.');
    expect(textOf(locked)).not.toContain('Orders:');
    expect(within(card).getByTestId('shipping-key-replace').getAttribute('aria-disabled')).toBe('true');
  });

  it('a shape that looks wrong is a hint and still reaches the server', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /carriers/shipping-shippo/key': refusal(422, 'KEY_REFUSED', { carrier: 'shipping-shippo', carrierMessage: 'raw words from the carrier' }) } });
    const card = await openConnection(user);
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    expect(within(card).getByTestId('shipping-key-shape')).toBeTruthy();
    await user.click(within(card).getByTestId('shipping-key-save'));
    expect(textOf(await screen.findByTestId('shipping-key-error'))).toContain('Shippo did not accept this key. Nothing was saved.');
    expect(writes()).toHaveLength(1);
    expect(screen.queryByText(/raw words/)).toBeNull();
    expect((within(card).getByLabelText('Shippo API key') as HTMLInputElement).value).toBe('');
  });

  it('KEY_IN_USE makes Replace aria-disabled, with the reason and the orders named', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      status: statusOf([connected(), dhl()], { activeCarrier: 'shipping-shippo' }),
      replies: { 'PUT /carriers/shipping-shippo/key': refusal(409, 'KEY_IN_USE', { carrier: 'shipping-shippo', count: 3, orders: ['MP-4119', 'NL-1059'] }) },
    });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    const locked = await screen.findByTestId('shipping-key-locked');
    expect(textOf(locked)).toContain('MP-4119');
    expect(textOf(locked)).toContain('NL-1059');
    expect(textOf(locked)).toContain('and 1 more');
    const replace = within(card).getByTestId('shipping-key-replace');
    expect((replace).getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(replace)).toContain('cannot change');
    await user.click(replace);
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
    expect(writes()).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(PASTED);
  });

  it('KEY_OTHER_ACCOUNT asks, and resends the same paste with the confirmation', async () => {
    const user = userEvent.setup();
    const saved = statusOf([connected({ keyHint: '••••z9Y8' }), dhl()]);
    const { writes } = mount({
      status: statusOf([connected(), dhl()]),
      replies: {
        'PUT /carriers/shipping-shippo/key': [refusal(409, 'KEY_OTHER_ACCOUNT', { carrier: 'shipping-shippo', from: { mode: 'live', keyHint: '••••a1B2' }, to: { mode: 'live' } }), { status: 200, body: { data: saved } }],
      },
    });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    expect(textOf(await screen.findByTestId('shipping-other-account'))).toContain('••••a1B2');
    expect(writes()).toHaveLength(1);
    await user.click(screen.getByTestId('shipping-other-confirm'));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]!.body).toEqual({ fields: { api_key: PASTED }, confirmAccountChange: true });
    expect(textOf(await screen.findByTestId('shipping-key-hint'))).toContain('••••z9Y8');
    expect(document.body.innerHTML).not.toContain(PASTED);
  });

  it('names the open orders and holds Replace from the first paint, with nothing pasted', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([connected({ mode: 'test' }, { openBookings: { count: 22, orders: ['MP-4119', 'NL-1059'] } }), dhl()]) });
    const card = await openConnection(user);
    const locked = within(card).getByTestId('shipping-key-locked');
    expect(textOf(locked)).toContain('MP-4119');
    expect(textOf(locked)).toContain('NL-1059');
    expect(textOf(locked)).toContain('and 20 more');
    for (const id of ['shipping-key-replace', 'shipping-replace-live']) {
      const control = within(card).getByTestId(id);
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(describedBy(control)).toContain('cannot change');
      await user.click(control);
    }
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it('a refused check on a held key keeps Paste a new key held too', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected({ state: 'refused' }, { openBookings: { count: 1, orders: ['MP-4119'] } }), dhl()]) });
    const card = await openConnection(user);
    const paste = within(card).getByTestId('shipping-paste-new');
    expect(paste.getAttribute('aria-disabled')).toBe('true');
    await user.click(paste);
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
  });

  it('with no key saved, KEY_IN_USE still says why and names the orders', async () => {
    const user = userEvent.setup();
    mount({ replies: { 'PUT /carriers/shipping-shippo/key': refusal(409, 'KEY_IN_USE', { carrier: 'shipping-shippo', count: 1, orders: ['MP-4119'] }) } });
    const card = await openConnection(user);
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    expect(textOf(await screen.findByTestId('shipping-key-locked'))).toContain('MP-4119');
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
    expect(document.body.innerHTML).not.toContain(PASTED);
  });

  it('replacing a key that had an address says the address is gone', async () => {
    const user = userEvent.setup();
    const tracking = trackingOf({ made: true, address: 'https://admin.shop.example/hook?token=••••alue', madeAt: 5 });
    const saved = statusOf([connected({ keyHint: '••••z9Y8' }), dhl()]);
    mount({ status: statusOf([connected(), dhl()]), tracking, replies: { 'PUT /carriers/shipping-shippo/key': { status: 200, body: { data: saved } } } });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    tracking.webhook = { ...tracking.webhook, made: false, ended: true, address: null, madeAt: null };
    await user.click(within(card).getByTestId('shipping-key-save'));
    expect(textOf(await screen.findByTestId('shipping-address-gone'))).toContain('stopped working when the key changed');
  });

  it('says the address ended on a later visit, with nothing replaced in this session', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected(), dhl()]), tracking: trackingOf({ ended: true }) });
    const card = await openConnection(user);
    expect(textOf(await within(card).findByTestId('shipping-address-gone'))).toContain('stopped working when the key changed');
  });

  it('replacing a key that never had an address claims nothing about one', async () => {
    const user = userEvent.setup();
    const saved = statusOf([connected({ keyHint: '••••z9Y8' }), dhl()]);
    mount({ status: statusOf([connected(), dhl()]), replies: { 'PUT /carriers/shipping-shippo/key': { status: 200, body: { data: saved } } } });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-save'));
    await waitFor(() => expect(textOf(screen.getByTestId('shipping-key-hint'))).toContain('z9Y8'));
    expect(screen.queryByTestId('shipping-address-gone')).toBeNull();
    await openTab(user, 'Tracking');
    expect(await screen.findByTestId('shipping-webhook-make')).toBeTruthy();
    expect(screen.queryByTestId('shipping-tracking-gone')).toBeNull();
  });

  it('Keep current key closes the form, sends nothing and drops what was typed', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([connected(), dhl()]) });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    await user.type(within(card).getByLabelText('Shippo API key'), PASTED);
    await user.click(within(card).getByTestId('shipping-key-keep'));
    expect(screen.queryByLabelText('Shippo API key')).toBeNull();
    expect(writes()).toHaveLength(0);
    await user.click(within(card).getByTestId('shipping-key-replace'));
    expect((within(card).getByLabelText('Shippo API key') as HTMLInputElement).value).toBe('');
  });

  it('never ticks the steps Adminium cannot know', async () => {
    const user = userEvent.setup();
    mount({});
    const card = await openConnection(user);
    expect(textOf(within(card).getByTestId('shipping-known-count'))).toContain('0 of 2 confirmed here');
    expect(within(card).queryByLabelText('Done')).toBeNull();
    expect((within(card).getByRole('link', { name: /Open Shippo/ })).getAttribute('href')).toBe('https://apps.goshippo.com/join');
  });
});

describe('Check connection', () => {
  const checking = async (user: ReturnType<typeof userEvent.setup>, before: CarrierView, reply: unknown, after: CarrierView) => {
    const next = statusOf([after, dhl()]);
    mount({ status: statusOf([before, dhl()]), replies: { 'POST /carriers/shipping-shippo/check': { status: 200, body: { data: reply } } } });
    const card = await openConnection(user);
    return { card, next };
  };

  it('live: names the carriers and the country, and says what is still needed', async () => {
    const user = userEvent.setup();
    const { card } = await checking(user, connected(), { outcome: 'ok', mode: 'live', carriers: ['Evri', 'DPD'], country: 'GB' }, connected());
    expect(textOf(within(card).getByTestId('shipping-result-live'))).toContain('Live key. These carriers answer for United Kingdom: Evri, DPD.');
    expect(within(card).getByText('The key works. Choose Shippo under Ship with to use it.')).toBeTruthy();
    expect(within(card).getByTestId('shipping-check-again')).toBeTruthy();
  });

  it('test: shows the Go live steps and the banner', async () => {
    const user = userEvent.setup();
    const { card } = await checking(user, connected({ mode: 'test' }), { outcome: 'ok', mode: 'test', carriers: ['Evri'], country: 'GB' }, connected({ mode: 'test' }));
    expect(textOf(within(card).getByTestId('shipping-result-test'))).toContain('Go live');
    expect(within(card).getByText('Replace with a live key')).toBeTruthy();
    expect(within(card).getByTestId('shipping-check-again')).toBeTruthy();
    expect(screen.getByTestId('shipping-test-banner')).toBeTruthy();
  });

  it('bad: says the key was not accepted, with a way to paste a new one', async () => {
    const user = userEvent.setup();
    await checking(user, connected({ state: 'refused' }), { outcome: 'refused' }, connected({ state: 'refused' }));
    expect(textOf(screen.getByTestId('shipping-result-bad'))).toContain('Shippo did not accept this key.');
    expect(screen.getByText('Paste a new key')).toBeTruthy();
    expect(screen.getByTestId('shipping-check-again')).toBeTruthy();
  });

  it('none: says no carrier answers for the country', async () => {
    const user = userEvent.setup();
    await checking(user, connected({ carriers: [] }), { outcome: 'ok', mode: 'live', carriers: [], country: 'GB' }, connected({ carriers: [] }));
    expect(textOf(screen.getByTestId('shipping-result-none'))).toContain('Shippo has no carrier for United Kingdom on this account.');
    expect(screen.getByTestId('shipping-check-again')).toBeTruthy();
  });

  it('a refused check on a key with no account record still reads as bad', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([shippo({ connected: true }), dhl()]), replies: { 'POST /carriers/shipping-shippo/check': { status: 200, body: { data: { outcome: 'refused' } } } } });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-check'));
    expect(textOf(await within(card).findByTestId('shipping-result-bad'))).toContain('Shippo did not accept this key.');
  });

  it('did not answer: never reads as a bad key, and can be checked again', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected(), dhl()]), replies: { 'POST /carriers/shipping-shippo/check': { status: 200, body: { data: { outcome: 'unreachable' } } } } });
    const card = await openConnection(user);
    await user.click(within(card).getByTestId('shipping-check-again'));
    const result = await within(card).findByTestId('shipping-result-no-answer');
    expect(textOf(result)).toContain('Shippo did not answer. Try again.');
    expect(within(card).getByText('This says nothing about your key. It stays as it was.')).toBeTruthy();
    expect(within(card).queryByTestId('shipping-result-bad')).toBeNull();
    expect(within(card).getByTestId('shipping-check-again')).toBeTruthy();
  });
});

describe('Label size', () => {
  it('saves once on commit, and not on each arrow key', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ replies: { 'PUT /label-size': { status: 200, body: { data: { labelSize: '4x6' } } } } });
    await openTab(user, 'Label size');
    const first = await screen.findByTestId('shipping-size-a4');
    first.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect((screen.getByTestId('shipping-size-4x6')).getAttribute('aria-checked')).toBe('true');
    expect(writes()).toHaveLength(0);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ size: '4x6' });
    await user.tab();
    expect(writes()).toHaveLength(1);
  });

  it('says it is the size asked for', async () => {
    const user = userEvent.setup();
    mount({});
    await openTab(user, 'Label size');
    expect(await screen.findByText(/A carrier may return another size/)).toBeTruthy();
  });
});

describe('what the owner is told goes to the carrier', () => {
  const opened = async (international: boolean) => {
    const user = userEvent.setup();
    mount({ status: statusOf([shippo()], { international }) });
    const card = await openConnection(user);
    return within(card).findByText(/billed to you/);
  };

  it('stays word for word for a shop that keeps to its own country', async () => {
    expect((await opened(false)).textContent).not.toContain('declared values');
  });

  it('adds goods and declared values once the shop sends parcels abroad', async () => {
    expect((await opened(true)).textContent).toContain('goods descriptions and declared values also go to Shippo');
  });
});

describe('Who can buy labels', () => {
  it('ties one error to each field and sends nothing', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([connected()], { limits: { perLabel: { amount: '25.00', currency: 'USD' }, dailyLabels: 20, packersAbroad: false, usedToday: 7 } }) });
    await openTab(user, 'Who can buy labels');
    const per = await screen.findByTestId('shipping-limit-per');
    const day = screen.getByTestId('shipping-limit-day');
    await user.clear(per);
    await user.type(per, '0');
    await user.clear(day);
    await user.type(day, 'x');
    await user.click(screen.getByTestId('shipping-limit-save'));
    expect(await screen.findByTestId('shipping-limit-per-error')).toBeTruthy();
    expect(describedBy(per)).toContain('most a packer can spend');
    expect(describedBy(day)).toContain('all packers together');
    expect(writes()).toHaveLength(0);
  });

  it('draws no abroad switch for a shop that does not send parcels abroad', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { limits: { perLabel: { amount: '25.00', currency: 'USD' }, dailyLabels: 20, packersAbroad: false, usedToday: 0 } }) });
    await openTab(user, 'Who can buy labels');
    await screen.findByTestId('shipping-limit-per');
    expect(screen.queryByTestId('shipping-abroad')).toBeNull();
  });

  it('turns packers abroad on with the limits as they are', async () => {
    const user = userEvent.setup();
    const status = statusOf([connected()], { international: true, limits: { perLabel: { amount: '25.00', currency: 'USD' }, dailyLabels: 20, packersAbroad: false, usedToday: 0 } });
    const { writes } = mount({ status, replies: { 'PUT /limits': { status: 200, body: { data: status } } } });
    await openTab(user, 'Who can buy labels');
    await user.click(await screen.findByTestId('shipping-abroad-switch'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ perLabel: { amount: '25.00', currency: 'USD' }, dailyLabels: 20, packersAbroad: true });
  });

  it('says the abroad switch does nothing until a limit is set', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { international: true }) });
    await openTab(user, 'Who can buy labels');
    expect((await screen.findByTestId('shipping-abroad')).textContent).toContain('no effect until a packer limit is set');
  });

  it('saves both limits, with a comma read as a decimal point', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([connected()], { limits: { perLabel: { amount: '25.00', currency: 'USD' }, dailyLabels: 20, packersAbroad: false, usedToday: 7 } }) });
    await openTab(user, 'Who can buy labels');
    const per = await screen.findByTestId('shipping-limit-per');
    await user.clear(per);
    await user.type(per, '12,50');
    await user.click(screen.getByTestId('shipping-limit-save'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ perLabel: { amount: '12.50', currency: 'USD' }, dailyLabels: 20 });
  });

  it('shows the day count for all packers together, and removes the limits', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([connected()], { limits: { perLabel: { amount: '25.00', currency: 'USD' }, dailyLabels: 20, packersAbroad: false, usedToday: 7 } }) });
    await openTab(user, 'Who can buy labels');
    const used = await screen.findByTestId('shipping-limit-used');
    expect(textOf(used)).toContain('7 of 20');
    expect(textOf(used)).toContain('bought by all packers together');
    expect((within(used).getByRole('meter')).getAttribute('aria-valuenow')).toBe('7');
    await user.click(screen.getByTestId('shipping-limit-stop'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ perLabel: null, dailyLabels: null });
  });

  it('with none set, says the owner books and asks for a currency it cannot know', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()]) });
    await openTab(user, 'Who can buy labels');
    expect(textOf(await screen.findByTestId('shipping-limit-none'))).toContain("Packers can't buy labels yet. You book them.");
    await user.click(screen.getByTestId('shipping-limit-open'));
    expect(screen.getByTestId('shipping-limit-currency-input')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('Tracking', () => {
  const address = 'https://admin.shop.example/api/v1/shipping/webhook/ins?token=fixturetokenvalue';
  const masked = 'https://admin.shop.example/api/v1/shipping/webhook/ins?token=••••alue';

  it('shows the whole address once, with Copy, and masked after that', async () => {
    const user = userEvent.setup();
    const stage = { status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf(), replies: { 'POST /carriers/shipping-shippo/webhook': { status: 200, body: { data: { address, madeAt: 5 } } } } };
    mount(stage);
    await openTab(user, 'Tracking');
    stage.tracking.webhook = { ...stage.tracking.webhook, made: true, address: masked, madeAt: 5 };
    await user.click(await screen.findByTestId('shipping-webhook-make'));
    expect(textOf(await screen.findByTestId('shipping-webhook-full'))).toContain(address);
    expect(screen.getByTestId('shipping-webhook-copy')).toBeTruthy();
    await openTab(user, 'Label size');
    await openTab(user, 'Tracking');
    expect(textOf(await screen.findByTestId('shipping-webhook-masked'))).toContain(masked);
    expect(screen.queryByTestId('shipping-webhook-full')).toBeNull();
    expect(document.body.innerHTML).not.toContain('fixturetokenvalue');
  });

  it('keeps the whole address out of the mutation cache', async () => {
    const user = userEvent.setup();
    const stage = { status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf(), replies: { 'POST /carriers/shipping-shippo/webhook': { status: 200, body: { data: { address, madeAt: 5 } } } } };
    const { client } = mount(stage);
    await openTab(user, 'Tracking');
    stage.tracking.webhook = { ...stage.tracking.webhook, made: true, address: masked, madeAt: 5 };
    await user.click(await screen.findByTestId('shipping-webhook-make'));
    expect(textOf(await screen.findByTestId('shipping-webhook-full'))).toContain(address);
    const held = client.getMutationCache().getAll().map((mutation) => JSON.stringify(mutation.state.data ?? null));
    expect(held.join(' ')).not.toContain('fixturetokenvalue');
  });

  it('warns that the old address stops working before making a new one', async () => {
    const user = userEvent.setup();
    const { writes } = mount({
      status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }),
      tracking: trackingOf({ made: true, address: masked, madeAt: 5 }),
      replies: { 'POST /carriers/shipping-shippo/webhook': { status: 200, body: { data: { address, madeAt: 6 } } } },
    });
    await openTab(user, 'Tracking');
    await user.click(await screen.findByTestId('shipping-webhook-new'));
    expect(textOf(await screen.findByTestId('shipping-webhook-warning'))).toContain('The old address stops working');
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByTestId('shipping-webhook-confirm'));
    expect(textOf(await screen.findByTestId('shipping-webhook-full'))).toContain(address);
  });

  it('says no webhook has ever arrived, and names all three events in the key mode', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected({ mode: 'test' })], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf({ made: true, address: masked, madeAt: 5 }) });
    await openTab(user, 'Tracking');
    expect(textOf(await screen.findByTestId('shipping-never-arrived'))).toContain('No update has arrived yet.');
    expect(screen.queryByTestId('shipping-last-update')).toBeNull();
    expect(screen.getByText(/track_updated, transaction_created and transaction_updated, and choose Test/)).toBeTruthy();
  });

  it('reads the last update from the webhook only, and shows the parcel counts', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf({ made: true, address: masked, madeAt: 5, firstAt: 1_700_000_000_000, lastAt: 1_700_000_000_000 }) });
    await openTab(user, 'Tracking');
    expect(await screen.findByTestId('shipping-last-update')).toBeTruthy();
    expect(textOf(screen.getByTestId('shipping-tracking-badge'))).toContain('Receiving');
    expect(textOf(screen.getByTestId('shipping-parcels-open'))).toContain('3');
    expect(textOf(screen.getByTestId('shipping-parcels-never'))).toContain('1');
    expect(textOf(screen.getByTestId('shipping-parcels-quiet'))).toContain('2');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a private server shows its state on load, and offers no address to make', async () => {
    const user = userEvent.setup();
    const { writes } = mount({ status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf({ publicAddress: false, made: true, address: masked, madeAt: 5 }) });
    await openTab(user, 'Tracking');
    expect(textOf(await screen.findByTestId('shipping-tracking-private'))).toContain("This server can't receive updates.");
    expect(textOf(screen.getByTestId('shipping-tracking-subtitle'))).toContain('Tracking updates when someone presses Refresh.');
    expect(screen.queryByTestId('shipping-webhook-make')).toBeNull();
    expect(screen.queryByTestId('shipping-webhook-new')).toBeNull();
    expect(screen.queryByText(/sends each carrier scan/)).toBeNull();
    expect(screen.getByTestId('shipping-parcels')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('a private server with an ended address stays the private state', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf({ publicAddress: false, ended: true }) });
    await openTab(user, 'Tracking');
    expect(await screen.findByTestId('shipping-tracking-private')).toBeTruthy();
    expect(screen.queryByTestId('shipping-tracking-gone')).toBeNull();
    expect(screen.queryByTestId('shipping-webhook-make')).toBeNull();
  });

  it('NO_PUBLIC_ADDRESS is still the private state when the address went after the page read it', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), replies: { 'POST /carriers/shipping-shippo/webhook': refusal(409, 'NO_PUBLIC_ADDRESS', { carrier: 'shipping-shippo' }) } });
    await openTab(user, 'Tracking');
    await user.click(await screen.findByTestId('shipping-webhook-make'));
    expect(textOf(await screen.findByTestId('shipping-tracking-private'))).toContain("This server can't receive updates.");
    expect(textOf(screen.getByTestId('shipping-tracking-subtitle'))).toContain('Tracking updates when someone presses Refresh.');
    expect(screen.queryByText(/sends each carrier scan/)).toBeNull();
  });

  it('a refused new address keeps the one that works, and does not read as a private server', async () => {
    const user = userEvent.setup();
    mount({
      status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }),
      tracking: trackingOf({ made: true, address: masked, madeAt: 5 }),
      replies: { 'POST /carriers/shipping-shippo/webhook': refusal(409, 'NO_PUBLIC_ADDRESS', { carrier: 'shipping-shippo' }) },
    });
    await openTab(user, 'Tracking');
    await user.click(await screen.findByTestId('shipping-webhook-new'));
    await user.click(await screen.findByTestId('shipping-webhook-confirm'));
    expect(await screen.findByText(/The address you have keeps working/)).toBeTruthy();
    expect(screen.queryByTestId('shipping-tracking-private')).toBeNull();
    expect(textOf(screen.getByTestId('shipping-webhook-masked'))).toContain('••••alue');
  });

  it('reads an ended address from the server, and offers a new one', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf({ ended: true, firstAt: 10, lastAt: 20 }) });
    await openTab(user, 'Tracking');
    expect(textOf(await screen.findByTestId('shipping-tracking-gone'))).toContain('stopped working when the key changed');
    expect(screen.getByTestId('shipping-webhook-make')).toBeTruthy();
  });

  it('having heard updates is not the same as an ended address', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf({ ended: false, firstAt: 10, lastAt: 20 }) });
    await openTab(user, 'Tracking');
    expect(await screen.findByTestId('shipping-webhook-make')).toBeTruthy();
    expect(screen.queryByTestId('shipping-tracking-gone')).toBeNull();
  });
});

describe('on every tab', () => {
  it('a test key keeps the banner, and the not-affiliated line sits once', async () => {
    const user = userEvent.setup();
    mount({ status: statusOf([connected({ mode: 'test' }), dhl()], { activeCarrier: 'shipping-shippo' }), tracking: trackingOf() });
    for (const name of ['Setup', 'Label size', 'Who can buy labels', 'Tracking']) {
      await openTab(user, name);
      expect(textOf(await screen.findByTestId('shipping-test-banner'))).toContain('Test mode: nothing will be delivered');
      expect(screen.getAllByTestId('shipping-not-affiliated')).toHaveLength(1);
    }
  });

  it('no banner on a live key', async () => {
    mount({ status: statusOf([connected(), dhl()], { activeCarrier: 'shipping-shippo' }) });
    await screen.findByTestId('shipping-row-shipping-shippo');
    expect(screen.queryByTestId('shipping-test-banner')).toBeNull();
  });
});
