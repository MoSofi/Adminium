// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { DesignerFile, DesignerFiles } from '../api.js';
import { crumbsOf, findFile, firstFile, foldersOf, nameOf, treeRows } from './fileTree.js';

const HASH = 'a'.repeat(64);
const file = (label: string, path = `apps/shop/${label}`): DesignerFile => ({ path, label, hash: HASH, size: 10 });
const customer = ['customer/App.tsx', 'customer/design.css', 'customer/pages/Home.tsx', 'customer/pages/menu/Item.tsx', 'customer/pages/Menu.tsx', 'customer/ui/button.tsx'].map((label) => file(label));
const said = (rows: ReturnType<typeof treeRows>): string[] => rows.map((row) => `${'  '.repeat(row.depth)}${row.kind === 'folder' ? `${row.name}/${row.open ? '' : ' (closed)'}` : row.name}`);

describe('the file list', () => {
  it('draws a side’s files under its heading, a folder where its first file is, first-level folders open and deeper ones closed', () => {
    expect(said(treeRows('customer', customer, new Set()))).toEqual(['App.tsx', 'design.css', 'pages/', '  Home.tsx', '  menu/ (closed)', '  Menu.tsx', 'ui/', '  button.tsx']);
  });

  it('turns a folder the other way when a person presses it, and the rest stay', () => {
    expect(said(treeRows('customer', customer, new Set(['customer/ui', 'customer/pages/menu'])))).toEqual(['App.tsx', 'design.css', 'pages/', '  Home.tsx', '  menu/', '    Item.tsx', '  Menu.tsx', 'ui/ (closed)']);
  });

  it('names the dashboard’s pages under "pages", and a settings file by its own name', () => {
    expect(said(treeRows('dashboard', [file('dashboard/pages/orders.json'), file('dashboard/pages/menu.json')], new Set()))).toEqual(['pages/', '  orders.json', '  menu.json']);
    expect(said(treeRows('settings', [file('design.md'), file('look.json'), file('app.json')], new Set()))).toEqual(['design.md', 'look.json', 'app.json']);
    expect(said(treeRows('staff', [file('staff/nav.json'), file('staff/App.tsx')], new Set()))).toEqual(['nav.json', 'App.tsx']);
  });

  it('says where the open file is, for the bar', () => {
    expect(crumbsOf('customer', 'customer/pages/Menu.tsx')).toEqual(['customer', 'pages', 'Menu.tsx']);
    expect(crumbsOf('settings', 'design.md')).toEqual(['design.md']);
    expect(nameOf('customer/pages/Menu.tsx')).toBe('Menu.tsx');
    expect(foldersOf('customer', 'customer/pages/menu/Item.tsx')).toEqual(['customer/pages', 'customer/pages/menu']);
    expect(foldersOf('settings', 'design.md')).toEqual([]);
  });

  it('opens the customer side’s App.tsx first, else the first file listed, and none when there is none', () => {
    const list = (groups: DesignerFiles['groups']): DesignerFiles => ({ groups, busy: null, version: null });
    expect(firstFile(list([{ key: 'customer', files: [file('customer/design.css'), file('customer/App.tsx')] }]))?.label).toBe('customer/App.tsx');
    expect(firstFile(list([{ key: 'dashboard', files: [file('dashboard/pages/a.json')] }, { key: 'settings', files: [file('app.json')] }]))?.label).toBe('dashboard/pages/a.json');
    expect(firstFile(list([]))).toBeNull();
    const both = list([{ key: 'staff', files: [file('staff/App.tsx')] }]);
    expect(findFile(both, 'apps/shop/staff/App.tsx')).toMatchObject({ group: 'staff' });
    expect(findFile(both, 'apps/shop/none')).toBeNull();
    expect(findFile(undefined, 'x')).toBeNull();
  });
});
