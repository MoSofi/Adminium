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
import { setWriteLock, WriteControl } from './write-lock.js';

const REASON = 'Read-only: this trial has ended';

afterEach(() => {
  act(() => setWriteLock(null));
});

describe('the write lock', () => {
  it('leaves a control as it is while writes are open', async () => {
    const onClick = vi.fn();
    render(
      <WriteControl>
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
        <WriteControl>
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
});
