// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-files template tests (09 §7.9): resolves the generated-vocabulary
 * config (nameColumn/parentColumn) + column detection onto the file-browser,
 * walks the parent-pointer hierarchy, opens the preview drawer, emits star
 * toggles as mutate intents only when a starred column exists, renders the
 * usage slot through WidgetHost, honest-disables the dropzone without an
 * upload transport, and degrades on loading/error/invalid layouts.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageFiles } from './PageFiles.js';
import { demoFilesLayout } from './demo-layout.js';
import { hasStarredColumn, resolveFileBrowserConfig } from './file-mapping.js';
import type { WidgetEvent } from '../../registry/types.js';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

const ROWS = [
  { id: 'f-1', file_name: 'Contracts', file_type: 'folder', parent_id: null, updated_at: new Date(NOW - 86_400_000).toISOString() },
  { id: 'f-2', file_name: 'Coastal House.pdf', file_type: 'pdf', parent_id: 'f-1', file_size: 2_400_000, updated_at: new Date(NOW - 3_600_000).toISOString(), is_starred: true, file_url: '/files/coastal.pdf' },
  { id: 'f-3', file_name: 'Budget.xlsx', file_type: 'sheet', parent_id: null, file_size: 812_000, updated_at: new Date(NOW - 600_000).toISOString(), is_starred: false },
];

const BINDING = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { schema: 'public', name: 'attachments', type: 'table' },
  shape: 'record-list',
  limit: 200,
};

const boundLayout = {
  ...demoFilesLayout,
  items: demoFilesLayout.items.map((item) =>
    item.i === 'browser'
      ? { ...item, config: { title: 'Attachments', nameColumn: 'file_name', parentColumn: 'parent_id', binding: BINDING } }
      : item,
  ),
};

function statesFor(rows: Record<string, unknown>[]) {
  return {
    browser: { status: 'success' as const, data: { rows, total: rows.length } },
    usage: { status: 'success' as const, data: { value: 45_212_000 } },
  };
}

describe('file-mapping', () => {
  it('projects generated nameColumn/parentColumn + detects the rest from rows', () => {
    const config = resolveFileBrowserConfig(
      { nameColumn: 'file_name', parentColumn: 'parent_id' },
      { rows: ROWS },
    );
    expect(config.nameField).toBe('file_name');
    expect(config.parentField).toBe('parent_id');
    expect(config.typeField).toBe('file_type');
    expect(config.sizeField).toBe('file_size');
    expect(config.modifiedField).toBe('updated_at');
    expect(config.starredField).toBe('is_starred');
    expect(config.urlField).toBe('file_url');
    expect(hasStarredColumn(config, { rows: ROWS })).toBe(true);
  });

  it('explicit *Field config wins over detection; malformed config degrades', () => {
    const config = resolveFileBrowserConfig({ nameField: 'title', views: 'grid' }, { rows: ROWS });
    expect(config.nameField).toBe('title');
    expect(config.views).toBe('grid');
    const fallback = resolveFileBrowserConfig({ views: 'sideways' }, { rows: [] });
    expect(fallback.views).toBe('both'); // schema default after degrade
    expect(hasStarredColumn(fallback, { rows: [{ id: 1 }] })).toBe(false);
  });
});

describe('PageFiles', () => {
  it('renders the bound hierarchy: root rows, folder navigation, breadcrumbs', async () => {
    const user = userEvent.setup();
    render(<PageFiles layout={boundLayout} states={statesFor(ROWS)} />);
    const browser = await screen.findByTestId('page-files-browser');

    // Root: the folder + the root file, not the nested pdf.
    expect(within(browser).getByText('Contracts')).toBeDefined();
    expect(within(browser).getByText('Budget.xlsx')).toBeDefined();
    expect(within(browser).queryByText('Coastal House.pdf')).toBeNull();

    // Open the folder → its child appears, breadcrumb grows.
    await user.click(within(browser).getByText('Contracts'));
    expect(within(browser).getByText('Coastal House.pdf')).toBeDefined();
  });

  it('opens the preview drawer on file open (size + link + mono id)', async () => {
    const user = userEvent.setup();
    render(<PageFiles layout={boundLayout} states={statesFor(ROWS)} />);
    const browser = await screen.findByTestId('page-files-browser');

    await user.click(within(browser).getByText('Budget.xlsx'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Budget.xlsx').length).toBeGreaterThan(0); // header + preview
    expect(within(dialog).getByText('sheet')).toBeDefined();
    expect(within(dialog).getByText(/812/)).toBeDefined(); // formatted size
  });

  it('emits star toggles as mutate intents against the bound source', async () => {
    const user = userEvent.setup();
    const events: [string, WidgetEvent][] = [];
    render(
      <PageFiles
        layout={boundLayout}
        states={statesFor(ROWS)}
        onEvent={(instanceId, event) => events.push([instanceId, event])}
      />,
    );
    const browser = await screen.findByTestId('page-files-browser');
    await user.click(within(browser).getAllByRole('button', { name: 'Star' })[0] as HTMLElement);

    const mutate = events.find(([, event]) => event.type === 'mutate');
    expect(mutate).toBeDefined();
    expect(mutate?.[0]).toBe('browser');
    expect(mutate?.[1]).toMatchObject({
      type: 'mutate',
      intent: 'update',
      connectionId: 'conn_1',
      table: 'public.attachments',
      values: { is_starred: true },
    });
  });

  it('hides starring when no starred-ish column exists in the payload', async () => {
    const bare = ROWS.map(({ is_starred, ...row }) => {
      void is_starred;
      return row;
    });
    render(<PageFiles layout={boundLayout} states={statesFor(bare)} />);
    const browser = await screen.findByTestId('page-files-browser');
    expect(within(browser).queryAllByRole('button', { name: 'Star' })).toHaveLength(0);
  });

  it('renders the usage slot through WidgetHost and disables the dropzone honestly', async () => {
    const { container } = render(<PageFiles layout={boundLayout} states={statesFor(ROWS)} />);
    await waitFor(() => {
      expect(container.querySelector('[data-widget="usage-meter"]')).not.toBeNull();
    });
    const dropzone = screen.getByTestId('page-files-dropzone');
    expect(within(dropzone).getByText('Uploads are not available on this page yet.')).toBeDefined();
    expect((dropzone.querySelector('[data-part="dropzone"]') as HTMLButtonElement).disabled).toBe(true);
    // No jobs → no progress list.
    expect(screen.queryByTestId('page-files-progress')).toBeNull();
  });

  it('shows host-driven upload jobs and routes Retry back to the host', async () => {
    const onRetryUpload = vi.fn();
    render(
      <PageFiles
        layout={boundLayout}
        states={statesFor(ROWS)}
        onUpload={() => {}}
        uploadJobs={[
          { id: 'job-1', name: 'Walkthrough.mp4', status: 'uploading', pct: 62 },
          { id: 'job-2', name: 'Logo.zip', status: 'failed', pct: 34, error: 'Network error' },
        ]}
        onRetryUpload={onRetryUpload}
      />,
    );
    const progress = screen.getByTestId('page-files-progress');
    expect(within(progress).getByText('Walkthrough.mp4')).toBeDefined();
    await userEvent.setup().click(within(progress).getByRole('button', { name: /Retry/ }));
    expect(onRetryUpload).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-2' }));
  });

  it('degrades on loading, error (Retry → refetch) and invalid layouts', async () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <PageFiles layout={demoFilesLayout} states={{ browser: { status: 'loading' } }} />,
    );
    expect(screen.getByRole('status', { name: 'Loading files' })).toBeDefined();

    rerender(
      <PageFiles
        layout={demoFilesLayout}
        states={{ browser: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch } }}
      />,
    );
    expect(screen.getByText('The file query failed')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender(<PageFiles layout={{ version: 99, items: 'nope' }} />);
    expect(screen.getByTestId('page-files-invalid')).toBeDefined();
  });
});

describe('page-files chrome localization (ui:templates.files.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { templates: { files: { uploadsUnavailable: 'Uploads sind auf dieser Seite noch nicht verfügbar.' } } }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <PageFiles layout={boundLayout} states={statesFor(ROWS)} />
      </I18nProvider>,
    );
    expect(screen.getByText('Uploads sind auf dieser Seite noch nicht verfügbar.')).toBeDefined();

    cleanup();
    render(<PageFiles layout={boundLayout} states={statesFor(ROWS)} />);
    expect(screen.getByText('Uploads are not available on this page yet.')).toBeDefined();
  });
});
