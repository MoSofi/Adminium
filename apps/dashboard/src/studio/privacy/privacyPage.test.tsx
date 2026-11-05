// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Privacy & public pages (`/studio/privacy`), router-mounted:
 *
 *  - who gets in: the Super Admin (`privacy.manage`); the built-in Admin, a
 *    marketer holding `settings.manage` and a rep get the house's no-access
 *    state and no request for anyone's data;
 *  - the four tabs, each with its own address, and nothing else;
 *  - the reach card first on "Privacy notice" and "Your websites": one line
 *    while reachable, else the state's card ("Check again" reads again; "Set
 *    it" only for someone who may change the address);
 *  - Your websites: the list with who added each, every line of the add box
 *    checked as typed (the comp's sample shows its four refusals, "Add" off),
 *    a save that sends the lines and shows the server's own refusals, a
 *    removal, and the loader line on the public address to copy;
 *  - Privacy notice: the empty state, `http://` refused in the field (Save
 *    off) and on save (the server's 422 shown), an https address saved;
 *  - A person's data: find → the result card grouped with its counts;
 *    nothing found; "Download everything" asks for a .zip and the ready one
 *    is a link to its own id; the erase dialog shows the server's What goes
 *    / What stays / Left, keeps "Erase for good" off until the address is
 *    typed again (any case), sends it as `confirm`, and ends on "Erased";
 *    a 409 never repeats the address; the address never rides a URL;
 *  - How long we keep things: the two fixed rows in their words, and a row
 *    per forms add-on saying how long its own setting keeps the answers.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ErasePreview, ListedWebsite, PersonFound, PrivacyExport, PrivacyNotice, PublicReach } from './privacyApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const MARTA = 'marta.kovac@cobaltlegal.example';
const HOUR = 3_600_000;

interface Call {
  method: string;
  url: string;
  body: unknown;
}

let roles: string[];
let systemActions: string[];
let notice: PrivacyNotice;
let exportsList: PrivacyExport[];
let eraseReply: { status: number; body: unknown };
/** The erase preview never answers (the dialog stays on its loading state). */
let previewHangs = false;
let reach: PublicReach;
let websites: ListedWebsite[];
/** What the next add answers instead of adding (the server found the list changed). */
let addRefusal: { lines: { line: string; code: string; origin: string | null }[]; tooMany: boolean } | null = null;

const TESSA = { id: 'usr_tessa', name: 'Tessa Marlow' };
const JULY_2 = Date.UTC(2026, 6, 2, 12);

const FOUND: PersonFound = {
  address: MARTA,
  found: true,
  person: { name: 'Marta Kovac', company: 'Cobalt Legal' },
  sources: [
    { id: 'people-crm-contacts', kind: 'people', group: 'gave', connectionId: 'con_1', table: 'contacts', app: 'sales-crm', ref: 'contacts', label: 'Contacts', keptByLaw: null, count: 1, keys: ['7'] },
    { id: 'consent', kind: 'consent', group: 'agreed', connectionId: null, table: null, app: null, ref: null, label: null, keptByLaw: null, count: 4, keys: ['a', 'b', 'c', 'd'] },
    { id: 'stop-list', kind: 'stop-list', group: 'agreed', connectionId: null, table: null, app: null, ref: null, label: null, keptByLaw: null, count: 1, keys: ['s'] },
    { id: 'campaign-mail', kind: 'campaign-mail', group: 'held', connectionId: null, table: null, app: null, ref: null, label: null, keptByLaw: null, count: 3, keys: ['x', 'y', 'z'] },
    { id: 'form-answers-forms', kind: 'form-answers', group: 'gave', connectionId: 'con_1', table: 'forms_answers', app: 'forms', ref: 'answers', label: 'Answers', keptByLaw: null, count: 2, keys: ['a1', 'a2'] },
    { id: 'form-invitations-forms', kind: 'form-invitations', group: 'held', connectionId: 'con_1', table: 'forms_invitations', app: 'forms', ref: 'invitations', label: null, keptByLaw: null, count: 1, keys: ['i1'] },
    { id: 'form-files-forms', kind: 'form-files', group: 'gave', connectionId: 'con_1', table: 'forms_answer_files', app: 'forms', ref: 'answer_files', label: null, keptByLaw: null, count: 2, keys: ['f1', 'f2'] },
  ],
};

const PREVIEW: ErasePreview = {
  address: MARTA,
  found: true,
  goes: [
    { kind: 'people', count: 1, connectionId: 'con_1', table: 'contacts', app: 'sales-crm', label: 'Contacts' },
    { kind: 'consent', count: 4 },
    { kind: 'campaign-mail', count: 3 },
    { kind: 'form-answers', count: 2, connectionId: 'con_1', table: 'forms_answers', app: 'forms', label: 'Answers' },
    { kind: 'form-invitations', count: 1, connectionId: 'con_1', table: 'forms_invitations', app: 'forms', label: 'Invitations' },
    { kind: 'form-files', count: 2, connectionId: 'con_1', table: 'forms_answer_files', app: 'forms', label: 'Answer files' },
  ],
  stays: [
    { kind: 'app-rows', reason: 'tax', count: 2, keptDays: null, forever: false, connectionId: 'con_1', table: 'invoices', app: 'sales-crm', label: 'Invoices' },
    { kind: 'exports', reason: 'kept-a-while', count: null, keptDays: 30, forever: false },
    { kind: 'do-not-email', reason: 'objection', count: null, keptDays: null, forever: true },
  ],
  left: [{ connectionId: 'con_1', table: 'contacts', column: 'joined_on', rows: 1 }],
};

function stub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      const ok = (data: unknown, status = 200) => Promise.resolve(jsonResponse(status, JSON.parse(JSON.stringify(data)) as unknown));
      if (url.startsWith('/api/v1/bootstrap')) return ok({ data: makeBootstrap({ roles, nav: { groups: [] }, systemActions }) });
      if (url === '/api/v1/privacy/notice' && method === 'GET') return ok({ data: notice });
      if (url === '/api/v1/privacy/notice' && method === 'PUT') {
        const next = body as { businessName: string | null; noticeUrl: string | null };
        if (next.noticeUrl !== null && !next.noticeUrl.startsWith('https://')) return ok({ error: { code: 'VALIDATION_FAILED', message: 'Use an https:// address.', details: { field: 'noticeUrl' } } }, 422);
        notice = { ...next, ready: next.businessName !== null && next.noticeUrl !== null, shownName: next.businessName ?? 'Meridian' };
        return ok({ data: notice });
      }
      if (url === '/api/v1/privacy/keeping') {
        return ok({
          data: {
            rows: [
              { key: 'consent-history', fixed: true, keptFor: 'until-erased', options: [] },
              { key: 'do-not-email', fixed: true, keptFor: 'forever', options: [] },
              { key: 'form-answers', fixed: true, keptFor: 24, options: [], addOn: { key: 'forms', name: 'Forms & surveys' } },
              { key: 'form-answers', fixed: true, keptFor: 'until-removed', options: [], addOn: { key: 'polls', name: 'Polls' } },
              // A row a later server adds, which this screen cannot word: left out.
              { key: 'chat-transcripts', fixed: false, keptFor: 12, options: [6, 12] },
            ],
          },
        });
      }
      if (url === '/api/v1/privacy/find') {
        const address = (body as { address: string }).address.toLowerCase();
        return ok({ data: address === MARTA ? FOUND : { address, found: false, person: null, sources: [] } });
      }
      if (url === '/api/v1/privacy/exports' && method === 'GET') return ok({ data: exportsList });
      if (url === '/api/v1/privacy/exports' && method === 'POST') {
        const made: PrivacyExport = { id: 'pex_2', status: 'ready', counts: { consent: 4 }, createdAt: Date.now(), completedAt: Date.now(), expiresAt: Date.now() + 24 * HOUR };
        exportsList = [made, ...exportsList];
        return ok({ data: { ...made, jobId: 'job_1' } }, 202);
      }
      if (url === '/api/v1/privacy/reach') return ok({ data: reach });
      if (url === '/api/v1/privacy/websites' && method === 'GET') return ok({ data: { websites, max: 50 } });
      if (url === '/api/v1/privacy/websites' && method === 'POST') {
        if (addRefusal !== null) return ok({ error: { code: 'VALIDATION_FAILED', message: 'Some lines are not websites that can be listed.', details: { ...addRefusal, max: 50 } } }, 422);
        const lines = (body as { lines: string[] }).lines;
        websites = [...websites, ...lines.map((line) => ({ origin: new URL(line).origin, addedBy: TESSA, addedAt: JULY_2 }))];
        return ok({ data: { websites, max: 50 } });
      }
      if (url === '/api/v1/privacy/websites/remove') {
        websites = websites.filter((site) => site.origin !== (body as { origin: string }).origin);
        return ok({ data: { websites, max: 50 } });
      }
      if (url === '/api/v1/privacy/erase/preview') return previewHangs ? new Promise(() => undefined) : ok({ data: PREVIEW });
      if (url === '/api/v1/privacy/erase') return ok(eraseReply.body, eraseReply.status);
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderAt(path: string) {
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

/** The Super Admin as the server seeds them: every key, `privacy.manage` among them. */
function asSuperAdmin(): void {
  roles = ['super-admin'];
  systemActions = ['users.manage', 'roles.manage', 'settings.manage', 'audit.read', 'privacy.manage', 'connections.manage'];
}

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
  notice = { businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy', ready: true, shownName: 'Meridian Workplace Ltd' };
  exportsList = [];
  eraseReply = { status: 200, body: { data: { counts: { 'people-crm-contacts': 1, consent: 4 }, left: [], filesFailed: 0 } } };
  previewHangs = false;
  reach = { state: 'reachable', origin: 'https://crm.meridian.example', checkedAt: Date.now() };
  websites = [];
  addRefusal = null;
});
reach = { state: 'reachable', origin: 'https://crm.meridian.example', checkedAt: Date.now() };
websites = [];
notice = { businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy', ready: true, shownName: 'Meridian Workplace Ltd' };
exportsList = [];
eraseReply = { status: 200, body: { data: { counts: {}, left: [], filesFailed: 0 } } };

describe('who opens the privacy page', () => {
  it.each([
    ['the built-in Admin', ['admin'], ['users.manage', 'audit.read', 'connections.manage', 'schema.remap', 'llm.run', 'project.read']],
    ['a marketer with settings.manage', ['marketing'], ['settings.manage']],
    ['a rep', ['rep'], []],
  ])('%s gets the no-access state and asks for nothing', async (_who, asRoles, actions) => {
    roles = asRoles;
    systemActions = actions;
    const { calls } = await renderAt('/studio/privacy?tab=person');
    expect(await screen.findByText('You don’t have access')).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'A person’s data' })).toBeNull();
    expect(calls.some((call) => call.url.startsWith('/api/v1/privacy'))).toBe(false);
  });

  it('a role granted privacy.manage on purpose gets in, without ways into screens it cannot open', async () => {
    roles = ['dpo'];
    systemActions = ['privacy.manage'];
    await renderAt('/studio/privacy?tab=person');
    await userEvent.type(await screen.findByLabelText('E-mail address'), MARTA);
    await userEvent.click(screen.getByTestId('privacy-person-find'));
    const card = await screen.findByTestId('privacy-result');
    expect(within(card).getByText('Do-not-email list')).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Open Do-not-email list' })).toBeNull();
    await userEvent.click(screen.getByTestId('privacy-erase'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('erase-goes');
    await userEvent.type(within(dialog).getByLabelText('Type the address to confirm'), MARTA);
    await userEvent.click(within(dialog).getByTestId('erase-for-good'));
    expect(await screen.findByText('Erased. Saved in the audit log.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open the audit log' })).toBeNull();
  });

  it('a shop owner holding privacy.people alone gets the person tab, asks for no notice, and erases', async () => {
    roles = ['shop-owner'];
    systemActions = ['privacy.people'];
    const { calls } = await renderAt('/studio/privacy?tab=notice');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['A person’s data']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    await userEvent.type(await screen.findByLabelText('E-mail address'), MARTA);
    await userEvent.click(screen.getByTestId('privacy-person-find'));
    await screen.findByTestId('privacy-result');
    await userEvent.click(screen.getByTestId('privacy-erase'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('erase-goes');
    await userEvent.type(within(dialog).getByLabelText('Type the address to confirm'), MARTA);
    await userEvent.click(within(dialog).getByTestId('erase-for-good'));
    expect(await screen.findByText('Erased. Saved in the audit log.')).toBeDefined();
    // Nothing of the notice, the websites or the keeping was asked for: those routes would refuse.
    expect(calls.some((call) => ['/api/v1/privacy/notice', '/api/v1/privacy/websites', '/api/v1/privacy/keeping', '/api/v1/privacy/reach'].includes(call.url))).toBe(false);
  });

  it('a rep asking for the websites tab gets the no-access state and asks for no list', async () => {
    roles = ['rep'];
    systemActions = ['settings.manage'];
    const { calls } = await renderAt('/studio/privacy?tab=websites');
    expect(await screen.findByText('You don’t have access')).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Your websites' })).toBeNull();
    expect(calls.some((call) => call.url.startsWith('/api/v1/privacy'))).toBe(false);
  });

  it('the Super Admin gets exactly the four tabs, each with its own address', async () => {
    asSuperAdmin();
    const { router } = await renderAt('/studio/privacy');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Privacy notice', 'Your websites', 'A person’s data', 'How long we keep things']);
    expect(screen.getByRole('tab', { name: 'Privacy notice' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('tab', { name: 'Your websites' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'websites' }));
    expect(await screen.findByText('Websites that may show your forms and chat')).toBeDefined();
    await userEvent.click(screen.getByRole('tab', { name: 'How long we keep things' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'keeping' }));
    expect(await screen.findByText('Kept until the person is erased')).toBeDefined();
  });
});

describe('the privacy notice', () => {
  it('says what is missing while either field is blank, and Save stays off', async () => {
    asSuperAdmin();
    notice = { businessName: null, noticeUrl: null, ready: false, shownName: 'Meridian' };
    await renderAt('/studio/privacy');
    expect(await screen.findByTestId('privacy-notice-unset')).toBeDefined();
    expect(screen.getByText('Set both: they’re shown on every form, the chat and the cookie banner once they arrive.')).toBeDefined();
    await userEvent.type(screen.getByLabelText('Business name'), 'Meridian Workplace Ltd');
    expect((screen.getByTestId('privacy-notice-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses http:// in the field, then saves an https address', async () => {
    asSuperAdmin();
    notice = { businessName: 'Meridian Workplace Ltd', noticeUrl: null, ready: false, shownName: 'Meridian Workplace Ltd' };
    const { calls } = await renderAt('/studio/privacy?tab=notice');
    const field = await screen.findByLabelText('Privacy notice address');
    await userEvent.type(field, 'http://www.meridian.example/privacy');
    expect(await screen.findByText('Use an address that starts with https, such as https://www.example.com/privacy.')).toBeDefined();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByTestId('privacy-notice-save') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, 'https://www.meridian.example/privacy');
    expect(screen.queryByText('Use an address that starts with https, such as https://www.example.com/privacy.')).toBeNull();
    await userEvent.click(screen.getByTestId('privacy-notice-save'));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')!.body).toEqual({ businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy' });
    await waitFor(() => expect(screen.queryByTestId('privacy-notice-unset')).toBeNull());
  });

  it('shows the server’s refusal of a non-https address on save', async () => {
    asSuperAdmin();
    notice = { businessName: 'Meridian Workplace Ltd', noticeUrl: null, ready: false, shownName: 'Meridian Workplace Ltd' };
    await renderAt('/studio/privacy');
    const field = await screen.findByLabelText('Privacy notice address');
    // `https:` with no host passes no check here; the stub refuses what does not start with https://.
    await userEvent.type(field, 'HTTPS://www.meridian.example/privacy');
    await userEvent.click(screen.getByTestId('privacy-notice-save'));
    expect(await screen.findByText('Use an address that starts with https, such as https://www.example.com/privacy.')).toBeDefined();
  });
});

describe('a person’s data', () => {
  async function findMarta(typed = MARTA) {
    asSuperAdmin();
    const rendered = await renderAt('/studio/privacy?tab=person');
    await userEvent.type(await screen.findByLabelText('E-mail address'), typed);
    await userEvent.click(screen.getByTestId('privacy-person-find'));
    await screen.findByTestId('privacy-result');
    return rendered;
  }

  it('finds the person and lists each place, grouped, with its count', async () => {
    const { calls } = await findMarta();
    const card = screen.getByTestId('privacy-result');
    expect(within(card).getByRole('heading', { name: 'Marta Kovac · Cobalt Legal' })).toBeDefined();
    expect(within(card).getByText('What they gave you')).toBeDefined();
    expect(within(card).getByText('What they agreed to or asked')).toBeDefined();
    expect(within(card).getByText('What the business keeps about them')).toBeDefined();
    const rows = within(card).getAllByTestId('privacy-source').map((row) => row.textContent);
    expect(rows).toEqual(['Contacts — sales-crm1 row', 'Answers — forms2 answers', 'Files sent with form answers2 files', 'Consent history4 entries', 'Do-not-email listyesOpen', 'Campaign e-mails3', 'Survey invitations1 invitation']);
    expect(calls.find((call) => call.url === '/api/v1/privacy/find')!.body).toEqual({ address: MARTA });
  });

  it('says nothing was found for an address with nothing kept', async () => {
    asSuperAdmin();
    await renderAt('/studio/privacy?tab=person');
    await userEvent.type(await screen.findByLabelText('E-mail address'), 'tomas.reidy@nordwind.example');
    await userEvent.click(screen.getByTestId('privacy-person-find'));
    expect(await screen.findByText('Nothing here for that address.')).toBeDefined();
    expect(screen.getByText('Check the spelling, or try another address this person used.')).toBeDefined();
  });

  it('"Download everything" asks for the .zip, and the ready one links to its id alone', async () => {
    const { calls } = await findMarta();
    await userEvent.click(screen.getByTestId('privacy-download'));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/privacy/exports' && call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST' && call.url === '/api/v1/privacy/exports')!.body).toEqual({ address: MARTA });
    const link = await screen.findByTestId('privacy-download-get');
    expect(link.getAttribute('href')).toBe('/api/v1/privacy/exports/pex_2/download');
    expect(screen.getByTestId('privacy-download-status').textContent).toBe('Ready');
  });

  it('the erase dialog shows the server’s lists and opens "Erase for good" only to the typed address', async () => {
    const { calls } = await findMarta();
    await userEvent.click(screen.getByTestId('privacy-erase'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Erase everything about this person?' })).toBeDefined();
    await within(dialog).findByTestId('erase-goes');
    expect(within(dialog).getByTestId('erase-goes').textContent).toBe('What goes1 row in Contacts, 4 consent entries, 3 campaign e-mails, 2 form answers in Answers, 1 survey invitation in Invitations, kept without their address, 2 files sent with form answers in Answer files');
    const stays = within(dialog).getByTestId('erase-stays').textContent ?? '';
    expect(stays).toContain('2 rows in Invoices, because tax law needs them.');
    expect(stays).toContain('Data exports staff made of a table may hold them, until each one expires. Kept for 30 days.');
    expect(stays).toContain('Their address stays on the do-not-email list as a code, so they’re never e-mailed again.');
    expect(within(dialog).getByTestId('erase-left').textContent).toContain('contacts.joined_on');
    const confirm = within(dialog).getByLabelText('Type the address to confirm');
    expect(document.activeElement).toBe(confirm);
    const eraseButton = within(dialog).getByTestId('erase-for-good') as HTMLButtonElement;
    expect(eraseButton.disabled).toBe(true);
    await userEvent.type(confirm, 'marta.kovac@cobaltlegal.exampl');
    expect(eraseButton.disabled).toBe(true);
    await userEvent.type(confirm, 'E');
    expect(eraseButton.disabled).toBe(false);
    await userEvent.click(eraseButton);
    expect(await screen.findByText('Erased. Saved in the audit log.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open the audit log' })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.find((call) => call.url === '/api/v1/privacy/erase')!.body).toEqual({ address: MARTA, confirm: 'marta.kovac@cobaltlegal.examplE' });
    // The address went in bodies only, never in an address.
    expect(calls.every((call) => !call.url.toLowerCase().includes('marta'))).toBe(true);
  });

  it('a refused confirm says so without repeating the address, and nothing is shown as erased', async () => {
    eraseReply = { status: 409, body: { error: { code: 'CONFLICT', message: 'Type the address again to confirm the erasure.', details: { reason: 'confirm-mismatch' } } } };
    await findMarta();
    await userEvent.click(screen.getByTestId('privacy-erase'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('erase-goes');
    await userEvent.type(within(dialog).getByLabelText('Type the address to confirm'), MARTA);
    await userEvent.click(within(dialog).getByTestId('erase-for-good'));
    const refusal = await within(dialog).findByText('That isn’t the same address. Type it again.');
    expect(refusal.textContent).not.toContain('marta');
    expect(screen.queryByText('Erased. Saved in the audit log.')).toBeNull();
  });

  it('keeps "Erase for good" off until the server has said what goes, even with the address typed', async () => {
    previewHangs = true;
    await findMarta();
    await userEvent.click(screen.getByTestId('privacy-erase'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Type the address to confirm'), MARTA);
    expect((within(dialog).getByTestId('erase-for-good') as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).queryByTestId('erase-goes')).toBeNull();
  });

  it('Cancel closes the dialog and erases nothing', async () => {
    const { calls } = await findMarta();
    await userEvent.click(screen.getByTestId('privacy-erase'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.some((call) => call.url === '/api/v1/privacy/erase')).toBe(false);
    expect(screen.getByTestId('privacy-result')).toBeDefined();
  });
});

describe('how long we keep things', () => {
  it('shows the two fixed rows and each forms add-on\'s answers in their words, with no Save', async () => {
    asSuperAdmin();
    await renderAt('/studio/privacy?tab=keeping');
    const table = await screen.findByTestId('privacy-keeping');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['Consent history', 'Do-not-email list', 'Form answers — Forms & surveys', 'Form answers — Polls']);
    expect(rows[0]!.textContent).toContain('Kept until the person is erased');
    expect(rows[0]!.textContent).toContain('Kept, because it proves what a person agreed to or asked');
    expect(rows[1]!.textContent).toContain('Kept for good');
    // The add-on's own setting, said where it is changed.
    expect(rows[2]!.textContent).toContain('Kept for 24 months');
    expect(rows[2]!.textContent).toContain('Set in Forms & surveys’s settings. Older answers are deleted each night.');
    expect(rows[3]!.textContent).toContain('Kept until someone removes them');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('can visitors reach the public pages', () => {
  it('says so in one line while they can, on the notice tab and the websites tab', async () => {
    asSuperAdmin();
    await renderAt('/studio/privacy');
    const strip = await screen.findByTestId('privacy-reach');
    expect(strip.getAttribute('data-state')).toBe('reachable');
    expect(strip.textContent).toBe('Visitors can reach https://crm.meridian.exampleReachable');
    expect(screen.getByRole('region', { name: 'Can visitors reach your public pages?' })).toBe(strip);
    cleanup();
    await renderAt('/studio/privacy?tab=websites');
    expect((await screen.findByTestId('privacy-reach')).getAttribute('data-state')).toBe('reachable');
  });

  it('names the proxy setting, and "Check again" reads the facts again', async () => {
    asSuperAdmin();
    reach = { state: 'proxy-hidden', origin: 'https://crm.meridian.example', checkedAt: Date.now() };
    const { calls } = await renderAt('/studio/privacy');
    const card = await screen.findByTestId('privacy-reach');
    expect(card.getAttribute('data-state')).toBe('proxy-hidden');
    expect(within(card).getByText('Proxy setting')).toBeDefined();
    expect(within(card).getByTestId('privacy-reach-problem').textContent).toBe("This server is behind a proxy that hides visitors' addresses, so limits on forms can't work. Set ADMINIUM_TRUST_PROXY=on.");
    expect(within(card).getByText('Ask whoever runs this server to set it and restart.')).toBeDefined();
    expect(within(card).queryByTestId('privacy-reach-set')).toBeNull();
    const before = calls.filter((call) => call.url === '/api/v1/privacy/reach').length;
    reach = { state: 'reachable', origin: 'https://crm.meridian.example', checkedAt: Date.now() };
    await userEvent.click(within(card).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByTestId('privacy-reach').getAttribute('data-state')).toBe('reachable'));
    expect(calls.filter((call) => call.url === '/api/v1/privacy/reach').length).toBe(before + 1);
  });

  it('with no public https address, shows the address seen and "Set it" to the Senders card', async () => {
    asSuperAdmin();
    reach = { state: 'not-set', origin: null, checkedAt: Date.now() };
    await renderAt('/studio/privacy?tab=websites');
    const card = await screen.findByTestId('privacy-reach');
    expect(within(card).getByText('No address')).toBeDefined();
    expect(within(card).getByTestId('privacy-reach-problem').textContent).toBe('This server has no public https address. Forms, chat and unsubscribe links need one.');
    expect(within(card).getByTestId('privacy-reach-address').textContent).toBe('(not set)');
    expect(within(card).getByRole('link', { name: 'Set it' }).getAttribute('href')).toBe('/studio/settings#email-link-origin');
  });

  it('shows the plain http address it saw, and no "Set it" to someone who may not change it', async () => {
    roles = ['dpo'];
    systemActions = ['privacy.manage'];
    reach = { state: 'not-https', origin: 'http://crm.meridian.example', checkedAt: Date.now() };
    await renderAt('/studio/privacy');
    const card = await screen.findByTestId('privacy-reach');
    expect(within(card).getByTestId('privacy-reach-address').textContent).toBe('http://crm.meridian.example');
    expect(within(card).queryByRole('link', { name: 'Set it' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Check again' })).toBeDefined();
  });

  it('words the network-off and desktop states as Payments does', async () => {
    asSuperAdmin();
    reach = { state: 'desktop', origin: null, checkedAt: Date.now() };
    await renderAt('/studio/privacy');
    const card = await screen.findByTestId('privacy-reach');
    expect(within(card).getByTestId('privacy-reach-problem').textContent).toBe('This server runs on this computer only. Customers cannot reach it.');
    expect(within(card).getByText('This computer only')).toBeDefined();
  });
});

describe('your websites', () => {
  const field = () => screen.getByTestId('privacy-websites-field') as HTMLTextAreaElement;
  const add = () => screen.getByTestId('privacy-websites-add') as HTMLButtonElement;
  const checks = () => within(screen.getByTestId('privacy-websites-checks')).queryAllByRole('listitem').map((item) => item.textContent);

  it('lists each website with who added it and when', async () => {
    asSuperAdmin();
    websites = [
      { origin: 'https://www.meridian.example', addedBy: TESSA, addedAt: JULY_2 },
      { origin: 'https://shop.meridian.example', addedBy: null, addedAt: JULY_2 },
    ];
    await renderAt('/studio/privacy?tab=websites');
    const list = await screen.findByTestId('privacy-websites-list');
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'https://www.meridian.exampleAdded by Tessa Marlow · Jul 2Remove',
      'https://shop.meridian.exampleAdded Jul 2Remove',
    ]);
    expect(within(list).getByRole('button', { name: 'Remove https://www.meridian.example' })).toBeDefined();
  });

  it('checks every line as typed: the comp’s sample shows its four refusals and "Add" stays off', async () => {
    asSuperAdmin();
    websites = [{ origin: 'https://www.meridian.example', addedBy: TESSA, addedAt: JULY_2 }];
    const { calls } = await renderAt('/studio/privacy?tab=websites');
    await screen.findByTestId('privacy-websites-list');
    expect(add().disabled).toBe(true);
    await userEvent.type(field(), 'http://events.meridian.example{enter}https://*.meridian.example{enter}https://crm.meridian.example{enter}https://WWW.meridian.example/{enter}https://events.meridian.example/forms');
    expect(checks()).toEqual([
      'http://events.meridian.example · Use https://',
      'https://*.meridian.example · One website per line, no *',
      'https://crm.meridian.example · That\'s this server\'s own address',
      'https://WWW.meridian.example/ · Already on the list',
      'https://events.meridian.example/forms · Just the address, no path',
    ]);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('privacy-websites-checks').getAttribute('aria-live')).toBe('polite');
    expect(field().getAttribute('dir')).toBe('ltr');
    expect(add().disabled).toBe(true);
    await userEvent.click(add());
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/privacy/websites')).toBe(false);
  });

  it('adds every good line at once, and the list shows them', async () => {
    asSuperAdmin();
    const { calls } = await renderAt('/studio/privacy?tab=websites');
    expect(await screen.findByTestId('privacy-websites-none')).toBeDefined();
    await userEvent.type(field(), 'https://events.meridian.example{enter}{enter}  https://Shop.meridian.example/  ');
    expect(checks()).toEqual(['https://events.meridian.example · Ready to add', 'https://Shop.meridian.example/ · Ready to add']);
    expect(field().getAttribute('aria-invalid')).toBeNull();
    await userEvent.click(add());
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/privacy/websites')).toBe(true));
    expect(calls.find((call) => call.method === 'POST' && call.url === '/api/v1/privacy/websites')!.body).toEqual({ lines: ['https://events.meridian.example', 'https://Shop.meridian.example/'] });
    const list = await screen.findByTestId('privacy-websites-list');
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent?.split('Added')[0])).toEqual(['https://events.meridian.example', 'https://shop.meridian.example']);
    expect(field().value).toBe('');
  });

  it('shows the server’s own refusal on each line when the list changed meanwhile', async () => {
    asSuperAdmin();
    addRefusal = { lines: [{ line: 'https://events.meridian.example', code: 'listed', origin: 'https://events.meridian.example' }], tooMany: false };
    await renderAt('/studio/privacy?tab=websites');
    await screen.findByTestId('privacy-websites-none');
    await userEvent.type(field(), 'https://events.meridian.example');
    await userEvent.click(add());
    await waitFor(() => expect(checks()).toEqual(['https://events.meridian.example · Already on the list']));
    expect(add().disabled).toBe(true);
    // Changing the lines checks them again here.
    await userEvent.type(field(), 'x');
    expect(checks()).toEqual(['https://events.meridian.examplex · Ready to add']);
  });

  it('removes a website at once and says so', async () => {
    asSuperAdmin();
    websites = [{ origin: 'https://www.meridian.example', addedBy: TESSA, addedAt: JULY_2 }];
    const { calls } = await renderAt('/studio/privacy?tab=websites');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove https://www.meridian.example' }));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/privacy/websites/remove')).toBe(true));
    expect(calls.find((call) => call.url === '/api/v1/privacy/websites/remove')!.body).toEqual({ origin: 'https://www.meridian.example' });
    expect(await screen.findByText('Removed https://www.meridian.example')).toBeDefined();
    expect(await screen.findByTestId('privacy-websites-none')).toBeDefined();
  });

  it('gives the loader line on the public address, to copy', async () => {
    asSuperAdmin();
    await renderAt('/studio/privacy?tab=websites');
    const embed = await screen.findByTestId('privacy-embed');
    expect(within(embed).getByTestId('privacy-embed-line').textContent).toBe('<script src="https://crm.meridian.example/x/embed.js" async></script>');
    expect(within(embed).getByTestId('privacy-embed-line').getAttribute('dir')).toBe('ltr');
    const copy = within(embed).getByRole('button', { name: 'Copy the loader line' });
    expect(copy.textContent).toBe('Copy');
    expect(within(embed).getByText('Then add a form or the chat where you want it. Each form\'s Share tab has its own line.')).toBeDefined();
  });
});
