import type { Meta, StoryObj } from '@storybook/react-vite';
import { Database, FolderKanban, ShieldCheck, Wallet } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/index.js';
import { PermissionMatrix } from './PermissionMatrix.js';
import type { PermissionGrant, PermissionMatrixPermission } from './PermissionMatrix.js';

const meta = {
  title: 'Tier4/PermissionMatrix',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Roles per designs/Roles Permissions.dc.html — Owner is hard-locked. */
const roles = [
  { id: 'role-owner', name: 'Owner', locked: true },
  { id: 'role-admin', name: 'Admin' },
  { id: 'role-member', name: 'Member' },
  { id: 'role-guest', name: 'Guest' },
] as const;

/** Permission rows in the server grant grammar (08-server-api.md §5.1). */
const permissions: readonly PermissionMatrixPermission[] = [
  { key: 'page:projects:view', label: 'View projects', category: 'Projects' },
  { key: 'table:pg-main:projects:create', label: 'Create projects', category: 'Projects' },
  { key: 'table:pg-main:projects:update', label: 'Edit & delete projects', category: 'Projects' },
  { key: 'page:projects:edit', label: 'Share externally', category: 'Projects' },
  { key: 'table:pg-main:*:read', label: 'View data & reports', category: 'Data' },
  { key: 'table:pg-main:*:export', label: 'Export data', category: 'Data' },
  { key: 'table:pg-main:*:update', label: 'Edit records', category: 'Data' },
  { key: 'table:pg-main:*:delete', label: 'Delete records', category: 'Data' },
  { key: 'page:billing:view', label: 'View billing & invoices', category: 'Billing' },
  { key: 'system:settings:manage', label: 'Manage subscription', category: 'Billing' },
  { key: 'system:users:manage', label: 'Manage members', category: 'Administration' },
  { key: 'system:roles:manage', label: 'Manage roles & access', category: 'Administration' },
  { key: 'system:audit:read', label: 'View audit log', category: 'Administration' },
];

const categoryIcons = {
  Projects: <FolderKanban />,
  Data: <Database />,
  Billing: <Wallet />,
  Administration: <ShieldCheck />,
};

/** Persisted grants — billing/roles perms off by default per the comp. */
const persisted: Readonly<Record<string, readonly PermissionGrant[]>> = {
  'role-admin': [
    'page:projects:view',
    'table:pg-main:projects:create',
    'table:pg-main:projects:update',
    'page:projects:edit',
    'table:pg-main:*:read',
    'table:pg-main:*:export',
    'table:pg-main:*:update',
    'table:pg-main:*:delete',
    'page:billing:view',
    'system:users:manage',
    'system:audit:read',
  ],
  'role-member': [
    'page:projects:view',
    'table:pg-main:projects:create',
    'table:pg-main:*:read',
    'table:pg-main:*:export',
    'table:pg-main:*:update',
  ],
  'role-guest': ['page:projects:view', 'table:pg-main:*:read'],
};

function Demo() {
  const [grants, setGrants] = useState(persisted);
  const [baseline, setBaseline] = useState(persisted);
  const dirtyCount = roles.reduce((total, role) => {
    const current = new Set(grants[role.id] ?? []);
    const base = new Set(baseline[role.id] ?? []);
    let count = 0;
    for (const key of current) if (!base.has(key)) count++;
    for (const key of base) if (!current.has(key)) count++;
    return total + count;
  }, 0);

  return (
    <div className="flex max-w-[820px] flex-col gap-3">
      <PermissionMatrix
        label="Role permissions"
        rowHeader="Permission"
        roles={roles}
        permissions={permissions}
        grants={grants}
        baseline={baseline}
        categoryIcons={categoryIcons}
        onChange={({ roleId, permissionKey, granted }) => {
          setGrants((current) => {
            const roleGrants = new Set(current[roleId] ?? []);
            if (granted) roleGrants.add(permissionKey);
            else roleGrants.delete(permissionKey);
            return { ...current, [roleId]: [...roleGrants] };
          });
        }}
      />
      <div className="flex items-center gap-3">
        <Button disabled={dirtyCount === 0} onClick={() => setBaseline(grants)}>
          Save changes
        </Button>
        <span className="text-body-sm text-fg-muted">
          {dirtyCount === 0
            ? 'No pending changes.'
            : `${dirtyCount} pending change${dirtyCount === 1 ? '' : 's'} — PUT /api/v1/roles/:id/permissions per touched role.`}
        </span>
      </div>
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };

export const States: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="max-w-[820px]">
      <PermissionMatrix
        label="Role permissions"
        rowHeader="Permission"
        roles={roles}
        permissions={permissions}
        grants={{
          ...persisted,
          // guest gained export (dirty on) and lost read (dirty off)
          'role-guest': ['page:projects:view', 'table:pg-main:*:export'],
        }}
        baseline={persisted}
        categoryIcons={categoryIcons}
      />
    </div>
  ),
};

export const ReadOnly: Story = {
  render: () => (
    <div className="max-w-[820px]">
      <PermissionMatrix
        disabled
        label="Role permissions (read-only)"
        rowHeader="Permission"
        roles={roles}
        permissions={permissions}
        grants={persisted}
        categoryIcons={categoryIcons}
      />
    </div>
  ),
};
