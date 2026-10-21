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

  it('names a new role, and a role that can do more', () => {
    put('apps/shop/manifest/roles.json', JSON.stringify([{ key: 'staff', permissions: ['table:@products:read'] }]));
    const before = currentSnapshot(root, 'shop');
    put('apps/shop/manifest/roles.json', JSON.stringify([{ key: 'staff', permissions: ['table:@products:read', 'table:@products:delete'] }, { key: 'guest', permissions: [] }]));
    expect(outsideChanges(root, 'shop', before, currentSnapshot(root, 'shop')).map((change) => change.view)).toEqual([
      { kind: 'role', role: 'staff', isNew: false },
      { kind: 'role', role: 'guest', isNew: true },
    ]);
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
