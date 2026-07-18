// @vitest-environment happy-dom
/**
 * `page-directory` template tests (M7 people track, 09 §7.7): renders the
 * stored config body as a person card grid, search + dept filter chips narrow
 * it (with the filtered empty state distinct from first-use), a card click
 * opens the record drawer + emits `record-open`, the org-chart variant mounts
 * the cycle-safe tree, and loading/error/invalid states never crash.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageDirectory } from './PageDirectory.js';
import type { WidgetEvent } from '../../registry/types.js';

const binding = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name: 'employees', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 60,
};

const PEOPLE = [
  { id: 'p1', name: 'Ava Reyes', role: 'Chief Executive', dept: 'Executive', email: 'ava@acme.dev', manager_id: null },
  { id: 'p2', name: 'Morgan Lee', role: 'VP Engineering', dept: 'Engineering', email: 'morgan@acme.dev', manager_id: 'p1' },
  { id: 'p3', name: 'Kai Ndlovu', role: 'Frontend Lead', dept: 'Engineering', email: 'kai@acme.dev', manager_id: 'p2' },
];

function galleryConfig(widget: 'card-gallery' | 'org-chart' = 'card-gallery') {
  return {
    templateVersion: 1,
    toolbar: ['filter-chip-bar', 'global-search'],
    overlays: ['toast-stack'],
    layout: {
      version: 1,
      items: [
        {
          i: 'directory',
          widget,
          x: 0,
          y: 2,
          w: 12,
          h: 14,
          config:
            widget === 'org-chart'
              ? { title: 'Employees', parentColumn: 'manager_id', labelColumn: 'name', binding }
              : { title: 'Employees', titleColumn: 'name', binding },
        },
      ],
    },
  };
}

// Canonical widget-data wire shape (server shapers.ts ShapedRecordList).
const loaded = {
  directory: {
    status: 'success' as const,
    data: { shape: 'record-list', rows: PEOPLE, columns: [], total: PEOPLE.length },
  },
};

describe('PageDirectory', () => {
  it('renders every person as a card with the member count', () => {
    render(<PageDirectory config={galleryConfig()} states={loaded} />);
    expect(screen.getByTestId('page-directory-gallery')).toBeDefined();
    expect(screen.getByText('Ava Reyes')).toBeDefined();
    expect(screen.getByText('Morgan Lee')).toBeDefined();
    expect(screen.getByText('Kai Ndlovu')).toBeDefined();
    expect(screen.getByText('3 people')).toBeDefined();
  });

  it('search narrows the grid; dept chips filter; clearing restores', async () => {
    const user = userEvent.setup();
    render(<PageDirectory config={galleryConfig()} states={loaded} />);

    await user.type(screen.getByPlaceholderText('Search people…'), 'morgan');
    expect(screen.queryByText('Ava Reyes')).toBeNull();
    expect(screen.getByText('Morgan Lee')).toBeDefined();
    expect(screen.getByText('1 people')).toBeDefined();

    await user.clear(screen.getByPlaceholderText('Search people…'));
    await user.click(screen.getByRole('button', { name: 'Engineering' }));
    expect(screen.queryByText('Ava Reyes')).toBeNull();
    expect(screen.getByText('Kai Ndlovu')).toBeDefined();
  });

  it('renders the FILTERED empty state (no-matches + Clear filters), not first-use', async () => {
    const user = userEvent.setup();
    render(<PageDirectory config={galleryConfig()} states={loaded} />);
    await user.type(screen.getByPlaceholderText('Search people…'), 'zzz-nobody');

    const empty = document.querySelector('[data-preset="no-matches"]');
    expect(empty).not.toBeNull();
    expect(screen.getByText('No matching people')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Ava Reyes')).toBeDefined();
  });

  it('first-use empty state renders no-data when the table has no rows', () => {
    render(
      <PageDirectory
        config={galleryConfig()}
        states={{ directory: { status: 'success', data: [] } }}
      />,
    );
    expect(document.querySelector('[data-preset="no-data"]')).not.toBeNull();
    expect(screen.getByText('No people yet')).toBeDefined();
  });

  it('card click opens the record drawer and emits record-open', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    const onDetail = vi.fn();
    render(
      <PageDirectory
        config={galleryConfig()}
        states={loaded}
        onEvent={onEvent}
        onDetailRecordChange={onDetail}
      />,
    );

    await user.click(screen.getByText('Morgan Lee'));
    expect(onDetail).toHaveBeenCalledWith('p2');
    await waitFor(() => {
      expect(screen.getByTestId('page-directory-detail')).toBeDefined();
    });
    // Drawer shows the record's fields.
    expect(screen.getByText('morgan@acme.dev')).toBeDefined();

    const [instanceId, event] = onEvent.mock.calls[0] as [string, WidgetEvent];
    expect(instanceId).toBe('directory');
    expect(event).toMatchObject({
      type: 'record-open',
      connectionId: 'conn_1',
      table: 'public.employees',
      recordId: 'p2',
    });
  });

  it('route-controlled drawer: detailRecordId opens without a click', async () => {
    render(<PageDirectory config={galleryConfig()} states={loaded} detailRecordId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-directory-detail')).toBeDefined();
    });
    expect(screen.getByText('ava@acme.dev')).toBeDefined();
  });

  it('org-chart variant renders the tree with the bridged parent/label fields', () => {
    render(
      <PageDirectory
        config={galleryConfig('org-chart')}
        states={{ directory: { status: 'success', data: PEOPLE } }}
      />,
    );
    expect(screen.getByTestId('page-directory-org-chart')).toBeDefined();
    expect(screen.getByTestId('org-node-p1')).toBeDefined();
    // Reporting chain intact: the report renders under its manager.
    expect(screen.getByTestId('org-node-p3')).toBeDefined();
    // No search box in the tree variant.
    expect(screen.queryByPlaceholderText('Search people…')).toBeNull();
  });

  it('error state shows the message + Retry; loading shows the spinner', async () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <PageDirectory
        config={galleryConfig()}
        states={{ directory: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch } }}
      />,
    );
    expect(screen.getByText('This directory failed to load')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender(<PageDirectory config={galleryConfig()} states={{ directory: { status: 'loading' } }} />);
    expect(screen.getByLabelText('Loading people')).toBeDefined();
  });

  it('invalid stored config renders the alert notice, never a crash', () => {
    render(<PageDirectory config={{ layout: { version: 99, items: 'nope' } }} />);
    expect(screen.getByTestId('page-directory-invalid')).toBeDefined();
  });
});
