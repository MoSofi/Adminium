// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A manifest written as parts composes into the document the validator reads,
 * and a problem is said against the part's own file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANIFEST_PART_FIELDS, appManifestSchema, composeManifest, installFloorWords, locateIssue, splitManifest, validateManifest, type ManifestPartFile } from '../src/index.js';
import { LEDGER_HOST } from './ledger-kit-fixture.js';

const json = (value: unknown): string => JSON.stringify(value);

const APP = {
  manifestVersion: 1,
  key: 'repairs',
  name: 'Repairs',
  version: '0.1.0',
  publisher: { id: 'local', name: 'Local' },
  license: 'UNLICENSED',
  description: { key: 'repairs.description', fallback: 'A repair desk.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.0' },
  frontends: [{ side: 'staff', kind: 'none' }],
  prefixed: true,
};
const JOBS = {
  ref: 'jobs',
  columns: [
    { ref: 'id', type: 'id', role: 'pk' },
    { ref: 'title', type: 'text', nullable: true },
  ],
};
const PARTS = {
  ref: 'parts',
  columns: [
    { ref: 'id', type: 'id', role: 'pk' },
    { ref: 'job_id', type: 'fk', references: 'jobs' },
  ],
};
const PAGE = {
  ref: 'jobs',
  template: 'page-crud',
  title: { key: 'repairs.jobs', fallback: 'Jobs' },
  nav: { group: 'manifest:repairs', icon: 'wrench', order: 1 },
  bindings: { main: 'jobs' },
};

function parts(change: Record<string, string | null> = {}): ManifestPartFile[] {
  const files: Record<string, string | null> = {
    'app.json': json(APP),
    'tables/jobs.json': json(JOBS),
    'tables/parts.json': json(PARTS),
    'pages/jobs.json': json(PAGE),
    ...change,
  };
  return Object.entries(files).flatMap(([path, text]) => (text === null ? [] : [{ path, text }]));
}

describe('composing a manifest from its parts', () => {
  it('puts the parts where the manifest has them, and the result validates', () => {
    const composed = composeManifest(
      parts({
        'roles.json': json([{ key: 'repairs-staff', name: 'Repairs staff' }]),
        'settings.json': json([{ key: 'shop_name', type: 'string' }]),
        'sample.json': json({ sampleData: { file: 'seeds/sample.json' } }),
      }),
    );
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.document).toMatchObject({
      key: 'repairs',
      requiredSchema: { prefixed: true, tables: [{ ref: 'jobs' }, { ref: 'parts' }] },
      pages: [{ ref: 'jobs' }],
      roles: [{ key: 'repairs-staff' }],
      settings: [{ key: 'shop_name' }],
      sampleData: { file: 'seeds/sample.json' },
    });
    // `prefixed` is written in app.json and lives under requiredSchema.
    expect(composed.document).not.toHaveProperty('prefixed');
    expect(composed.origin).toEqual({ tables: ['tables/jobs.json', 'tables/parts.json'], pages: ['pages/jobs.json'] });
    const validated = validateManifest(composed.document, { allowLocalPublisher: true });
    expect(validated.ok, JSON.stringify(validated)).toBe(true);
  });

  it('reads the rules an app ships from automations.json, as the array', () => {
    const rule = { key: 'repairs-done', name: 'Done', enabled: false };
    const composed = composeManifest(parts({ 'automations.json': json([rule]) }));
    expect(composed.ok && composed.document['automations']).toEqual([rule]);
  });

  it('leaves an absent part out rather than writing an empty one', () => {
    const composed = composeManifest(parts());
    expect(composed.ok && Object.keys(composed.document).sort()).toEqual(
      ['categories', 'compatibility', 'description', 'frontends', 'key', 'license', 'manifestVersion', 'name', 'pages', 'publisher', 'requiredSchema', 'version'].sort(),
    );
  });

  it('gives the same document whatever order the files arrive in', () => {
    const forward = composeManifest(parts());
    const backward = composeManifest([...parts()].reverse());
    expect(backward).toEqual(forward);
  });

  it('drops an editor’s $schema pointer from a part', () => {
    const composed = composeManifest(parts({ 'tables/jobs.json': json({ $schema: 'https://example.test/table.json', ...JOBS }) }));
    expect(composed.ok && (composed.document['requiredSchema'] as { tables: unknown[] }).tables[0]).toEqual(JOBS);
  });

  it.each([
    ['a file that is no part', { 'acess.json': '{}' }, 'acess.json', /not a manifest part/],
    ['a part that is not JSON', { 'roles.json': '[{' }, 'roles.json', /not valid JSON/],
    ['a table named differently from its ref', { 'tables/Jobs.json': json(JOBS) }, 'tables/Jobs.json', /Name the file jobs\.json/],
    ['a page with no ref', { 'pages/jobs.json': json({ ...PAGE, ref: undefined }) }, 'pages/jobs.json', /has no "ref"/],
    ['a field written in the wrong part', { 'app.json': json({ ...APP, roles: [] }) }, 'app.json', /"roles" is written in roles\.json/],
    ['automations written in app.json', { 'app.json': json({ ...APP, automations: [] }) }, 'app.json', /"automations" is written in automations\.json/],
    ['tables written in app.json', { 'app.json': json({ ...APP, requiredSchema: {} }) }, 'app.json', /one file per table/],
    ['a field a block does not hold', { 'access.json': json({ roles: [] }) }, 'access.json', /"roles" is not written here/],
    ['a block that is not an object', { 'sample.json': '[]' }, 'sample.json', /must be an object/],
    ['no app.json', { 'app.json': null }, 'app.json', /is missing/],
  ])('refuses %s, naming the file', (_name, change, file, message) => {
    const composed = composeManifest(parts(change));
    expect(composed.ok).toBe(false);
    if (composed.ok) return;
    expect(composed.problems).toContainEqual({ file, message: expect.stringMatching(message) });
  });

  it('reports every problem at once', () => {
    const composed = composeManifest(parts({ 'acess.json': '{}', 'roles.json': '[{' }));
    expect(!composed.ok && composed.problems).toHaveLength(2);
  });
});

describe('saying which part a validator issue is in', () => {
  const origin = { tables: ['tables/jobs.json', 'tables/parts.json'], pages: ['pages/jobs.json'] };
  it.each([
    ['requiredSchema.tables.1.columns.1.references', 'tables/parts.json', 'columns.1.references'],
    ['requiredSchema.tables', 'tables/', 'tables'],
    ['requiredSchema.prefixed', 'app.json', 'prefixed'],
    ['pages.0.template', 'pages/jobs.json', 'template'],
    ['pages', 'pages/', ''],
    ['publisher.id', 'app.json', 'publisher.id'],
    ['roles.0.permissions.2', 'roles.json', '0.permissions.2'],
    ['publicAccess.0.table', 'access.json', 'publicAccess.0.table'],
    ['publicKeys.handover', 'access.json', 'publicKeys.handover'],
    ['sampleData.file', 'sample.json', 'sampleData.file'],
    ['addOns.requires.0.key', 'add-ons.json', 'requires.0.key'],
    ['automations.0.trigger', 'automations.json', '0.trigger'],
    ['something.new', 'app.json', 'something.new'],
  ])('%s → %s', (path, file, inner) => {
    expect(locateIssue(origin, path)).toEqual({ file, path: inner });
  });

  it('points a real validator issue at the table file it is in', () => {
    const composed = composeManifest(parts({ 'tables/parts.json': json({ ...PARTS, columns: [{ ref: 'id', type: 'nonsense' }] }) }));
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const validated = validateManifest(composed.document, { allowLocalPublisher: true });
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.issues.map((issue) => locateIssue(composed.origin, issue.path).file)).toContain('tables/parts.json');
  });
});

describe('splitting one manifest into parts', () => {
  /** Tables and pages in ref order, which is the order composing gives them. */
  const inRefOrder = (document: Record<string, unknown>): Record<string, unknown> => {
    const byRef = (list: unknown): unknown[] => [...(list as { ref: string }[])].sort((a, b) => (a.ref < b.ref ? -1 : 1));
    const schema = document['requiredSchema'] as Record<string, unknown>;
    return { ...document, requiredSchema: { ...schema, tables: byRef(schema['tables']) }, pages: byRef(document['pages']) };
  };

  const released = join(import.meta.dirname, 'fixtures', 'released');
  const fixtures = readdirSync(released).filter((name) => name.endsWith('.manifest.json'));

  it('every top-level field of an app manifest has exactly one part', () => {
    // `kind` is implied by the folder (a folder holds an app); `prefixed` is written in app.json and lives under requiredSchema.
    const fields = Object.values(MANIFEST_PART_FIELDS).flat().filter((field) => field !== 'prefixed');
    expect(fields.filter((field, i) => fields.indexOf(field) !== i)).toEqual([]);
    const declared = Object.keys(appManifestSchema.shape).sort();
    expect([...fields].sort()).toEqual(declared);
  });

  it('a manifest using every new word composes back to itself', () => {
    const document = structuredClone(LEDGER_HOST) as unknown as Record<string, unknown> & { requiredSchema: { tables: Record<string, unknown>[] } };
    const actions = [
      { id: 'ready', label: { 'en-US': 'Mark ready' }, move: { to: 'ready' }, tone: 'primary', set: { hold_until: { now: true } } },
      { id: 'list', label: 'Back to the list', link: { page: 'orders', param: 'order' }, in: ['placed'] },
    ];
    const orders = document.requiredSchema.tables[0] as { states: Record<string, unknown> };
    document.requiredSchema.tables[0] = { ...orders, indexes: [['status', 'hold_until']], states: { ...orders.states, actions } };
    const config = {
      tabs: { order_lines: { empty: 'No lines yet', noNew: true } },
      layout: { toolbar: { links: [{ label: 'Count', href: '/p/orders', icon: 'clipboard-check', tone: 'primary' }, { label: 'New', href: '/p/orders', icon: 'plus' }] } },
    };
    const grants = [{ addOn: 'ledger-kit', table: 'accounts', actions: ['read', 'update'], limit: { readable: ['id', 'balance'], writable: ['note'] } }];
    const full = {
      ...document,
      pages: [{ ...(document['pages'] as Record<string, unknown>[])[0], config }],
      roles: [{ key: 'desk', name: 'Desk', permissions: ['table:@orders:read'], tables: grants }],
      sampleData: { file: 'seeds/ledger-host.sample.json', addOns: { 'ledger-kit': { file: 'seeds/ledger-host.ledger-kit.sample.json' } } },
      automations: [
        {
          key: 'ledger-host-cancelled',
          name: { 'en-US': 'Tell the desk', 'de-DE': 'Dem Empfang sagen' },
          enabled: true,
          trigger: { kind: 'record', event: 'updated', table: 'orders', changedColumn: 'status', when: [{ left: { field: 'status' }, op: 'is', right: 'cancelled' }] },
          graph: {
            version: 1,
            nodes: [
              { id: 't', kind: 'trigger', title: 'An order is cancelled' },
              { id: 'n', kind: 'action', title: 'Tell the desk', action: { kind: 'notification', to: { roles: ['desk'] }, title: 'Order {{record.id}} was cancelled' } },
            ],
          },
        },
      ],
    };
    const validated = validateManifest(full);
    expect(validated.ok ? [] : validated.issues).toEqual([]);
    // Every nested word rides the part its table, role or sample already has; `automations` has a part of its own.
    const files = splitManifest(full);
    expect(files.map((file) => file.path)).toContain('automations.json');
    const composed = composeManifest(files);
    expect(composed.ok, JSON.stringify(composed)).toBe(true);
    if (composed.ok) expect(composed.document).toEqual(inRefOrder(full));
    const table = (ref: string) => ((composed.ok ? composed.document['requiredSchema'] : {}) as { tables: Record<string, unknown>[] }).tables.find((candidate) => candidate['ref'] === ref) as Record<string, unknown>;
    expect(table('order_lines')['postings']).toEqual((full.requiredSchema.tables.find((candidate) => candidate['ref'] === 'order_lines') as Record<string, unknown>)['postings']);
    expect(table('orders')['indexes']).toEqual([['status', 'hold_until']]);
    expect((table('orders')['states'] as Record<string, unknown>)['actions']).toEqual(actions);
    const whole = (composed.ok ? composed.document : {}) as { roles: Record<string, unknown>[]; pages: Record<string, unknown>[]; sampleData: unknown };
    expect(whole.roles[0]!['tables']).toEqual(grants);
    expect(whole.pages[0]!['config']).toEqual(config);
    expect(whole.sampleData).toEqual(full.sampleData);
    // The fixture uses the words it says it does: each is one the walker names.
    const words = installFloorWords(full).map((found) => found.word);
    for (const word of ['automations', 'table.postings', 'table.indexes', 'states.actions', 'roles.tables', 'config.tabs', 'toolbar.links', 'sampleData.addOns', 'column.customerKey']) expect(words, word).toContain(word);
  });

  it('has released manifests to try', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('%s composes back to itself', (name) => {
    const document = JSON.parse(readFileSync(join(released, name), 'utf8')) as Record<string, unknown>;
    if (document['kind'] === 'add-on') return;
    const composed = composeManifest(splitManifest(document));
    expect(composed.ok, JSON.stringify(composed)).toBe(true);
    if (composed.ok) expect(composed.document).toEqual(inRefOrder(document));
  });

  it('writes each block to its own file and nothing for a block the manifest lacks', () => {
    const composed = composeManifest(parts({ 'roles.json': json([{ key: 'r', name: 'R' }]) }));
    if (!composed.ok) throw new Error('fixture');
    expect(splitManifest(composed.document).map((file) => file.path).sort()).toEqual(
      ['app.json', 'pages/jobs.json', 'roles.json', 'tables/jobs.json', 'tables/parts.json'].sort(),
    );
  });
});
