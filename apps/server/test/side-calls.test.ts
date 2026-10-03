// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A side's calls that Adminium will refuse, found in its source (plan 65, R4).
 *
 *  1. A customer page that sorts or filters a public list from the browser,
 *     or names a table by its short name, is told so, with what works.
 *  2. A claim in access.json the page never makes, or makes and never reads
 *     through, is told.
 *  3. A staff screen that passes `where` as { column: value } is told the
 *     filter's real shape.
 *  4. The starter's own screens, and a call quoted in a comment, raise nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addSide, scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { sideCallIssues } from '../src/project/apps/side-calls.js';
import { APP_VERSION } from '../src/version.js';

let root: string;
const write = (file: string, text: string): void => {
  const target = join(root, 'apps', 'cakes', file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
};
const MANIFEST = {
  requiredSchema: { tables: [{ ref: 'cakes' }, { ref: 'orders' }] },
  publicAccess: [{ table: 'cakes', methods: ['GET'] }, { table: 'orders', methods: ['POST'] }],
};
const messages = (manifest: unknown = MANIFEST): string[] => sideCallIssues(root, 'cakes', manifest).map((issue) => `${issue.side}: ${issue.message}`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-side-calls-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a side’s calls, read from its source', () => {
  it('names a public list sorted or filtered from the page, and a table called by its short name', () => {
    write('customer/src/App.tsx', `const rows = await client.list(orders, {\n  where: { customer_email: email },\n});\nconst menu = await client.list('cakes');`);
    const found = messages();
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('asks the public API for a list with "where"');
    expect(found[0]).toContain('PUBLIC_QUERY_REFUSED');
    expect(found[1]).toContain(`use config.tables['cakes'] ?? 'cakes'`);

    write('customer/src/App.tsx', `const rows = (await client.list(cakesTable, { limit: 50, order: 'name.asc' })).data;`);
    expect(messages()).toEqual([expect.stringContaining('a list with "order"')]);
    // What a public list does take, and a name that is no table of the app's.
    write('customer/src/App.tsx', `const rows = (await client.list(config.tables['cakes'] ?? 'cakes', { limit: 50, cursor })).data;\nawait client.create(name, { message });\nthings.get('other');`);
    expect(messages()).toEqual([]);
  });

  it('names a claim the page never makes, and one it never reads through', () => {
    const claimed = { ...MANIFEST, publicAccess: [...MANIFEST.publicAccess, { table: 'orders', methods: ['GET'], claim: { match: ['code', 'email'] } }] };
    write('customer/src/App.tsx', `const rows = (await client.list(orders, { limit: 1 })).data;`);
    expect(messages(claimed)).toEqual([expect.stringContaining('never calls client.claim')]);
    write('customer/src/App.tsx', `if (await client.claim({ code, email })) setRows((await client.list(orders, { limit: 1 })).data);`);
    expect(messages(claimed)).toEqual([expect.stringContaining("${config.tables['orders'] ?? 'orders'}_claimed")]);
    write('customer/src/App.tsx', `if (await client.claim({ code, email })) setRows((await client.list(\`\${orders}_claimed\`, { limit: 1 })).data);`);
    expect(messages(claimed)).toEqual([]);
  });

  it('names a claim made with a name first, a claimed endpoint spelled out, and a claim nothing in access.json answers', () => {
    write('customer/src/Track.tsx', `await client.claim('orders', { customer_email: email });\nconst res = await client.list('orders/_claimed');`);
    const found = messages();
    expect(found).toEqual([
      expect.stringContaining('calls client.claim with a name first'),
      expect.stringContaining("${config.tables['orders'] ?? 'orders'}_claimed"),
      expect.stringContaining('access.json has no entry with a "claim"'),
    ]);
    expect(found[2]).toContain('manifest-by-task--let-a-customer-find-their-own-row.md');
  });

  it('names a staff filter written as { column: value }', () => {
    write('staff/src/App.tsx', `const { rows } = await staff.list('orders', { where: { status } });`);
    expect(messages()).toEqual([expect.stringContaining('staff: passes "where" as { column: value }')]);
    write('staff/src/App.tsx', `const { rows } = await staff.list('orders', { order: 'id.desc', where: { column: 'status', op: 'eq', value: status } });\nawait staff.list('orders', { where: { and: [a, b] } });`);
    // A staff screen sorts and names tables by their short names: both are right there.
    expect(messages()).toEqual([]);
  });

  it('says nothing of the starter’s own screens, nor of a call quoted in a comment', () => {
    scaffoldApp({ root, key: 'cakes', name: 'Cakes', sides: [], version: APP_VERSION });
    addSide({ root, key: 'cakes', name: 'Cakes', side: 'customer' });
    addSide({ root, key: 'cakes', name: 'Cakes', side: 'staff' });
    expect(messages({ requiredSchema: { tables: [{ ref: 'items' }, { ref: 'requests' }] }, publicAccess: [{ table: 'items', methods: ['GET'] }] })).toEqual([]);
    write('customer/src/notes.ts', `// never: client.list(items, { where: x })\n/* nor client.list('cakes') */\nexport const x = 1;`);
    expect(messages()).toEqual([]);
  });
});
