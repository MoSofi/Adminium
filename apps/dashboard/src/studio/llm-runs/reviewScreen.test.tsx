// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Review-diff screen tests (06-llm-assist.md §10.3, acceptance 11/12/14):
 * category grouping + header counts, the §8.2 default check state, the bulk
 * "Accept all" never selecting rejects-heuristic/user-locked rows, the
 * apply → confirm → success-toast → undo flow, draft persistence across a
 * remount, and the read-only rendering of an applied run. Fetch is mocked like
 * the sibling remap/hub suites (no msw).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { LlmRunDetail, SuggestionDiff } from '../ai/api.js';
import { ReviewScreen } from './ReviewScreen.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const DIFF: SuggestionDiff[] = [
  {
    id: 'label:public.orders',
    category: 'label',
    table: 'public.orders',
    status: 'conflict',
    confidence: 0.9,
    heuristicValue: { label: { en_US: 'Orders tbl' } },
    llmValue: { label: { en_US: 'Orders', de_DE: 'Bestellungen' }, description: { en_US: 'Customer orders' } },
    reason: 'Cleaner label',
  },
  {
    id: 'label:public.orders.total_cents',
    category: 'label',
    table: 'public.orders',
    status: 'agree',
    confidence: 0.4,
    heuristicValue: { label: { en_US: 'Total cents' } },
    llmValue: { label: { en_US: 'Total cents' } },
  },
  {
    id: 'key:public.orders',
    category: 'key',
    table: 'public.orders',
    status: 'llm-new',
    confidence: 0.6,
    heuristicValue: undefined,
    llmValue: { displayColumn: 'order_number', naturalKey: ['order_number'] },
  },
  {
    id: 'enum:public.orders.status',
    category: 'enum',
    table: 'public.orders',
    status: 'conflict',
    confidence: 0.95,
    heuristicValue: { kind: 'category', order: null, tones: {} },
    llmValue: { kind: 'workflow', order: ['pending', 'paid'], tones: { pending: 'warn', paid: 'pos' } },
    reason: 'Lifecycle states',
  },
  {
    id: 'relation:public.orders.product_id->public.products.id',
    category: 'relation',
    table: 'public.orders',
    status: 'llm-new',
    confidence: 0.93,
    heuristicValue: undefined,
    llmValue: {
      fromTable: 'public.orders',
      fromColumns: ['product_id'],
      toTable: 'public.products',
      toColumns: ['id'],
      kind: 'many-to-one',
      evidence: 'Name + type match',
    },
    reason: 'Name + type match',
  },
  {
    id: 'pii:public.customers.email',
    category: 'pii',
    table: 'public.customers',
    status: 'rejects-heuristic',
    confidence: 0.99,
    heuristicValue: { kind: 'email', masking: 'mask-email' },
    llmValue: null,
    reason: 'Column is a lookup code, not an address.',
  },
  {
    id: 'pii:public.customers.full_name',
    category: 'pii',
    table: 'public.customers',
    status: 'user-locked',
    confidence: 0.96,
    heuristicValue: { kind: 'name', masking: 'mask-partial' },
    llmValue: { kind: 'name', masking: 'redact' },
    currentValue: { kind: 'name', masking: 'none' },
  },
];

function makeRun(overrides: Partial<LlmRunDetail> = {}): LlmRunDetail {
  return {
    id: 'run_1',
    connectionId: 'conn_1',
    snapshotId: 'snap_1',
    mode: 'byo',
    provider: null,
    model: null,
    promptVersion: 'adminium.prompt/v1',
    status: 'validated',
    validationStatus: 'valid',
    sections: null,
    locales: ['en_US', 'de_DE'],
    sampling: null,
    chunksTotal: 1,
    chunksReceived: 1,
    tokensIn: null,
    tokensOut: null,
    durationMs: null,
    appliedBy: null,
    appliedAt: null,
    createdBy: 'user_1',
    createdAt: 1,
    validationErrors: null,
    review: null,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

interface HarnessOptions {
  run?: () => LlmRunDetail;
  /** Applied run returned by POST /apply (and by GET after apply). */
  appliedRun?: () => LlmRunDetail;
  undoToken?: string | null;
}

function installFetch(options: HarnessOptions = {}): { calls: Call[] } {
  const calls: Call[] = [];
  let applied = false;
  const runFn = options.run ?? (() => makeRun());
  const appliedRunFn =
    options.appliedRun ?? (() => makeRun({ status: 'applied', appliedAt: 2, review: { accepted: ['label:public.orders'], rejected: [] } }));

  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ method, url, body });

    if (method === 'GET' && url.endsWith('/diff')) {
      return Promise.resolve(jsonResponse(200, { diff: DIFF }));
    }
    if (method === 'GET' && /\/llm\/runs\/run_1$/.test(url)) {
      return Promise.resolve(jsonResponse(200, applied ? appliedRunFn() : runFn()));
    }
    if (method === 'POST' && url.endsWith('/apply')) {
      applied = true;
      const accepted = (body as { accepted: string[] }).accepted;
      return Promise.resolve(
        jsonResponse(200, {
          run: { ...appliedRunFn() },
          partial: false,
          counts: { overrides: accepted.length, pages: 0, navGroupUpdates: 0 },
          review: { accepted, rejected: [] },
          ...(options.undoToken === undefined ? { undoToken: 'undo_tok_1' } : { undoToken: options.undoToken }),
        }),
      );
    }
    if (method === 'POST' && url.includes('/undo/')) {
      applied = false;
      return Promise.resolve(jsonResponse(200, { overrides: 1, pages: 0 }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

function renderScreen(): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <ReviewScreen runId="run_1" />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

const isChecked = (el: HTMLElement): boolean => el.getAttribute('aria-checked') === 'true';
const isDisabled = (el: HTMLElement): boolean =>
  el.hasAttribute('disabled') || el.getAttribute('data-disabled') !== null;

describe('ReviewScreen — grouping & counts', () => {
  it('renders §10.3 category sections and the header status counts', async () => {
    installFetch();
    renderScreen();

    // Sections for each non-empty group.
    const sections = await screen.findAllByTestId('category-section');
    const groupIds = sections.map((section) => section.getAttribute('data-group'));
    expect(groupIds).toEqual(['labels', 'enums', 'relations', 'keys', 'pii']);

    // Header counts: 1 agree / 2 conflict / 2 new / 1 rejects.
    expect(screen.getByText('1 agree')).toBeTruthy();
    expect(screen.getByText('2 conflict')).toBeTruthy();
    expect(screen.getByText('2 new')).toBeTruthy();
    expect(screen.getByText('1 rejects')).toBeTruthy();
  });
});

describe('ReviewScreen — default check state (§8.2)', () => {
  it('pre-checks confident rows, leaves rejects-heuristic and user-locked out', async () => {
    installFetch();
    renderScreen();

    const conflict = await screen.findByLabelText('Accept label suggestion for orders');
    expect(isChecked(conflict)).toBe(true);

    // The below-threshold llm-new key row (0.6) is left unchecked by default.
    const key = screen.getByLabelText('Accept key columns suggestion for orders');
    expect(isChecked(key)).toBe(false);

    // rejects-heuristic: unchecked and carries the warn callout.
    const rejects = screen.getByLabelText('Accept PII suggestion for customers.email');
    expect(isChecked(rejects)).toBe(false);
    expect(screen.getByText('The AI rejects a heuristic decision — confirm before accepting.')).toBeTruthy();

    // user-locked: disabled + "kept — edited by you".
    expect(screen.getByText('kept — edited by you')).toBeTruthy();
    const lockedRow = screen.getByText('kept — edited by you').closest('[data-testid="suggestion-row"]');
    const lockedCheckbox = within(lockedRow as HTMLElement).getByRole('checkbox');
    expect(isDisabled(lockedCheckbox)).toBe(true);

    // Footer count reflects the 4 default-accepted rows.
    expect(screen.getByRole('button', { name: /Apply 4 accepted suggestions/ })).toBeTruthy();
  });
});

describe('ReviewScreen — bulk accept (acceptance 12)', () => {
  it('"Accept all ≥ 80%" never selects rejects-heuristic or user-locked rows', async () => {
    installFetch();
    const user = userEvent.setup();
    renderScreen();

    await screen.findAllByTestId('category-section');
    await user.click(screen.getByRole('button', { name: /Clear selection/ }));
    expect(screen.getByRole('button', { name: /Apply 0 accepted suggestions/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Accept all ≥ 80%/ }));

    // Confident conflict/llm-new re-checked; rejects + locked stay unchecked.
    expect(isChecked(screen.getByLabelText('Accept label suggestion for orders'))).toBe(true);
    expect(isChecked(screen.getByLabelText('Accept PII suggestion for customers.email'))).toBe(false);
    const lockedRow = screen.getByText('kept — edited by you').closest('[data-testid="suggestion-row"]');
    expect(isChecked(within(lockedRow as HTMLElement).getByRole('checkbox'))).toBe(false);
  });
});

describe('ReviewScreen — apply → confirm → toast → undo', () => {
  it('applies, shows a success toast with Undo, and redeems the undo token', async () => {
    const harness = installFetch();
    const user = userEvent.setup();
    renderScreen();

    await screen.findAllByTestId('category-section');
    await user.click(screen.getByRole('button', { name: /Apply 4 accepted suggestions/ }));

    // Confirmation modal summarizing the writes.
    const confirm = await screen.findByRole('button', { name: 'Apply changes' });
    await user.click(confirm);

    // Apply request fired with the accepted set.
    await waitFor(() => {
      expect(harness.calls.some((call) => call.method === 'POST' && call.url.endsWith('/apply'))).toBe(true);
    });
    const applyCall = harness.calls.find((call) => call.url.endsWith('/apply'));
    expect((applyCall?.body as { accepted: string[] }).accepted).toContain('label:public.orders');

    // Success toast with an Undo action.
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undo);

    await waitFor(() => {
      expect(
        harness.calls.some(
          (call) => call.method === 'POST' && call.url.includes('/llm/runs/run_1/undo/undo_tok_1'),
        ),
      ).toBe(true);
    });
  });
});

describe('ReviewScreen — draft persistence (acceptance 12)', () => {
  it('persists accept/reject state across a remount until applied', async () => {
    installFetch();
    const user = userEvent.setup();
    const first = renderScreen();

    // Uncheck a default-checked row.
    const checkbox = await screen.findByLabelText('Accept label suggestion for orders');
    expect(isChecked(checkbox)).toBe(true);
    await user.click(checkbox);
    expect(isChecked(checkbox)).toBe(false);
    await waitFor(() => expect(localStorage.getItem('adminium.llmReview.run_1')).not.toBeNull());

    first.unmount();

    // Remount with a fresh QueryClient — the draft rehydrates.
    renderScreen();
    const rehydrated = await screen.findByLabelText('Accept label suggestion for orders');
    expect(isChecked(rehydrated)).toBe(false);
  });
});

describe('ReviewScreen — applied run is read-only', () => {
  it('renders disabled checkboxes and no apply footer once applied', async () => {
    installFetch({
      run: () => makeRun({ status: 'applied', appliedAt: 2, review: { accepted: ['label:public.orders'], rejected: [] } }),
    });
    renderScreen();

    expect(await screen.findByText('This run has been applied')).toBeTruthy();
    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes) expect(isDisabled(checkbox)).toBe(true);
    expect(screen.queryByRole('button', { name: /Apply .* accepted suggestions/ })).toBeNull();
  });
});
