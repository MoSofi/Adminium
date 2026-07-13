import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionMatrix } from './PermissionMatrix.js';
import type { PermissionGrant, PermissionMatrixPermission } from './PermissionMatrix.js';

afterEach(cleanup);

const roles = [
  { id: 'role-owner', name: 'Owner', locked: true },
  { id: 'role-admin', name: 'Admin' },
  { id: 'role-member', name: 'Member' },
];

const permissions: readonly PermissionMatrixPermission[] = [
  { key: 'page:projects:view', label: 'View projects', category: 'Projects' },
  { key: 'table:pg-main:projects:update', label: 'Edit projects', category: 'Projects' },
  { key: 'system:users:manage', label: 'Manage members', category: 'Administration' },
  { key: 'system:roles:manage', label: 'Manage roles & access', category: 'Administration' },
];

const grants: Readonly<Record<string, readonly PermissionGrant[]>> = {
  'role-admin': ['page:projects:view', 'table:pg-main:projects:update', 'system:users:manage'],
  'role-member': ['page:projects:view'],
};

function renderMatrix(props: Partial<Parameters<typeof PermissionMatrix>[0]> = {}) {
  return render(
    <PermissionMatrix
      label="Role permissions"
      rowHeader="Permission"
      roles={roles}
      permissions={permissions}
      grants={grants}
      {...props}
    />,
  );
}

describe('PermissionMatrix', () => {
  it('renders roles as columns and category groups as eyebrow labels', () => {
    const { container } = renderMatrix();
    expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual([
      'Permission',
      'Owner',
      'Admin',
      'Member',
    ]);
    const groupLabels = [...container.querySelectorAll('[data-part="matrix-group-label"]')].map(
      (el) => el.textContent,
    );
    expect(groupLabels).toEqual(['Projects', 'Administration']);
  });

  it('reflects the grants map as cell states', () => {
    renderMatrix();
    expect(
      screen.getByRole('button', { name: 'View projects — Admin' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Manage members — Member' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('hard-locks the Owner column (locked-granted, no change events)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderMatrix({ onChange });
    const ownerCell = screen.getByRole('button', { name: 'Manage roles & access — Owner' });
    expect(ownerCell.getAttribute('data-state')).toBe('locked');
    expect(ownerCell.getAttribute('aria-pressed')).toBe('true');
    expect(ownerCell.getAttribute('aria-disabled')).toBe('true');
    await user.click(ownerCell);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits { roleId, permissionKey, granted } on toggle', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderMatrix({ onChange });
    await user.click(screen.getByRole('button', { name: 'Manage roles & access — Admin' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      roleId: 'role-admin',
      permissionKey: 'system:roles:manage',
      granted: true,
    });
    await user.click(screen.getByRole('button', { name: 'View projects — Member' }));
    expect(onChange).toHaveBeenLastCalledWith({
      roleId: 'role-member',
      permissionKey: 'page:projects:view',
      granted: false,
    });
  });

  it('is diff-aware: cells differing from the baseline show the dirty dot', () => {
    renderMatrix({
      baseline: {
        ...grants,
        // baseline had members WITHOUT view, and admins WITH roles-manage
        'role-member': [],
        'role-admin': [...(grants['role-admin'] ?? []), 'system:roles:manage'],
      },
    });
    // member gained view → dirty
    expect(
      screen.getByRole('button', { name: 'View projects — Member' }).getAttribute('data-dirty'),
    ).toBe('true');
    // admin lost roles-manage → dirty even though the cell is now off
    expect(
      screen
        .getByRole('button', { name: 'Manage roles & access — Admin' })
        .getAttribute('data-dirty'),
    ).toBe('true');
    // untouched cell → clean
    expect(
      screen.getByRole('button', { name: 'View projects — Admin' }).getAttribute('data-dirty'),
    ).toBeNull();
  });

  it('without a baseline nothing is dirty', () => {
    const { container } = renderMatrix();
    expect(container.querySelector('[data-dirty]')).toBeNull();
  });

  it('supports keyboard toggling through the underlying grid', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderMatrix({ onChange });
    const start = screen.getByRole('button', { name: 'View projects — Admin' });
    start.focus();
    await user.keyboard('{ArrowDown} ');
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      roleId: 'role-admin',
      permissionKey: 'table:pg-main:projects:update',
      granted: false,
    });
  });

  it('disabled matrix keeps state visible but emits nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderMatrix({ onChange, disabled: true });
    const cell = screen.getByRole('button', { name: 'View projects — Admin' });
    expect(cell.getAttribute('aria-pressed')).toBe('true');
    await user.click(cell);
    expect(onChange).not.toHaveBeenCalled();
  });
});
