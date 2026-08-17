// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-io surfaces (M7-T07): the §11.1 number-consistency invariant, the
 * Import Wizard's upload step (target gate → dropzone), and the Data Exports
 * page rendering artifact rows through `scheduled-jobs-list`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

describe('statsConsistent (§11.1 invariant)', () => {
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
