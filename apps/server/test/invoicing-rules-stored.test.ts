// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rules an invoicing app asks for reach the store whole, on every
 * engine: a formula, a column's decimal places, a prefixed number from a
 * gapless series, a fill from the connection or a settings row, a date worked
 * out from another, a fingerprint over child rows, and a document's states.
 *
 * The app's tables are prefixed (`studio_invoices`), and every rule names
 * tables by the app's short names — at any depth. Each one must be stored
 * against the REAL table, or the write path would query a table that does not
 * exist the first time the rule ran.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { overridesRepo, type SchemaOverride } from '@adminium/meta';

import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an invoicing app's rules on ${dialect}`, () => {
    it('are all written, none skipped, each naming the real tables', async () => {
      const h = await installInvoicing(dialect);
      open = h;
      const rules = h.reply['rules'] as { written: number; skipped: unknown[] };
      expect(rules.skipped, JSON.stringify(rules.skipped)).toEqual([]);

      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.origin === 'app');
      // The id a table has in the snapshot, whatever the engine's schema prefix.
      const idOf = (ref: string) => {
        const found = stored.find((o) => o.tableName.endsWith(`.${h.real(ref)}`) || o.tableName === h.real(ref));
        expect(found, `a rule on ${ref}`).toBeDefined();
        return found!.tableName;
      };
      const rule = (op: string, table: string, column: string | null): SchemaOverride => {
        const found = stored.find((o) => o.op === op && o.tableName === idOf(table) && o.columnName === column);
        expect(found, `${op} on ${table}.${column ?? ''}`).toBeDefined();
        return found!;
      };

      expect(rule('column.formula', 'invoice_lines', 'amount').value).toEqual({
        formula: { max: [0, { sub: [{ mul: ['qty', 'rate'] }, { coalesce: ['discount', 0] }] }] },
      });
      expect(rule('column.formula', 'invoices', 'total').value).toEqual({ formula: { add: ['subtotal', { coalesce: ['tax', 0] }] } });
      expect(rule('column.scale', 'invoices', 'total').value).toEqual({ scale: 'currency' });
      expect(rule('column.scale', 'invoice_lines', 'qty').value).toEqual({ scale: 3 });

      // A setting a rule reads is the settings row's REAL table.
      expect(rule('column.sequence', 'invoices', 'number_seq').value).toEqual({
        gapless: true,
        startSetting: { table: idOf('settings'), column: 'invoice_start' },
      });
      expect(rule('column.format', 'invoices', 'number').value).toEqual({
        from: 'number_seq',
        prefixSetting: { table: idOf('settings'), column: 'invoice_prefix' },
        pad: 4,
      });
      expect(rule('column.sequence', 'versions', 'v').value).toEqual({ gapless: true, scope: 'proposal_id' });
      expect(rule('column.default', 'invoices', 'currency').value).toEqual({ kind: 'from', from: 'connection.currency' });
      expect(rule('column.default', 'invoices', 'tax_rate').value).toEqual({ kind: 'from', from: { table: idOf('settings'), column: 'tax_rate' } });
      expect(rule('column.copy', 'invoices', 'tax_rate').value).toEqual({ via: 'client_id', from: 'tax_rate' });

      expect(rule('column.stamp', 'invoices', 'due_on').value).toMatchObject({ set: { addDays: { date: 'issued_on', days: 'terms' } } });
      // A fingerprint's child rows are read from the real child table.
      expect(rule('column.stamp', 'proposals', 'fingerprint').value).toEqual({
        set: { hashOf: { columns: ['signed_name'], children: [{ table: idOf('proposal_lines'), via: 'proposal_id', columns: ['position', 'amount'], orderBy: 'position' }] } },
        on: [{ column: 'status', values: ['accepted'] }, { column: 'signed_name', filled: true }],
      });

      // The states tie child tables by their real ids, in the children and in a move's requirement.
      const states = rule('table.states', 'invoices', null).value as {
        children: Record<string, unknown>;
        moves: { draft: { requires?: { children?: Record<string, number> } }[] };
      };
      expect(Object.keys(states.children).sort()).toEqual([idOf('invoice_lines'), idOf('payments')].sort());
      expect(states.children[idOf('payments')]).toEqual({ via: 'invoice_id', parentIn: ['sent'], clearOnCreate: ['client_paid_at'] });
      expect(states.moves.draft[0]!.requires?.children).toEqual({ [idOf('invoice_lines')]: 1 });
    });
  });
}
