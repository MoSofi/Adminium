// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The page-wide write lock: a locked create, edit, delete or save control
 * stays focusable, says `aria-disabled`, ignores a click and shows the reason
 * on focus; released, it is the control it was.
 */
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gridColumnSpecSchema } from '../families/tables/column-spec.js';
import { RecordDetail } from '../templates/page-crud/RecordDetail.js';
import type { CrudApi } from '../templates/page-crud/crud-api.js';
import { setDatabaseWriteLock, setWriteLock, useWriteLock, WriteControl, WriteLockScope, type WriteAction } from './write-lock.js';

const REASON = 'Read-only: this trial has ended';
const CAPPED = 'Read-only: the database is over the trial’s limit';

afterEach(() => {
  act(() => {
    setWriteLock(null);
    setDatabaseWriteLock('conn_1', null);
    setDatabaseWriteLock('conn_2', null);
  });
});

function Lock({ action, connectionId }: { action: WriteAction; connectionId?: string }) {
  return <output data-testid={`lock-${action}`}>{useWriteLock(action, connectionId) ?? 'open'}</output>;
}

describe('the write lock', () => {
  it('leaves a control as it is while writes are open', async () => {
    const onClick = vi.fn();
    render(
      <WriteControl action="create">
        <button type="button" onClick={onClick}>
          New order
        </button>
      </WriteControl>,
    );
    const button = screen.getByRole('button', { name: 'New order' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('locks it with aria-disabled, ignores a click and shows the reason on keyboard focus', async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <WriteControl action="update">
          <button type="submit" onClick={onClick}>
            Save
          </button>
        </WriteControl>
      </form>,
    );
    act(() => setWriteLock(REASON));
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Not natively disabled: a keyboard reaches it.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const user = userEvent.setup();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => button.blur());
    await user.tab();
    expect(document.activeElement).toBe(button);
    expect((await screen.findAllByText(REASON)).length).toBeGreaterThan(0);
    // Released: the control works again.
    act(() => setWriteLock(null));
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('locks a record’s Edit and Delete', async () => {
    const columns = [
      gridColumnSpecSchema.parse({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, nullable: false }),
      gridColumnSpecSchema.parse({ name: 'name', label: 'Name', logicalType: 'varchar', isDisplay: true }),
    ];
    const api = { get: vi.fn(async () => ({ data: { id: 7, name: 'Ada' }, inboundCounts: [] })), listRelated: vi.fn(async () => []) } as unknown as CrudApi;
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    act(() => setWriteLock(REASON));
    render(<RecordDetail api={api} columns={columns} recordId="7" onEdit={onEdit} onDelete={onDelete} />);
    const edit = await screen.findByRole('button', { name: /edit/i });
    const remove = screen.getByRole('button', { name: /delete/i });
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    await userEvent.setup().click(edit);
    await userEvent.setup().click(remove);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('locks creates and edits of a held database, and keeps its deletes open', async () => {
    render(
      <WriteLockScope connectionId="conn_1">
        <Lock action="create" />
        <Lock action="update" />
        <Lock action="delete" />
        <WriteControl action="create">
          <button type="button">New row</button>
        </WriteControl>
        <WriteControl action="delete">
          <button type="button">Delete</button>
        </WriteControl>
      </WriteLockScope>,
    );
    act(() => setDatabaseWriteLock('conn_1', CAPPED));
    expect(screen.getByTestId('lock-create').textContent).toBe(CAPPED);
    expect(screen.getByTestId('lock-update').textContent).toBe(CAPPED);
    expect(screen.getByTestId('lock-delete').textContent).toBe('open');
    const create = screen.getByRole('button', { name: 'New row' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('aria-disabled')).toBeNull();
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(create);
    expect((await screen.findAllByText(CAPPED)).length).toBeGreaterThan(0);
  });

  it('holds a database lock to its own database', () => {
    render(
      <>
        <Lock action="create" connectionId="conn_2" />
        <WriteLockScope connectionId="conn_2">
          <WriteControl action="update">
            <button type="button">Edit</button>
          </WriteControl>
        </WriteLockScope>
        {/* Outside any database (an attachment, which is the installation's own data): only the installation's lock. */}
        <WriteControl action="create">
          <button type="button">Upload</button>
        </WriteControl>
      </>,
    );
    act(() => setDatabaseWriteLock('conn_1', CAPPED));
    expect(screen.getByTestId('lock-create').textContent).toBe('open');
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('keeps the two locks apart: neither one lifts the other', () => {
    render(
      <WriteLockScope connectionId="conn_1">
        <Lock action="create" />
        <Lock action="delete" />
      </WriteLockScope>,
    );
    act(() => {
      setDatabaseWriteLock('conn_1', CAPPED);
      setWriteLock(REASON);
    });
    // The installation's lock covers every write, deletes too, and says its own reason.
    expect(screen.getByTestId('lock-create').textContent).toBe(REASON);
    expect(screen.getByTestId('lock-delete').textContent).toBe(REASON);
    // The trial's lock let go: the database is still held.
    act(() => setWriteLock(null));
    expect(screen.getByTestId('lock-create').textContent).toBe(CAPPED);
    expect(screen.getByTestId('lock-delete').textContent).toBe('open');
    // And the other way round.
    act(() => {
      setWriteLock(REASON);
      setDatabaseWriteLock('conn_1', null);
    });
    expect(screen.getByTestId('lock-create').textContent).toBe(REASON);
    expect(screen.getByTestId('lock-delete').textContent).toBe(REASON);
  });
});
