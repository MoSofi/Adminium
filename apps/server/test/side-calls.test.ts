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
 *  5. A picture a table keeps, shown by the column's own value, or through an
 *     entry whose rows carry no id, is told, with how its address is built.
 *  6. A row that must come with rows below it (an order and its lines), made
 *     with a create that sends none, is told to send them in one write.
 *  7. An event's currentTarget read after the handler has let go is told.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addSide, scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { currentTargetAfterAwait, hooksAfterReturn, sideCallIssues } from '../src/project/apps/side-calls.js';
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
    // `orders` is only added to: no entry reads it, so the list itself is not found.
    expect(found[0]).toContain('PUBLIC_REF_NOT_FOUND');
    // Said with where the names are, since "config.tables" alone was read as the client's config.
    expect(found[1]).toContain("loaded.value.tables['<table>'] ?? '<table>'");
    expect(found[1]).toContain('Never from `client.config()`');

    write('customer/src/App.tsx', `const rows = (await client.list(cakesTable, { limit: 50, order: 'name.asc' })).data;`);
    expect(messages()).toEqual([expect.stringContaining('a list with "order"')]);
    // What a public list does take, and a name that is no table of the app's.
    write('customer/src/App.tsx', `const rows = (await client.list(config.tables['cakes'] ?? 'cakes', { limit: 50, cursor })).data;\nawait client.create(name, { message });\nthings.get('other');`);
    expect(messages()).toEqual([]);
  });

  describe('a public list’s search, sort and filter, judged against its entry', () => {
    const SHOP = {
      compatibility: { minAdminiumVersion: '0.3.70' },
      requiredSchema: { tables: [{ ref: 'products' }, { ref: 'pages' }, { ref: 'orders' }] },
      publicAccess: [
        { table: 'products', methods: ['GET'], select: ['id', 'name', 'category', 'price'], searchable: ['name'], orderable: ['price'], filterable: ['category', { column: 'price', ops: ['gte', 'lte'] }] },
        { table: 'pages', methods: ['GET'], select: ['id', 'title'] },
      ],
    };
    const listing = (table: string, options: string): void => write('customer/src/App.tsx', `const rows = await client.list(loaded.value.tables['${table}'] ?? '${table}', ${options});`);

    it('says nothing of a search, a sort or a filter the entry declares', () => {
      for (const options of [
        '{ q: term, limit: 24 }',
        '{ q }',
        "{ order: 'price.desc' }",
        "{ order: up ? 'price.asc' : 'price.desc' }",
        "{ where: { column: 'category', op: 'eq', value: picked } }",
        "{ where: { and: [{ column: 'price', op: 'gte', value: 1 }, { column: 'price', op: 'lte', value: 9 }] } }",
        '{ limit: 24, ...(term ? { q: term } : {}) }',
      ]) {
        listing('products', options);
        expect(messages(SHOP), options).toEqual([]);
      }
      write('customer/src/App.tsx', "const rows = await client.list<Product>(loaded.value.tables['products'] ?? 'products', { q: term });\nconst more = await client.list(loaded.value.tables['pages'] ?? 'pages', { limit: 5 });");
      expect(messages(SHOP)).toEqual([]);
    });

    it('names the exact field to declare for a search, a sort or a filter the entry does not', () => {
      for (const [options, parameter, field] of [
        ['{ q: term }', 'q', 'publicAccess[1].searchable'],
        ['{ limit: 24, ...(term ? { q: term } : {}) }', 'q', 'publicAccess[1].searchable'],
        ["{ order: 'title.asc' }", 'order', 'publicAccess[1].orderable'],
        ["{ where: { column: 'title', op: 'eq', value: picked } }", 'where', 'publicAccess[1].filterable'],
      ] as const) {
        listing('pages', options);
        const found = messages(SHOP);
        expect(found, options).toHaveLength(1);
        expect(found[0]).toContain(`a list with "${parameter}"`);
        expect(found[0]).toContain('400 PUBLIC_QUERY_REFUSED');
        expect(found[0]).toContain(`manifest/access.json, at ${field}`);
      }
    });

    it('names a column or an operator the declaration leaves out', () => {
      listing('products', "{ order: 'name.asc' }");
      expect(messages(SHOP)).toEqual([expect.stringMatching(/publicAccess\[0\]\.orderable.*"name"/)]);
      listing('products', "{ where: { column: 'name', op: 'eq', value: picked } }");
      expect(messages(SHOP)).toEqual([expect.stringMatching(/publicAccess\[0\]\.filterable.*"name"/)]);
      listing('products', "{ where: { column: 'price', op: 'eq', value: picked } }");
      expect(messages(SHOP)).toEqual([expect.stringMatching(/publicAccess\[0\]\.filterable.*"price".*"eq"/)]);
      listing('products', "{ where: { or: [{ column: 'category', op: 'eq', value: 1 }, { column: 'category', op: 'eq', value: 2 }] } }");
      expect(messages(SHOP)).toEqual([expect.stringContaining('joined by "and" only')]);
    });

    it('names an option the public client does not have, declared or not: it is dropped without an error', () => {
      for (const [options, wrong, right] of [
        ["{ filter: { column: 'category', op: 'eq', value: picked } }", 'filter', 'where'],
        ["{ filters: [{ column: 'category', op: 'eq', value: picked }] }", 'filters', 'where'],
        ['{ search: term }', 'search', 'q'],
        ["{ sort: 'price.desc' }", 'sort', 'order'],
      ] as const) {
        listing('products', options);
        const found = messages(SHOP);
        expect(found, options).toHaveLength(1);
        expect(found[0]).toContain(`passes "${wrong}"`);
        expect(found[0]).toContain(`The option is "${right}"`);
        expect(found[0]).not.toContain('PUBLIC_QUERY_REFUSED');
      }
    });

    it('never tells a signed-in list to declare what it may not', () => {
      write('customer/src/App.tsx', "const rows = await client.list(`${loaded.value.tables['orders'] ?? 'orders'}_claimed`, { order: 'id.desc' });\nawait client.claim({ code, email });");
      const found = messages({ ...SHOP, publicAccess: [...SHOP.publicAccess, { table: 'orders', methods: ['GET'], select: ['id'], claim: { match: ['code', 'email'] } }] });
      expect(found).toEqual([expect.stringContaining('publicAccess[2] cannot declare "orderable"')]);
      expect(found[0]).toContain('sort or narrow the rows in the page');
    });

    it('says to raise the app’s floor only when it is below the release that reads these fields', () => {
      listing('pages', '{ q: term }');
      expect(messages(SHOP)[0]).not.toContain('compatibility.minAdminiumVersion');
      const older = { ...SHOP, compatibility: { minAdminiumVersion: '0.3.60' } };
      expect(messages(older)[0]).toContain('manifest/app.json, at compatibility.minAdminiumVersion, to "0.3.68"');
    });

    it('follows a name held in a variable, and stays quiet when it cannot tell and an entry declares it', () => {
      write('customer/src/App.tsx', "const ref = loaded.value.tables['products'] ?? 'products';\nconst rows = await client.list(ref, { q: term });");
      expect(messages(SHOP)).toEqual([]);
      write('customer/src/App.tsx', "const ref = loaded.value.tables['pages'] ?? 'pages';\nconst rows = await client.list(ref, { q: term });");
      expect(messages(SHOP)).toEqual([expect.stringContaining('publicAccess[1].searchable')]);
      write('customer/src/App.tsx', 'export const load = (table: string) => client.list(table, { q: term });');
      expect(messages(SHOP)).toEqual([]);
      write('customer/src/App.tsx', "export const load = (table: string) => client.list(table, { order: 'title.asc' });");
      expect(messages({ ...SHOP, publicAccess: [SHOP.publicAccess[1]] })).toEqual([expect.stringContaining('publicAccess[0].orderable')]);
    });

    it('judges every call in a file, not only the first', () => {
      write('customer/src/App.tsx', "await client.list(loaded.value.tables['products'] ?? 'products', { q: term });\nawait client.list(loaded.value.tables['pages'] ?? 'pages', { q: term });");
      expect(messages(SHOP)).toEqual([expect.stringContaining('publicAccess[1].searchable')]);
    });

    describe('a filter through another list (via)', () => {
      const TABLES = {
        tables: [
          { ref: 'products', columns: [{ ref: 'id', role: 'pk' }, { ref: 'name' }, { ref: 'category' }] },
          { ref: 'variants', columns: [{ ref: 'id', role: 'pk' }, { ref: 'product_id', type: 'fk', references: 'products' }, { ref: 'colour_code' }, { ref: 'size_code' }, { ref: 'price' }] },
        ],
      };
      const VARIANTS = { table: 'variants', methods: ['GET'], select: ['id', 'product_id', 'colour_code', 'size_code', 'price'] };
      const THROUGH = {
        compatibility: { minAdminiumVersion: '0.3.70' },
        requiredSchema: TABLES,
        publicAccess: [
          { table: 'products', methods: ['GET'], select: ['id', 'name', 'category'], filterable: ['category'], via: { entry: 'variants', on: 'product_id', columns: ['colour_code', { column: 'size_code', ops: ['eq'] }] } },
          VARIANTS,
        ],
      };
      const UNDECLARED = { ...THROUGH, publicAccess: [{ table: 'products', methods: ['GET'], select: ['id', 'name', 'category'] }, VARIANTS] };

      it('says nothing of a via the entry declares', () => {
        for (const options of [
          '{ via }',
          '{ via: picked, limit: 24 }',
          "{ via: { column: 'colour_code', op: 'eq', value: colour } }",
          "{ via: { column: 'colour_code', op: 'in', value: colours } }",
          "{ via: { and: [{ column: 'colour_code', op: 'eq', value: colour }, { column: 'size_code', op: 'eq', value: size }] } }",
          "{ limit: 24, ...(colour ? { via: { column: 'colour_code', op: 'eq', value: colour } } : {}) }",
          "{ where: { column: 'category', op: 'eq', value: picked }, via: { column: 'colour_code', op: 'eq', value: colour } }",
        ]) {
          listing('products', options);
          expect(messages(THROUGH), options).toEqual([]);
        }
      });

      it('names the exact field and a ready shape for a via the entry does not declare', () => {
        listing('products', "{ via: { and: [{ column: 'colour_code', op: 'eq', value: colour }, { column: 'size_code', op: 'eq', value: size }] } }");
        const found = messages(UNDECLARED);
        expect(found).toHaveLength(1);
        expect(found[0]).toContain('a list with "via" on "products"');
        expect(found[0]).toContain('400 PUBLIC_QUERY_REFUSED');
        expect(found[0]).toContain('manifest/access.json, at publicAccess[0].via');
        expect(found[0]).toContain('"via": { "entry": "variants", "on": "product_id", "columns": ["colour_code", "size_code"] }');
        expect(found[0]).toContain('ONE');
      });

      it('leaves the shape to fill in when the source cannot say which list it goes through', () => {
        listing('products', "{ via: { column: 'weight', op: 'eq', value: 2 } }");
        expect(messages(UNDECLARED)).toEqual([expect.stringContaining('"via": { "entry": "<table of the other list>", "on": "<its foreign key to this table>", "columns": ["weight"] }')]);
        // The link is there and customers read no list of that table: naming it would fail the manifest's own check.
        listing('products', "{ via: { column: 'colour_code', op: 'eq', value: 'slate' } }");
        expect(messages({ ...UNDECLARED, publicAccess: [UNDECLARED.publicAccess[0]] })).toEqual([expect.stringContaining('"entry": "<table of the other list>"')]);
      });

      it('names a column or an operator its columns leave out, an "or", and a plain object', () => {
        listing('products', "{ via: { column: 'price', op: 'eq', value: 2 } }");
        expect(messages(THROUGH)).toEqual([expect.stringMatching(/publicAccess\[0\]\.via\.columns.*"price".*"variants"/)]);
        listing('products', "{ via: { column: 'size_code', op: 'in', value: sizes } }");
        expect(messages(THROUGH)).toEqual([expect.stringMatching(/publicAccess\[0\]\.via\.columns.*"size_code".*"in"/)]);
        listing('products', "{ via: { column: 'colour_code', op: 'like', value: 'sl%' } }");
        expect(messages(THROUGH)).toEqual([expect.stringContaining('never takes "like"')]);
        listing('products', "{ via: { or: [{ column: 'colour_code', op: 'eq', value: 1 }, { column: 'size_code', op: 'eq', value: 2 }] } }");
        expect(messages(THROUGH)).toEqual([expect.stringContaining('joined by "and" only')]);
        listing('products', "{ via: { colour_code: 'slate' } }");
        expect(messages(THROUGH)).toEqual([expect.stringContaining('passes it as { column: value }')]);
      });

      it('says a where on the other list’s column belongs under via, never to declare it on this table', () => {
        listing('products', "{ where: { column: 'colour_code', op: 'eq', value: colour } }");
        const found = messages(THROUGH);
        expect(found).toEqual([expect.stringContaining('Send it as "via"')]);
        expect(found[0]).toContain('publicAccess[0].via.columns');
        expect(found[0]).not.toContain('at publicAccess[0].filterable');
        // Also on an entry with no filterable of its own.
        const only = { ...THROUGH, publicAccess: [{ ...THROUGH.publicAccess[0], filterable: undefined }, VARIANTS] };
        expect(messages(only)).toEqual([expect.stringContaining('Send it as "via"')]);
      });

      it('never tells a signed-in list to declare it, and raises a floor below its release', () => {
        write('customer/src/App.tsx', "await client.claim({ code, email });\nconst rows = await client.list(`${loaded.value.tables['products'] ?? 'products'}_claimed`, { via: picked });");
        expect(messages({ ...UNDECLARED, publicAccess: [{ table: 'products', methods: ['GET'], select: ['id'], claim: { match: ['code', 'email'] } }, VARIANTS] })).toEqual([expect.stringContaining('publicAccess[0] cannot declare "via"')]);
        listing('products', '{ via: picked }');
        expect(messages(UNDECLARED)[0]).not.toContain('compatibility.minAdminiumVersion');
        expect(messages({ ...UNDECLARED, compatibility: { minAdminiumVersion: '0.3.60' } })[0]).toContain('manifest/app.json, at compatibility.minAdminiumVersion, to "0.3.68"');
      });
    });
  });

  it('names a picture column put in an <img> as it is, and a pictures entry whose rows carry no id', () => {
    const pictured = (select: string[]) => ({
      requiredSchema: { tables: [{ ref: 'cakes', columns: [{ ref: 'id', role: 'pk' }, { ref: 'name' }, { ref: 'photo' }] }] },
      publicAccess: [{ table: 'cakes', methods: ['GET'], select, pictures: ['photo'] }],
    });
    // The column's own value is the staff's address of the file: a visitor gets a broken image.
    write('customer/src/App.tsx', `const rows = (await client.list(table)).data;\nexport const Card = ({ cake }) => <img src={cake.photo} alt={cake.name} />;`);
    const found = messages(pictured(['name', 'photo']));
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('its "select" leaves out "id"');
    expect(found[1]).toContain('reads the picture column "photo" of "cakes" and never calls pictureUrl');
    expect(found[1]).toContain("pictureUrl(loaded.value.baseUrl, shown, table, row.id, '<column>', row.<column>)");

    // Built with pictureUrl, with the id in the rows: nothing to say.
    write(
      'customer/src/App.tsx',
      `import { pictureUrl } from '@adminiumjs/public-client';\nconst shown = await client.config();\nconst rows = (await client.list(table)).data;\nconst src = pictureUrl(loaded.value.baseUrl, shown, table, cake.id, 'photo', cake.photo);`,
    );
    expect(messages(pictured(['id', 'name', 'photo']))).toEqual([]);
    // A screen that never shows the picture is not told about it.
    write('customer/src/App.tsx', `const rows = (await client.list(table)).data;\nexport const Card = ({ cake }) => <p>{cake.name}</p>;`);
    expect(messages(pictured(['id', 'name', 'photo']))).toEqual([]);
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

  it('reads a typed call like a plain one, for a short name and for a claimed endpoint', () => {
    const claimed = { ...MANIFEST, publicAccess: [...MANIFEST.publicAccess, { table: 'orders', methods: ['GET'], claim: { match: ['code', 'email'] } }] };
    for (const type of ['<Cake>', '<Cake[]>', '<Row<Cake>>', '<{ id: number }>', '<{\n  id: number;\n  name: string;\n}>', '<\n  Cake | Pie\n>']) {
      write('customer/src/App.tsx', `const rows = await client.list${type}('cakes', { limit: 5 });`);
      expect(messages(), type).toEqual([expect.stringContaining('short name ("cakes")')]);
      write('customer/src/App.tsx', `await client.list(table);\nawait client.create${type}('orders', { name });`);
      expect(messages(), type).toEqual([expect.stringContaining('short name ("orders")')]);
      write('customer/src/App.tsx', `await client.claim({ code, email });\nconst rows = await client.list${type}('orders_claimed');`);
      expect(messages(claimed), type).toEqual([expect.stringContaining('reads a claimed endpoint by a name written out')]);
      write('customer/src/App.tsx', `await client.claim({ code, email });\nconst row = await client.get${type}(\`orders_claimed\`, id);`);
      expect(messages(claimed), type).toEqual([expect.stringContaining('reads a claimed endpoint by a name written out')]);
      // The name built from the customer config stays right, typed or not.
      write('customer/src/App.tsx', `await client.claim({ code, email });\nconst rows = await client.list${type}(\`\${orders}_claimed\`, { limit: 1 });`);
      expect(messages(claimed), type).toEqual([]);
    }
    // A comparison that only looks like a type names no table.
    write('customer/src/App.tsx', `await client.list(table);\nconst far = page.list < 3 && size > ('cakes');`);
    expect(messages()).toEqual([]);
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

  it('says when customers may read a table and no screen reads anything: the page would show none of it', () => {
    // The rows are taken from the customer config, which has none: nothing is ever asked of the public API.
    write('customer/src/App.tsx', `export function App() { const loaded = useCustomer();\n  return <ul>{loaded.value.cakes?.map((cake) => <li key={cake.id}>{cake.name}</li>)}</ul>; }`);
    const found = messages();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('customer: never reads "cakes", which customers are let read (access.json): no screen calls the public client\'s list');
    expect(found[0]).toContain("client.list(loaded.value.tables['cakes'] ?? 'cakes', { limit: 50 })");
    // One list call anywhere in the side, in a helper of its own or reading one row: nothing is said, whichever table it reads.
    write('customer/src/data.ts', `export const load = (client, table) => client.list(table, { limit: 50 });`);
    expect(messages()).toEqual([]);
    write('customer/src/data.ts', `export const one = (client, table, id) => client.get(table, id);`);
    expect(messages()).toEqual([]);
    // A call typed with what it answers is a read too, however its type is written.
    for (const typed of ['client.list<Cake>(table, { limit: 50 })', 'client.list<Cake[]>(table)', 'client.list<Row<Cake>>(table)', 'client.list<{ id: number }>(table)', 'client.get<Cake>(table, id)', 'client\n  .list<Cake>(table)', 'client.list<{\n  id: number;\n}>(table)', 'client.list<\n  Cake | Pie\n>(table)']) {
      write('customer/src/data.ts', `export const load = (client, table, id) => ${typed};`);
      expect(messages(), typed).toEqual([]);
    }
    // A comparison that only looks like a type is no read.
    write('customer/src/data.ts', `export const nothing = (page) => page.list < 3;`);
    expect(messages()).toHaveLength(1);
    // A list call only in a comment is none.
    write('customer/src/data.ts', `// client.list(table)\nexport const nothing = 1;`);
    expect(messages()).toHaveLength(1);
    // An app customers only write to, or whose rows are a person's own (claimed), is not told.
    expect(messages({ ...MANIFEST, publicAccess: [{ table: 'orders', methods: ['POST'] }] })).toEqual([]);
    // A side with no screens yet is not told.
    rmSync(join(root, 'apps', 'cakes', 'customer'), { recursive: true });
    expect(messages()).toEqual([]);
  });

  it('says when the public client is made at every render and named in an effect’s list: the page would ask for its rows without end', () => {
    const looping = `export function App() {\n  const loaded = useCustomer();\n  const client = createPublicClient(loaded.value);\n  useEffect(() => {\n    client.list(table).then(setRows);\n  }, [client, table]);\n  return <ul />;\n}`;
    write('customer/src/App.tsx', looping);
    const found = messages();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('makes the public client at every render (const client = createPublicClient(…)) and names "client" in a useEffect\'s list');
    expect(found[0]).toContain('useMemo(() => createPublicClient(loaded.value), [loaded.value])');
    // Made once, made inside the effect, or left out of the list: nothing is said.
    for (const fine of [
      looping.replace('const client = createPublicClient(loaded.value);', 'const client = useMemo(() => createPublicClient(loaded.value), [loaded.value]);'),
      looping.replace('[client, table]', '[loaded.state, table]'),
      `export function App() {\n  useEffect(() => {\n    const client = createPublicClient(loaded.value);\n    client.list(table).then(setRows);\n  }, [loaded.state]);\n  return <ul />;\n}`,
      // Made once, at the top of the file: it is the same client at every render.
      `const client = createPublicClient(window.__config);\nexport function App() {\n  useEffect(() => {\n    client.list(table).then(setRows);\n  }, [client, table]);\n  return <ul />;\n}`,
      // Another name that only contains it.
      looping.replace('[client, table]', '[clientReady, table]'),
    ]) {
      write('customer/src/App.tsx', fine);
      expect(messages(), fine).toEqual([]);
    }
  });
});

describe('a table’s short name kept in a name of the side’s own', () => {
  it('is told as the short name in the call is: the page’s every write would answer PUBLIC_REF_NOT_FOUND', () => {
    // Seen 2026-11-27: data.ts held `export const ENQUIRIES = 'enquiries'`, the pages called client.create(ENQUIRIES, …),
    // and the contact form, the newsletter and the order all failed, while the list (through config.tables) worked.
    write('customer/src/data.ts', `export const CAKES = 'cakes';\nexport const ORDERS = 'orders';\nexport const SHOP = 'the-shop';`);
    write('customer/src/pages/contact.tsx', `import { CAKES, ORDERS } from '../data';\nconst menu = await client.list(config.tables[CAKES] ?? CAKES, { limit: 50 });\nawait s.client.create(ORDERS, { name });`);
    const found = messages();
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('customer: calls the public client with the table\'s short name ("orders")');
    expect(found[0]).toContain("loaded.value.tables['orders'] ?? 'orders'");
    // Fine: the endpoint's name worked out from the config and held in a name, also one that shares the constant's name elsewhere.
    for (const fine of [
      `import { ORDERS } from '../data';\nconst orders = config.tables[ORDERS] ?? ORDERS;\nawait client.create(orders, { name });`,
      `const ORDERS = site.config.tables['orders'] ?? 'orders';\nawait client.create(ORDERS, { name });`,
      `import { SHOP } from '../data';\nawait things.create(SHOP, { name });`,
    ]) {
      write('customer/src/pages/contact.tsx', fine);
      // (The second case sets ORDERS to something worked out in one file: the name is then never taken for the short name.)
      // (An app customers only write to: the page reading no list is then nothing to say.)
      expect(messages({ ...MANIFEST, publicAccess: [{ table: 'orders', methods: ['POST'] }] }), fine).toEqual([]);
    }
  });
});

describe('a write the page makes that cannot work, read from its source', () => {
  it('says when a row that must come with rows below it is made with a create that sends none', () => {
    // An order must have a line (access.json: children.order_lines.min 1); client.create sends the order alone, and the
    // server refuses every one: PUBLIC_WRITE_REFUSED "too-few". Check, build and the look at the page all passed it (seen 2026-11-26).
    const ORDERS = {
      requiredSchema: { tables: [{ ref: 'orders' }, { ref: 'order_lines' }, { ref: 'messages' }] },
      publicAccess: [
        { table: 'orders', methods: ['POST'], writable: ['name'], children: { order_lines: { via: 'order_id', writable: ['product_id', 'quantity'], min: 1, max: 40 } } },
        { table: 'messages', methods: ['POST'], writable: ['body'] },
      ],
    };
    // As the walk's page wrote it.
    write('customer/src/pages/cart.tsx', `await site.client.create(site.config.tables['orders'] ?? 'orders', {\n  name,\n  order_lines: lines.map((l) => ({ product_id: l.id, quantity: l.qty })),\n});`);
    const found = messages(ORDERS);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('customer: makes a row of "orders" with client.create, and access.json asks for at least 1 row of "order_lines" with each one.');
    expect(found[0]).toContain('PUBLIC_WRITE_REFUSED, "too-few"');
    expect(found[0]).toContain('client.createTree(ref, { values: { … }, children: { order_lines: [{ values: { product_id, quantity } }] } })');
    // An entry that declares `expect` is told to quote first; one that does not is never told to send it (it would be refused).
    expect(found[0]).not.toContain('expect');
    write('customer/src/pages/cart.tsx', `await client.createWithRank(config.tables['orders'] ?? 'orders', { name });`);
    expect(messages({ ...ORDERS, publicAccess: [{ ...ORDERS.publicAccess[0], expect: { total: 'total' } }] })[0]).toContain(', expect: { total } (the total from client.quote(ref, { values, children }) first)');
    // The table named as the starter and the guides name it: through a name held, and a name in capitals.
    for (const named of [
      `const ORDERS = 'orders';\nconst orders = config.tables[ORDERS] ?? ORDERS;\nawait client.create(orders, { name });`,
      `const orders = loaded.value.tables.orders;\nawait client.create<Order>(orders, { name });`,
      `await client.create('orders', { name });`,
      // A table this cannot read (a prop), told by the child's own name among what is sent.
      `export function Checkout({ ordersRef }) {\n  return client.create(ordersRef, { name, order_lines: lines });\n}`,
    ]) {
      write('customer/src/pages/cart.tsx', named);
      expect(messages(ORDERS).filter((line) => line.includes('order_lines')), named).toHaveLength(1);
    }
    // A table this cannot read and nothing that says: said of the side, once, when no screen sends a tree at all.
    write('customer/src/pages/cart.tsx', `export function Checkout({ ordersRef }) {\n  return client.create(ordersRef, { name });\n}`);
    expect(messages(ORDERS)).toEqual([expect.stringContaining('never calls client.createTree, and access.json lets customers make a row of "orders" and asks for at least 1 row of "order_lines" with each one.')]);
    // Fine: the tree write, a create of another table, an entry that asks for no child, a staff screen, and what only looks like a create.
    for (const fine of [
      `await client.createTree(config.tables['orders'] ?? 'orders', { values: { name }, children: { order_lines: lines } });`,
      `await client.create(config.tables['messages'] ?? 'messages', { body });`,
      `const el = document.createElement('orders'); const o = Object.create(null); await things.createOrder('orders', {});`,
      `export function Checkout({ ordersRef }) {\n  client.create(ordersRef, { name });\n  return client.createTree(ordersRef, { values: { name }, children: { order_lines: lines } });\n}`,
    ]) {
      write('customer/src/pages/cart.tsx', fine);
      expect(messages(ORDERS), fine).toEqual([]);
    }
    write('customer/src/pages/cart.tsx', `await client.create(config.tables['orders'] ?? 'orders', { name });`);
    expect(messages({ ...ORDERS, publicAccess: [{ table: 'orders', methods: ['POST'], writable: ['name'], children: { order_lines: { via: 'order_id', writable: ['quantity'], min: 0, max: 40 } } }] })).toEqual([]);
    rmSync(join(root, 'apps', 'cakes', 'customer'), { recursive: true });
    write('staff/src/Desk.tsx', `await loaded.value.create('orders', { name });`);
    expect(messages(ORDERS)).toEqual([]);
  });

  it('says when an event’s currentTarget is read after the handler has let go: the send worked, and the visitor is told it failed', () => {
    // As the walk's contact page wrote it: the message was saved (201), `event.currentTarget.reset()` threw, and the page said "Something went wrong".
    const broken = `async function send(event: FormEvent<HTMLFormElement>) {\n  event.preventDefault();\n  const form = new FormData(event.currentTarget);\n  try {\n    await client.create(messagesRef, { body: String(form.get('body')) });\n    event.currentTarget.reset();\n    setStatus('ok');\n  } catch (error) {\n    setStatus('failed');\n  }\n}`;
    expect(currentTargetAfterAwait(broken)).toBe('event');
    write('customer/src/pages/contact.tsx', broken);
    expect(messages()).toEqual([expect.stringContaining('customer: reads event.currentTarget after the handler has let go (after an await, or in a callback that runs later).')]);
    expect(messages()[0]).toContain('const form = event.currentTarget; then use form (form.reset(), new FormData(form)).');
    // A staff screen is told the same.
    write('staff/src/Desk.tsx', broken.replace(/\bevent\b/g, 'e'));
    expect(messages().map((line) => line.split(':')[0])).toEqual(['customer', 'staff']);
    // Later by another way: a promise's callback, a timer, a state updater.
    for (const later of [
      `function send(e) {\n  client.create(ref, {}).then(() => e.currentTarget.reset());\n}`,
      `function onChange(e) {\n  setTimeout(() => { setValue(e.currentTarget.value); }, 200);\n}`,
      `const view = <input onChange={(e) => setForm((prev) => ({ ...prev, [e.currentTarget.name]: e.currentTarget.value }))} />;`,
      `const send = async (ev) => {\n  await save();\n  rows.forEach((row) => mark(row, ev.currentTarget));\n};`,
    ]) {
      expect(currentTargetAfterAwait(later), later).not.toBeNull();
    }
    // Fine: read before the wait, read in the very call that waits, kept in a name first, an await that belongs to a
    // function inside the handler, another function's own event, and the words in a comment or a sentence.
    for (const fine of [
      `async function send(event) {\n  const form = event.currentTarget;\n  await client.create(ref, new FormData(form));\n  form.reset();\n}`,
      `async function send(event) {\n  event.preventDefault();\n  await client.create(ref, Object.fromEntries(new FormData(event.currentTarget)));\n}`,
      `function onChange(e) {\n  const save = async (v) => { await client.update('x', '1', { v }); };\n  void save(e.currentTarget.value);\n}`,
      `async function load() {\n  await client.list(ref);\n}\nfunction onChange(e) {\n  setValue(e.currentTarget.value);\n}`,
      `async function send(event) {\n  await save();\n  return <input onChange={(e) => setValue(e.currentTarget.value)} />;\n}`,
      `async function send(event) {\n  await save();\n  // event.currentTarget is gone by now\n  setNote('event.currentTarget is cleared after an await');\n}`,
      `function onChange(e) {\n  setValue(e.currentTarget.value);\n  rows.map((row) => row.id === e.currentTarget.name);\n}`,
      `async function send(event) {\n  if (event.currentTarget.checkValidity()) await save();\n}`,
    ]) {
      expect(currentTargetAfterAwait(fine), fine).toBeNull();
    }
  });
});
