// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN EFFECT AN APP ADDS TO A TABLE BUILT ON AN ADD-ON'S SHAPE, through a link
 * the app itself added.
 *
 * A quote's next version names the one it replaces (`replaces_id`, the app's
 * column). The app says: when a quote is sent, the one it replaces is
 * withdrawn. That is the shape's own move of the other row (sent →
 * withdrawn), made in the same write:
 *
 *  - sending version 2 withdraws version 1, and both are written or neither;
 *  - a version 1 the customer accepted in the meantime cannot be withdrawn,
 *    so sending version 2 is refused and version 2 stays a draft;
 *  - a first version, which replaces nothing, is sent as before.
 *
 * On SQLite, Postgres and MySQL, through the write service.
 */
import { readFileSync } from 'node:fs';

import { manifestsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import { appManifest } from './app-add-ons.helpers.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const invoicesAddOn = (): Doc => ({ ...(JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Doc), version: '1.1.0' });

/** A part of the quote shape, spelled out as the app's own table, with what the app adds to its columns and its states. */
function tableOnPart(part: string, ref: string, extra: Doc[] = [], states: (shape: Doc) => Doc = (shape) => shape): Doc {
  const names: Record<string, string> = { document: 'quotes', lines: 'quote_lines' };
  const shape = (invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((one) => one['name'] === 'quote')!;
  const def = (shape['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value])) }),
    };
  });
  return { ref, module: 'selling', builtOn: 'invoices/quote@1', part, columns: [...columns, ...extra], ...(def.states === undefined ? {} : { states: states(mapTableRefs(def.states, map).value as Doc) }) };
}

function crm(): Doc {
  return appManifest('crm', {
    version: '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: { requires: [{ key: 'invoices', range: '>=1.1.0', reason: en('Quotes are made by this add-on.') }] },
    modules: [{ id: 'selling', label: en('Selling'), default: 'always' }],
    requiredSchema: {
      prefixed: true,
      tables: [
        tableOnPart('document', 'quotes', [{ ref: 'replaces_id', type: 'fk', references: 'quotes', nullable: true }], (shape) => ({
          ...shape,
          // The app's own: sending a version withdraws the one it replaces.
          effects: [...((shape['effects'] as unknown[] | undefined) ?? []), { on: { to: 'sent' }, via: 'replaces_id', set: { status: 'withdrawn' } }],
        })),
        tableOnPart('lines', 'quote_lines'),
      ],
    },
    roles: [{ key: 'rep', name: 'Sales rep', modules: ['selling'], permissions: ['table:@quotes:read', 'page:@crm-quotes:view'] }],
    pages: [{ ref: 'crm-quotes', template: 'page-crud', title: { key: 't.crm-quotes', fallback: 'Quotes' }, nav: { group: 'manifest:sample', icon: 'list', order: 1 }, bindings: { rows: 'quotes' }, module: 'selling' }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  });
}

async function invoices(meta: MetaDb): Promise<void> {
  const document = invoicesAddOn();
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

import { validateManifest } from '@adminium/manifest';
it('the fixture is a valid app', () => {
  const result = validateManifest(crm());
  expect(result.ok ? [] : result.issues).toEqual([]);
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's own effect on a table built on a shape, on ${dialect}`, () => {
    let h: InvoicingHarness;
    beforeAll(async () => {
      h = await installInvoicing(dialect, crm(), invoices, {}, { install: { addOns: [{ key: 'invoices', version: '1.1.0' }] } });
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });
    const statusOf = async (key: unknown) => String((await h.rows(`SELECT status FROM ${h.real('quotes')} WHERE id = ${String(key)}`))[0]!['status']);

    /** A quote with one line, ready to send; `replaces` names the version before it. */
    async function quote(replaces?: unknown): Promise<unknown> {
      const w = await writerFor(h);
      const made = await w.create('quotes', replaces === undefined ? {} : { replaces_id: replaces });
      await w.create('quote_lines', { document_id: made['id'], qty: 2, rate: 100 });
      return made['id'];
    }

    it('sending a version withdraws the one it replaces, in the same write', async () => {
      const w = await writerFor(h);
      const v1 = await quote();
      // A first version replaces nothing: it is sent as before.
      await w.update('quotes', v1, { status: 'sent' });
      expect(await statusOf(v1)).toBe('sent');
      const v2 = await quote(v1);
      expect([await statusOf(v1), await statusOf(v2)]).toEqual(['sent', 'draft']);
      await w.update('quotes', v2, { status: 'sent' });
      expect([await statusOf(v1), await statusOf(v2)]).toEqual(['withdrawn', 'sent']);
      // The withdrawn version says when, by the shape's own stamp: it was moved as a move, not written over.
      expect((await h.rows(`SELECT decided_at FROM ${h.real('quotes')} WHERE id = ${String(v1)}`))[0]!['decided_at']).not.toBeNull();
    });

    it('is refused when the replaced version can no longer be withdrawn, and then nothing is written', async () => {
      const w = await writerFor(h);
      const v1 = await quote();
      await w.update('quotes', v1, { status: 'sent' });
      const v2 = await quote(v1);
      // The customer accepts version 1 before version 2 goes out.
      await w.update('quotes', v1, { status: 'accepted' });
      await expect(w.update('quotes', v2, { status: 'sent' })).rejects.toThrow();
      expect([await statusOf(v1), await statusOf(v2)]).toEqual(['accepted', 'draft']);
      // A version that was never sent cannot be withdrawn either: its replacement waits.
      const draft = await quote();
      const next = await quote(draft);
      await expect(w.update('quotes', next, { status: 'sent' })).rejects.toThrow();
      expect([await statusOf(draft), await statusOf(next)]).toEqual(['draft', 'draft']);
    });

    it('a version already withdrawn is left as it is: its replacement is sent', async () => {
      const w = await writerFor(h);
      const v1 = await quote();
      await w.update('quotes', v1, { status: 'sent' });
      await w.update('quotes', v1, { status: 'withdrawn' });
      const v2 = await quote(v1);
      await w.update('quotes', v2, { status: 'sent' });
      expect([await statusOf(v1), await statusOf(v2)]).toEqual(['withdrawn', 'sent']);
    });
  });
}
