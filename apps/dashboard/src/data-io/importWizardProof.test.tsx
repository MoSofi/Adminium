// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Import Wizard, where a walk in a real browser found it wanting:
 *
 *  - the target picker offered an app's tables to nobody (it listed the
 *    owner's own pages only), and named a chosen page by its table;
 *  - a refusal of the import right was said in the server's English only;
 *  - the validation list was titled by a code (`qty: BAD_NUMBER`);
 *  - once the lines had been looked at, the summary and the Run button still
 *    spoke from the type check alone, and contradicted the preview beside them;
 *  - a preview line said "Line 4 · New" and not which row of the file it was;
 *  - on a narrow screen the assistant's button lay over the footer's last button.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapData, NavItem } from '../app/bootstrap.js';
import { ImportWizardPage } from './ImportWizardPage.js';

const item = (pageId: string, fallback: string, sourceTable: string | null, extra: Partial<NavItem> = {}): NavItem => ({
  pageId,
  slug: pageId.replace('page_', ''),
  labelKey: `nav.${pageId}`,
  fallback,
  icon: 'table',
  order: 1,
  connectionId: 'conn_1',
  sourceTable,
  ...extra,
});

/** An install that holds an app and one page of the owner's own. */
const BOOT: BootstrapData = {
  user: { id: 'usr_1', name: 'Ava', email: 'ava@adminium.test' } as BootstrapData['user'],
  roles: ['super-admin'],
  prefs: {} as BootstrapData['prefs'],
  nav: { groups: [{ key: 'workspace', items: [item('page_parts', 'Parts list', 'main.parts'), item('page_home', 'Home', null)] }] },
  appSections: [
    {
      appKey: 'sales-crm',
      label: 'Sales CRM',
      version: '0.2.0',
      staff: null,
      groups: [
        {
          key: 'selling',
          label: 'Selling',
          items: [
            item('page_pipeline', 'Pipeline', 'main.crm_deals', { appKey: 'sales-crm' }),
            item('page_deals', 'Deals', 'main.crm_deals', { appKey: 'sales-crm' }),
            item('page_companies', 'Companies', 'main.crm_companies', { appKey: 'sales-crm' }),
            item('page_overview', 'Overview', null, { appKey: 'sales-crm' }),
          ],
        },
      ],
    },
    {
      kind: 'add-on',
      appKey: 'holidays',
      label: 'Holiday calendars',
      version: '1.0.0',
      staff: null,
      groups: [{ key: 'g', label: null, items: [{ ...item('page_addon', 'Calendar', null, { addOnKey: 'holidays' }), addOnPage: { key: 'holidays', ref: 'calendar' } }] }],
    },
  ],
  version: '0.0.0-test',
  configVersion: 1,
  llm: { enabled: false },
};

const envelope = (pageId: string, template: string, table: string, title: string) => ({
  data: {
    v: 1,
    kind: 'page',
    id: pageId,
    template,
    title: { key: `nav.${pageId}`, fallback: title },
    source: { connectionId: 'conn_1', table },
    nav: { group: 'workspace', icon: 'table', order: 1, slug: pageId.replace('page_', '') },
    access: { minRole: 'viewer', permissions: [] },
    config:
      template === 'page-crud'
        ? { templateVersion: 1, columns: [{ name: 'sku', label: 'Sku' }, { name: 'name', label: 'Name' }, { name: 'qty', label: 'Quantity' }] }
        : { templateVersion: 1, toolbar: [], overlays: [], layout: { version: 1, items: [] } },
  },
});

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Server {
  /** What the type check answers. */
  report?: { total: number; valid: number; invalid: number; issues: { row: number; column: string; code: string; message: string; value: string }[] };
  /** What the look at the lines answers; absent, it is refused. */
  preview?: Record<string, unknown>;
  /** What making the import answers, when not the import. */
  create?: () => Response;
  /** A page whose read is refused. */
  refusedPage?: string;
}

function stubServer(server: Server = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : (init?.body ?? null) });
      const page = /^\/api\/v1\/pages\/(page_\w+)$/.exec(url)?.[1];
      if (page !== undefined) {
        if (page === server.refusedPage) return reply(403, { error: { code: 'FORBIDDEN', message: 'You may not open this page.', requestId: 'req_1' } });
        if (page === 'page_pipeline') return reply(200, envelope(page, 'page-board', 'main.crm_deals', 'Pipeline'));
        if (page === 'page_deals') return reply(200, envelope(page, 'page-crud', 'main.crm_deals', 'Deals'));
        if (page === 'page_companies') return reply(200, envelope(page, 'page-crud', 'main.crm_companies', 'Companies'));
        return reply(200, envelope(page, 'page-crud', 'main.parts', 'Parts list'));
      }
      if (url.startsWith('/api/v1/imports/upload')) {
        return reply(201, { data: { fileId: 'file_1', filename: 'pasted.csv', sizeBytes: 40, sha256: 'x', columns: ['sku', 'name', 'qty'], sampleRows: [['A-1', 'Bracket', '4']], totalRows: 250 } });
      }
      if (url === '/api/v1/imports') {
        if (server.create !== undefined) return server.create();
        const options = (calls.at(-1)?.body as { options: Record<string, unknown> }).options;
        return reply(201, { data: { import: { id: 'imp_1', status: 'ready', options, stats: null, errorReportFileId: null }, report: server.report ?? { total: 3, valid: 3, invalid: 0, issues: [] } } });
      }
      if (url.includes('/preview') && server.preview !== undefined) return reply(200, { data: server.preview });
      return reply(404, { error: { code: 'NOT_FOUND', message: 'no such thing', requestId: 'req_1' } });
    }),
  );
  return calls;
}

function renderWizard(ui: ReactElement = <ImportWizardPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['bootstrap'], BOOT);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const TARGET = { connectionId: 'conn_1', table: 'main.parts', columns: [{ key: 'sku', label: 'Sku' }, { key: 'name', label: 'Name' }, { key: 'qty', label: 'Quantity' }] };
const picker = (): HTMLSelectElement => screen.getByTestId('import-target') as HTMLSelectElement;
const shown = (select: HTMLSelectElement): string => select.selectedOptions[0]?.textContent ?? '';

/** From a fresh wizard on the Parts list to its Validate step. */
async function toValidateStep(user: ReturnType<typeof userEvent.setup>, how: { matchOn?: string; update?: boolean } = {}) {
  renderWizard(<ImportWizardPage initialTarget={TARGET} {...(how.matchOn === undefined ? {} : { matchOn: how.matchOn })} />);
  const input = screen.getByTestId('import-upload').querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['sku,name,qty\n'], 'parts.csv', { type: 'text/csv' }));
  await screen.findByTestId('wizard-validate');
  if (how.update === true) await user.selectOptions(screen.getByTestId('import-when-here'), 'upsert');
  await user.click(screen.getByTestId('wizard-validate'));
  await screen.findByTestId('validation-summary');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the target picker', () => {
  it('offers each installed app’s table pages under the app’s name, beside the owner’s own', () => {
    stubServer();
    renderWizard();
    const select = picker();
    // The owner's own table page, ungrouped; a page over no table is no target.
    expect([...select.children].filter((child) => child.tagName === 'OPTION').map((option) => option.textContent)).toEqual(['Choose a table page…', 'Parts list']);
    const groups = [...select.querySelectorAll('optgroup')];
    // An add-on's page of its own code is bound to no table: its section is not listed at all.
    expect(groups.map((group) => group.label)).toEqual(['Sales CRM']);
    expect([...groups[0]!.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Pipeline', 'Deals', 'Companies']);
  });

  it('names the page that was chosen, not its table', async () => {
    stubServer();
    const user = userEvent.setup();
    renderWizard();
    await user.selectOptions(picker(), 'page_companies');
    await waitFor(() => expect(screen.getByTestId('import-upload').querySelector('[data-part="dropzone"]')?.hasAttribute('disabled')).toBe(false));
    expect(picker().value).toBe('page_companies');
    expect(shown(picker())).toBe('Companies');
    expect(picker().textContent).not.toContain('main.crm_companies');
  });

  it('a board over a table leads to the table’s own list page', async () => {
    stubServer();
    const user = userEvent.setup();
    renderWizard();
    await user.selectOptions(picker(), 'page_pipeline');
    await waitFor(() => expect(picker().value).toBe('page_deals'));
    expect(shown(picker())).toBe('Deals');
    expect(screen.queryByText(/not a table/)).toBeNull();
  });

  it('says so, in words, when the page cannot be opened', async () => {
    stubServer({ refusedPage: 'page_companies' });
    const user = userEvent.setup();
    renderWizard();
    await user.selectOptions(picker(), 'page_companies');
    expect(await screen.findByText('That page could not be opened.')).toBeTruthy();
    expect(screen.getByText('You may not open this page.')).toBeTruthy();
    expect(picker().value).toBe('');
  });

  it('says, by the page’s name, that the import right is missing when the server refuses it', async () => {
    stubServer({
      create: () => reply(403, { error: { code: 'TABLE_FORBIDDEN', message: 'You do not have import access to this table.', requestId: 'req_1', details: { permission: 'table:conn_1:main.crm_companies:import' } } }),
    });
    const user = userEvent.setup();
    renderWizard();
    await user.selectOptions(picker(), 'page_companies');
    await waitFor(() => expect(shown(picker())).toBe('Companies'));
    const input = screen.getByTestId('import-upload').querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['sku,name,qty\n'], 'parts.csv', { type: 'text/csv' }));
    await user.click(await screen.findByTestId('wizard-validate'));
    expect(await screen.findByText('You do not hold the right to import into Companies. Ask an administrator for it.')).toBeTruthy();
  });
});

describe('the validation list', () => {
  it('titles each group in words, by the column’s label, with a line of the file as its example', async () => {
    stubServer({
      report: {
        total: 5,
        valid: 1,
        invalid: 4,
        issues: [
          { row: 17, column: 'qty', code: 'BAD_NUMBER', message: '"twelve" is not an integer', value: 'twelve' },
          { row: 18, column: 'qty', code: 'BAD_NUMBER', message: '"lots" is not an integer', value: 'lots' },
          { row: 19, column: 'name', code: 'REQUIRED', message: 'name is required', value: '' },
          { row: 20, column: 'sku', code: 'TOO_ODD', message: 'This value is too odd.', value: '??' },
        ],
      },
    });
    await toValidateStep(userEvent.setup());
    const list = document.querySelector('[data-widget="validation-issues-list"]') ?? document.body;
    const text = list.textContent ?? '';
    expect(text).toContain('Quantity: not a number');
    expect(text).toContain('For example “twelve”, on line 17.');
    expect(text).toContain('Name: empty, and a value is needed');
    expect(text).toContain('For example on line 19.');
    // A code this screen has no sentence for: the server's own words.
    expect(text).toContain('Sku: This value is too odd.');
    expect(text).not.toMatch(/BAD_NUMBER|REQUIRED|TOO_ODD/);
    expect(text).not.toContain('qty:');
  });
});

describe('the summary and the Run button, once the lines have been looked at', () => {
  const report = { total: 250, valid: 249, invalid: 1, issues: [{ row: 17, column: 'qty', code: 'BAD_NUMBER', message: '"twelve" is not an integer', value: 'twelve' }] };

  it('“Leave them as they are”: speaks of the new lines only, and says what happens to the rest', async () => {
    stubServer({ report, preview: { total: 250, judged: 250, capped: false, counts: { new: 245, here: 4, refused: 1 }, hooksNotRun: false, lines: [] } });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku' });
    expect(screen.getByTestId('validation-summary').textContent).toBe('245 new lines will be brought in.');
    expect(screen.getByTestId('validation-rest').textContent).toBe('4 already here will be left as they are · 1 refused');
    expect(screen.getByTestId('wizard-run').textContent).toBe('Bring in 245 new lines');
    // The type check's own count is not said beside a preview that says otherwise.
    expect(document.body.textContent).not.toContain('249');
  });

  it('“Update them”: the new lines and the ones it updates', async () => {
    stubServer({ report: { total: 5, valid: 5, invalid: 0, issues: [] }, preview: { total: 5, judged: 5, capped: false, counts: { new: 2, here: 3, refused: 0 }, hooksNotRun: false, lines: [] } });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku', update: true });
    expect(screen.getByTestId('wizard-run').textContent).toBe('Bring in 2 new lines and update 3');
    expect(screen.getByTestId('validation-summary').textContent).toBe('2 new lines will be brought in, and 3 lines already here updated.');
    expect(screen.queryByTestId('validation-rest')).toBeNull();
  });

  it('“Update them” with nothing new: the run updates, and says so', async () => {
    stubServer({ report: { total: 3, valid: 3, invalid: 0, issues: [] }, preview: { total: 3, judged: 3, capped: false, counts: { new: 0, here: 3, refused: 0 }, hooksNotRun: false, lines: [] } });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku', update: true });
    expect(screen.getByTestId('wizard-run').textContent).toBe('Update 3 lines');
    expect(screen.getByTestId('validation-summary').textContent).toBe('3 lines already here will be updated.');
  });

  it('nothing would be brought in: says only that, and what the lines are', async () => {
    stubServer({ report: { total: 3, valid: 3, invalid: 0, issues: [] }, preview: { total: 3, judged: 3, capped: false, counts: { new: 0, here: 3, refused: 0 }, hooksNotRun: false, lines: [] } });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku' });
    expect(screen.getByTestId('import-nothing').textContent).toBe('Nothing here would be brought in.');
    expect(screen.queryByTestId('validation-summary')?.textContent ?? '').not.toContain('ready to import');
    expect(screen.getByTestId('validation-rest').textContent).toBe('3 already here will be left as they are');
    expect((screen.getByTestId('wizard-run') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('wizard-run').textContent).toBe('Run import');
  });

  it('only the first lines were looked at: the whole file’s count is the type check’s, and the step says what the preview covers', async () => {
    stubServer({ report: { total: 5000, valid: 4990, invalid: 10, issues: [] }, preview: { total: 5000, judged: 2000, capped: true, counts: { new: 1990, here: 6, refused: 4 }, hooksNotRun: false, lines: [] } });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku' });
    expect(screen.getByTestId('validation-summary').textContent).toBe('4990 of 5000 rows ready to import — 10 will be skipped.');
    expect(screen.getByTestId('wizard-run').textContent).toBe('Import 4990 rows (skip 10)');
    expect(screen.queryByTestId('validation-rest')).toBeNull();
    expect(screen.getByTestId('import-preview').textContent).toContain('Only the first 2000 of 5000 lines were looked at.');
  });

  it('the lines could not be looked at: the type check’s wording stands', async () => {
    stubServer({ report });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku' });
    expect(screen.getByTestId('validation-summary').textContent).toBe('249 of 250 rows ready to import — 1 will be skipped.');
    expect(screen.getByTestId('wizard-run').textContent).toBe('Import 249 rows (skip 1)');
  });
});

describe('a line of the preview', () => {
  it('says which row of the file it is, as text, whole in its title', async () => {
    const long = `${'Very long part name '.repeat(5)}end`;
    stubServer({
      preview: {
        total: 3,
        judged: 3,
        capped: false,
        counts: { new: 2, here: 1, refused: 0 },
        hooksNotRun: false,
        lines: [
          { row: 1, status: 'here', label: 'A-0001' },
          { row: 2, status: 'new', label: '<b>A-0002</b>' },
          { row: 3, status: 'new', label: long },
          { row: 4, status: 'new' },
        ],
      },
    });
    await toValidateStep(userEvent.setup(), { matchOn: 'sku' });
    const preview = screen.getByTestId('import-preview');
    const label = (row: number) => preview.querySelector(`[data-line="${String(row)}"] [data-part="line-label"]`);
    expect(label(1)?.textContent).toBe('A-0001');
    // The file's own characters, never markup.
    expect(label(2)?.textContent).toBe('<b>A-0002</b>');
    expect(label(2)?.querySelector('b')).toBeNull();
    expect(label(3)?.getAttribute('title')).toBe(long);
    expect(label(3)?.className).toContain('truncate');
    // A line the server gave no label for has none, and still says what it is.
    expect(label(4)).toBeNull();
    expect(within(preview.querySelector('[data-line="4"]') as HTMLElement).getByText('New')).toBeTruthy();
  });
});

describe('the footer', () => {
  it('keeps its buttons clear of the assistant’s button while that button is there', async () => {
    stubServer({ preview: { total: 3, judged: 3, capped: false, counts: { new: 3, here: 0, refused: 0 }, hooksNotRun: false, lines: [] } });
    await toValidateStep(userEvent.setup());
    const actions = screen.getByTestId('wizard-run').closest('[data-part="wizard-actions"]');
    // The room is the lift the shell sets for the toasts while the button is drawn (`--toast-lift`), and none without it.
    expect(actions?.className).toContain('pe-[var(--toast-lift,0px)]');
    expect(document.querySelector('[data-part="wizard-footer"]')?.contains(actions ?? null)).toBe(true);
  });
});
