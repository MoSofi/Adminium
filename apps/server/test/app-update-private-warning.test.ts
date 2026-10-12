// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own update is the one way a private table's mark comes off. So
 * the plan of an update that takes it off says so, before anything is
 * written: the rows were read only by the people each belongs to, and will
 * be read by every role that holds the table.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string) => ({ ref, type: 'text', maxLength: 36, nullable: true, rules: { staff: true } });
const manifest = (version: string, keepPrivate: boolean): Record<string, unknown> => ({
  ...invoicingManifest([
    { ref: 'notes', ...(keepPrivate ? { private: true } : {}), belongs: [{ column: 'manager_id' }, { column: 'rep_id' }], indexes: [['manager_id'], ['rep_id']], columns: [id, staff('manager_id'), staff('rep_id'), { ref: 'text', type: 'text', maxLength: 200 }] },
    { ref: 'plain', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
  ]),
  version,
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-plain', template: 'page-crud', title: { key: 't', fallback: 'Plain' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'plain' } }],
});

describe('an update that stops keeping a table private', () => {
  let h: InvoicingHarness;
  afterAll(async () => {
    await h?.close();
  });

  const planOf = async (doc: Record<string, unknown>) => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(doc), 'staff/index.html': '<!doctype html><html><body></body></html>' });
    const staged = await h.app.inject({ method: 'POST', url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
    expect(staged.statusCode, staged.body).toBe(200);
    const plan = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: doc['key'], version: doc['version'], connectionId: h.connectionId } });
    expect(plan.statusCode, plan.body).toBe(200);
    return ((plan.json() as { plan: { ruleWarnings?: { table: string; message: string }[] } }).plan.ruleWarnings ?? []).filter((warning) => warning.message.includes('private'));
  };

  it('says so in the plan, by table, and says nothing while the mark stays', async () => {
    h = await installInvoicing('sqlite', manifest('0.2.0', true));
    expect(await planOf(manifest('0.2.1', true))).toEqual([]);
    const warned = await planOf(manifest('0.2.2', false));
    expect(warned).toEqual([{ table: 'notes', column: '', message: 'This version no longer keeps "notes" private. Its rows, read until now only by the people each belongs to, will be read by every role that is given the table.' }]);
  }, 240_000);
});
