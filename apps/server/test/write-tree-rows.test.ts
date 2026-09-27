// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A create with its child rows, row by row: a child that seals a fingerprint
 * over its own totals is sealed again once they are in; a clash on the root's
 * key that is not a retry's twin reaches the door as the engine's own
 * refusal; and a quote waits on no save holding the customer its order points
 * at, nor a save on a quote (Postgres: a row that only points at a held one
 * goes in).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { HashOf } from '../src/connections/effective-schema.js';
import { isUniqueViolation } from '../src/crud/decided-columns.js';
import type { Row } from '../src/crud/mask.js';
import { fingerprintOf } from '../src/crud/seal.js';
import type { TreeNode } from '../src/crud/write-tree.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { MENU, orderManifest, orderTree, writeTree, type Writer } from './order-tree-fixture.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

/** Boxes of packs, each pack sealed over its name, its total and its items. */
function packing(): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'boxes', columns: [id, { ref: 'label', type: 'text', maxLength: 60 }] },
    {
      ref: 'packs',
      columns: [
        id,
        { ref: 'box_id', type: 'fk', references: 'boxes' },
        { ref: 'name', type: 'text', maxLength: 60, nullable: true },
        { ref: 'total', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'pack_items', via: 'pack_id', sum: 'price' } } },
        {
          ref: 'fingerprint',
          type: 'text',
          maxLength: 64,
          nullable: true,
          rules: {
            stamp: {
              set: { hashOf: { columns: ['name', 'total'], children: [{ table: 'pack_items', via: 'pack_id', columns: ['price'], orderBy: 'id' }] } },
              on: { column: 'name', filled: true },
            },
          },
        },
      ],
    },
    { ref: 'pack_items', columns: [id, { ref: 'pack_id', type: 'fk', references: 'packs' }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
  ]);
  manifest['key'] = 'pk';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'boxes' };
  return manifest;
}

describe.each(LEGS)('a child row that seals over its own totals — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Writer;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, packing());
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  it.runIf(available)('is sealed again once the rows below it are added up', async () => {
    const node = (ref: string, values: Row, at: TreeNode['at'], children: TreeNode[] = [], via?: TreeNode['via']): TreeNode => ({
      name: ref,
      target: w.targetOf(ref),
      values,
      at,
      children,
      ...(via === undefined ? {} : { via }),
    });
    const root = node('boxes', { label: 'Hamper' }, [], [
      node('packs', { name: 'Cheese' }, ['packs', 0], [node('pack_items', { price: '4.50' }, ['packs', 0, 'pack_items', 0], [], { column: 'pack_id', parentKey: 'id' }), node('pack_items', { price: '3.25' }, ['packs', 0, 'pack_items', 1], [], { column: 'pack_id', parentKey: 'id' })], {
        column: 'box_id',
        parentKey: 'id',
      }),
    ]);
    const outcome = await writeTree(w, root);
    const pack = outcome.rows.find((row) => row.node.name === 'packs')!.record;
    const target = w.targetOf('packs');
    const [stored] = await h!.rows(`select * from ${h!.real('packs')} where id = ${String(pack['id'])}`);
    expect(Number(stored!['total'])).toBeCloseTo(7.75, 2);
    const hashOf = (target.table.table!.columns.find((c) => c.name === 'fingerprint')!.stamp!.set as { hashOf: HashOf }).hashOf;
    // What anyone holding the stored rows works out: the pack's total and both items included.
    expect(stored!['fingerprint']).toBe(await fingerprintOf((await h!.manager.data(h!.connectionId)).db, target.view, target.table, stored!, hashOf, null));
  });
});

describe.each(LEGS)('a clash on the root key that is not a retry — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Writer;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest());
    for (const statement of MENU) await h.rows(statement);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  it.runIf(available)("reaches the door as the engine's own refusal", async () => {
    const values = { email: 'ada@example.com', name: 'Ada', client_key: 'twin-key-0123456789abcdefgh' };
    await writeTree(w, orderTree(w, [{ item: 4 }], values));
    const seen: unknown[] = [];
    await writeTree(w, orderTree(w, [{ item: 4 }], values), 'save', w.desk, {
      // A retry key whose rows cannot be found: the clash is not a twin's.
      replay: async () => null,
      mapError: (error) => {
        seen.push(error);
        throw error;
      },
    }).catch(() => undefined);
    expect(seen).toHaveLength(1);
    expect(isUniqueViolation(seen[0])).toBe(true);
  });
});

describe.each(LEGS.filter(([dialect]) => dialect === 'postgres'))('a quote beside a save on the same customer — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Writer;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest());
    for (const statement of MENU) await h.rows(statement);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  /** Fails when `work` has not settled within `ms`. */
  const within = async <T>(ms: number, work: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`still waiting after ${String(ms)} ms`)), ms);
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  };

  it.runIf(available)('a quote for the customer a save holds does not wait for it', async () => {
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holding = new Promise<void>((resolve) => (held = resolve));
    // The save stops inside its transaction, holding the customer whose lifetime its order climbs into.
    const saving = writeTree(w, orderTree(w, [{ item: 4 }]), 'save', w.desk, {
      expect: async () => {
        held();
        await gate;
      },
    });
    try {
      await within(5_000, holding);
      const quote = await within(2_000, writeTree(w, orderTree(w, [{ item: 4 }]), 'dry'));
      expect(quote.mode).toBe('dry');
    } finally {
      release();
      await saving;
    }
  });

  it.runIf(available)("a quote of a change to a line of the customer's order does not wait for a save holding the customer", async () => {
    const made = await writeTree(w, orderTree(w, [{ item: 4 }]));
    const line = made.rows.find((row) => row.node.at.length === 2)!.record;
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holding = new Promise<void>((resolve) => (held = resolve));
    const saving = writeTree(w, orderTree(w, [{ item: 4 }]), 'save', w.desk, {
      expect: async () => {
        held();
        await gate;
      },
    });
    try {
      await within(5_000, holding);
      const quoted = await within(
        2_000,
        w.writes.update({ target: w.targetOf('order_items'), pk: { id: line['id'] }, values: { qty: 3 }, context: w.desk, mode: 'dry', announce: async () => {} }),
      );
      expect(Number(quoted.after?.['qty'])).toBe(3);
    } finally {
      release();
      await saving;
    }
    // Nothing of the quote was kept.
    expect(Number((await h!.rows(`select qty from ${h!.real('order_items')} where id = ${String(line['id'])}`))[0]!['qty'])).toBe(1);
  });

  it.runIf(available)('a save for the customer a quote points at does not wait for it', async () => {
    let release!: () => void;
    let inside!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pointing = new Promise<void>((resolve) => (inside = resolve));
    // The quote stops at its first line, its order (for customer 1) already in.
    const quoting = writeTree(w, orderTree(w, [{ item: 4 }]), 'dry', w.desk, {
      checks: async (_db, node) => {
        if (node.at.length === 0) return;
        inside();
        await gate;
      },
    });
    try {
      await within(5_000, pointing);
      const saved = await within(2_000, writeTree(w, orderTree(w, [{ item: 4 }])));
      expect(saved.mode).toBe('save');
    } finally {
      release();
      await quoting;
    }
  });
});
