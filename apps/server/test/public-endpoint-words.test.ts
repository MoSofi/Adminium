// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An availability endpoint answered by an add-on's stock words keeps `words`
 * through every layer it is stored in — the printed definition, the compiled
 * resource, the scope document — and is a widening when it is added. A layer
 * that dropped the key would answer the entry as a plain limit: every row
 * free.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { validateManifest, type AppManifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { planPublicEndpoints } from '../src/apps/manifest-public.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { unbuiltEntryRuleOf, unbuiltInManifest } from '../src/crud/unbuilt-rules.js';
import { wideningOf } from '../src/public-api/derive.js';
import { definitionToResource, endpointIssues, parseDefinition, printDefinition, sourceTable, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { compileScope, publicScopeDocumentSchema, type PublicScopeDocument } from '../src/public-api/scope.js';
import { publicAvailabilityReply } from '../src/routes/public/schema.js';
import { LEDGER_HOST } from '../../../packages/manifest/test/ledger-kit-fixture.js';
import { modelOf } from './rule-round-trip.helpers.js';

const col = (name: string, extra: Record<string, unknown> = {}) => ({ name, logicalType: 'text', ...extra });
const key = col('id', { logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } });
const model = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [{ schema: 'public', name: 'menu_items', primaryKey: ['id'], columns: [key, col('name')] }],
    relations: [],
  }),
) as DatabaseModel;
const view = new SnapshotView('cnx_test', applyOverrides(model, []));

function def(over: Partial<PublicEndpointDefinition> = {}): PublicEndpointDefinition {
  return {
    path: '/menu_items_availability',
    source: 'public.menu_items',
    methods: ['GET'],
    select: ['id'],
    filters: [],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    kind: 'availability',
    words: { add_on: 'inventory', id: 'stock' },
    ...over,
  };
}
const issues = (d: PublicEndpointDefinition) => endpointIssues(d, { ref: d.path.slice(1), view }).map((i) => i.code);

describe('the stored text', () => {
  it('ordered() keeps words', () => {
    const text = printDefinition(def());
    expect(JSON.parse(text)).toMatchObject({ kind: 'availability', words: { add_on: 'inventory', id: 'stock' } });
    const parsed = parseDefinition(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.definition.words).toEqual({ add_on: 'inventory', id: 'stock' });
    expect(printDefinition(parsed.definition)).toBe(text);
  });

  it('answers a table with no limit of its own, and takes nothing that shapes a limit', () => {
    expect(issues(def())).toEqual([]);
    expect(issues(def({ words: undefined }))).toContain('ENDPOINT_AVAILABILITY_NO_LIMIT');
    expect(issues(def({ capacity_rule: 0 }))).toEqual(['ENDPOINT_AVAILABILITY_SHAPE']);
    expect(issues(def({ show_left: { below: 5 } }))).toEqual(['ENDPOINT_AVAILABILITY_SHAPE']);
    expect(issues(def({ kind: undefined, select: ['id', 'name'] }))).toContain('ENDPOINT_AVAILABILITY_SHAPE');
    expect(issues(def({ methods: ['GET', 'POST'] }))).toContain('ENDPOINT_AVAILABILITY_READ_ONLY');
  });
});

describe('the compiled resource and the scope document', () => {
  const resource = definitionToResource('menu_items_availability', def(), ['GET'], sourceTable(view, 'public.menu_items'));

  it('the compiled resource carries words', () => {
    expect(resource.kind).toBe('availability');
    expect(resource.words).toEqual({ addOn: 'inventory', id: 'stock' });
  });

  it('the scope document keeps words', () => {
    const document = publicScopeDocumentSchema.parse({ version: 1, side: 'customer', resources: [resource] });
    expect(document.resources[0]!.words).toEqual({ addOn: 'inventory', id: 'stock' });
    expect(publicScopeDocumentSchema.safeParse({ version: 1, side: 'customer', resources: [{ ...resource, words: { addOn: 'inventory', id: 'stock', left: true } }] }).success).toBe(false);
  });

  it('the compiled scope a request is judged by carries words', () => {
    const compiled = compileScope({ version: 1, side: 'customer', resources: [resource] });
    expect(compiled.byRef.get('menu_items_availability')?.words).toEqual({ addOn: 'inventory', id: 'stock' });
    const plain = compileScope({ version: 1, side: 'customer', resources: [{ ...resource, words: undefined }] });
    expect(plain.byRef.get('menu_items_availability')?.words).toBeUndefined();
  });

  it('adding words to an entry, or changing whose words answer it, is a widening', () => {
    const plain = { ...resource, words: undefined };
    const before = { version: 1, side: 'customer', resources: [plain] } as unknown as PublicScopeDocument;
    const after = publicScopeDocumentSchema.parse({ version: 1, side: 'customer', resources: [resource] });
    expect(wideningOf(before, after).map((w) => [w.ref, w.rows])).toEqual([['menu_items_availability', true]]);
    expect(wideningOf(after, after)).toEqual([]);
    const other = publicScopeDocumentSchema.parse({ version: 1, side: 'customer', resources: [{ ...resource, words: { addOn: 'inventory', id: 'item' } }] });
    expect(wideningOf(after, other).map((w) => w.rows)).toEqual([true]);
  });
});

describe('a manifest entry answered by words', () => {
  it('is stored as the add-on\'s key and the words\' id', () => {
    const doc = { ...structuredClone(LEDGER_HOST), publicAccess: [{ table: 'order_lines', methods: ['GET'], kind: 'availability', words: 'ledger-kit:units-left' }] };
    const validated = validateManifest(doc);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    const manifest = validated.manifest as AppManifest;
    const names = Object.fromEntries(manifest.requiredSchema.tables.map((table) => [table.ref, `ledger_host_${table.ref}`]));
    const hostView = new SnapshotView('cnx_test', applyOverrides(modelOf(manifest.requiredSchema.tables, 'ledger_host_'), []));
    const planned = planPublicEndpoints(manifest, names, hostView);
    const entry = planned.find((endpoint) => endpoint.kind === 'availability');
    expect(entry?.definition?.words).toEqual({ add_on: 'ledger-kit', id: 'units-left' });
    expect(entry?.ref).toBe('ledger_host_order_lines_availability');
  });
});

describe('until words are answered', () => {
  it('a stored entry with words serves nothing, and a manifest that declares one needs the release that answers', () => {
    expect(unbuiltEntryRuleOf(def() as unknown as Record<string, unknown>)).toBe('words');
    expect(unbuiltEntryRuleOf(def({ words: undefined }) as unknown as Record<string, unknown>)).toBeNull();
    const doc = { ...structuredClone(LEDGER_HOST), publicAccess: [{ table: 'order_lines', methods: ['GET'], kind: 'availability', words: 'ledger-kit:units-left' }] };
    expect(unbuiltInManifest(doc).find((found) => found.word === 'availability.words')).toEqual({ word: 'availability.words', path: 'publicAccess.0.words', release: '0.3.18' });
    expect(unbuiltInManifest({ kind: 'add-on', addOn: { words: [{ id: 'stock' }] } })).toEqual([{ word: 'addOn.words', path: 'addOn.words', release: '0.3.18' }]);
  });
});

describe('the reply', () => {
  it('is each row asked about: in, low or out, with what is left only where shown', () => {
    expect(publicAvailabilityReply.safeParse({ data: [{ id: '4', state: 'low', left: 4 }, { id: '9', state: 'out' }, { id: '2', state: 'in' }] }).success).toBe(true);
    expect(publicAvailabilityReply.safeParse({ data: [{ id: '4', state: 'expired' }] }).success).toBe(false);
  });
});
