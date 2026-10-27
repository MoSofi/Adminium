// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign to a table's people, through the real editor, as a marketer (a
 * custom role holding the campaigns' grant, not the Admin):
 *
 *  - 1a: the table is the default; the breakdown is the server's; the
 *    existing-customers row shows only where the table's switch is on, and
 *    turning it on asks the server again; "At most 100 an hour" is the
 *    default, with the estimate; the click switch is off; the send carries
 *    all of it;
 *  - 1b: people ticked before records were kept: the card, the footer's
 *    Send waiting; the review one person at a time with Undo, written on
 *    Done; the counts move;
 *  - 1c: the sender's refusals, one row each with its fix link, and the same
 *    from a send that answers 409;
 *  - 1d: a table whose addresses this person sees masked: the danger alert,
 *    the lock, and no breakdown or count;
 *  - 1e: scheduled, with the cap in the sentence;
 *  - the send log: summary, filters, search, CSV, each state's words;
 *  - the locked footer on a marketing e-mail, and none on a service one.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { EmailAudienceBreakdown, EmailAudienceTable, EmailDocumentDetail, EmailRunView, EmailSendLogRow } from '../../email/api.js';

vi.mock('../../app/ws.js', () => ({
  createRealtimeClient: () => new Proxy({}, { get: () => () => undefined }),
}));

const CONTACTS: EmailAudienceTable = {
  connectionId: 'conn_1',
  table: 'tbl_contacts',
  label: 'Contacts',
  appKey: 'crm',
  appName: 'Sales CRM',
  kind: 'people',
  consentPurpose: 'newsletter',
  addresses: 'readable',
  existingCustomers: { offered: true, on: true, at: Date.UTC(2026, 6, 2, 10), by: { id: 'usr_mia', name: 'Mia' } },
};

function breakdown(over: Partial<EmailAudienceBreakdown> = {}): EmailAudienceBreakdown {
  return { rows: 1252, recipients: 412, consent: 412, existingCustomers: 58, doNotEmail: 9, notAgreed: 819, awaitingReview: 0, notMarked: 0, sample: 0, reservedDomain: 0, noAddress: 3, ...over };
}

function run(extra: Partial<EmailRunView> = {}): EmailRunView {
  return {
    id: 'run_1',
    status: 'sent',
    total: 6,
    sent: 3,
    failed: 1,
    skipped: 2,
    scheduledAt: Date.UTC(2026, 5, 30, 10),
    startedAt: Date.UTC(2026, 5, 30, 10),
    finishedAt: Date.UTC(2026, 5, 30, 11),
    jobId: null,
    audience: { kind: 'table', connectionId: 'conn_1', table: 'tbl_contacts', purpose: 'newsletter' },
    failures: [],
    createdAt: 1,
    state: 'done',
    ratePerHour: 100,
    mailClass: 'marketing',
    basis: 'consent',
    trackClicks: false,
    ...extra,
  };
}

function detail(over: Partial<EmailDocumentDetail> = {}): EmailDocumentDetail {
  return {
    id: 'et_c',
    kind: 'campaign',
    key: 'july',
    locale: 'en_US',
    name: 'July news',
    subject: 'Quieter floors',
    category: 'marketing',
    enabled: true,
    needsTranslation: false,
    archivedAt: null,
    updatedAt: 1,
    isBuiltin: false,
    isBuiltinCopy: false,
    starter: null,
    brand: null,
    heading: 'Hello',
    topicLabel: 'July news',
    document: { subject: 'Quieter floors', preheader: '', blocks: [{ id: 'b_h', block: 'email.heading', data: { text: 'Hello {{name}}' }, style: {} }], footer: 'Meridian Workplace Ltd', brand: null, attachments: [] },
    vars: ['name'],
    languages: [{ id: 'et_c', locale: 'en_US', needsTranslation: false, enabled: true, archived: false }],
    attachmentsResolved: [],
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

interface World {
  tables: EmailAudienceTable[];
  preview: (body: { audience: Record<string, unknown>; ratePerHour?: number }) => Record<string, unknown> | { status: number; body: unknown };
  send?: (body: unknown) => { status: number; body: unknown };
  review?: { purpose: 'newsletter'; total: number; people: { key: string; name: string; address: string; tickedBy: string | null; tickedAt: number | null }[] };
  log?: (url: string) => { summary: Record<string, number>; rows: EmailSendLogRow[]; next: number | null };
  answer?: () => { status: number; body: unknown };
  detail: EmailDocumentDetail;
}

function stub(world: World): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      const ok = (data: unknown, status = 200) => Promise.resolve(jsonResponse(status, data));
      if (url.startsWith('/api/v1/bootstrap')) return ok({ data: makeBootstrap({ user: { ...makeBootstrap().user, id: 'usr_mia' }, roles: ['marketer'], systemActions: ['settings.manage'], nav: { groups: [] } }) });
      if (url === '/api/v1/branding') return ok({ data: { appName: 'Meridian', logoUrl: null, showVersion: true } });
      if (url === '/api/v1/settings/email') return ok({ data: { configured: true, host: 'smtp', port: 587, user: 'u', from: 'news@meridian.example', secure: true, senders: [], maxAttachmentBytes: 1 } });
      if (url === '/api/v1/email-templates/et_c' && (method === 'GET' || method === 'PUT')) return ok(world.detail);
      if (url === '/api/v1/email-blocks') return ok({ blocks: [] });
      if (url === '/api/v1/roles') return ok({ roles: [] });
      if (url === '/api/v1/email-audience/tables') return ok({ tables: world.tables });
      if (url === '/api/v1/email-audience/people-tables') return ok({ tables: [{ connectionId: 'conn_1', table: 'tbl_old', label: 'Old leads', appName: 'Sales CRM', canEmail: false }] });
      if (url.startsWith('/api/v1/email-audience/views')) return ok({ views: [{ id: 'view_n', name: 'North territory', shared: true, refused: null }, { id: 'view_s', name: 'Searched', shared: true, refused: 'view-search' }] });
      if (url.startsWith('/api/v1/email-audience/review') && method === 'GET') return ok(world.review ?? { purpose: 'newsletter', total: 0, people: [] });
      if (url === '/api/v1/email-audience/review/answer' && method === 'POST' && world.answer !== undefined) return ok(world.answer().body, world.answer().status);
      if (url === '/api/v1/email-audience/review/answer' && method === 'POST') return ok({ event: { id: 'cev_1', state: (body as { answer: string }).answer === 'confirm' ? 'yes' : 'no', at: 1 } });
      if (url === '/api/v1/email-templates/et_c/audience/preview' && method === 'POST') {
        const answer = world.preview(body as never);
        if ('status' in answer && typeof answer.status === 'number') return ok(answer.body, answer.status);
        return ok(answer);
      }
      if (url === '/api/v1/email-templates/et_c/send' && method === 'POST') {
        const answer = world.send?.(body) ?? { status: 202, body: { run: run({ status: 'running', state: 'running' }) } };
        return ok(answer.body, answer.status);
      }
      if (url === '/api/v1/email/marketing') return ok({ data: { postalAddress: 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom', replyTo: null, publicOrigin: 'https://crm.meridian.example', businessName: 'Meridian', senders: [] } });
      if (url === '/api/v1/email-templates/et_c/runs') return ok({ runs: [world.detail.run ?? run()] });
      if (url.startsWith('/api/v1/email-runs/run_1/log')) return ok(world.log?.(url) ?? { summary: {}, rows: [], next: null });
      if (url === '/api/v1/email-runs/run_1') return ok({ run: world.detail.run ?? run(), name: 'July news', done: 6, total: 6, left: 0, estimateMinutes: null });
      if (url.startsWith('/api/v1/users')) return ok({ users: [], nextCursor: null, counts: { active: 1, invited: 0, suspended: 0 } });
      if (url.startsWith('/api/v1/files?')) return ok({ data: [], nextCursor: null });
      return ok({ error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }, 404);
    }),
  );
  return calls;
}

async function openEditor(world: World) {
  const calls = stub(world);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/email-templates/et_c'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-inspector');
  return { calls, user: userEvent.setup() };
}

async function openDialog(world: World) {
  const opened = await openEditor(world);
  await opened.user.click(screen.getByTestId('email-send'));
  const dialog = await screen.findByRole('dialog');
  return { ...opened, dialog };
}

const previews = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/audience/preview')).map((c) => c.body as { audience: Record<string, unknown>; ratePerHour?: number });
const ready = (over: Partial<EmailAudienceBreakdown> = {}) => (input: { audience: Record<string, unknown>; ratePerHour?: number }) => {
  const b = breakdown({ ...over, recipients: input.audience['existingCustomers'] === true ? 470 : 412 });
  return { total: 1249, skipped: 1249 - b.recipients, unfilled: [], estimateMinutes: input.ratePerHour === undefined ? null : Math.ceil((b.recipients / input.ratePerHour) * 60), breakdown: b, variables: [], refusals: [], sender: 'news@meridian.example' };
};

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the send dialog, to a table’s people (as a marketer)', () => {
  it('1a: the table is the default, the breakdown is the server’s, and the send carries the table, the purpose, the cap and the basis', async () => {
    const { dialog, calls, user } = await openDialog({ tables: [CONTACTS], preview: ready(), detail: detail() });
    expect(within(dialog).getByRole('radio', { name: 'People in a table' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(within(dialog).getByTestId('email-send-breakdown')).toBeDefined());
    expect(within(dialog).getByTestId('email-send-table').textContent).toContain('Contacts — Sales CRM');
    expect(within(dialog).getByTestId('email-send-breakdown-consent').textContent).toBe('412may be e-mailed for the Newsletter');
    expect(within(dialog).getByTestId('email-send-breakdown-dne').textContent).toBe('9on the do-not-email list — skipped');
    expect(within(dialog).getByTestId('email-send-breakdown-not-agreed').textContent).toBe('819haven’t agreed — skipped');
    // A line the comp does not draw shows only when it is not zero.
    expect(within(dialog).getByTestId('email-send-breakdown-noAddress').textContent).toBe('3with no address — skipped');
    expect(within(dialog).queryByTestId('email-send-breakdown-sample')).toBeNull();
    expect(within(dialog).queryByTestId('email-send-breakdown-existing')).toBeNull();
    expect(within(dialog).getByText('This is marketing mail. Every copy carries an unsubscribe link, and the do-not-email list is always skipped.')).toBeDefined();
    // The table's owner (this person) switched existing customers on.
    // In the person's language (en-US here).
    expect(within(dialog).getByText('Where the law allows it. You turned this on for Contacts on Jul 2.')).toBeDefined();
    expect(within(dialog).getByTestId('email-campaign-count').textContent).toBe('412 recipients · 837 skipped');
    expect(within(dialog).getByTestId('email-send-estimate').textContent).toBe('About 4 hours for 412 people.');
    expect(within(dialog).getByTestId('email-send-clicks').getAttribute('aria-checked')).toBe('false');
    expect(previews(calls).at(-1)).toEqual({ audience: { kind: 'table', connectionId: 'conn_1', table: 'tbl_contacts', purpose: 'newsletter' }, ratePerHour: 100 });

    await user.click(within(dialog).getByTestId('email-send-existing'));
    await waitFor(() => expect(within(dialog).getByTestId('email-send-breakdown-existing').textContent).toBe('+ 58existing customers'));
    expect(previews(calls).at(-1)?.audience['existingCustomers']).toBe(true);
    await waitFor(() => expect(within(dialog).getByTestId('email-send-estimate').textContent).toBe('About 5 hours for 470 people.'));
    await user.click(within(dialog).getByRole('radio', { name: 'Surveys' }));
    await waitFor(() => expect(within(dialog).getByTestId('email-send-breakdown-consent').textContent).toBe('412may be e-mailed for the Surveys'));

    await user.click(within(dialog).getByTestId('email-send-clicks'));
    await user.click(within(dialog).getByTestId('email-campaign-send'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/send'))).toHaveLength(1));
    expect(calls.find((c) => c.url.endsWith('/send'))?.body).toEqual({
      audience: { kind: 'table', connectionId: 'conn_1', table: 'tbl_contacts', purpose: 'surveys', existingCustomers: true },
      ratePerHour: 100,
      trackClicks: true,
    });
    expect(await screen.findByText('Campaign sent!')).toBeDefined();
  });

  it('"As fast as your mail server allows" sends no cap and shows no estimate; a cap that is not a number holds the send', async () => {
    const { dialog, calls, user } = await openDialog({ tables: [CONTACTS], preview: ready(), detail: detail() });
    await waitFor(() => expect(within(dialog).getByTestId('email-send-estimate')).toBeDefined());
    const rate = within(dialog).getByTestId('email-send-rate');
    await user.clear(rate);
    await user.type(rate, 'lots');
    expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'As fast as your mail server allows' }));
    await waitFor(() => expect(within(dialog).queryByTestId('email-send-estimate')).toBeNull());
    await waitFor(() => expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(dialog).getByTestId('email-campaign-send'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/send'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/send'))?.body).toEqual({ audience: { kind: 'table', connectionId: 'conn_1', table: 'tbl_contacts', purpose: 'newsletter' } });
  });

  it('the picker opens the table’s e-mail settings, offers a switched-off table’s, and "Only these" lists the views it may use', async () => {
    const { dialog, calls, user } = await openDialog({ tables: [CONTACTS], preview: ready(), detail: detail() });
    await user.click(within(dialog).getByTestId('email-send-view'));
    const views = await screen.findByRole('menu');
    expect(within(views).getByRole('menuitemradio', { name: /Searched/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(views).getByText('That view has a search in it, so it would mail more people than it shows. Pick another.')).toBeDefined();
    await user.click(within(views).getByRole('menuitemradio', { name: 'North territory' }));
    await waitFor(() => expect(previews(calls).at(-1)?.audience['viewId']).toBe('view_n'));
    await user.click(within(dialog).getByTestId('email-send-table'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Old leads — Sales CRM: open its e-mail settings' })).toBeDefined();
    await user.click(within(menu).getByRole('menuitem', { name: 'E-mail settings for Contacts' }));
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/email-audience/table-settings?'))).toBe(true));
    expect(calls.find((c) => c.url.startsWith('/api/v1/email-audience/table-settings?'))?.url).toContain('table=tbl_contacts');
  });

  it('1b: people ticked before records were kept wait for a review; answers are written on Done, Undo takes one back', async () => {
    let waiting = 3;
    const { dialog, calls, user } = await openDialog({
      tables: [CONTACTS],
      preview: (input) => ready({ awaitingReview: waiting })(input),
      review: {
        purpose: 'newsletter',
        total: 3,
        people: [
          { key: '4', name: 'Rex Review', address: 'rex@harbour.dev', tickedBy: 'Dana Whitlock', tickedAt: Date.UTC(2025, 10, 3) },
          { key: '10', name: 'Rae Review', address: 'rae@harbour.dev', tickedBy: null, tickedAt: null },
          { key: '11', name: 'Rio Review', address: 'rio@harbour.dev', tickedBy: 'Dana Whitlock', tickedAt: null },
        ],
      },
      detail: detail(),
    });
    const card = await within(dialog).findByTestId('email-send-review-card');
    expect(card.textContent).toContain('3 people say yes but were ticked before records were kept. Confirm them before sending?');
    expect(within(card).getByTestId('email-send-with-record').textContent).toBe('Send to the 412 with a record');
    expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(card).getByTestId('email-send-review-open'));
    await waitFor(() => expect(screen.getAllByTestId('email-review-row')).toHaveLength(3));
    const rows = screen.getAllByTestId('email-review-row');
    expect(rows[0]?.textContent).toContain('Ticked by Dana Whitlock · Nov 3, 2025');
    expect(rows[1]?.textContent).toContain('Ticked before records were kept');
    // No "confirm all", ever.
    expect(screen.queryByRole('button', { name: /all/i })).toBeNull();
    await user.click(within(rows[0] as HTMLElement).getByTestId('email-review-confirm'));
    await user.click(within(rows[1] as HTMLElement).getByTestId('email-review-leave-out'));
    await user.click(within(rows[2] as HTMLElement).getByTestId('email-review-confirm'));
    expect(screen.getByTestId('email-review-count').textContent).toBe('2 confirmed · 1 left out · 0 to decide');
    // Undo takes Rio back: nothing reached the server yet.
    await user.click(within(screen.getAllByTestId('email-review-row')[2] as HTMLElement).getByTestId('email-review-undo'));
    expect(screen.getByTestId('email-review-count').textContent).toBe('1 confirmed · 1 left out · 1 to decide');
    expect(calls.filter((c) => c.url.endsWith('/review/answer'))).toHaveLength(0);
    waiting = 1;
    await user.click(screen.getByTestId('email-review-done'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/review/answer'))).toHaveLength(2));
    expect(calls.filter((c) => c.url.endsWith('/review/answer')).map((c) => c.body)).toEqual([
      { connectionId: 'conn_1', table: 'tbl_contacts', key: '4', answer: 'confirm' },
      { connectionId: 'conn_1', table: 'tbl_contacts', key: '10', answer: 'leave-out' },
    ]);
    // Back on the send dialog, the counts asked again: one is still waiting.
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByTestId('email-send-review-card').textContent).toContain('1 person says yes but was ticked'));
  });

  it('1b: a marketer who may not change the table is told so, and the answers stay chosen', async () => {
    const { dialog, user } = await openDialog({
      tables: [CONTACTS],
      preview: ready({ awaitingReview: 1 }),
      review: { purpose: 'newsletter', total: 1, people: [{ key: '4', name: 'Rex Review', address: 'rex@harbour.dev', tickedBy: null, tickedAt: null }] },
      answer: () => ({ status: 403, body: { error: { code: 'TABLE_FORBIDDEN', message: 'no' } } }),
      detail: detail(),
    });
    await user.click(await within(dialog).findByTestId('email-send-review-open'));
    await user.click(await screen.findByTestId('email-review-confirm'));
    await user.click(screen.getByTestId('email-review-done'));
    expect((await screen.findAllByRole('alert')).some((el) => el.textContent === 'You can’t change Contacts, so you can’t answer for its people.')).toBe(true);
    expect(screen.getByTestId('email-review-answer').textContent).toBe('Confirmed');
  });

  it('1c: the sender’s refusals, each with its fix link; Send stays disabled', async () => {
    const { dialog, calls } = await openDialog({
      tables: [CONTACTS],
      preview: (input) => ({ ...ready()(input), refusals: ['no-postal-address', 'free-mail-from', 'no-public-address'], sender: 'meridian.news@gmail.com' }),
      detail: detail(),
    });
    const card = await within(dialog).findByTestId('email-send-refusals');
    const rows = within(card).getAllByTestId('email-send-refusal');
    expect(rows.map((row) => row.getAttribute('data-code'))).toEqual(['no-postal-address', 'free-mail-from', 'no-public-address']);
    expect(rows[0]?.textContent).toBe('Add your postal address to the sender first. The law in many countries asks for it in every marketing mail.Add address');
    expect(rows[1]?.textContent).toBe('meridian.news@gmail.com can’t send marketing mail. Use an address at your own domain.Change sender');
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Add address' }).getAttribute('href')).toBe('/studio/settings#marketing-postal-address');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Change sender' }).getAttribute('href')).toBe('/studio/settings#senders');
    expect(within(rows[2] as HTMLElement).getByRole('link', { name: 'Set the address' }).getAttribute('href')).toBe('/studio/settings#email-link-origin');
    expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/send'))).toHaveLength(0);
  });

  it('1c: a send the server refuses with 409 shows the refusals it named, DMARC with its guide', async () => {
    const { dialog, user } = await openDialog({
      tables: [CONTACTS],
      preview: ready(),
      send: () => ({ status: 409, body: { error: { code: 'SENDER_REFUSED', message: 'no', details: { refusals: ['no-dmarc'] } } } }),
      detail: detail(),
    });
    await waitFor(() => expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(dialog).getByTestId('email-campaign-send'));
    const row = await within(dialog).findByTestId('email-send-refusal');
    expect(row.textContent).toContain('meridian.example has no DMARC record yet, so marketing mail can’t go out yet.');
    expect(within(row).getByRole('link', { name: /How to add one/ }).getAttribute('href')).toContain('guides/email/campaigns/#dmarc');
    expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('1d: a table whose addresses this person sees masked: the alert and the lock, and nothing about the table', async () => {
    const { dialog, calls } = await openDialog({ tables: [{ ...CONTACTS, addresses: 'masked' }], preview: ready(), detail: detail() });
    const alert = await within(dialog).findByTestId('email-send-refused');
    expect(alert.textContent).toBe('You see the addresses in Contacts masked, so you can’t send to it.');
    expect(within(dialog).getByTestId('email-send-table').className).toContain('border-danger');
    expect(within(dialog).queryByTestId('email-send-breakdown')).toBeNull();
    expect(within(dialog).queryByTestId('email-send-estimate')).toBeNull();
    expect(within(dialog).getByTestId('email-campaign-count').textContent).toBe('');
    expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(true);
    // Nothing is asked about a table it cannot send to.
    expect(previews(calls)).toHaveLength(0);
  });

  it('1d: a table the server now refuses (the right to read it gone) reads the same way', async () => {
    const { dialog } = await openDialog({
      tables: [CONTACTS],
      preview: () => ({ status: 403, body: { error: { code: 'AUDIENCE_REFUSED', message: 'no', details: { reason: 'cannot-read', table: 'Contacts' } } } }),
      detail: detail(),
    });
    expect((await within(dialog).findByTestId('email-send-refused')).textContent).toBe('You can no longer read Contacts, so you can’t send to it.');
    expect(within(dialog).queryByTestId('email-send-breakdown')).toBeNull();
  });

  it('1e: scheduled, the success names the day, the time and the cap', async () => {
    const { dialog, calls, user } = await openDialog({
      tables: [CONTACTS],
      preview: ready(),
      send: (body) => ({ status: 202, body: { run: run({ status: 'scheduled', state: 'running', scheduledAt: (body as { scheduleAt: number }).scheduleAt }) } }),
      detail: detail(),
    });
    await user.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    fireEvent.change(within(dialog).getByTestId('email-campaign-at'), { target: { value: '2999-07-30T10:00' } });
    await waitFor(() => expect((within(dialog).getByTestId('email-campaign-send') as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(dialog).getByTestId('email-campaign-send'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/send'))).toBe(true));
    expect(await screen.findByText('Campaign scheduled!')).toBeDefined();
    expect(screen.getByText(/^July news goes out .+ at .+, at most 100 an hour\.$/)).toBeDefined();
  });
});

describe('the send log (as a marketer)', () => {
  const row = (over: Partial<EmailSendLogRow>): EmailSendLogRow => ({ id: 'esnd_1', seq: 1, name: 'Marta Kovac', address: 'marta@cobalt.example', language: 'en_US', state: 'sent', reason: null, time: Date.UTC(2026, 5, 30, 10, 2), retrying: false, attempts: 1, clicks: 0, ...over });
  const log = () => ({
    summary: { total: 9, sent: 2, waiting: 0, skipped: 2, bounced: 1, spam: 1, failed: 1, unsubscribed: 1 },
    rows: [
      row({ id: 'a' }),
      row({ id: 'b', name: 'Owen Marsh', state: 'sent', retrying: true, reason: 'Mail server timed out' }),
      row({ id: 'c', name: 'Ines Vaughan', state: 'bounced', reason: '550 mailbox unavailable' }),
      row({ id: 'd', name: 'Tomas Reidy', state: 'spam', reason: 'notice:postmark' }),
      row({ id: 'e', name: 'Felix Morgan', state: 'failed', reason: 'Mail server timed out' }),
      row({ id: 'f', name: 'Callum Brookes', state: 'skipped-stop', reason: 'do-not-email', time: null }),
      row({ id: 'g', name: 'Aisha Rahman', state: 'skipped-consent', reason: 'not-agreed' }),
      row({ id: 'h', name: 'Ruth Adeyemi', state: 'unsubscribed' }),
    ],
    next: null,
  });

  it('opens on the campaign’s tab: the summary counts Failed too, each state is worded, and filters and search ask the server', async () => {
    const { calls, user } = await openEditor({ tables: [], preview: ready(), log, detail: detail({ run: run() }) });
    await user.click(await screen.findByTestId('email-view-log'));
    const page = await screen.findByTestId('email-send-log');
    await waitFor(() => expect(within(page).getByTestId('email-log-summary-sent').textContent).toBe('Sent2'));
    expect(within(page).getByTestId('email-log-summary-failed').textContent).toBe('Failed1');
    expect(within(page).getByTestId('email-log-summary-spam').textContent).toBe('Marked as spam1');
    const table = within(page).getByRole('table', { name: 'Send log' });
    const lines = within(table)
      .getAllByTestId('email-log-row')
      .map((el) => [...el.querySelectorAll('[role="cell"]')].map((cell) => cell.textContent));
    expect(lines.map((cells) => [cells[0], cells[2], cells[4]])).toEqual([
      ['Marta Kovac', 'Sent', '—'],
      ['Owen Marsh', 'Failed', 'Mail server timed out — will try again'],
      ['Ines Vaughan', 'Bounced', '550 mailbox unavailable'],
      ['Tomas Reidy', 'Marked as spam', 'Reported by Postmark'],
      ['Felix Morgan', 'Failed', 'Mail server timed out'],
      ['Callum Brookes', 'Skipped — do-not-email list', '—'],
      ['Aisha Rahman', 'Skipped — hasn’t agreed', '—'],
      ['Ruth Adeyemi', 'Unsubscribed', 'After sending'],
    ]);
    // A failed row is over: no "will try again" on it.
    expect(lines[4]?.[4]).not.toContain('try again');

    await user.click(within(page).getByRole('radio', { name: 'Bounced' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/email-runs/run_1/log?filter=bounced&limit=50')).toBe(true));
    await user.type(within(page).getByTestId('email-log-search'), 'ines');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/email-runs/run_1/log?filter=bounced&q=ines&limit=50')).toBe(true));
    expect(within(page).getByTestId('email-log-csv').getAttribute('href')).toBe('/api/v1/email-runs/run_1/log.csv?filter=bounced&q=ines');
    await user.click(screen.getByTestId('email-view-edit'));
    expect(await screen.findByTestId('email-canvas')).toBeDefined();
  });

  it('a send stopped for good says the rest were not sent, not that they wait', async () => {
    const stoppedLog = () => ({ summary: { total: 3, sent: 1, waiting: 2, skipped: 0, bounced: 0, spam: 0, failed: 0, unsubscribed: 0 }, rows: [row({ id: 'a' }), row({ id: 'b', name: 'Nadia Brooks', state: 'queued', time: null })], next: null });
    const { user } = await openEditor({ tables: [], preview: ready(), log: stoppedLog, detail: detail({ run: run({ status: 'cancelled', state: 'stopped' }) }) });
    await user.click(await screen.findByTestId('email-view-log'));
    const page = await screen.findByTestId('email-send-log');
    await waitFor(() => expect(within(page).getByTestId('email-log-summary-waiting').textContent).toBe('Not sent2'));
    expect(within(page).getByRole('radio', { name: 'Not sent' })).toBeDefined();
    const badges = within(within(page).getByRole('table', { name: 'Send log' })).getAllByTestId('email-log-state').map((el) => el.textContent);
    expect(badges).toEqual(['Sent', 'Not sent — the send was stopped']);
  });

  it('a campaign never sent has no tabs', async () => {
    await openEditor({ tables: [], preview: ready(), detail: detail() });
    expect(screen.queryByTestId('email-view-log')).toBeNull();
  });
});

describe('the locked footer', () => {
  it('a marketing e-mail shows the two locked lines in the canvas and in the footer’s panel', async () => {
    const { user } = await openEditor({ tables: [], preview: ready(), detail: detail() });
    const canvas = await screen.findByTestId('email-locked-footer');
    await waitFor(() => expect(canvas.textContent).toContain('Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom'));
    expect(canvas.textContent).toContain('Unsubscribe from Meridian’s newsletter');
    await user.click(screen.getByTestId('email-section-footer'));
    const rows = await screen.findByTestId('email-locked-rows');
    expect(rows.textContent).toContain('Added to every marketing mail. You can’t remove them.');
    expect(rows.textContent).toContain('Unsubscribe from Meridian’s newsletter');
  });

  it('a service e-mail shows none', async () => {
    const { user } = await openEditor({ tables: [], preview: ready(), detail: detail({ category: 'transactional', kind: 'template' }) });
    await user.click(screen.getByTestId('email-section-footer'));
    await screen.findByTestId('email-footer-panel');
    expect(screen.queryByTestId('email-locked-footer')).toBeNull();
    expect(screen.queryByTestId('email-locked-rows')).toBeNull();
  });
});
