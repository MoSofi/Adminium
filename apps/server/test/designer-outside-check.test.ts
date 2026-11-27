// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app newly lets strangers do, or its pages reach, compared with what it allowed at the
 * last apply: asked of the person in a session that holds words from outside. Only what grows is
 * a change; taking access away is not.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentSnapshot, outsideChanges, readApplied, writeApplied } from '../src/designer/outside-check.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-outside-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
const put = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};
const access = (entries: unknown[]): void => put('apps/shop/manifest/access.json', JSON.stringify({ publicAccess: entries }));

describe('what an app newly allows', () => {
  it('names each new public way in, by its table’s name, and nothing that was there', () => {
    put('apps/shop/manifest/tables/bookings.json', JSON.stringify({ ref: 'bookings', name: 'Bookings' }));
    access([{ table: 'products', methods: ['GET'], select: ['id', 'name'] }]);
    const before = currentSnapshot(root, 'shop');
    access([
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'cost'] },
      { table: 'bookings', methods: ['POST', 'PATCH'], writable: ['name'] },
    ]);
    const changes = outsideChanges(root, 'shop', before, currentSnapshot(root, 'shop'));
    expect(changes.map((change) => change.line)).toEqual(['strangers could read cost of products', 'strangers could add rows to Bookings', 'strangers could change rows of Bookings']);
    expect(changes.map((change) => change.view)).toEqual([
      { kind: 'access', verb: 'read-columns', table: 'products', columns: ['cost'] },
      { kind: 'access', verb: 'add', table: 'Bookings' },
      { kind: 'access', verb: 'change', table: 'Bookings' },
    ]);
    // Taking access away is never asked.
    access([]);
    expect(outsideChanges(root, 'shop', before, currentSnapshot(root, 'shop'))).toEqual([]);
  });

  it('sees what a stranger may write to the rows below an entry’s own, as a manifest names them: by their table', () => {
    // Seen 2026-11-27: the children were read only as a list, a manifest writes them as { "<table>": { … } }, and a
    // create that wrote product_id and qty to its lines (the plan had approved product and quantity) was never asked.
    const orders = (lines: Record<string, unknown>) => access([{ table: 'orders', methods: ['POST'], writable: ['name'], children: { order_lines: { via: 'order_id', min: 1, max: 40, ...lines } } }]);
    orders({ writable: ['product', 'quantity'] });
    const before = currentSnapshot(root, 'shop');
    expect(before.access[0]?.writable).toEqual(['name', 'order_lines.product', 'order_lines.quantity']);
    orders({ writable: ['product', 'quantity', 'unit_price'], children: { line_options: { via: 'line_id', max: 8, writable: ['name'] } } });
    const now = currentSnapshot(root, 'shop');
    expect(now.access[0]?.writable).toEqual(['name', 'order_lines.product', 'order_lines.quantity', 'order_lines.unit_price', 'order_lines.line_options.name']);
    expect(outsideChanges(root, 'shop', before, now).map((change) => change.line)).toEqual(['strangers could write order_lines.unit_price, order_lines.line_options.name of orders']);
    // The same lines again ask nothing.
    expect(outsideChanges(root, 'shop', now, now)).toEqual([]);
  });

  it('names a new role, and a role that can do more', () => {
    put('apps/shop/manifest/roles.json', JSON.stringify([{ key: 'staff', permissions: ['table:@products:read'] }]));
    const before = currentSnapshot(root, 'shop');
    put('apps/shop/manifest/roles.json', JSON.stringify([{ key: 'staff', permissions: ['table:@products:read', 'table:@products:delete'] }, { key: 'guest', permissions: [] }]));
    expect(outsideChanges(root, 'shop', before, currentSnapshot(root, 'shop')).map((change) => change.view)).toEqual([
      { kind: 'role', role: 'staff', isNew: false, rights: { tables: [{ table: 'products', actions: ['delete'] }], pages: 0, limits: false, other: [], more: 0 } },
      // A new role with nothing granted has nothing more to name.
      { kind: 'role', role: 'guest', isNew: true },
    ]);
  });

  it('says what more a role could do: each table by its name with the actions, the pages counted, the rest as written or counted', () => {
    put('apps/shop/manifest/tables/bookings.json', JSON.stringify({ ref: 'bookings', name: 'Bookings', columns: [] }));
    put('apps/shop/manifest/roles.json', JSON.stringify([{ key: 'staff', permissions: ['table:@products:read'] }]));
    const before = currentSnapshot(root, 'shop');
    const tables = Array.from({ length: 7 }, (_, n) => `table:@t${String(n)}:read`);
    put(
      'apps/shop/manifest/roles.json',
      JSON.stringify([
        {
          key: 'staff',
          permissions: ['table:@products:read', 'table:@bookings:delete', 'table:@bookings:read', 'table:@bookings:update', 'table:@bookings:read_pii', 'table:@bookings:create', 'page:@shop-bookings:view', 'page:@shop-classes:view', 'app:@:staff', 'Odd Grant!', ...tables],
          limits: { bookings: ['note'] },
        },
        { key: 'courier', permissions: ['table:@bookings:read'] },
      ]),
    );
    const changes = outsideChanges(root, 'shop', before, currentSnapshot(root, 'shop'));
    const staff = changes.find((change) => change.view.kind === 'role' && change.view.role === 'staff');
    expect(staff?.view).toEqual({
      kind: 'role',
      role: 'staff',
      isNew: false,
      rights: {
        // The table's own name, the actions in the order a person thinks of them; six tables named, the seventh and eighth counted.
        tables: [{ table: 'Bookings', actions: ['read', 'read_pii', 'create', 'update', 'delete'] }, ...Array.from({ length: 5 }, (_, n) => ({ table: `t${String(n)}`, actions: ['read'] }))],
        pages: 2,
        limits: true,
        other: ['app:@:staff'],
        more: 3,
      },
    });
    expect(staff?.line).toBe('the role "staff" could do more than before (17 new rights: Bookings: read, read_pii, create, update, delete; t0: read; t1: read; t2: read; t3: read; t4: read; 2 pages; its write limits changed; app:@:staff; 3 more)');
    // A new role's rights are named too, and that it starts with no limits is no right.
    const courier = changes.find((change) => change.view.kind === 'role' && change.view.role === 'courier');
    expect(courier?.view).toEqual({ kind: 'role', role: 'courier', isNew: true, rights: { tables: [{ table: 'Bookings', actions: ['read'] }], pages: 0, limits: false, other: [], more: 0 } });
    expect(courier?.line).toBe('a new role "courier" could sign in and use the app (Bookings: read)');
  });

  it('names a page whose own code calls an address outside the public client, and not the template’s copy or a comment', () => {
    put('apps/shop/customer/src/App.tsx', "// fetch('/x') is said in a comment only\nexport default function App() { return null; }\n");
    put('apps/shop/customer/src/site/js/x.js', "fetch('https://evil.example')");
    const before = currentSnapshot(root, 'shop');
    expect(before.calls).toEqual([]);
    put('apps/shop/customer/src/pages/shop.tsx', "export default function Shop() { void fetch('https://pay.example/charge'); return null; }\n");
    put('apps/shop/customer/src/pages/live.tsx', "const socket = new WebSocket('wss://x');\nconst api = '/api/v1/data';\n");
    expect(outsideChanges(root, 'shop', before, currentSnapshot(root, 'shop')).map((change) => change.line)).toEqual(['the live page calls an address outside Adminium', 'the shop page calls an address outside Adminium']);
  });

  it('is compared with what was kept at the last apply, and with nothing before the first', () => {
    access([{ table: 'messages', methods: ['POST'] }]);
    expect(readApplied(root, 'shop')).toBeNull();
    expect(outsideChanges(root, 'shop', null, currentSnapshot(root, 'shop')).map((change) => change.line)).toEqual(['strangers could add rows to messages']);
    writeApplied(root, 'shop', currentSnapshot(root, 'shop'));
    expect(outsideChanges(root, 'shop', readApplied(root, 'shop'), currentSnapshot(root, 'shop'))).toEqual([]);
  });
});
