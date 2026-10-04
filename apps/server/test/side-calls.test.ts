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
import { hooksAfterReturn, sideCallIssues } from '../src/project/apps/side-calls.js';
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
    // Said with where the names are, since "config.tables" alone was read as the client's config.
    expect(found[1]).toContain("loaded.value.tables['<table>'] ?? '<table>'");
    expect(found[1]).toContain('Never from `client.config()`');

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
    expect(messages(claimed)).toEqual([expect.stringContaining("${loaded.value.tables['orders'] ?? 'orders'}_claimed")]);
    write('customer/src/App.tsx', `if (await client.claim({ code, email })) setRows((await client.list(\`\${orders}_claimed\`, { limit: 1 })).data);`);
    expect(messages(claimed)).toEqual([]);
  });

  it('names a claim made with a name first, a claimed endpoint spelled out, and a claim nothing in access.json answers', () => {
    write('customer/src/Track.tsx', `await client.claim('orders', { customer_email: email });\nconst res = await client.list('orders/_claimed');`);
    const found = messages();
    expect(found).toEqual([
      expect.stringContaining('calls client.claim with a name first'),
      expect.stringContaining("${loaded.value.tables['orders'] ?? 'orders'}_claimed"),
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

describe('table names read from the wrong config', () => {
  it('is found where a model wrote it, and not in a screen that reads them from the customer config', () => {
    const root = mkdtempSync(join(tmpdir(), 'adminium-side-config-'));
    try {
      mkdirSync(join(root, 'apps', 'bakery', 'customer', 'src'), { recursive: true });
      const file = join(root, 'apps', 'bakery', 'customer', 'src', 'App.tsx');
      writeFileSync(file, "async function loadCakes() {\n  const client = createPublicClient(loaded.value);\n  const config = await client.config();\n  const table = config.tables['cakes'] ?? 'cakes';\n  const { data } = await client.list(table, { limit: 50 });\n}\n");
      const issues = sideCallIssues(root, 'bakery', { requiredSchema: { tables: [{ ref: 'cakes' }] } });
      expect(issues.map((issue) => issue.message).join(' ')).toContain('reads "tables" from client.config()');
      expect(issues.map((issue) => issue.message).join(' ')).toContain("loaded.value.tables['<table>'] ?? '<table>'");
      // The other spellings a model wrote: straight off the call, with or without the await.
      for (const line of ["const t = client.config().tables['cakes'] ?? 'cakes';", "const t = (await client.config()).tables['cakes'];", "const t = (await client.config())?.tables?.['cakes'];"]) {
        writeFileSync(file, `async function load() {\n  ${line}\n}\n`);
        expect(sideCallIssues(root, 'bakery', { requiredSchema: { tables: [{ ref: 'cakes' }] } }).map((issue) => issue.message).join(' '), line).toContain('from client.config()');
      }
      writeFileSync(file, "async function loadCakes() {\n  const client = createPublicClient(loaded.value);\n  const table = loaded.value.tables['cakes'] ?? 'cakes';\n  const config = await client.config();\n  const zone = config.timezone;\n  const { data } = await client.list(table, { limit: 50 });\n}\n");
      expect(sideCallIssues(root, 'bakery', { requiredSchema: { tables: [{ ref: 'cakes' }] } }).map((issue) => issue.message).join(' ')).not.toContain('client.config()');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('a hook called after a component may already have returned', () => {
  it('is found where a model wrote it: early returns, then a hook', () => {
    const screen = [
      "export function App() {",
      "  const loaded = useCustomer();",
      "  const [form, setForm] = useState({ name: '' });",
      "",
      "  if (loaded.state === 'loading') return <div className=\"page\">Loading...</div>;",
      "  if (loaded.state === 'error') return <div className=\"page\">Error</div>;",
      "",
      "  React.useEffect(() => {",
      "    if (!form.name) return;",
      "    setForm({ name: 'x' });",
      "  }, []);",
      "",
      "  return <main>{form.name}</main>;",
      "}",
    ].join('\n');
    expect(hooksAfterReturn(screen)).toEqual([{ component: 'App', hook: 'useEffect', line: 8, returnedAt: 5 }]);
  });

  it('is found for a return inside an if block, and for a component written as an arrow', () => {
    const screen = ['const Menu = ({ config }: Props) => {', '  if (config === null) {', '    return null;', '  }', '  const [cakes, setCakes] = useState<Row[]>([]);', '  return <ul>{cakes.length}</ul>;', '};'].join('\n');
    expect(hooksAfterReturn(screen)).toEqual([{ component: 'Menu', hook: 'useState', line: 5, returnedAt: 3 }]);
  });

  it('is not seen in a screen that calls its hooks first, whatever its callbacks return', () => {
    const screen = [
      'export function App() {',
      '  const [rows, setRows] = useState<Row[]>([]);',
      '  useEffect(() => {',
      '    if (rows.length > 0) return;',
      '    void load().then(setRows);',
      '  }, [rows]);',
      '  const submit = async (event: FormEvent) => {',
      '    if (busy) return;',
      '    await save();',
      '  };',
      "  // if (x) return early, then useThing() — a comment is not code",
      "  const label = 'if (a) return useState(';",
      '  if (rows.length === 0) return <p>Nothing yet</p>;',
      '  return <ul>{rows.map((row) => <li key={row.id}>{row.name}</li>)}</ul>;',
      '}',
      '',
      'function helper() {',
      '  if (1) return 2;',
      '  return useless();',
      '}',
    ].join('\n');
    // (A lower-case function is no component; `useless(` is not a hook's name.)
    expect(hooksAfterReturn(screen.replace(/\/\/[^\n]*/g, ''))).toEqual([]);
  });

  it('is said with the file, both lines and what to do, for either side', () => {
    const root = mkdtempSync(join(tmpdir(), 'adminium-side-hooks-'));
    try {
      mkdirSync(join(root, 'apps', 'bakery', 'staff', 'src'), { recursive: true });
      writeFileSync(join(root, 'apps', 'bakery', 'staff', 'src', 'App.tsx'), 'export function App() {\n  if (!ready) return null;\n  const rows = useRows();\n  return <p>{rows.length}</p>;\n}\n');
      const issues = sideCallIssues(root, 'bakery', { requiredSchema: { tables: [] } });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ side: 'staff', file: 'apps/bakery/staff/src/App.tsx' });
      expect(issues[0]?.message).toContain('line 3: "App" calls useRows after it may already have returned (line 2)');
      expect(issues[0]?.message).toContain('Move every hook');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
