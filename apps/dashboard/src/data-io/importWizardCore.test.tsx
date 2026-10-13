// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The import wizard on a host that is not the dashboard: no query cache, no
 * router, no session of the dashboard's, no catalogue. Only what the wizard
 * is handed: a client for the server's import doors, the host's words, the
 * table.
 *
 * Worth proving, since the dashboard's own tests stop at the Validate step:
 * a paste is walked to its review through that client alone; a running job
 * is asked after every second until it is done, and no longer; what the host
 * hears of the job only hurries the asking; a refusal the client throws is
 * read off its `code` and `details` whatever class it is; and nothing is
 * asked once the wizard is gone.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImportDto, ImportPreviewDto, JobDto, UploadPreview, ValidationReportDto } from './api.js';
import { ImportWizard, statsConsistent, type ImportClient, type ImportWords } from './ImportWizard.js';

const TARGET = { connectionId: 'conn_1', table: 'companies', columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }] };

/** The host's words here: the English beside the key, with what is put in. A plural is left as written; no test reads one. */
const words: ImportWords = (_key, fallback, args = {}) => fallback.replace(/\{(\w+)\}/g, (whole: string, name: string) => (name in args ? String(args[name]) : whole));

const UPLOADED: UploadPreview = { fileId: 'file_1', filename: 'pasted.csv', sizeBytes: 60, sha256: 'x', columns: ['name', 'email'], sampleRows: [['Harbour', 'a@harbour.test']], totalRows: 3 };
const REPORT: ValidationReportDto = { total: 3, valid: 3, invalid: 0, issues: [] };
const LOOK: ImportPreviewDto = {
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
};
const importRow = (status: ImportDto['status'], stats: ImportDto['stats'] = null): ImportDto => ({
  id: 'imp_1',
  connectionId: 'conn_1',
  tableName: 'companies',
  requestedBy: 'usr_1',
  fileId: 'file_1',
  mapping: { columns: [] },
  options: { mode: 'skip', matchColumn: 'email', skipInvalid: true },
  status,
  stats,
  errorReportFileId: null,
  createdAt: 0,
  startedAt: null,
  finishedAt: null,
});
const job = (status: JobDto['status'], pct: number): JobDto => ({ id: 'job_1', kind: 'import', status, progress: { pct, message: status === 'running' ? 'Line 1 of 3' : null }, lastError: null });

interface Fake {
  client: ImportClient;
  calls: { upload: { name: string; header: string | undefined }[]; create: Parameters<ImportClient['createImport']>[0][]; job: number; import: number };
  /** What the next asks answer: the job and the import as the server would have them then. */
  now: { job: JobDto; import: ImportDto };
  heard: (() => void) | null;
  stopped: number;
}

function fake(over: Partial<ImportClient> = {}, live = false): Fake {
  const state: Fake = {
    calls: { upload: [], create: [], job: 0, import: 0 },
    now: { job: job('running', 40), import: importRow('running') },
    heard: null,
    stopped: 0,
    client: {
      uploadImportFile: async (file, opts) => {
        state.calls.upload.push({ name: file.name, header: opts?.header });
        return UPLOADED;
      },
      createImport: async (input) => {
        state.calls.create.push(input);
        return { data: { import: importRow('ready'), report: REPORT } };
      },
      previewImport: async () => LOOK,
      runImport: async () => ({ data: { import: importRow('running'), jobId: 'job_1' } }),
      getImport: async () => {
        state.calls.import += 1;
        return state.now.import;
      },
      getJob: async () => {
        state.calls.job += 1;
        return state.now.job;
      },
      errorReportHref: (id) => `/reports/${id}`,
      ...(live
        ? {
            watchJob: (_jobId: string, changed: () => void) => {
              state.heard = changed;
              return () => {
                state.stopped += 1;
              };
            },
          }
        : {}),
      ...over,
    },
  };
  return state;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A paste, its columns matched by their names, the lines looked at: the wizard at its Validate step. */
async function toValidate(state: Fake, user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<ImportWizard client={state.client} t={words} target={TARGET} targetName="Companies" matchOn="email" />);
  await user.type(screen.getByRole('textbox'), 'name,email{Enter}Harbour,a@harbour.test');
  await user.click(screen.getByTestId('import-paste-use'));
  await user.click(await screen.findByTestId('wizard-validate'));
  await screen.findByTestId('validation-summary');
}

describe('the import wizard, on a client and words handed to it', () => {
  it('walks a paste to its preview through the client alone, with the table and the match the host named', async () => {
    const state = fake();
    const user = userEvent.setup();
    await toValidate(state, user);
    expect(state.calls.upload).toEqual([{ name: 'pasted.csv', header: undefined }]);
    expect(state.calls.create).toEqual([
      {
        fileId: 'file_1',
        connectionId: 'conn_1',
        table: 'companies',
        mapping: { columns: [{ from: 'name', to: 'name' }, { from: 'email', to: 'email' }] },
        options: { mode: 'skip', matchColumn: 'email', skipInvalid: true },
      },
    ]);
    expect([...screen.getByTestId('import-preview').querySelectorAll('[data-count]')].map((el) => `${el.getAttribute('data-count') ?? ''} ${el.lastElementChild?.textContent ?? ''}`)).toEqual(['new 2', 'here 1', 'refused 0']);
    expect([...screen.getByTestId('import-preview').querySelectorAll('[data-line]')].map((el) => el.getAttribute('data-status'))).toEqual(['new', 'here', 'new']);
    expect(screen.getByTestId('validation-rest').textContent).toBe('1 already here will be left as they are');
    // Nothing was asked of a job before one was started.
    expect(state.calls.job).toBe(0);
  });

  it('draws the host’s own choice of table at the head of the first step, and waits for a table', () => {
    const state = fake();
    render(<ImportWizard client={state.client} t={words} target={null} targetName="" targetPicker={<p data-testid="host-picker">Pick a table</p>} />);
    expect(screen.getByTestId('host-picker').textContent).toBe('Pick a table');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('import-upload').querySelector('[data-part="dropzone"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('asks after a running job every second until it is done, shows the review, and then asks no more', async () => {
    const state = fake();
    const user = userEvent.setup();
    await toValidate(state, user);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      screen.getByTestId('wizard-run').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Line 1 of 3')).toBeTruthy();
    expect(state.calls.job).toBe(1);
    expect(state.calls.import).toBe(1);
    expect(screen.queryByTestId('import-review')).toBeNull();
    // A second later it is asked again, and is still running.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(state.calls.job).toBe(2);
    expect(state.calls.import).toBe(2);
    // The server finishes: the next ask finds it done.
    state.now = { job: job('succeeded', 100), import: importRow('succeeded', { total: 3, inserted: 2, updated: 0, skipped: 1, alreadyHere: 1 }) };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const review = screen.getByTestId('import-review');
    expect([...review.querySelectorAll('.font-mono')].map((el) => el.textContent)).toEqual(['3', '2', '0', '1']);
    expect(screen.getByTestId('import-already-here').textContent).toBe('Already here, left as they were: 1');
    expect(statsConsistent(state.now.import.stats!)).toBe(true);
    const asked = { ...state.calls };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(state.calls.job).toBe(asked.job);
    expect(state.calls.import).toBe(asked.import);
  });

  it('what the host hears of the job hurries the asking, and the host is told to stop listening when the wizard goes', async () => {
    const state = fake({}, true);
    const user = userEvent.setup();
    await toValidate(state, user);
    await user.click(screen.getByTestId('wizard-run'));
    await waitFor(() => expect(state.heard).not.toBeNull());
    await waitFor(() => expect(state.calls.job).toBe(1));
    state.now = { job: job('succeeded', 100), import: importRow('succeeded', { total: 3, inserted: 3, updated: 0, skipped: 0 }) };
    // Well inside the second the wizard would have waited.
    act(() => state.heard!());
    await screen.findByTestId('import-review');
    expect(state.calls.job).toBe(2);
    cleanup();
    expect(state.stopped).toBe(1);
  });

  it('an import that has finished is over, whatever its job was last heard to say; one not heard of yet has not failed', async () => {
    // The two are asked apart: here the job's answer is old (still running) and the import's is the news.
    const state = fake();
    state.now = { job: job('running', 40), import: importRow('succeeded', { total: 3, inserted: 3, updated: 0, skipped: 0 }) };
    let answer: (value: ImportDto) => void = () => undefined;
    const slow = fake({ getImport: () => new Promise<ImportDto>((resolve) => (answer = resolve)), getJob: state.client.getJob });
    const user = userEvent.setup();
    await toValidate(slow, user);
    await user.click(screen.getByTestId('wizard-run'));
    // Before the import has answered at all: it is being brought in, not "failed".
    await waitFor(() => expect(screen.getByText('Line 1 of 3')).toBeTruthy());
    expect(screen.queryByText('The import failed.')).toBeNull();
    await act(async () => answer(state.now.import));
    await screen.findByTestId('import-review');
    expect(screen.queryByText('Line 1 of 3')).toBeNull();
  });

  it('a job that failed is said, with the server’s own reason', async () => {
    const state = fake();
    state.now = { job: { ...job('failed', 10), lastError: 'The table is locked.' }, import: importRow('failed') };
    const user = userEvent.setup();
    await toValidate(state, user);
    await user.click(screen.getByTestId('wizard-run'));
    expect(await screen.findByText('The import failed.')).toBeTruthy();
    expect(screen.getByText('The table is locked.')).toBeTruthy();
  });

  it('asks nothing once it is gone', async () => {
    const state = fake();
    const user = userEvent.setup();
    await toValidate(state, user);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      screen.getByTestId('wizard-run').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const asked = state.calls.job;
    cleanup();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.calls.job).toBe(asked);
  });

  it.each([
    ['table:conn_1:companies:import', 'You do not hold the right to import into Companies. Ask an administrator for it.'],
    ['table:conn_1:companies:read', 'Matching lines against the rows already there needs the right to read Companies. Match on nothing, or ask an administrator for it.'],
  ])('reads a refusal off whatever the client threw (%s), and names the table as the host does', async (permission, sentence) => {
    // No class of the dashboard's: a plain Error with the server's code and details on it.
    const refused = Object.assign(new Error('You do not have import access to this table.'), { code: 'TABLE_FORBIDDEN', details: { permission } });
    const state = fake({ createImport: () => Promise.reject(refused) });
    const user = userEvent.setup();
    render(<ImportWizard client={state.client} t={words} target={TARGET} targetName="Companies" />);
    await user.type(screen.getByRole('textbox'), 'name,email{Enter}Harbour,a@harbour.test');
    await user.click(screen.getByTestId('import-paste-use'));
    await user.click(await screen.findByTestId('wizard-validate'));
    expect(await screen.findByText(sentence)).toBeTruthy();
    // Still on the mapping step, with the button back: the person can change the match and try again.
    expect((screen.getByTestId('wizard-validate') as HTMLButtonElement).disabled).toBe(false);
  });

  it('any other refusal is said as the server said it, and an upload that fails stays on the first step', async () => {
    const state = fake({ uploadImportFile: () => Promise.reject(new Error('The file is larger than 32 MB.')) });
    const user = userEvent.setup();
    render(<ImportWizard client={state.client} t={words} target={TARGET} targetName="Companies" />);
    await user.type(screen.getByRole('textbox'), 'name');
    await user.click(screen.getByTestId('import-paste-use'));
    expect(await screen.findByText('The file is larger than 32 MB.')).toBeTruthy();
    expect(screen.queryByTestId('wizard-validate')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('name');
  });
});
