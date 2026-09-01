// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `planInstall` (26-T01) — against the REAL shipped manifests, not fixtures.
 *
 * The manifests are inlined here rather than read from `Adminiumjs/add-ons`,
 * because this package cannot depend on that repo and a fixture copied by hand
 * would drift silently. What is copied is the part that matters — the
 * `requiredSchema` blocks and their foreign keys — and the shapes are asserted
 * against the schema on the way in, so a copy that stops being a valid manifest
 * fails here rather than being planned against.
 */
import { describe, expect, it } from 'vitest';

import { addOnManifestSchema, planInstall, type AddOnManifest, type SchemaModelView } from '../src/index.js';

/** The envelope every fixture below shares; only `requiredSchema` differs. */
function addOn(key: string, requiredSchema?: unknown): AddOnManifest {
  const parsed = addOnManifestSchema.safeParse({
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '1.0.0', requires: [] },
    addOn: {
      attaches: [{ app: 'printing', range: '^1.0.0' }],
      provides: [],
      consumes: [],
      slots: [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }],
      events: [],
      connect: { kind: 'none' },
      scopes: [],
    },
    ...(requiredSchema === undefined ? {} : { requiredSchema }),
  });
  if (!parsed.success) {
    throw new Error(`fixture is not a valid add-on manifest: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** design-studio: one table, one FK OUT to the host's `jobs`. */
const DESIGN_STUDIO = addOn('design-studio', {
  tables: [
    {
      ref: 'artwork_designs',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'job_id', type: 'fk', references: 'jobs' },
        { ref: 'name', type: 'text' },
        { ref: 'created_at', type: 'timestamptz', role: 'created_at' },
      ],
    },
  ],
});

/** personalizer: two tables, one internal FK and two out to the host. */
const PERSONALIZER = addOn('personalizer', {
  tables: [
    {
      ref: 'personalization_templates',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'product_id', type: 'fk', references: 'products' },
        { ref: 'name', type: 'text' },
      ],
    },
    {
      ref: 'personalizations',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'template_id', type: 'fk', references: 'personalization_templates' },
        { ref: 'order_line_id', type: 'fk', references: 'order_lines' },
      ],
    },
  ],
});

/** shipping-dhl: two tables, the FK entirely internal. */
const SHIPPING_DHL = addOn('shipping-dhl', {
  tables: [
    {
      ref: 'shipments',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'tracking', type: 'text' },
        { ref: 'status', type: 'enum', enum: ['booked', 'delivered'] },
      ],
    },
    {
      ref: 'shipment_events',
      columns: [
        { ref: 'id', type: 'id', role: 'pk' },
        { ref: 'shipment_id', type: 'fk', references: 'shipments' },
        { ref: 'at', type: 'timestamptz' },
      ],
    },
  ],
});

/** An add-on with no `requiredSchema` at all — 3 of the 6 shipped ones. */
const HOLIDAY_CALENDARS = addOn('holiday-calendars');

const model = (...tables: Array<[string, string[]]>): SchemaModelView => ({
  tables: tables.map(([ref, cols]) => ({ ref, columns: cols.map((c) => ({ ref: c })) })),
});

const EMPTY: SchemaModelView = { tables: [] };

describe('planInstall: an add-on that touches no data', () => {
  it('plans nothing and is installable anywhere', () => {
    const plan = planInstall(HOLIDAY_CALENDARS, EMPTY);
    expect(plan.touchesData).toBe(false);
    expect(plan.create).toEqual([]);
    expect(plan.reuse).toEqual([]);
    expect(plan.installable).toBe(true);
  });
});

describe('planInstall: creating tables', () => {
  it('plans a create for every table the database does not have', () => {
    const plan = planInstall(SHIPPING_DHL, EMPTY);
    expect(plan.create.map((t) => t.ref)).toEqual(['shipments', 'shipment_events']);
    expect(plan.reuse).toEqual([]);
    expect(plan.touchesData).toBe(true);
  });

  it('keeps declaration order, so an FK target is created before its dependent', () => {
    // Not cosmetic: `shipment_events.shipment_id` references `shipments`, and
    // on a database without deferred constraints the target has to exist first.
    const plan = planInstall(SHIPPING_DHL, EMPTY);
    expect(plan.create.map((t) => t.ref).indexOf('shipments')).toBeLessThan(
      plan.create.map((t) => t.ref).indexOf('shipment_events'),
    );
  });

  it('resolves an FK to a table it is itself creating as internal', () => {
    const plan = planInstall(SHIPPING_DHL, EMPTY);
    expect(plan.references).toEqual([
      { fromTable: 'shipment_events', fromColumn: 'shipment_id', to: 'shipments', resolution: 'internal' },
    ]);
    expect(plan.installable).toBe(true);
  });
});

describe('planInstall: the foreign key that points at the host', () => {
  it('refuses when the host table is simply absent', () => {
    // design-studio needs the host's `jobs`. On an empty database there is
    // nothing for it to attach to, and this is the case a planner that only
    // emitted DDL would discover at CREATE TABLE — after creating other tables,
    // on MySQL, with no transactional DDL to roll them back.
    const plan = planInstall(DESIGN_STUDIO, EMPTY);
    expect(plan.installable).toBe(false);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      table: 'artwork_designs',
      column: 'job_id',
    });
    // The message names the missing table and says whose job it is to have it.
    expect(plan.problems[0]?.message).toContain('jobs');
    expect(plan.problems[0]?.message).toContain('host app');
  });

  it('resolves against a host that DOES have the table', () => {
    const plan = planInstall(DESIGN_STUDIO, model(['jobs', ['id', 'name']]));
    expect(plan.installable).toBe(true);
    expect(plan.references).toEqual([
      { fromTable: 'artwork_designs', fromColumn: 'job_id', to: 'jobs', resolution: 'host' },
    ]);
    expect(plan.create.map((t) => t.ref)).toEqual(['artwork_designs']);
  });

  it('handles a manifest whose FKs point both inward and outward', () => {
    const plan = planInstall(
      PERSONALIZER,
      model(['products', ['id']], ['order_lines', ['id']]),
    );
    expect(plan.installable).toBe(true);
    expect(plan.references).toEqual([
      {
        fromTable: 'personalization_templates',
        fromColumn: 'product_id',
        to: 'products',
        resolution: 'host',
      },
      {
        fromTable: 'personalizations',
        fromColumn: 'template_id',
        to: 'personalization_templates',
        resolution: 'internal',
      },
      {
        fromTable: 'personalizations',
        fromColumn: 'order_line_id',
        to: 'order_lines',
        resolution: 'host',
      },
    ]);
  });

  it('reports every unresolved reference, not just the first', () => {
    // An operator fixing one missing table and being shown the next one is a
    // worse experience than being told both at once.
    const plan = planInstall(PERSONALIZER, model(['products', ['id']]));
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]?.column).toBe('order_line_id');

    const none = planInstall(PERSONALIZER, EMPTY);
    expect(none.problems.map((p) => p.column)).toEqual(['product_id', 'order_line_id']);
  });
});

describe('planInstall: reusing what is already there', () => {
  it('reuses a table that exists and carries every required column', () => {
    const plan = planInstall(
      SHIPPING_DHL,
      model(
        ['shipments', ['id', 'tracking', 'status']],
        ['shipment_events', ['id', 'shipment_id', 'at']],
      ),
    );
    expect(plan.create).toEqual([]);
    expect(plan.reuse.map((t) => t.ref)).toEqual(['shipments', 'shipment_events']);
    expect(plan.reuse.every((t) => t.missingColumns.length === 0)).toBe(true);
    expect(plan.installable).toBe(true);
  });

  it('reports a PARTIAL match: the table is there but does not carry what is needed', () => {
    // A different situation from both "create it" and "it fits", and the
    // consent dialog has to be able to say which.
    const plan = planInstall(SHIPPING_DHL, model(['shipments', ['id']]));
    const shipments = plan.reuse.find((t) => t.ref === 'shipments');
    expect(shipments?.action).toBe('reuse');
    expect(shipments?.missingColumns).toEqual(['tracking', 'status']);
    expect(shipments?.columns.find((c) => c.ref === 'id')?.missing).toBe(false);
    // `shipment_events` is still a create — one existing table does not make
    // the whole manifest a reuse.
    expect(plan.create.map((t) => t.ref)).toEqual(['shipment_events']);
  });

  it('never marks a column missing on a table it is creating', () => {
    const plan = planInstall(SHIPPING_DHL, EMPTY);
    expect(plan.create.flatMap((t) => t.columns).every((c) => !c.missing)).toBe(true);
    expect(plan.create.every((t) => t.missingColumns.length === 0)).toBe(true);
  });
});

describe("planInstall: Adminium's own namespace", () => {
  it("refuses a table that would shadow the meta store's", () => {
    // On the SQLite default the meta store and the data source are the same
    // database, so this is not a shadow — it is the table.
    const hostile = addOn('hostile', {
      tables: [{ ref: 'adminium_users', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }],
    });
    const plan = planInstall(hostile, EMPTY);
    expect(plan.installable).toBe(false);
    expect(plan.problems[0]).toMatchObject({ code: 'RESERVED_TABLE', table: 'adminium_users' });
    // And it is not planned for creation despite being refused.
    expect(plan.create).toEqual([]);
  });
});

describe('planInstall: the plan is always returned', () => {
  it('returns a renderable plan even when it cannot be applied', () => {
    // The consent dialog has to show WHY, so a refusal is data, not an
    // exception that leaves the surface with nothing to draw.
    const plan = planInstall(DESIGN_STUDIO, EMPTY);
    expect(plan.installable).toBe(false);
    expect(plan.addOnKey).toBe('design-studio');
    expect(plan.version).toBe('1.0.0');
    expect(plan.create).toHaveLength(1);
    expect(plan.problems).toHaveLength(1);
  });

  it('is pure: planning twice gives the same answer', () => {
    const m = model(['jobs', ['id']]);
    expect(planInstall(DESIGN_STUDIO, m)).toEqual(planInstall(DESIGN_STUDIO, m));
  });
});
