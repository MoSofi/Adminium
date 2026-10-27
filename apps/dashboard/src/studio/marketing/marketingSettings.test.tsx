// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketing mail settings in Workspace settings, as the marketer they are
 * for (a role holding `settings.manage`, not an Admin), router-mounted:
 *
 *  - each saved sender gets its "Marketing mail" block: the postal address and
 *    the reply address once (the first own-domain sender's), the DKIM key or
 *    "Make a key", DMARC; a public mailbox only its one line;
 *  - DNS states: found, not found yet (with "Check again"), could not ask;
 *  - "Make a key" posts the sender's domain; the postal and reply addresses
 *    ride the page's one Save and its review;
 *  - the send dialog's fix link `#marketing-postal-address` lands on the field;
 *  - the bounce card: Postmark's address made on choosing it and its
 *    credentials shown once; Mailgun's key saved and never shown back;
 *    "Another service" the note only; no public address, no address made;
 *  - a role without `settings.manage` is refused the page.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { MarketingSender, MarketingSettings, NoticeEndpoint, NoticeEndpoints, SenderCheck } from './marketingApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const RECORD = 'adminium._domainkey.meridian.example TXT "v=DKIM1; k=rsa; p=MIIBIjAN"';
const key = { domain: 'meridian.example', selector: 'adminium', record: { name: 'adminium._domainkey.meridian.example', type: 'TXT' as const, value: 'v=DKIM1; k=rsa; p=MIIBIjAN', text: RECORD }, createdAt: 1, usable: true };

function sender(over: Partial<MarketingSender>): MarketingSender {
  return { address: 'news@meridian.example', name: 'Meridian', implicit: true, domain: 'meridian.example', freeMail: false, key, ...over };
}

function endpoint(service: NoticeEndpoint['service'], over: Partial<NoticeEndpoint> = {}): NoticeEndpoint {
  const secretRow = service === 'mailgun' ? 'signing-key' : service === 'sendgrid' ? 'verification-key' : service === 'ses' ? 'topic-arn' : 'copy-credentials';
  return { service, opened: false, secretRow, ready: false, secretSetAt: null, confirmedAt: null, lastNoticeAt: null, noticeCount: 0, address: null, ...over };
}

interface World {
  roles: string[];
  systemActions: string[];
  marketing: MarketingSettings;
  checks: Record<string, SenderCheck>;
  notices: NoticeEndpoints;
}

let world: World;
const ORIGIN = 'https://crm.meridian.example';

function freshWorld(): World {
  return {
    roles: ['marketing'],
    systemActions: ['settings.manage'],
    marketing: {
      postalAddress: null,
      replyTo: null,
      publicOrigin: ORIGIN,
      senders: [
        sender({}),
        sender({ address: 'sales@meridian.example', name: 'Meridian Sales', implicit: false, key: null }),
        sender({ address: 'meridian.news@gmail.com', name: 'Gmail', implicit: false, domain: 'gmail.com', freeMail: true, key: null }),
      ],
    },
    checks: {
      'news@meridian.example': { dmarc: { policy: 'quarantine', recordDomain: 'meridian.example' }, dkim: 'found', refusals: [] },
      'sales@meridian.example': { dmarc: { policy: null, recordDomain: null }, dkim: null, refusals: ['no-dmarc'] },
    },
    notices: { publicOrigin: ORIGIN, suggested: 'postmark', services: (['ses', 'postmark', 'mailgun', 'brevo', 'sendgrid', 'other'] as const).map((one) => endpoint(one)) },
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      // A copy each time, as a server's reply is: the cache never shares an object the test changes later.
      const ok = (data: unknown) => Promise.resolve(jsonResponse(200, JSON.parse(JSON.stringify(data)) as unknown));
      if (url.startsWith('/api/v1/bootstrap')) return ok({ data: makeBootstrap({ roles: world.roles, nav: { groups: [] }, systemActions: world.systemActions }) });
      if (url === '/api/v1/settings/workspace') return ok({ data: { branding: { appName: 'Meridian', logoUrl: null, showVersion: true } } });
      if (url === '/api/v1/settings/security') return ok({ data: { sessionTtlHours: 720, require2fa: false, passwordMinLength: 10 } });
      if (url === '/api/v1/settings/email' && method === 'GET') {
        return ok({
          data: {
            configured: true,
            host: 'smtp.postmarkapp.com',
            port: 587,
            user: 'pm',
            from: 'Meridian <news@meridian.example>',
            secure: false,
            senders: [
              { name: 'Meridian Sales', address: 'sales@meridian.example' },
              { name: 'Gmail', address: 'meridian.news@gmail.com' },
            ],
            maxAttachmentBytes: 10 * 1024 * 1024,
            publicOrigin: ORIGIN,
          },
        });
      }
      if (url === '/api/v1/email/marketing') return ok({ data: world.marketing });
      if (url === '/api/v1/email/marketing/check') return ok({ data: world.checks[(body as { address: string }).address] });
      if (url === '/api/v1/email/marketing/dkim-keys') {
        world.marketing.senders = world.marketing.senders.map((one) => (one.domain === 'meridian.example' ? { ...one, key } : one));
        return ok({ data: { key } });
      }
      if (url === '/api/v1/privacy/postal-address') return ok({ data: { postalAddress: (body as { postalAddress: string | null }).postalAddress } });
      if (url === '/api/v1/email/marketing/reply-to') return ok({ data: { replyTo: (body as { replyTo: string | null }).replyTo } });
      if (url === '/api/v1/email/notice-endpoints') return ok({ data: world.notices });
      const opened = /^\/api\/v1\/email\/notice-endpoints\/([a-z]+)(\/credentials|\/secret)?$/.exec(url);
      if (opened !== null) {
        const service = opened[1] as NoticeEndpoint['service'];
        const made = endpoint(service, { opened: true, ready: service !== 'mailgun' || opened[2] === '/secret', secretSetAt: opened[2] === '/secret' || service === 'postmark' ? Date.UTC(2026, 6, 20) : null, address: `${ORIGIN}/api/v1/email/notices/${service}/tok-${service}` });
        world.notices = { ...world.notices, services: world.notices.services.map((one) => (one.service === service ? made : one)) };
        if (opened[2] === '/secret') return ok({ data: { endpoint: made } });
        const pass = opened[2] === '/credentials' ? 'second-made-password' : 'first-made-password';
        return ok({ data: { endpoint: made, credentials: service === 'postmark' ? { user: 'adminium-postmark', pass } : null } });
      }
      if (url === '/api/v1/connections') return ok({ connections: [] });
      if (url === '/api/v1/branding') return ok({ data: { appName: 'Meridian', logoUrl: null, showVersion: true } });
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderAt(path = '/studio/settings') {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stub();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, router };
}

const blockOf = (address: string) => document.querySelector<HTMLElement>(`[data-part="marketing-mail"][data-sender="${address}"]`);

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('marketing mail under each sender', () => {
  it('shows the install\'s two fields once, each sender\'s key and DMARC, and a public mailbox\'s one line', async () => {
    world = freshWorld();
    await renderAt();
    await waitFor(() => expect(blockOf('news@meridian.example')).not.toBeNull());
    const news = within(blockOf('news@meridian.example')!);
    expect(news.getByText('Marketing mail')).toBeDefined();
    expect(news.getByLabelText('Postal address')).toBeDefined();
    expect(news.getByText('Required for marketing mail.')).toBeDefined();
    expect(news.getByLabelText('Replies to marketing mail go to')).toBeDefined();
    expect(news.getByText(RECORD)).toBeDefined();
    expect(await news.findByText('Found in DNS')).toBeDefined();
    expect(await news.findByText('p=quarantine')).toBeDefined();

    const sales = within(blockOf('sales@meridian.example')!);
    expect(sales.queryByLabelText('Postal address')).toBeNull();
    expect(sales.getByRole('button', { name: 'Make a key' })).toBeDefined();
    expect(await sales.findByText('Not found')).toBeDefined();
    expect(sales.getByRole('link', { name: /How to add a DMARC record/ }).getAttribute('href')).toContain('docs.adminium.dev');

    const gmail = within(blockOf('meridian.news@gmail.com')!);
    expect(gmail.getByText('Can’t send marketing mail: use your own domain.')).toBeDefined();
    expect(gmail.queryByText('Sign marketing mail (DKIM)')).toBeNull();
  });

  it('says "not found yet" with Check again, and that DNS could not be asked', async () => {
    world = freshWorld();
    world.checks['news@meridian.example'] = { dmarc: 'unchecked', dkim: 'not-found', refusals: ['not-aligned'] };
    const { calls } = await renderAt();
    await waitFor(() => expect(blockOf('news@meridian.example')).not.toBeNull());
    const news = within(blockOf('news@meridian.example')!);
    expect(await news.findByText('Not found yet — DNS can take an hour')).toBeDefined();
    expect(news.getByText('DNS could not be asked')).toBeDefined();
    const before = calls.filter((call) => call.url === '/api/v1/email/marketing/check').length;
    world.checks['news@meridian.example'] = { dmarc: { policy: 'reject', recordDomain: 'meridian.example' }, dkim: 'found', refusals: [] };
    await userEvent.setup().click(news.getByRole('button', { name: 'Check again' }));
    expect(await news.findByText('Found in DNS')).toBeDefined();
    expect(calls.filter((call) => call.url === '/api/v1/email/marketing/check').length).toBe(before + 1);
  });

  it('makes a key for the sender\'s domain, and shows its record', async () => {
    world = freshWorld();
    world.marketing.senders = world.marketing.senders.map((one) => ({ ...one, key: null }));
    const { calls } = await renderAt();
    await waitFor(() => expect(blockOf('news@meridian.example')).not.toBeNull());
    const news = within(blockOf('news@meridian.example')!);
    await userEvent.setup().click(news.getByRole('button', { name: 'Make a key' }));
    expect(await news.findByText(RECORD)).toBeDefined();
    expect(calls.find((call) => call.url === '/api/v1/email/marketing/dkim-keys')?.body).toEqual({ domain: 'meridian.example' });
  });

  it('offers "Make a key" again for a key that no longer opens', async () => {
    world = freshWorld();
    world.marketing.senders[0] = sender({ key: { ...key, usable: false } });
    await renderAt();
    await waitFor(() => expect(blockOf('news@meridian.example')).not.toBeNull());
    const news = within(blockOf('news@meridian.example')!);
    expect(news.getByText('This key no longer works on this server. Make a new one and publish its record.')).toBeDefined();
    expect(news.getByRole('button', { name: 'Make a key' })).toBeDefined();
  });

  it('saves the postal and reply addresses with the page\'s one Save, named in the review, and refuses a bad reply address', async () => {
    world = freshWorld();
    const user = userEvent.setup();
    const { calls } = await renderAt();
    await waitFor(() => expect(blockOf('news@meridian.example')).not.toBeNull());
    const news = within(blockOf('news@meridian.example')!);
    await user.type(news.getByLabelText('Replies to marketing mail go to'), 'two@a.example, three@b.example');
    expect(await news.findByText('Enter one e-mail address, such as hello@example.com.')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(news.getByLabelText('Replies to marketing mail go to'));
    await user.type(news.getByLabelText('Replies to marketing mail go to'), 'hello@meridian.example');
    await user.type(news.getByLabelText('Postal address'), 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Postal address')).toBeDefined();
    expect(within(dialog).getByText('Replies to marketing mail go to')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/email/marketing/reply-to')).toBe(true));
    expect(calls.find((call) => call.url === '/api/v1/privacy/postal-address')).toMatchObject({ method: 'PUT', body: { postalAddress: 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds' } });
    expect(calls.find((call) => call.url === '/api/v1/email/marketing/reply-to')).toMatchObject({ method: 'PUT', body: { replyTo: 'hello@meridian.example' } });
  });

  it('lands the send dialog\'s fix link on the postal address field', async () => {
    world = freshWorld();
    await renderAt('/studio/settings#marketing-postal-address');
    await waitFor(() => expect(document.activeElement?.id).toBe('marketing-postal-address'));
  });

  it('refuses the settings to a role without settings.manage', async () => {
    world = freshWorld();
    world.systemActions = ['users.manage'];
    await renderAt();
    expect(await screen.findByText('You don’t have access')).toBeDefined();
    expect(blockOf('news@meridian.example')).toBeNull();
  });
});

describe('the bounce card', () => {
  const card = async () => within((await screen.findByRole('heading', { name: 'Bounces and spam reports' })).closest<HTMLElement>('[data-part="bounce-card"]')!);

  it('makes Postmark\'s address on choosing it, shows its credentials once, and Replace makes new ones', async () => {
    world = freshWorld();
    const user = userEvent.setup();
    const { calls } = await renderAt();
    const c = await card();
    expect(c.getByRole('radio', { name: 'Postmark' }).getAttribute('aria-checked')).toBe('true');
    expect(await c.findByText(`${ORIGIN}/api/v1/email/notices/postmark/tok-postmark`)).toBeDefined();
    expect(c.getByText('Paste this address into Postmark')).toBeDefined();
    expect(c.getByText('Copy these into Postmark')).toBeDefined();
    expect(c.getByTestId('made-password').textContent).toBe('first-made-password');
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/email/notice-endpoints/postmark')).toHaveLength(1);
    expect(c.getByText('Nothing has arrived yet')).toBeDefined();
    await user.click(c.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(c.getByTestId('made-password').textContent).toBe('second-made-password'));
    expect(calls.filter((call) => call.url === '/api/v1/email/notice-endpoints/postmark/credentials')).toHaveLength(1);
  });

  it('saves Mailgun\'s signing key and never shows it back', async () => {
    world = freshWorld();
    const user = userEvent.setup();
    const { calls } = await renderAt();
    const c = await card();
    await user.click(c.getByRole('radio', { name: 'Mailgun' }));
    const field = await c.findByLabelText('Signing key');
    expect(field.getAttribute('type')).toBe('password');
    expect(field.getAttribute('placeholder')).toBe('Paste the signing key from Mailgun');
    await user.type(field, 'key-0123456789abcdef');
    await user.click(c.getByRole('button', { name: 'Save' }));
    expect(await c.findByRole('button', { name: 'Replace' })).toBeDefined();
    expect(c.getByText(/Set on/)).toBeDefined();
    expect(calls.find((call) => call.url === '/api/v1/email/notice-endpoints/mailgun/secret')).toMatchObject({ method: 'PUT', body: { secret: 'key-0123456789abcdef' } });
    expect(document.body.innerHTML).not.toContain('key-0123456789abcdef');
  });

  it('shows only the note for another service, and makes no address without a public one', async () => {
    world = freshWorld();
    world.notices = { ...world.notices, publicOrigin: null, suggested: null };
    const { calls } = await renderAt();
    const c = await card();
    expect(c.getByRole('radio', { name: 'Another service' }).getAttribute('aria-checked')).toBe('true');
    expect(c.getByText('Mails refused while sending are still caught. Add other bounces by hand to the do-not-email list.')).toBeDefined();
    await userEvent.setup().click(c.getByRole('radio', { name: 'Brevo' }));
    expect(await c.findByText(/Set the address in email links first/)).toBeDefined();
    expect(calls.some((call) => call.method === 'POST' && call.url.startsWith('/api/v1/email/notice-endpoints/'))).toBe(false);
  });
});
