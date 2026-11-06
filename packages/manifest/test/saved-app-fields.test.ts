// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a file saved from a dashboard may carry beside an ordinary app: a
 * page's envelope, its shared views and the file's provenance (a self-made
 * app's only), and the fields every app may use to describe a hand-built
 * dashboard's tables, links, answers and mails. Each is a word with a floor,
 * so an older Adminium says "needs Adminium 0.3.49" instead of failing.
 */
import { describe, expect, it } from 'vitest';

import {
  EMAIL_BRAND_MARKS,
  INSTALL_FLOOR_WORD_NAMES,
  WORD_FLOORS,
  installFloorWords,
  planInstall,
  savedAppIssues,
  validateManifest,
  type Manifest,
  type PlanContext,
  type SchemaModelView,
} from '../src/index.js';

type Doc = Record<string, unknown>;

const page = (over: Doc = {}): Doc => ({ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' }, ...over });

/** A self-made shop: customers and their orders. */
function shop(over: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'total', type: 'decimal', scale: 2, precision: 10 },
            { ref: 'opens_at', type: 'time', nullable: true },
            { ref: 'gift', type: 'int', yesNo: true, nullable: true },
            { ref: 'note', type: 'text', nullable: true, hidden: true },
          ],
        },
      ],
    },
    pages: [page()],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...over,
  };
}

const tableOf = (m: Doc, ref: string): Doc => ((m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === ref) as Doc);
const columnOf = (m: Doc, table: string, ref: string): Doc => ((tableOf(m, table)['columns'] as Doc[]).find((c) => c['ref'] === ref) as Doc);
const local = (m: Doc) => validateManifest(m, { allowLocalPublisher: true });
const issues = (m: Doc): string => {
  const result = local(m);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

const ENVELOPE = { v: 1, kind: 'crud', template: 'page-crud', config: { columns: [{ column: 'total', width: 120 }], pageSize: 50 } };
const VIEWS = [
  { v: 1, kind: 'filters', name: 'Open orders', isDefault: true, config: { filters: [{ column: 'total', op: 'gt', value: 0 }] } },
  { v: 1, kind: 'filters', name: 'Big ones', config: { sort: { column: 'total', dir: 'desc' } } },
];
const PROVENANCE = { lineage: 'lin_8f2kq1x9a0', savedAt: '2026-11-05T10:00:00Z', adminiumVersion: '0.3.49', label: 'Before the summer menu', workspaces: ['Fernhill'] };

describe('a self-made app\'s page envelope, views and provenance', () => {
  it('are taken from a self-made app', () => {
    const m = shop({ pages: [page({ bindings: { rows: 'orders' }, envelope: ENVELOPE, views: VIEWS })], provenance: PROVENANCE });
    expect(issues(m)).toBe('');
    const validated = local(m);
    expect(validated.ok && validated.manifest.kind === 'app' ? validated.manifest.provenance?.lineage : null).toBe('lin_8f2kq1x9a0');
  });

  it('are refused on an app of any other publisher, and on an add-on', () => {
    const catalogue = shop({ publisher: { id: 'adminium', name: 'Adminium' }, pages: [page({ envelope: ENVELOPE, views: VIEWS })], provenance: PROVENANCE });
    const text = issues(catalogue);
    expect(text).toContain('pages.0.envelope: "envelope" is carried only by a self-made app');
    expect(text).toContain('pages.0.views: "views" is carried only by a self-made app');
    expect(text).toContain('provenance: "provenance" is carried only by a self-made app');
    // Without the door that lets a self-made app in at all, the publisher is refused first.
    const shut = validateManifest(shop({ provenance: PROVENANCE }));
    expect(shut.ok).toBe(false);
    expect(shut.ok ? [] : shut.issues.map((issue) => issue.path)).toContain('publisher.id');
    // An add-on's page is never a self-made one.
    expect(savedAppIssues({ kind: 'add-on', publisher: { id: 'adminium' }, pages: [{ ref: 'kit', template: 'page-crud', envelope: { template: 'page-crud' } }] })).toEqual([
      { path: ['pages', 0, 'envelope'], message: '"envelope" is carried only by a self-made app (publisher "local")' },
    ]);
  });

  it('keep an envelope to its page: its template, and no config beside it', () => {
    expect(issues(shop({ pages: [page({ envelope: { ...ENVELOPE, template: 'page-board' } })] }))).toContain('the envelope\'s template is the page\'s own ("page-crud")');
    expect(issues(shop({ pages: [page({ envelope: ENVELOPE, config: { pageSize: 10 } })] }))).toContain('a page with an envelope carries its config there');
    // What the target makes its own is never in the file.
    expect(issues(shop({ pages: [page({ envelope: { ...ENVELOPE, id: 'page_1', source: { connectionId: 'conn_1', table: 'public.orders' } } })] }))).toContain('Unrecognized key');
    expect(issues(shop({ pages: [page({ envelope: { ...ENVELOPE, width: 'wide', padding: 'none' } })] }))).toBe('');
  });

  it('name each view once, with one default of each kind', () => {
    expect(issues(shop({ pages: [page({ views: [VIEWS[0], VIEWS[0]] })] }))).toContain('a page names each view once');
    expect(issues(shop({ pages: [page({ views: [VIEWS[0], { ...VIEWS[1], isDefault: true }] })] }))).toContain('one default view of each kind');
    // A default list view and a default layout may stand together.
    expect(issues(shop({ pages: [page({ views: [VIEWS[0], { v: 1, kind: 'layout', name: 'Mine', isDefault: true, config: { widgetState: {} } }] })] }))).toBe('');
    expect(issues(shop({ pages: [page({ views: [{ ...VIEWS[0], kind: 'personal' }] })] }))).toContain('views.0.kind');
  });

  it('say where the file was saved in a closed shape', () => {
    expect(issues(shop({ provenance: { ...PROVENANCE, lineage: 'x' } }))).toContain('a lineage is 8 to 64');
    expect(issues(shop({ provenance: { ...PROVENANCE, savedAt: 'yesterday' } }))).toContain('provenance.savedAt');
    expect(issues(shop({ provenance: { ...PROVENANCE, adminiumVersion: 'latest' } }))).toContain('an Adminium version');
    expect(issues(shop({ provenance: { ...PROVENANCE, connectionId: 'conn_1' } }))).toContain('Unrecognized key');
    const { label: _label, workspaces: _workspaces, ...bare } = PROVENANCE;
    expect(issues(shop({ provenance: bare }))).toBe('');
  });
});

describe('the fields a dashboard\'s tables are described with', () => {
  it('take a time of day, a decimal\'s digits, a hidden column and an int read as a yes or a no', () => {
    expect(issues(shop())).toBe('');
  });

  it('keep each to the columns it fits', () => {
    const m = shop();
    columnOf(m, 'orders', 'note')['precision'] = 8;
    expect(issues(m)).toContain('precision applies to a decimal or money column only');
    const n = shop();
    columnOf(n, 'orders', 'total')['precision'] = 1;
    expect(issues(n)).toContain('at least the places after the point');
    const p = shop();
    // No scale: the column keeps four places, so four digits in all is the least.
    Object.assign(columnOf(p, 'orders', 'total'), { scale: undefined, precision: 3 });
    expect(issues(p)).toContain('4 when scale gives none');
    Object.assign(columnOf(p, 'orders', 'total'), { precision: 4 });
    expect(issues(p)).toBe('');
    const q = shop();
    Object.assign(columnOf(q, 'orders', 'gift'), { type: 'bool' });
    expect(issues(q)).toContain('a bool column is one already');
    const r = shop();
    columnOf(r, 'orders', 'opens_at')['default'] = '09:00';
    expect(issues(r)).toContain('a time column takes no default');
  });

  it('describe a link: its name, that Adminium does not show it, or that no foreign key keeps it', () => {
    const relation = (value: unknown) => {
      const m = shop();
      columnOf(m, 'orders', 'customer_id')['relation'] = value;
      return issues(m);
    };
    expect(relation({ label: 'Buyer' })).toBe('');
    expect(relation({ constraint: false, label: 'Buyer' })).toBe('');
    expect(relation({ remove: true })).toBe('');
    expect(relation({})).toContain('a relation says label, remove or constraint');
    expect(relation({ remove: true, label: 'Buyer' })).toContain('remove alone');
    expect(relation({ remove: true, constraint: false })).toContain('remove alone');
    expect(relation({ constraint: true })).toContain('relation.constraint');
    const m = shop();
    columnOf(m, 'orders', 'total')['relation'] = { label: 'x' };
    expect(issues(m)).toContain('an fk column only');
  });

  it('mark a table left out, a people table\'s existing customers, and postings kept switched off', () => {
    const excluded = shop();
    tableOf(excluded, 'orders')['exclude'] = true;
    expect(issues(excluded)).toContain('pages.0.bindings.rows: "orders" is left out of Adminium (exclude)');
    const kept = shop();
    tableOf(kept, 'customers')['exclude'] = true;
    expect(issues(kept)).toBe('');

    expect(savedAppIssues({ kind: 'app', publisher: { id: 'local' }, requiredSchema: { tables: [{ ref: 'customers', existingCustomers: true }] } })).toEqual([
      { path: ['requiredSchema', 'tables', 0, 'existingCustomers'], message: 'existing customers are a people table\'s: list "customers" in people' },
    ]);
    expect(savedAppIssues({ kind: 'app', publisher: { id: 'local' }, people: [{ table: 'customers' }], requiredSchema: { tables: [{ ref: 'customers', existingCustomers: true }] } })).toEqual([]);

    const switched = (off: Doc, table: Doc = {}) => savedAppIssues({ kind: 'app', publisher: { id: 'local' }, requiredSchema: { tables: [{ ref: 'orders', switchedOff: off, ...table }] } }).map((issue) => issue.message);
    expect(switched({ postings: ['line'] }, { postings: [{ id: 'line' }] })).toEqual([]);
    expect(switched({ postings: ['gone'] }, { postings: [{ id: 'line' }] })).toEqual(['"gone" is not a posting of "orders"']);
    expect(switched({ adjust: true })).toEqual(['"orders" has no price rule (adjust) to switch off']);
    expect(switched({ adjust: true }, { adjust: { uses: 'offers' } })).toEqual([]);
    const m = shop();
    tableOf(m, 'orders')['switchedOff'] = {};
    expect(issues(m)).toContain('a switch names postings, adjust, or both');
  });

  it('give an answer a line under it', () => {
    const m = shop({ optionLists: { sizes: { label: 'Sizes', values: [{ value: 's', label: 'Small', description: 'Up to 250 ml' }] } } });
    expect(issues(m)).toBe('');
    const long = shop({ optionLists: { sizes: { label: 'Sizes', values: [{ value: 's', description: 'x'.repeat(513) }] } } });
    expect(issues(long)).toContain('optionLists.sizes.values.0.description');
  });
});

describe('a self-made app\'s icon', () => {
  it('is a lucide name a self-made app carries, and nothing else', () => {
    const validated = local(shop({ icon: 'shopping-bag' }));
    expect(validated.ok && validated.manifest.kind === 'app' ? validated.manifest.icon : null).toBe('shopping-bag');
    expect(issues(shop({ icon: 'coffee' }))).toBe('');
    for (const bad of ['Coffee', 'shopping_bag', 'cup--soda', '-leaf', '<svg>', 'x'.repeat(61)]) expect(issues(shop({ icon: bad })), bad).toContain('icon');
    expect(issues(shop({ publisher: { id: 'adminium', name: 'Adminium' }, icon: 'coffee' }))).toContain('icon: "icon" is carried only by a self-made app');
  });

  it('is read from 0.3.49, and found where the file writes it', () => {
    expect(WORD_FLOORS['app.icon']).toBe('0.3.49');
    expect(installFloorWords(shop({ icon: 'leaf' })).filter((word) => word.word === 'app.icon')).toEqual([{ word: 'app.icon', path: 'icon' }]);
    expect(issues(shop({ icon: 'leaf', compatibility: { minAdminiumVersion: '0.3.48' } }))).toContain('"app.icon" is read by Adminium 0.3.49');
  });
});

describe('an app\'s mail: its kind, what it is for, its brand, the files it carries', () => {
  const template = (over: Doc = {}): Doc => ({
    key: 'shop-news',
    name: 'News',
    locales: { 'en-US': { subject: 'News', blocks: [{ block: 'email.text', data: { text: 'Hello' } }] } },
    ...over,
  });
  const BRAND = { name: 'Shop', mark: 'leaf', accent: '#1f7a4d', fromName: 'The shop', fromEmail: 'hello@shop.test' };

  it('are taken in the template store\'s own words', () => {
    expect(issues(shop({ emailTemplates: [template({ kind: 'campaign', category: 'marketing', brand: BRAND, attachments: [{ file: 'emails/terms.pdf' }] })] }))).toBe('');
    expect(EMAIL_BRAND_MARKS).toContain('logo');
  });

  it('refuse a brand outside the store\'s shape and a file outside the package', () => {
    expect(issues(shop({ emailTemplates: [template({ brand: { ...BRAND, accent: 'green' } })] }))).toContain('a six-digit hex colour');
    expect(issues(shop({ emailTemplates: [template({ brand: { ...BRAND, mark: 'rocket' } })] }))).toContain('emailTemplates.0.brand.mark');
    for (const file of ['../secrets.txt', '/etc/passwd', 'emails/../../x', 'emails/./a.pdf', 'a b.pdf']) {
      expect(issues(shop({ emailTemplates: [template({ attachments: [{ file }] })] })), file).toContain('a file of the package');
    }
    expect(issues(shop({ emailTemplates: [template({ attachments: Array.from({ length: 21 }, (_, i) => ({ file: `f${String(i)}.pdf` })) })] }))).toContain('emailTemplates.0.attachments');
    expect(issues(shop({ emailTemplates: [template({ category: 'news' })] }))).toContain('emailTemplates.0.category');
  });

  it('never call a mail the outbox or a rule sends a campaign', () => {
    const sent = savedAppIssues({
      kind: 'app',
      publisher: { id: 'local' },
      emailTemplates: [{ key: 'shop-news', kind: 'campaign' }, { key: 'shop-receipt', kind: 'campaign' }, { key: 'shop-other', kind: 'template' }],
      outbox: { kinds: { receipt: 'shop-receipt' } },
      automations: [{ graph: { nodes: [{ action: { kind: 'email', templateKey: 'shop-news' } }] } }],
    });
    expect(sent.map((issue) => issue.path)).toEqual([
      ['emailTemplates', 0, 'kind'],
      ['emailTemplates', 1, 'kind'],
    ]);
    expect(savedAppIssues({ kind: 'app', publisher: { id: 'local' }, emailTemplates: [{ key: 'shop-news', kind: 'campaign' }], automations: [{ nodes: 'nothing' }] })).toEqual([]);
  });
});

describe('the words and their floor', () => {
  const NEW = [
    'page.envelope',
    'page.views',
    'app.provenance',
    'app.icon',
    'column.time',
    'column.precision',
    'column.hidden',
    'column.yesNo',
    'relation.label',
    'relation.remove',
    'relation.noConstraint',
    'table.exclude',
    'table.existingCustomers',
    'table.switchedOff',
    'optionList.description',
    'email.kind',
    'email.category',
    'email.brand',
    'email.attachments',
  ] as const;

  it('are each a word read from 0.3.49', () => {
    for (const word of NEW) {
      expect(INSTALL_FLOOR_WORD_NAMES).toContain(word);
      expect(WORD_FLOORS[word], word).toBe('0.3.49');
    }
  });

  it('are found where the document writes them', () => {
    const m = shop({
      provenance: PROVENANCE,
      icon: 'coffee',
      pages: [page({ envelope: ENVELOPE, views: VIEWS })],
      optionLists: { sizes: { label: 'Sizes', values: [{ value: 's', description: 'Small' }] } },
      emailTemplates: [{ key: 'shop-news', kind: 'campaign', category: 'marketing', brand: {}, attachments: [], locales: {} }],
    });
    const orders = tableOf(m, 'orders');
    Object.assign(orders, { exclude: true, existingCustomers: true, switchedOff: { adjust: true } });
    columnOf(m, 'orders', 'customer_id')['relation'] = { label: 'Buyer', remove: true, constraint: false };
    const found = installFloorWords(m).filter((word) => (NEW as readonly string[]).includes(word.word));
    expect(found.map((word) => word.word).sort()).toEqual([...NEW].sort());
    expect(found.find((word) => word.word === 'column.time')?.path).toBe('requiredSchema.tables.1.columns.3.type');
    expect(found.find((word) => word.word === 'relation.noConstraint')?.path).toBe('requiredSchema.tables.1.columns.1.relation.constraint');
    expect(found.find((word) => word.word === 'optionList.description')?.path).toBe('optionLists.sizes.values.0.description');
    expect(found.find((word) => word.word === 'page.views')?.path).toBe('pages.0.views');
    // A page with neither, and a column with none of them, name none.
    expect(installFloorWords({ kind: 'app', pages: [{ ref: 'x', template: 'page-crud' }], requiredSchema: { tables: [{ ref: 't', columns: [{ ref: 'a', type: 'int' }, 'nonsense'] }, 'nonsense'] } })).toEqual([]);
  });

  it('raise the floor: an app that says an older one is told the release that reads them', () => {
    const old = shop({ compatibility: { minAdminiumVersion: '0.3.45' }, provenance: PROVENANCE });
    const text = issues(old);
    expect(text).toContain('"column.time" is read by Adminium 0.3.49 and later, and compatibility.minAdminiumVersion is 0.3.45');
    expect(text).toContain('"app.provenance" is read by Adminium 0.3.49');
  });
});

describe('the plan of a dashboard\'s tables', () => {
  const ctx: PlanContext = { prefix: null, records: { orders: { table: 'orders', state: 'created', owned: true }, customers: { table: 'customers', state: 'created', owned: true } }, others: [], dialect: 'postgres' };
  const col = (ref: string, over: Doc = {}) => ({ ref, nullable: true, ...over });
  const id = col('id', { isPrimaryKey: true, logicalType: 'integer', isIdentity: true, nullable: false });
  const live = (orders: Doc[]): SchemaModelView => ({
    tables: [
      { ref: 'customers', columns: [id, col('name', { logicalType: 'varchar', maxLength: 80 })] },
      { ref: 'orders', columns: [id, ...orders] },
    ],
  } as unknown as SchemaModelView);
  const ORDERS = [
    col('customer_id', { logicalType: 'integer', linksTo: null }),
    col('total', { logicalType: 'decimal' }),
    col('opens_at', { logicalType: 'time' }),
    col('gift', { logicalType: 'integer' }),
    col('note', { logicalType: 'text' }),
  ];
  const plan = (m: Doc, orders: Doc[] = ORDERS) => planInstall(local(m).ok ? (local(m) as { manifest: Manifest }).manifest : (m as unknown as Manifest), live(orders), ctx);

  it('reuses a time column, a text column that holds one, and nothing else', () => {
    const reused = plan(shop());
    expect(reused.problems).toEqual([]);
    expect(plan(shop(), ORDERS.map((c) => (c.ref === 'opens_at' ? { ...c, logicalType: 'varchar', maxLength: 8 } : c))).problems).toEqual([]);
    const clash = plan(shop(), ORDERS.map((c) => (c.ref === 'opens_at' ? { ...c, logicalType: 'integer' } : c)));
    expect(clash.problems.map((p) => p.code)).toEqual(['COLUMN_TYPE_CONFLICT']);
  });

  it('gives a link no foreign key keeps none, and links a plain one', () => {
    const linked = plan(shop()).tables?.find((t) => t.ref === 'orders')?.edits;
    expect(linked).toEqual([{ kind: 'add-link', column: 'customer_id', to: 'customers' }]);
    const m = shop();
    columnOf(m, 'orders', 'customer_id')['relation'] = { constraint: false };
    expect(plan(m).tables?.find((t) => t.ref === 'orders')?.edits).toEqual([]);
  });
});
