// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A code Adminium makes on a column whose name reads like a secret
 * (`link_token`), on every engine: it is made on create and again when the row
 * changes hands, as on any other column — never left empty, and a column that
 * may not be empty never answers with the database's own error — while the
 * column stays a secret: no reply carries it, and nobody writes it by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const app = (name: string, nullable: boolean, secret?: boolean): Record<string, unknown> => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'passes',
  name: 'Passes',
  version: '0.1.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'x' },
  categories: ['crm'],
  compatibility: { minAdminiumVersion: '0.3.1' },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'tickets',
        columns: [
          id,
          { ref: 'pending_email', type: 'text', maxLength: 254, nullable: true },
          {
            ref: name,
            type: 'text',
            maxLength: 16,
            ...(nullable ? { nullable: true } : {}),
            rules: { code: { length: 16, renew: { on: { column: 'pending_email', changed: true } } }, ...(secret === undefined ? {} : { secret }) },
          },
        ],
      },
    ],
  },
  pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'O' }, nav: { group: 'g', icon: 'home', order: 1 } }],
  frontends: [{ side: 'staff', kind: 'spa' }],
});

for (const [name, nullable, secret] of [
  ['door_code', true, undefined],
  ['link_token', true, undefined],
  ['link_token', false, undefined],
  ['link_token', true, false],
] as const) {
  describe.each(LEGS)(`a code on "${name}" (may be empty: ${String(nullable)}, secret said: ${String(secret)}) — %s`, (dialect, available) => {
    let h: InvoicingHarness;
    let w: Awaited<ReturnType<typeof writerFor>>;
    let routes: DataRoutes;
    beforeAll(async () => {
      if (!available) return;
      h = await installInvoicing(dialect, app(name, nullable, secret));
      w = await writerFor(h, 'Europe/London');
      routes = await dataRoutesOver(h, dialect);
    }, 180_000);
    afterAll(async () => {
      if (!available) return;
      await routes.close();
      await h.close();
    });
    const code = async (key: unknown) => (await h.rows(`select ${name} as c from ${h.real('tickets')} where id = ${String(key)}`))[0]!['c'];

    it.runIf(available)('makes a code on create and again when the row changes hands', async () => {
      const made = await w.create('tickets', {});
      const own = await code(made['id']);
      await w.update('tickets', made['id'], { pending_email: 'kai@example.com' });
      const renewed = await code(made['id']);
      expect(String(own)).toMatch(/^[0-9A-Z]{16}$/);
      expect(String(renewed)).toMatch(/^[0-9A-Z]{16}$/);
      expect(renewed).not.toBe(own);
    });

    it.runIf(available)('through the staff routes: made, never shown when a secret, never written by hand', async () => {
      const res = await routes.post('tickets', { values: { pending_email: 'mia@example.com' } });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: Record<string, unknown> }).data;
      const made = await code(data['id']);
      expect(String(made)).toMatch(/^[0-9A-Z]{16}$/);
      if (name === 'link_token' && secret === undefined) {
        expect(res.body).not.toContain(String(made));
        const typed = await routes.patch('tickets', data['id'], { values: { link_token: 'ZZZZZZZZZZZZZZZZ' } });
        expect(typed.statusCode, typed.body).toBeGreaterThanOrEqual(400);
        expect(await code(data['id'])).toBe(made);
      }
    });
  });
}
