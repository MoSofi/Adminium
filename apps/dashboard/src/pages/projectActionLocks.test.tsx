// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A project's own actions under the write locks (`@adminium/widgets`
 * `write-lock`): one that writes stays in reach on the record page and in
 * the row's menu, `aria-disabled`, with the reason, and runs nothing; one
 * that only reads stays open. In the bulk bar, each says the write it makes.
 */
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDatabaseWriteLock, setWriteLock } from '@adminium/widgets';

import { projectBulkActions, ProjectActionButtons, ProjectActionMenu, type ProjectActionDto, type ProjectActionsForTable } from './projectActions.js';

const ENDED = 'Read-only: this trial has ended';

const action = (id: string, permission: ProjectActionDto['permission']): ProjectActionDto => ({
  id,
  label: id,
  icon: null,
  confirm: null,
  bulk: true,
  permission,
  database: 'shop',
  connectionId: 'cnx_1',
  table: 'public.orders',
});

function forTable(start = vi.fn()): ProjectActionsForTable {
  const record = [action('Refund', 'update'), action('Print', 'read')];
  return { record, bulk: record, start, busy: false, dialog: null };
}

afterEach(() => {
  act(() => {
    setWriteLock(null);
    setDatabaseWriteLock('cnx_1', null);
  });
});

describe('a project’s actions under a write lock', () => {
  it('locks the record page’s writing action with the reason, and leaves the reading one open', async () => {
    const start = vi.fn();
    act(() => setWriteLock(ENDED));
    render(<ProjectActionButtons actions={forTable(start)} id="7" />);
    const refund = screen.getByRole('button', { name: 'Refund' });
    expect(refund.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Print' }).getAttribute('aria-disabled')).toBeNull();
    await userEvent.setup().click(refund);
    expect(start).not.toHaveBeenCalled();
    act(() => refund.focus());
    expect((await screen.findAllByText(ENDED)).length).toBeGreaterThan(0);
  });

  it('locks it in the row’s menu while its database is held', async () => {
    const start = vi.fn();
    act(() => setDatabaseWriteLock('cnx_1', 'Read-only: the database is over the trial’s limit'));
    render(<ProjectActionMenu actions={forTable(start)} id="7" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const refund = await screen.findByRole('menuitem', { name: 'Refund' });
    expect(refund.getAttribute('aria-disabled')).toBe('true');
    await user.click(refund);
    expect(start).not.toHaveBeenCalled();
  });

  it('says in the bulk bar which write each one makes', () => {
    const bulk = projectBulkActions(forTable());
    expect(bulk.map((one) => [one.key, one.write])).toEqual([
      ['Refund', 'update'],
      ['Print', undefined],
    ]);
  });
});
