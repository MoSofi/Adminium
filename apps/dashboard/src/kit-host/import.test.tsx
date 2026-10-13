// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The import wizard, as an app's own screen mounts it: plain props in, a
 * handle out.
 *
 * Worth proving: a paste is previewed and run through the server's doors
 * with the person's session and the app's token, and the app is told what
 * the import did; the app's table, its columns, its one allowed mode and its
 * "no two rows share this" columns are what the wizard offers; several
 * tables are picked by their labels and one is not asked about; every
 * refusal of a door is said in the part (no right to import, to read, to
 * update when made and again when run, a paste too large, anything else in
 * the server's own sentence); `update` keeps what was typed, the mapping and
 * the step; nothing is asked after unmount; and the part asks for no word
 * outside its set, in any language.
 *
 * The server here is a function handed over as the part's `fetch`. The real
 * doors, the real rights and a real browser are apps/e2e/tests/kit-parts.spec.ts.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportProps, ImportResult, ImportTable, KitMounted } from './contract.js';
import { mount } from './index.js';
import { clearOutsideWords, KIT_LOCALES, outsideWords } from './words.js';

const COMPANIES: ImportTable = {
  table: 'crm_companies',
  label: 'Companies',
  columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email', unique: true }, { key: 'city', label: 'City' }],
  matchOn: 'email',
};
const CONTACTS: ImportTable = { table: 'crm_contacts', label: 'Contacts', columns: [{ key: 'full_name', label: 'Full name' }, { key: 'phone', label: 'Phone' }] };

interface Call {
  method: string;
  path: string;
  csrf: string | null;
  credentials: string | undefined;
  body: unknown;
}

interface Server {
  calls: Call[];
  fetch: NonNullable<ImportProps['fetch']>;
  /** A door answered otherwise, by `METHOD path` (the path without its query). */
  refuse: Record<string, { status: number; body?: unknown }>;
  job: 'running' | 'succeeded';
}

const reply = (status: number, body: unknown): Response => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const forbidden = (right: string): { status: number; body: unknown } => ({
  status: 403,
  body: { error: { code: 'TABLE_FORBIDDEN', message: 'You do not have import access to this table.', details: { permission: `table:conn_1:crm_companies:${right}` } } },
});

function server(): Server {
  const importRow = (status: string, stats: unknown = null): unknown => ({
    id: 'imp_1',
    connectionId: 'conn_1',
    tableName: 'crm_companies',
    requestedBy: 'usr_1',
    fileId: 'file_1',
    mapping: { columns: [] },
    options: created.options,
    status,
    stats,
    errorReportFileId: null,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
  });
  let created: { options: unknown } = { options: {} };
  const state: Server = {
    calls: [],
    refuse: {},
    job: 'succeeded',
    fetch: async (input, init = {}) => {
      const method = init.method ?? 'GET';
      const headers = new Headers(init.headers);
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body instanceof File ? await init.body.text() : null;
      state.calls.push({ method, path: input, csrf: headers.get('x-adminium-csrf'), credentials: init.credentials, body });
      const refused = state.refuse[`${method} ${input.split('?')[0] ?? ''}`];
      if (refused !== undefined) return reply(refused.status, refused.body);
      if (method === 'POST' && input.startsWith('/api/v1/imports/upload')) {
        return reply(201, { data: { fileId: 'file_1', filename: 'pasted.csv', sizeBytes: 80, sha256: 'x', columns: ['name', 'email', 'town'], sampleRows: [['Harbour', 'a@harbour.test', 'Kiel']], totalRows: 3 } });
      }
      if (method === 'POST' && input === '/api/v1/imports') {
        created = body as { options: unknown };
        return reply(201, { data: { import: importRow('ready'), report: { total: 3, valid: 3, invalid: 0, issues: [] } } });
      }
      if (input.startsWith('/api/v1/imports/imp_1/preview')) {
        return reply(200, {
          data: {
            total: 3,
            judged: 3,
            capped: false,
            hooksNotRun: false,
            counts: { new: 2, here: 1, refused: 0 },
            lines: [
              { row: 1, status: 'new', label: 'a@harbour.test' },
              { row: 2, status: 'here', label: 'b@second.test' },
              { row: 3, status: 'new', label: 'c@third.test' },
            ],
          },
        });
      }
      if (method === 'POST' && input === '/api/v1/imports/imp_1/run') return reply(202, { data: { import: importRow('running'), jobId: 'job_1' } });
      if (input === '/api/v1/jobs/job_1') return reply(200, { data: { id: 'job_1', kind: 'import', status: state.job, progress: { pct: state.job === 'running' ? 30 : 100 }, lastError: null } });
      if (input === '/api/v1/imports/imp_1') {
        return reply(200, { data: state.job === 'running' ? importRow('running') : importRow('succeeded', { total: 3, inserted: 2, updated: 0, skipped: 1, alreadyHere: 1 }) });
      }
      return reply(404, { error: { code: 'NOT_FOUND', message: 'No such door.' } });
    },
  };
  return state;
}

let host: HTMLElement;
let mounted: KitMounted<ImportProps> | null = null;
let api: Server;
let browserFetch: { mock: { calls: unknown[][] }; mockRestore(): void };

beforeEach(() => {
  clearOutsideWords();
  api = server();
  // The part is given a fetch of its own here: the browser's must then never be touched.
  browserFetch = vi.spyOn(globalThis, 'fetch');
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  host.remove();
  expect(browserFetch.mock.calls).toEqual([]);
  browserFetch.mockRestore();
  // The gate: nothing drawn in this file asked for a word the part does not carry.
  expect(outsideWords()).toEqual([]);
});

async function wizard(props: Partial<ImportProps> = {}): Promise<void> {
  await act(async () => {
    mounted = await mount('import', host, { connectionId: 'conn_1', tables: [COMPANIES], csrfToken: 'tok_1', fetch: api.fetch, locale: 'en-US', dir: 'ltr', ...props });
  });
}

const box = (): HTMLTextAreaElement => host.querySelector('textarea')!;
const byTest = (id: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const posts = (): Call[] => api.calls.filter((call) => call.method === 'POST');

/** Pastes rows and uses them: the wizard at its mapping step. */
async function paste(user: ReturnType<typeof userEvent.setup>, text = 'name,email,town\nHarbour,a@harbour.test,Kiel'): Promise<void> {
  fireEvent.change(box(), { target: { value: text } });
  await user.click(byTest('import-paste-use')!);
  await waitFor(() => expect(byTest('wizard-validate')).not.toBeNull());
}

async function toPreview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await paste(user);
  await user.click(byTest('wizard-validate')!);
  await waitFor(() => expect(byTest('validation-summary')).not.toBeNull());
}

describe('the import wizard, mounted', () => {
  it('stands under the kit’s wrapper on the table the app named, and asks nobody anything until something is pasted', async () => {
    await wizard({ title: 'Paste a list' });
    const wrapper = host.querySelector('.adm-kit');
    expect(wrapper?.getAttribute('data-kit-part')).toBe('import');
    expect(screen.getByRole('group', { name: 'Paste a list' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Paste a list' })).toBeTruthy();
    // One table: the person is not asked which.
    expect(byTest('import-target')).toBeNull();
    expect(box().disabled).toBe(false);
    expect(byTest('import-upload')).not.toBeNull();
    // No session read, no list of connections, no page: nothing at all.
    expect(api.calls).toEqual([]);
  });

  it('walks a paste to its preview and its run through the doors, with the session and the app’s token, and tells the app what it did', async () => {
    const onDone = vi.fn<(result: ImportResult) => void>();
    await wizard({ onDone });
    const user = userEvent.setup();
    await toPreview(user);
    // The upload is the pasted text itself, as CSV.
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/api/v1/imports/upload?filename=pasted.csv', body: 'name,email,town\nHarbour,a@harbour.test,Kiel' });
    // The import: the app's connection and table, the columns matched by their names, the match the app chose, rows left as they are.
    expect(api.calls[1]).toMatchObject({
      method: 'POST',
      path: '/api/v1/imports',
      body: {
        fileId: 'file_1',
        connectionId: 'conn_1',
        table: 'crm_companies',
        mapping: { columns: [{ from: 'name', to: 'name' }, { from: 'email', to: 'email' }, { from: 'town', to: null }] },
        options: { mode: 'skip', matchColumn: 'email', skipInvalid: true },
      },
    });
    // What each line would do, before anything is written.
    expect([...byTest('import-preview')!.querySelectorAll('[data-line]')].map((el) => `${el.getAttribute('data-status') ?? ''} ${el.querySelector('[data-part="line-label"]')?.textContent ?? ''}`)).toEqual([
      'new a@harbour.test',
      'here b@second.test',
      'new c@third.test',
    ]);
    expect(byTest('wizard-run')!.textContent).toBe('Bring in 2 new lines');
    expect(onDone).not.toHaveBeenCalled();

    await user.click(byTest('wizard-run')!);
    await waitFor(() => expect(byTest('import-review')).not.toBeNull());
    expect([...byTest('import-review')!.querySelectorAll('.font-mono')].map((el) => el.textContent)).toEqual(['3', '2', '0', '1']);
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ created: 2, updated: 0, skipped: 1, failed: 0 });

    // Every call went with the session; the three that change something carried the token, and no read did.
    expect(api.calls.every((call) => call.credentials === 'same-origin')).toBe(true);
    expect(posts().map((call) => [call.path.split('?')[0], call.csrf])).toEqual([
      ['/api/v1/imports/upload', 'tok_1'],
      ['/api/v1/imports', 'tok_1'],
      ['/api/v1/imports/imp_1/run', 'tok_1'],
    ]);
    expect(api.calls.filter((call) => call.method === 'GET').every((call) => call.csrf === null)).toBe(true);
    // Only the import doors and the job's: nothing of the dashboard's.
    expect(api.calls.every((call) => /^\/api\/v1\/(imports|jobs)(\/|$|\?)/.test(call.path))).toBe(true);
  });

  it('offers what the app allows: one mode and the person is not asked, and a match only on a column no two rows share', async () => {
    await wizard({ modes: ['skip'] });
    const user = userEvent.setup();
    await paste(user);
    const match = byTest('import-match-on') as HTMLSelectElement;
    // Name is mapped too, and is not marked: only Email may be matched on.
    expect([...match.options].map((option) => option.textContent)).toEqual(['Nothing: every line is new', 'Email']);
    expect(match.value).toBe('email');
    expect(byTest('import-when-here')).toBeNull();
    await user.click(byTest('wizard-validate')!);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect((posts()[1]!.body as { options: unknown }).options).toEqual({ mode: 'skip', matchColumn: 'email', skipInvalid: true });
  });

  it('with both modes the first is the one chosen, and the person may take the other', async () => {
    await wizard({ modes: ['update', 'skip'] });
    const user = userEvent.setup();
    await paste(user);
    const mode = byTest('import-when-here') as HTMLSelectElement;
    expect(mode.value).toBe('upsert');
    await user.selectOptions(mode, 'skip');
    await user.click(byTest('wizard-validate')!);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect((posts()[1]!.body as { options: { mode: string } }).options.mode).toBe('skip');
  });

  it('with no column marked, any column the mapping brings in can be matched on', async () => {
    await wizard({ tables: [{ ...COMPANIES, columns: COMPANIES.columns.map(({ key, label }) => ({ key, label })) }] });
    const user = userEvent.setup();
    await paste(user);
    expect([...(byTest('import-match-on') as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(['Nothing: every line is new', 'Name', 'Email']);
  });

  it('several tables are picked by the names the app gave, and another table starts over', async () => {
    await wizard({ tables: [COMPANIES, CONTACTS] });
    const picker = byTest('import-target') as HTMLSelectElement;
    expect(screen.getByLabelText('Target table')).toBe(picker);
    expect([...picker.options].map((option) => option.textContent)).toEqual(['Companies', 'Contacts']);
    expect(picker.value).toBe('crm_companies');
    fireEvent.change(box(), { target: { value: 'left behind' } });
    const user = userEvent.setup();
    await user.selectOptions(picker, 'crm_contacts');
    expect(box().value).toBe('');
    await paste(user, 'Full name,Phone\nDana,1');
    await user.click(byTest('wizard-validate')!);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]!.body).toMatchObject({ table: 'crm_contacts', options: { mode: 'insert', skipInvalid: true } });
  });

  it('offers only a paste, or only a file, where the app says so', async () => {
    await wizard({ sources: ['paste'] });
    expect(byTest('import-upload')).toBeNull();
    expect(byTest('import-paste')).not.toBeNull();
    await act(async () => mounted!.update({ sources: ['file'] }));
    expect(byTest('import-upload')).not.toBeNull();
    expect(byTest('import-paste')).toBeNull();
  });

  it.each([
    ['no right to import', 'import', 'You do not hold the right to import into Companies. Ask an administrator for it.'],
    ['no right to read what is matched against', 'read', 'Matching lines against the rows already there needs the right to read Companies. Match on nothing, or ask an administrator for it.'],
    ['no right to update', 'update', 'You do not hold the right to change rows of Companies. Leave the lines already here as they are, or ask an administrator for it.'],
  ])('says %s in the reader’s words, by the table’s name, and stays where the person can change their mind', async (_what, right, sentence) => {
    api.refuse['POST /api/v1/imports'] = forbidden(right);
    await wizard();
    const user = userEvent.setup();
    await paste(user);
    await user.click(byTest('wizard-validate')!);
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect((byTest('wizard-validate') as HTMLButtonElement).disabled).toBe(false);
    expect(byTest('import-match-on')).not.toBeNull();
  });

  it('a run the server refuses (the right to update, checked again) is said beside the button, and nothing is reported as done', async () => {
    const onDone = vi.fn();
    api.refuse['POST /api/v1/imports/imp_1/run'] = forbidden('update');
    await wizard({ onDone, modes: ['update'] });
    const user = userEvent.setup();
    await toPreview(user);
    await user.click(byTest('wizard-run')!);
    await waitFor(() => expect(byTest('import-run-refused')).not.toBeNull());
    expect(byTest('import-run-refused')!.textContent).toContain('You do not hold the right to change rows of Companies.');
    expect(byTest('import-review')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a paste that is too large is said so; any other refusal is the server’s own sentence; and what was typed is still there', async () => {
    api.refuse['POST /api/v1/imports/upload'] = { status: 413 };
    await wizard();
    const user = userEvent.setup();
    fireEvent.change(box(), { target: { value: 'far too much' } });
    await user.click(byTest('import-paste-use')!);
    expect(await screen.findByText('This is more than an import takes: 32 MB at most.')).toBeTruthy();
    expect(box().value).toBe('far too much');
    api.refuse['POST /api/v1/imports/upload'] = { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'There are no rows to bring in.' } } };
    await user.click(byTest('import-paste-use')!);
    expect(await screen.findByText('There are no rows to bring in.')).toBeTruthy();
    expect(screen.queryByText('This is more than an import takes: 32 MB at most.')).toBeNull();
    expect(byTest('wizard-validate')).toBeNull();
  });

  it('a look at the lines that fails is said, and the import can still be run', async () => {
    api.refuse['GET /api/v1/imports/imp_1/preview'] = { status: 403, body: { error: { code: 'FORBIDDEN', message: 'A masked column cannot be matched on.' } } };
    await wizard();
    const user = userEvent.setup();
    await toPreview(user);
    expect(screen.getByText('The lines could not be looked at before the import.')).toBeTruthy();
    expect(screen.getByText('A masked column cannot be matched on.')).toBeTruthy();
    expect((byTest('wizard-run') as HTMLButtonElement).disabled).toBe(false);
  });

  it('update keeps what was typed, then the mapping and the step, and a new token is the one the next call carries', async () => {
    await wizard({ title: 'Paste a list' });
    const user = userEvent.setup();
    fireEvent.change(box(), { target: { value: 'name,email\nHarbour,a@harbour.test' } });
    // The same table in a new list, another title, a new function: the wizard is the one that was there.
    const before = box();
    await act(async () => mounted!.update({ title: 'Bring in companies', tables: [{ ...COMPANIES, columns: COMPANIES.columns.map((column) => ({ ...column })) }], onDone: () => undefined }));
    expect(box()).toBe(before);
    expect(box().value).toBe('name,email\nHarbour,a@harbour.test');
    expect(screen.getByRole('heading', { name: 'Bring in companies' })).toBeTruthy();

    await user.click(byTest('import-paste-use')!);
    await waitFor(() => expect(byTest('wizard-validate')).not.toBeNull());
    // The person takes Town out of the import and sends Name nowhere; the app then says something unrelated.
    const pickers = [...host.querySelectorAll<HTMLSelectElement>('[data-part="mapping-target"]')];
    await user.selectOptions(pickers[0]!, '__skip__');
    await act(async () => mounted!.update({ csrfToken: 'tok_2', tables: [{ ...COMPANIES }] }));
    expect(byTest('wizard-validate')).not.toBeNull();
    expect([...host.querySelectorAll<HTMLSelectElement>('[data-part="mapping-target"]')].map((select) => select.value)).toEqual(['__skip__', 'email', '']);
    await user.click(byTest('wizard-validate')!);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]!.csrf).toBe('tok_2');
    expect((posts()[1]!.body as { mapping: unknown }).mapping).toEqual({ columns: [{ from: 'name', to: null }, { from: 'email', to: 'email' }, { from: 'town', to: null }] });
  });

  it('with onClose the last step has a Close button, once nothing is running', async () => {
    const onClose = vi.fn();
    api.job = 'running';
    await wizard({ onClose });
    const user = userEvent.setup();
    await toPreview(user);
    expect(byTest('wizard-close')).toBeNull();
    await user.click(byTest('wizard-run')!);
    await waitFor(() => expect(host.querySelector('[role="progressbar"]')).not.toBeNull());
    expect(byTest('wizard-close')).toBeNull();
    api.job = 'succeeded';
    await waitFor(() => expect(byTest('wizard-close')).not.toBeNull(), { timeout: 4_000 });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is gone after unmount, and asks the server nothing more', async () => {
    api.job = 'running';
    await wizard();
    const user = userEvent.setup();
    await toPreview(user);
    await user.click(byTest('wizard-run')!);
    await waitFor(() => expect(api.calls.some((call) => call.path === '/api/v1/jobs/job_1')).toBe(true));
    act(() => mounted!.unmount());
    expect(host.childElementCount).toBe(0);
    const asked = api.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(api.calls.length).toBe(asked);
  });

  it.each(KIT_LOCALES)('in %s every word is the catalogue’s, a plural reads as a sentence, and none is outside the set', async (locale) => {
    await wizard({ locale, dir: locale.startsWith('ar') ? 'rtl' : 'ltr', tables: [COMPANIES, CONTACTS], onClose: () => undefined, modes: ['update', 'skip'] });
    const user = userEvent.setup();
    await toPreview(user);
    expect(host.querySelector('.adm-kit')?.getAttribute('lang')).toBe(locale);
    expect(host.textContent).not.toMatch(/[{}]/);
    await user.click(byTest('wizard-run')!);
    await waitFor(() => expect(byTest('import-review')).not.toBeNull());
    expect(host.textContent).not.toMatch(/[{}]/);
    for (const label of [...host.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '')) expect(label).not.toMatch(/[{}]/);
  });

  it('speaks Arabic, right to left', async () => {
    await wizard({ locale: 'ar-EG', dir: 'rtl' });
    expect(host.querySelector('.adm-kit')?.getAttribute('dir')).toBe('rtl');
    expect(byTest('import-paste-use')!.textContent).not.toBe('Use these rows');
    expect(byTest('import-paste-use')!.textContent).toMatch(/[؀-ۿ]/);
  });
});
