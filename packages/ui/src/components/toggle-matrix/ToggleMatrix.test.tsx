import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToggleMatrix } from './ToggleMatrix.js';
import type { ToggleMatrixCellState } from './ToggleMatrix.js';

afterEach(cleanup);

const columns = [
  { id: 'owner', label: 'Owner', locked: true },
  { id: 'admin', label: 'Admin' },
  { id: 'member', label: 'Member' },
];

const groups = [
  {
    id: 'projects',
    label: 'Projects',
    rows: [
      { id: 'view', label: 'View projects' },
      { id: 'edit', label: 'Edit projects' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    rows: [{ id: 'export', label: 'Export data' }],
  },
];

const stateFor =
  (on: ReadonlySet<string>) =>
  (rowId: string, columnId: string): ToggleMatrixCellState =>
    on.has(`${rowId}:${columnId}`) ? 'on' : 'off';

function renderMatrix(props: Partial<Parameters<typeof ToggleMatrix>[0]> = {}) {
  return render(
    <ToggleMatrix
      label="Permissions"
      rowHeader="Permission"
      columns={columns}
      groups={groups}
      getCellState={stateFor(new Set(['view:admin', 'view:member', 'export:admin']))}
      {...props}
    />,
  );
}

describe('ToggleMatrix', () => {
  it('renders grid semantics: headers, group labels, row headers, cells', () => {
    renderMatrix();
    const grid = screen.getByRole('grid', { name: 'Permissions' });
    expect(grid).toBeDefined();
    expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual([
      'Permission',
      'Owner',
      'Admin',
      'Member',
    ]);
    expect(screen.getAllByRole('rowheader').map((el) => el.textContent)).toEqual([
      'View projects',
      'Edit projects',
      'Export data',
    ]);
    // group eyebrow rows
    expect(grid.querySelectorAll('[data-part="matrix-group-label"]')).toHaveLength(2);
    // 3 rows × 3 columns of toggle buttons
    expect(grid.querySelectorAll('[data-part="matrix-cell"]')).toHaveLength(9);
  });

  it('exposes cell state via aria-pressed and locks locked columns', () => {
    renderMatrix();
    const onCell = screen.getByRole('button', { name: 'View projects — Admin' });
    const offCell = screen.getByRole('button', { name: 'Edit projects — Admin' });
    const lockedCell = screen.getByRole('button', { name: 'View projects — Owner' });
    expect(onCell.getAttribute('aria-pressed')).toBe('true');
    expect(offCell.getAttribute('aria-pressed')).toBe('false');
    expect(lockedCell.getAttribute('aria-pressed')).toBe('true');
    expect(lockedCell.getAttribute('aria-disabled')).toBe('true');
    expect(lockedCell.getAttribute('data-state')).toBe('locked');
  });

  it('click toggles an editable cell with the requested next value', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderMatrix({ onToggle });
    await user.click(screen.getByRole('button', { name: 'Edit projects — Admin' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('edit', 'admin', true);
    await user.click(screen.getByRole('button', { name: 'View projects — Admin' }));
    expect(onToggle).toHaveBeenLastCalledWith('view', 'admin', false);
  });

  it('never fires onToggle for locked cells or when disabled', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { unmount } = renderMatrix({ onToggle });
    await user.click(screen.getByRole('button', { name: 'View projects — Owner' }));
    expect(onToggle).not.toHaveBeenCalled();
    unmount();
    renderMatrix({ onToggle, disabled: true });
    await user.click(screen.getByRole('button', { name: 'Edit projects — Admin' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('arrow keys move cell focus; Home/End jump within the row', async () => {
    const user = userEvent.setup();
    renderMatrix();
    const first = screen.getByRole('button', { name: 'View projects — Owner' });
    await user.click(first);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View projects — Admin' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit projects — Admin' }));
    await user.keyboard('{ArrowDown}'); // crosses the group boundary
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export data — Admin' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export data — Member' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export data — Owner' }));
    await user.keyboard('{ArrowUp}{ArrowLeft}'); // ArrowLeft at col 0 stays put
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit projects — Owner' }));
  });

  it('roving tabindex keeps a single tab stop', async () => {
    const user = userEvent.setup();
    renderMatrix();
    const cells = screen
      .getAllByRole('button')
      .filter((el) => el.getAttribute('data-part') === 'matrix-cell');
    expect(cells.filter((el) => el.tabIndex === 0)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Export data — Member' }));
    await user.keyboard('{ArrowUp}');
    const after = screen
      .getAllByRole('button')
      .filter((el) => el.getAttribute('data-part') === 'matrix-cell' && el.tabIndex === 0);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(screen.getByRole('button', { name: 'Edit projects — Member' }));
  });

  it('Space toggles the focused cell (controlled round-trip)', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [on, setOn] = useState<ReadonlySet<string>>(new Set());
      return (
        <ToggleMatrix
          label="Permissions"
          rowHeader="Permission"
          columns={columns}
          groups={groups}
          getCellState={stateFor(on)}
          onToggle={(rowId, columnId, next) => {
            setOn((current) => {
              const nextSet = new Set(current);
              if (next) nextSet.add(`${rowId}:${columnId}`);
              else nextSet.delete(`${rowId}:${columnId}`);
              return nextSet;
            });
          }}
        />
      );
    }
    render(<Controlled />);
    const cell = screen.getByRole('button', { name: 'View projects — Admin' });
    cell.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'View projects — Admin' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('marks dirty cells with the diff dot', () => {
    renderMatrix({ isDirty: (rowId, columnId) => rowId === 'view' && columnId === 'admin' });
    const dirtyCell = screen.getByRole('button', { name: 'View projects — Admin' });
    expect(dirtyCell.getAttribute('data-dirty')).toBe('true');
    expect(dirtyCell.querySelector('[data-part="matrix-dirty-dot"]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit projects — Admin' }).getAttribute('data-dirty'),
    ).toBeNull();
  });
});
