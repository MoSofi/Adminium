// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RECORD PAGE'S BUTTONS SURVIVE THE TRIP from a manifest to what a page
 * reads: stored with every key they were written with, a child table by its
 * real id, each label keyed the way Adminium's locales are, read back whole.
 * And a manifest that uses them — or a role's grant on an add-on's table, a
 * look-up, tab words, a bulk action, a second toolbar link — is refused by a
 * server that reads those words and does not run them yet.
 */
import type { Manifest } from '@adminium/manifest';
import { validateOverrideInput, type SchemaOverride } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { statesRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { MANIFEST_WORDS_RUN, UNBUILT_MANIFEST_WORDS, unbuiltInManifest } from '../src/crud/unbuilt-rules.js';
import { CARD_ACTIONS, DESK, DESK_HOST } from '../../../packages/manifest/test/desk-fixture.js';
import { addOnHarness, type Harness as AddOnHarness } from './app-add-ons.helpers.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installHarness, type Harness } from './app-install-harness.js';
import { manifestOf, modelOf, store } from './rule-round-trip.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into a manifest freely
type Doc = Record<string, any>;

const KIT = manifestOf(structuredClone(DESK));
const tables = KIT.requiredSchema!.tables;
const stored = store(KIT, 'desk_', expect);
const base = modelOf(tables, 'desk_');
const id = (ref: string) => `public.desk_${ref}`;
const row = stored.rows.find((candidate) => candidate.op === 'table.states' && candidate.tableName === id('cards')) as SchemaOverride;
const actions = (row.value as { actions: Doc[] }).actions;

describe('the stored buttons of a record page', () => {
  it('keep every key they are handed: the child table by its real id, each label by locale', () => {
    expect(row.value).toEqual(stored.sent.get('table.states|cards|'));
    expect(actions).toEqual([
      { ...CARD_ACTIONS[0], label: { en_US: 'Activate', de_DE: 'Aktivieren' } },
      { ...CARD_ACTIONS[1], confirm: { en_US: 'Send it once more?' } },
      CARD_ACTIONS[2],
      { ...CARD_ACTIONS[3], child: { ...CARD_ACTIONS[3].child, table: id('card_actions') } },
    ]);
    // Every key the four forms have is in the fixture, so none can be dropped unseen.
    expect(actions.map((action) => Object.keys(action).sort())).toEqual([
      ['ask', 'confirm', 'id', 'label', 'move', 'set', 'tone'],
      ['ask', 'confirm', 'id', 'in', 'label', 'set', 'tone'],
      ['id', 'in', 'label', 'link', 'tone'],
      ['child', 'confirm', 'id', 'in', 'label', 'set', 'tone'],
    ]);
    expect(Object.keys(actions[2]!['link'] as Doc).sort()).toEqual(['addOnPage', 'param']);
    expect(Object.keys(actions[3]!['child'] as Doc).sort()).toEqual(['form', 'table', 'via']);
  });

  it('are read back whole on the table', () => {
    const table = applyOverrides(base, stored.rows).tables.find((candidate) => candidate.id === id('cards'))!;
    expect(table.states?.actions).toEqual(actions);
    expect(statesRuleIssue(row.value, base.tables.find((candidate) => candidate.id === id('cards'))!, base)).toBeNull();
  });

  it('a link to a generated page keeps its page', () => {
    const doc = structuredClone(DESK) as Doc;
    doc.requiredSchema.tables[0].states.actions[2].link = { page: 'desk-cards', param: 'card' };
    const again = store(manifestOf(doc), 'desk_', expect).rows.find((candidate) => candidate.op === 'table.states')!;
    expect((again.value as { actions: Doc[] }).actions[2]!['link']).toEqual({ page: 'desk-cards', param: 'card' });
  });

  it('what a button sets is never read as a table, whatever its column is called', () => {
    const doc = structuredClone(DESK) as Doc;
    doc.requiredSchema.tables[1].columns.push({ ref: 'table', type: 'text', maxLength: 40, nullable: true });
    doc.requiredSchema.tables[0].states.actions[3].set = { action: 'top_up', table: 'counter' };
    const again = store(manifestOf(doc), 'desk_', expect).rows.find((candidate) => candidate.op === 'table.states')!;
    expect((again.value as { actions: Doc[] }).actions[3]!['set']).toEqual({ action: 'top_up', table: 'counter' });
  });

  it('the store refuses a key it does not know, in every form', () => {
    const refused = (change: (list: Doc[]) => void) => {
      const list = structuredClone(actions);
      change(list);
      return () => validateOverrideInput({ connectionId: 'cnx', op: 'table.states', tableName: id('cards'), columnName: null, value: { ...row.value, actions: list } });
    };
    expect(refused(() => undefined)).not.toThrow();
    expect(refused((list) => { list[0]!['colour'] = 'red'; })).toThrow();
    expect(refused((list) => { list[1]!['colour'] = 'red'; })).toThrow();
    expect(refused((list) => { list[2]!['link'].colour = 'red'; })).toThrow();
    expect(refused((list) => { list[3]!['child'].colour = 'red'; })).toThrow();
    expect(refused((list) => { list[0]!['move'].colour = 'red'; })).toThrow();
    expect(refused((list) => { list[0]!['set'].activated_at = { now: true, colour: 'red' }; })).toThrow();
    expect(refused((list) => { list[0]!['tone'] = 'loud'; })).toThrow();
  });
});

describe('the words a server reads and does not run yet', () => {
  const NEW = ['toolbar.links', 'roles.tables'] as const;
  const found = (doc: unknown) => unbuiltInManifest(doc).map((word) => `${word.word} ${word.release}`);

  it('each names the release that runs it', () => {
    for (const word of NEW) expect(UNBUILT_MANIFEST_WORDS[word], word).toBe('0.3.18');
    // A record page's buttons are run: nothing is refused for them any more.
    for (const run of ['states.actions', 'addOn.lookUp', 'config.tabs', 'config.bulk'] as const) {
      expect(UNBUILT_MANIFEST_WORDS[run], run).toBeUndefined();
      expect(MANIFEST_WORDS_RUN, run).toContain(run);
    }
    expect(found(DESK).some((word) => word.startsWith('states.actions'))).toBe(false);
    expect(found(DESK).some((word) => word.startsWith('addOn.lookUp'))).toBe(false);
    // What is left of the desk kit's words for a later release: the last four of a code, kept beside it.
    expect(found(DESK)).toEqual(['column.codeLast4 0.3.19']);
    expect(found(DESK_HOST)).toContain('roles.tables 0.3.18');
    const linked = structuredClone(DESK_HOST) as Doc;
    linked.pages[0].config = { layout: { toolbar: { links: [{ label: 'New sale', href: '/p/sales' }, { label: 'Count', href: '/p/sales', tone: 'primary' }] } } };
    expect(found(linked)).toContain('toolbar.links 0.3.18');
  });

  let open: Harness | null = null;
  let openAddOns: AddOnHarness | null = null;
  afterEach(async () => {
    await open?.close();
    await openAddOns?.close();
    open = null;
    openAddOns = null;
  });

  /** An app's upload, as the marketplace door takes it. */
  async function upload(h: Harness, doc: unknown) {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(doc), 'staff/index.html': '<!doctype html>' });
    return (h.inject as (request: Doc) => ReturnType<Harness['inject']>)({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
  }

  it('an app whose role reaches an add-on\'s table is refused at the upload, and makes no table', async () => {
    const h = (open = await installHarness('sqlite'));
    const staged = await upload(h, DESK_HOST);
    expect(staged.statusCode, staged.body).toBe(422);
    expect(JSON.parse(staged.body)).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.3.18', words: [{ word: 'roles.tables', path: 'roles.0.tables', release: '0.3.18' }] } },
    });
    expect(await h.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'desk_host_%'`)).toEqual([]);
  });

  it('an app whose own table has buttons is taken: its upload and its install go through', async () => {
    const h = (open = await installHarness('sqlite'));
    const plain = structuredClone(DESK_HOST) as Doc;
    delete plain.roles[0].tables;
    delete plain.addOns;
    const sales = plain.requiredSchema.tables[0];
    sales.columns.push({ ref: 'status', type: 'enum', enum: ['open', 'paid'], default: 'open' });
    sales.states = { column: 'status', initial: 'open', moves: { open: ['paid'] }, actions: [{ id: 'pay', label: 'Take payment', move: { to: 'paid' } }] };
    const staged = await upload(h, plain);
    expect(staged.statusCode, staged.body).toBe(200);
    const installed = await h.install(plain as Manifest);
    expect(installed.statusCode, installed.body).toBe(200);
  });

  it('an add-on that uses a word of a later release is still refused at its install, by that word alone', async () => {
    const h = (openAddOns = await addOnHarness('sqlite'));
    await h.stageAddOn(DESK as unknown as Doc, { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'desk', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(422);
    expect(installed.body).toContain('column.codeLast4');
    for (const word of ['states.actions', 'config.tabs', 'config.bulk', 'addOn.lookUp']) expect(installed.body, word).not.toContain(word);
    expect((await h.tableNames()).filter((name) => name.includes('cards'))).toEqual([]);
  });
});
