// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-io surfaces: the number-consistency invariant, the Import Wizard's
 * upload step (target gate → dropzone), and the Data Exports page
 * rendering artifact rows through `scheduled-jobs-list`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapData } from '../app/bootstrap.js';
import { DataExportsPage } from './DataExportsPage.js';
import { ImportWizardPage, statsConsistent } from './ImportWizardPage.js';
import type { ExportDto } from './api.js';

const BOOT: BootstrapData = {
  user: { id: 'usr_1', name: 'Ava', email: 'ava@adminium.test' } as BootstrapData['user'],
  roles: ['admin'],
  prefs: {} as BootstrapData['prefs'],
  nav: {
    groups: [
      {
        key: 'workspace',
        items: [
          {
            pageId: 'page_customers',
            slug: 'customers',
            labelKey: 'nav.customers',
            fallback: 'Customers',
            icon: 'users',
            order: 1,
          },
        ],
      },
    ],
  },
  version: '0.0.0-test',
  configVersion: 1,
  llm: { enabled: false },
};

function renderWithClient(ui: ReactElement, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['bootstrap'], BOOT);
  seed?.(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('statsConsistent (invariant)', () => {
  it('holds exactly when total = created + updated + skipped', () => {
    expect(statsConsistent({ total: 2940, inserted: 2612, updated: 288, skipped: 40 })).toBe(true);
    expect(statsConsistent({ total: 4, inserted: 3, skipped: 1 })).toBe(true);
    expect(statsConsistent({ total: 4, inserted: 3 })).toBe(false);
    expect(statsConsistent({ total: 0 })).toBe(true);
  });
});

describe('ImportWizardPage', () => {
  it('starts on Upload with the dropzone gated behind a target pick', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(<ImportWizardPage />);
    const wizard = screen.getByTestId('import-wizard');
    expect(wizard.querySelector('[data-step="upload"]')?.getAttribute('data-state')).toBe('active');
    expect(wizard.querySelector('[data-step="run"]')?.getAttribute('data-state')).toBe('todo');
    // No target chosen yet → the dropzone control is disabled.
    const dropzone = screen.getByTestId('import-upload').querySelector('[data-part="dropzone"]');
    expect(dropzone?.hasAttribute('disabled')).toBe(true);
    // The nav-derived target options are offered.
    expect(screen.getByText('Customers')).toBeTruthy();
  });

  it('imports the columns it matched by itself, with no picker touched', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/v1/imports/upload')) {
          return reply(201, {
            data: {
              fileId: 'file_1',
              filename: 'customers.csv',
              sizeBytes: 40,
              sha256: 'x',
              columns: ['customer_id', 'company_name', 'notes'],
              sampleRows: [['ALFKI', 'Alfreds', 'x']],
              totalRows: 1,
            },
          });
        }
        calls.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
        return reply(422, { error: { code: 'VALIDATION_FAILED', message: 'stop here', requestId: 'req_1' } });
      }),
    );
    const user = userEvent.setup();
    renderWithClient(
      <ImportWizardPage
        initialTarget={{
          connectionId: 'conn_1',
          table: 'public.customers',
          columns: [
            { key: 'customer_id', label: 'Customer Id' },
            { key: 'company_name', label: 'Company' },
          ],
        }}
      />,
    );
    const input = screen.getByTestId('import-upload').querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['customer_id,company_name,notes\n'], 'customers.csv', { type: 'text/csv' }));
    await user.click(await screen.findByTestId('wizard-validate'));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toMatchObject({
      mapping: {
        columns: [
          { from: 'customer_id', to: 'customer_id' },
          { from: 'company_name', to: 'company_name' },
          { from: 'notes', to: null },
        ],
      },
    });
  });

  const TARGET = {
    connectionId: 'conn_1',
    table: 'public.customers',
    columns: [
      { key: 'customer_id', label: 'Customer Id' },
      { key: 'company_name', label: 'Company' },
    ],
  };
  const UPLOADED = {
    data: {
      fileId: 'file_1',
      filename: 'pasted.csv',
      sizeBytes: 40,
      sha256: 'x',
      columns: ['customer_id', 'company_name'],
      sampleRows: [['ALFKI', 'Alfreds']],
      totalRows: 3,
    },
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  /** A server that takes the upload, makes the import, and answers the preview a page at a time. */
  function stubServer(pages: Record<string, unknown> = {}) {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : (init?.body ?? null) });
        if (url.startsWith('/api/v1/imports/upload')) return reply(201, UPLOADED);
        if (url === '/api/v1/imports') {
          const options = (calls.at(-1)?.body as { options: Record<string, unknown> }).options;
          return reply(201, { data: { import: { id: 'imp_1', status: 'ready', options, stats: null, errorReportFileId: null }, report: { total: 3, valid: 3, invalid: 0, issues: [] } } });
        }
        const page = Object.entries(pages).find(([query]) => url.endsWith(query));
        return page === undefined ? reply(404, { error: { code: 'NOT_FOUND', message: 'no such page', requestId: 'req_1' } }) : reply(200, { data: page[1] });
      }),
    );
    return calls;
  }

  it('uploads pasted rows as a file, and says when no row holds the column names', async () => {
    const calls = stubServer();
    const user = userEvent.setup();
    const view = renderWithClient(<ImportWizardPage initialTarget={TARGET} />);
    const paste = screen.getByTestId('import-paste');
    // Nothing to use until something is pasted.
    expect((screen.getByTestId('import-paste-use') as HTMLButtonElement).disabled).toBe(true);
    await user.click(paste.querySelector('textarea') as HTMLTextAreaElement);
    await user.paste('customer_id\tcompany_name\nALFKI\tAlfreds\n');
    await user.click(screen.getByTestId('import-paste-use'));
    await screen.findByTestId('wizard-validate');
    // Ticked by default: the first row is the header, as for a file.
    expect(calls[0]?.url).toBe('/api/v1/imports/upload?filename=pasted.csv');
    expect(calls[0]?.body).toBeInstanceOf(File);
    expect(await (calls[0]?.body as File).text()).toBe('customer_id\tcompany_name\nALFKI\tAlfreds\n');
    view.unmount();

    const again = stubServer();
    renderWithClient(<ImportWizardPage initialTarget={TARGET} />);
    await user.click(screen.getByTestId('import-paste').querySelector('textarea') as HTMLTextAreaElement);
    await user.paste('ALFKI\tAlfreds\n');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByTestId('import-paste-use'));
    await screen.findByTestId('wizard-validate');
    expect(again[0]?.url).toBe('/api/v1/imports/upload?filename=pasted.csv&header=none');
  });

  /** From a fresh wizard to its Map step. */
  async function toMapStep(user: ReturnType<typeof userEvent.setup>, props: { matchOn?: string } = {}) {
    renderWithClient(<ImportWizardPage initialTarget={TARGET} {...props} />);
    const input = screen.getByTestId('import-upload').querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['customer_id,company_name\n'], 'customers.csv', { type: 'text/csv' }));
    await screen.findByTestId('wizard-validate');
  }
  const optionsSent = (calls: { url: string; body: unknown }[]) => (calls.find((call) => call.url === '/api/v1/imports')?.body as { options: unknown }).options;

  it('makes every line new unless a column is chosen to match on', async () => {
    const calls = stubServer();
    const user = userEvent.setup();
    await toMapStep(user);
    const match = screen.getByTestId('import-match-on') as HTMLSelectElement;
    // The columns the mapping brings in, and nothing chosen.
    expect([...match.options].map((option) => option.value)).toEqual(['', 'customer_id', 'company_name']);
    expect(match.value).toBe('');
    expect(screen.queryByTestId('import-when-here')).toBeNull();
    await user.click(screen.getByTestId('wizard-validate'));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/imports')).toBe(true));
    expect(optionsSent(calls)).toEqual({ mode: 'insert', skipInvalid: true });
  });

  it('leaves the lines already here as they are when a column is chosen, or updates them when asked', async () => {
    const calls = stubServer();
    const user = userEvent.setup();
    await toMapStep(user);
    await user.selectOptions(screen.getByTestId('import-match-on'), 'customer_id');
    expect((screen.getByTestId('import-when-here') as HTMLSelectElement).value).toBe('skip');
    await user.click(screen.getByTestId('wizard-validate'));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/imports')).toBe(true));
    expect(optionsSent(calls)).toEqual({ mode: 'skip', matchColumn: 'customer_id', skipInvalid: true });
  });

  it('starts matched on the column a page named, and sends an update when that is picked', async () => {
    const calls = stubServer();
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'customer_id' });
    expect((screen.getByTestId('import-match-on') as HTMLSelectElement).value).toBe('customer_id');
    await user.selectOptions(screen.getByTestId('import-when-here'), 'upsert');
    await user.click(screen.getByTestId('wizard-validate'));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/imports')).toBe(true));
    expect(optionsSent(calls)).toEqual({ mode: 'upsert', matchColumn: 'customer_id', skipInvalid: true });
  });

  it('shows what the import would do with each line before it runs, a page at a time', async () => {
    const counts = { new: 1, here: 1, refused: 1 };
    const calls = stubServer({
      '/preview?offset=0&limit=100': {
        total: 5000,
        judged: 3,
        capped: true,
        counts,
        hooksNotRun: true,
        lines: [
          { row: 1, status: 'new' },
          { row: 2, status: 'refused', code: 'ALREADY_EXISTS', column: 'customer_id', message: 'A row with this value already exists.' },
        ],
      },
      '/preview?offset=2&limit=100': { total: 5000, judged: 3, capped: true, counts, hooksNotRun: true, lines: [{ row: 3, status: 'here', earlierLine: 1 }] },
    });
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'customer_id' });
    await user.click(screen.getByTestId('wizard-validate'));

    const preview = await screen.findByTestId('import-preview');
    const count = (kind: string) => preview.querySelector(`[data-count="${kind}"]`)?.textContent ?? '';
    expect([count('new'), count('here'), count('refused')]).toEqual(['New1', 'Already here1', 'Refused1']);
    const lines = () => [...preview.querySelectorAll('[data-line]')].map((line) => [line.getAttribute('data-line'), line.getAttribute('data-status')]);
    expect(lines()).toEqual([['1', 'new'], ['2', 'refused']]);
    // A refused line says why, with its column.
    expect(preview.querySelector('[data-line="2"]')?.textContent).toContain('customer_id: A row with this value already exists.');
    // Only some lines were looked at, and the project's own code was not run: both are said.
    expect(preview.textContent).toMatch(/Only the first/);
    expect(preview.textContent).toMatch(/runs only when the import runs/);
    // The type-issue list is still there beside it.
    expect(screen.getByTestId('validation-summary')).toBeTruthy();

    await user.click(screen.getByTestId('import-preview-more'));
    await waitFor(() => expect(lines()).toEqual([['1', 'new'], ['2', 'refused'], ['3', 'here']]));
    expect(preview.querySelector('[data-line="3"]')?.textContent).toMatch(/Same as line/);
    // Every judged line is shown: nothing more to ask for.
    expect(screen.queryByTestId('import-preview-more')).toBeNull();
    expect(calls.filter((call) => call.url.includes('/preview')).map((call) => call.url)).toEqual([
      '/api/v1/imports/imp_1/preview?offset=0&limit=100',
      '/api/v1/imports/imp_1/preview?offset=2&limit=100',
    ]);
  });

  it('hides the already-here count when nothing is matched on', async () => {
    stubServer({ '/preview?offset=0&limit=100': { total: 3, judged: 3, capped: false, counts: { new: 3, here: 0, refused: 0 }, hooksNotRun: false, lines: [] } });
    const user = userEvent.setup();
    await toMapStep(user);
    await user.click(screen.getByTestId('wizard-validate'));
    const preview = await screen.findByTestId('import-preview');
    expect(preview.querySelector('[data-count="here"]')).toBeNull();
    expect(preview.querySelector('[data-count="new"]')?.textContent).toBe('New3');
  });

  it('still offers the run when the preview is refused, and says so', async () => {
    stubServer();
    const user = userEvent.setup();
    await toMapStep(user);
    await user.click(screen.getByTestId('wizard-validate'));
    expect(await screen.findByText('The lines could not be looked at before the import.')).toBeTruthy();
    expect(screen.queryByTestId('import-preview')).toBeNull();
    expect((screen.getByTestId('wizard-run') as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts ready to upload when the binding pre-resolves the target', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(
      <ImportWizardPage
        initialTarget={{ connectionId: 'conn_1', table: 'public.customers', columns: [] }}
      />,
    );
    const dropzone = screen.getByTestId('import-upload').querySelector('[data-part="dropzone"]');
    expect(dropzone?.hasAttribute('disabled')).toBe(false);
  });
});

describe('DataExportsPage', () => {
  it('renders artifact rows with status lines through scheduled-jobs-list', async () => {
    const rows: ExportDto[] = [
      {
        id: 'exp_1',
        connectionId: 'conn_1',
        requestedBy: 'usr_1',
        source: { kind: 'table', table: 'public.customers' },
        format: 'csv',
        status: 'ready',
        fileId: 'file_1',
        filename: 'public.customers-exp_1.csv',
        sizeBytes: 120,
        rowCount: 42,
        error: null,
        jobId: null,
        createdAt: 1,
        completedAt: 2,
        expiresAt: null,
      },
      {
        id: 'exp_2',
        connectionId: 'conn_1',
        requestedBy: 'usr_1',
        source: { kind: 'table', table: 'public.orders' },
        format: 'json',
        status: 'processing',
        fileId: null,
        filename: null,
        sizeBytes: null,
        rowCount: null,
        error: null,
        jobId: 'job_1',
        createdAt: 3,
        completedAt: null,
        expiresAt: null,
      },
    ];
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(<DataExportsPage />, (client) => {
      client.setQueryData(['data-io', 'exports'], rows);
    });
    expect(await screen.findByTestId('exports-list')).toBeTruthy();
    expect(screen.getByText('public.customers-exp_1.csv')).toBeTruthy();
    // t() degrades to the un-interpolated fallback in unit tests — match the
    // stable copy, not the ICU-substituted number.
    expect(screen.getByText(/click to download/)).toBeTruthy();
    expect(screen.getByText(/Processing/)).toBeTruthy();
    // xlsx is not offered (documented deviation) — csv/json only.
    const formatOptions = [...document.querySelectorAll('option')].map((option) => option.textContent);
    expect(formatOptions).toContain('CSV');
    expect(formatOptions).not.toContain('XLSX');
  });
});

describe('ImportWizardPage — nothing to bring in, a preview that fails, an answer for another import, an unmapped match column', () => {
  const TARGET = {
    connectionId: 'conn_1',
    table: 'public.customers',
    columns: [
      { key: 'customer_id', label: 'Customer Id' },
      { key: 'company_name', label: 'Company' },
      { key: 'email', label: 'Email' },
    ],
  };
  const UPLOADED = {
    data: { fileId: 'file_1', filename: 'customers.csv', sizeBytes: 40, sha256: 'x', columns: ['customer_id', 'company_name'], sampleRows: [['ALFKI', 'Alfreds']], totalRows: 3 },
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  interface Server {
    /** The validation report each new import answers. */
    report?: { total: number; valid: number; invalid: number; issues: never[] };
    /** A preview page by `<import id><query>`; a function is asked each time. */
    pages: Record<string, unknown | (() => Promise<Response>)>;
  }
  /** A server that gives each new import an id of its own. */
  function stubServer(server: Server) {
    const calls: { method: string; url: string; body: unknown }[] = [];
    let made = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
        if (url.startsWith('/api/v1/imports/upload')) return reply(201, UPLOADED);
        if (url === '/api/v1/imports') {
          made += 1;
          const options = (calls.at(-1)?.body as { options: Record<string, unknown> }).options;
          return reply(201, {
            data: { import: { id: `imp_${String(made)}`, status: 'ready', options, stats: null, errorReportFileId: null }, report: server.report ?? { total: 3, valid: 3, invalid: 0, issues: [] } },
          });
        }
        const page = Object.entries(server.pages).find(([key]) => url === `/api/v1/imports/${key}`);
        if (page === undefined) return reply(404, { error: { code: 'NOT_FOUND', message: 'This import is gone.', requestId: 'req_1' } });
        return typeof page[1] === 'function' ? (page[1] as () => Promise<Response>)() : reply(200, { data: page[1] });
      }),
    );
    return calls;
  }
  async function toMapStep(user: ReturnType<typeof userEvent.setup>, props: { matchOn?: string } = {}) {
    renderWithClient(<ImportWizardPage initialTarget={TARGET} {...props} />);
    const input = screen.getByTestId('import-upload').querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['customer_id,company_name\n'], 'customers.csv', { type: 'text/csv' }));
    await screen.findByTestId('wizard-validate');
  }
  const run = (): HTMLButtonElement => screen.getByTestId('wizard-run') as HTMLButtonElement;
  const page = (counts: { new: number; here: number; refused: number }, extra: Record<string, unknown> = {}) => ({
    total: 3,
    judged: 3,
    capped: false,
    counts,
    hooksNotRun: false,
    lines: [],
    ...extra,
  });

  it('does not offer the run when every line is refused or already here and left as it is', async () => {
    stubServer({ pages: { 'imp_1/preview?offset=0&limit=100': page({ new: 0, here: 2, refused: 1 }) } });
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'customer_id' });
    await user.click(screen.getByTestId('wizard-validate'));
    await screen.findByTestId('import-preview');
    expect(run().disabled).toBe(true);
    expect(screen.getByTestId('import-nothing').textContent).toBe('Nothing here would be brought in.');
  });

  it('offers the run when the lines already here would be updated', async () => {
    stubServer({ pages: { 'imp_1/preview?offset=0&limit=100': page({ new: 0, here: 2, refused: 1 }) } });
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'customer_id' });
    await user.selectOptions(screen.getByTestId('import-when-here'), 'upsert');
    await user.click(screen.getByTestId('wizard-validate'));
    await screen.findByTestId('import-preview');
    expect(run().disabled).toBe(false);
    expect(screen.queryByTestId('import-nothing')).toBeNull();
  });

  it('offers the run when only some lines were looked at: the rest may be new', async () => {
    stubServer({ pages: { 'imp_1/preview?offset=0&limit=100': page({ new: 0, here: 3, refused: 0 }, { total: 5000, capped: true }) } });
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'customer_id' });
    await user.click(screen.getByTestId('wizard-validate'));
    await screen.findByTestId('import-preview');
    expect(run().disabled).toBe(false);
  });

  it('does not offer the run when no row passed validation', async () => {
    stubServer({ report: { total: 3, valid: 0, invalid: 3, issues: [] }, pages: { 'imp_1/preview?offset=0&limit=100': page({ new: 0, here: 0, refused: 3 }) } });
    const user = userEvent.setup();
    await toMapStep(user);
    await user.click(screen.getByTestId('wizard-validate'));
    await screen.findByTestId('validation-summary');
    expect(run().disabled).toBe(true);
    expect(screen.getByTestId('import-nothing')).toBeTruthy();
  });

  const TWO = [
    { row: 1, status: 'new' },
    { row: 2, status: 'new' },
  ];

  it('says why when "Show more" could not be answered', async () => {
    stubServer({ pages: { 'imp_1/preview?offset=0&limit=100': page({ new: 3, here: 0, refused: 0 }, { lines: TWO }) } });
    const user = userEvent.setup();
    await toMapStep(user);
    await user.click(screen.getByTestId('wizard-validate'));
    await user.click(await screen.findByTestId('import-preview-more'));
    expect(await screen.findByText('The lines could not be looked at before the import.')).toBeTruthy();
    expect(screen.getByText('This import is gone.')).toBeTruthy();
    // The lines that were shown stay, and the run is still offered.
    expect(document.querySelectorAll('[data-line]')).toHaveLength(2);
    expect(run().disabled).toBe(false);
  });

  it('drops a "Show more" answer that is for an import the person has since gone back from', async () => {
    let answerOld: (response: Response) => void = () => undefined;
    stubServer({
      pages: {
        'imp_1/preview?offset=0&limit=100': page({ new: 3, here: 0, refused: 0 }, { lines: TWO }),
        'imp_1/preview?offset=2&limit=100': () => new Promise<Response>((resolve) => void (answerOld = resolve)),
        'imp_2/preview?offset=0&limit=100': page({ new: 3, here: 0, refused: 0 }, { lines: [{ row: 1, status: 'new' }, { row: 2, status: 'refused', message: 'no' }] }),
      },
    });
    const user = userEvent.setup();
    await toMapStep(user);
    await user.click(screen.getByTestId('wizard-validate'));
    await user.click(await screen.findByTestId('import-preview-more'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByTestId('wizard-validate'));
    const statuses = () => [...document.querySelectorAll('[data-line]')].map((line) => `${line.getAttribute('data-line') ?? ''}:${line.getAttribute('data-status') ?? ''}`);
    await waitFor(() => expect(statuses()).toEqual(['1:new', '2:refused']));
    // The first import's third line arrives now.
    answerOld(reply(200, { data: page({ new: 3, here: 0, refused: 0 }, { lines: [{ row: 3, status: 'here' }] }) }));
    await new Promise((done) => setTimeout(done, 30));
    expect(statuses()).toEqual(['1:new', '2:refused']);
  });

  it('a page’s match column that no column of the file is mapped to is said, and stops the validation until it is settled', async () => {
    const calls = stubServer({ pages: {} });
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'email' });
    const validate = (): HTMLButtonElement => screen.getByTestId('wizard-validate') as HTMLButtonElement;
    expect(screen.getByTestId('import-match-unmapped').textContent).toBe('Lines cannot be matched on Email: no column of the file is mapped to it.');
    expect(validate().disabled).toBe(true);
    // The choice is shown as it stands, not as "every line is new".
    const match = screen.getByTestId('import-match-on') as HTMLSelectElement;
    expect(match.value).toBe('email');
    // The person settles it: nothing is matched on.
    await user.selectOptions(match, '');
    expect(screen.queryByTestId('import-match-unmapped')).toBeNull();
    expect(validate().disabled).toBe(false);
    await user.click(validate());
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/imports')).toBe(true));
    expect((calls.find((call) => call.url === '/api/v1/imports')?.body as { options: unknown }).options).toEqual({ mode: 'insert', skipInvalid: true });
  });

  it('or the person picks a column the file does bring in', async () => {
    stubServer({ pages: {} });
    const user = userEvent.setup();
    await toMapStep(user, { matchOn: 'email' });
    await user.selectOptions(screen.getByTestId('import-match-on'), 'customer_id');
    expect(screen.queryByTestId('import-match-unmapped')).toBeNull();
    expect((screen.getByTestId('wizard-validate') as HTMLButtonElement).disabled).toBe(false);
  });
});
