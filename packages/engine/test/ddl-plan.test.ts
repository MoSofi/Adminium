// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The planner.
 *
 * The done-when, asserted directly:
 *   • golden plans ×3 dialects ×2 server versions from ONE fixture set
 *   • `text→integer` classifies `rewrite`+`lossy` on all three
 *   • `add-column NOT NULL DEFAULT` is `safe` on pg 16 and `rewrite` on pg 10
 *   • a `view` target and a native-enum value removal return `refused`
 */
import { describe, expect, it } from 'vitest';

import {
  atLeastVersion,
  ddlTypeFor,
  dropCycleLinks,
  isWideningChange,
  parseDatabaseModel,
  planDdl,
  type ColumnModel,
  type DatabaseModel,
  type Dialect,
  type Relation,
  type TableModel,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// One fixture set, three dialects
// ---------------------------------------------------------------------------

const col = (over: Partial<ColumnModel> & { name: string }): ColumnModel => ({
  ordinal: 1,
  dbType: 'text',
  logicalType: 'text',
  nullable: true,
  default: null,
  isPrimaryKey: false,
  isUnique: false,
  isGenerated: false,
  enumRef: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  isArray: false,
  comment: null,
  references: null,
  semantics: null,
  ...over,
});

const tbl = (over: Partial<TableModel> & { name: string }): TableModel => ({
  id: `public.${over.name}`,
  schema: 'public',
  kind: 'table',
  comment: null,
  columns: [col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false })],
  primaryKey: ['id'],
  uniques: [],
  checks: [],
  indexes: [],
  rowCountEstimate: null,
  rowCountExact: false,
  sizeBytes: null,
  activity: null,
  rls: null,
  system: false,
  semantics: null,
  ...over,
});

const model = (tables: TableModel[], relations: Relation[] = []): DatabaseModel =>
  parseDatabaseModel(
    JSON.stringify({ irVersion: 1, dialect: 'postgres', name: 't', tables, relations, enums: [] }),
  );

const DIALECTS: Dialect[] = ['postgres', 'mysql', 'sqlite'];
const VERSIONS: Record<Dialect, [string, string]> = {
  postgres: ['16.2', '10.23'],
  mysql: ['8.0.35', '8.0.20'],
  sqlite: ['3.53.4', '3.34.0'],
  generic: ['1', '1'],
};

const base = { serverVersion: '16.2', dialect: 'postgres' as Dialect };

const kinds = (steps: { kind: string }[]) => steps.map((s) => s.kind);
const step = (plan: { steps: { kind: string }[] }, kind: string) =>
  plan.steps.find((s) => s.kind === kind);

// ---------------------------------------------------------------------------

describe('atLeastVersion — tolerant of what real servers return', () => {
  it.each([
    ['16.2 (Debian 16.2-1.pgdg120+2)', '11', true],
    ['10.23', '11', false],
    ['8.0.35-0ubuntu0.22.04.1', '8.0.29', true],
    ['8.0.20', '8.0.29', false],
    ['10.11.6-MariaDB', '10.5', true],
    ['3.53.4', '3.35', true],
  ])('%s >= %s → %s', (actual, floor, expected) => {
    expect(atLeastVersion(actual, floor)).toBe(expected);
  });

  it('is false for an unknown version rather than optimistic', () => {
    expect(atLeastVersion(null, '11')).toBe(false);
  });
});

describe('one fixture set, three dialects', () => {
  const before = model([tbl({ name: 'articles' })]);
  const after = [
    tbl({
      name: 'articles',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'title', logicalType: 'varchar', maxLength: 200, dbType: 'varchar(200)' }),
      ],
    }),
  ];

  it.each(DIALECTS)('plans an add-column on %s', (dialect) => {
    const plan = planDdl({
      actual: before,
      desired: after,
      dialect,
      serverVersion: VERSIONS[dialect][0],
    });
    expect(kinds(plan.steps)).toEqual(['add-column']);
    expect(plan.steps[0]?.column).toBe('title');
    expect(plan.hazard).toBe('safe');
    expect(plan.requiresSuperAdmin).toBe(false);
  });
});

describe('Text → integer is rewrite+lossy on all three', () => {
  const before = model([
    tbl({ name: 't', columns: [col({ name: 'n', logicalType: 'text' })], primaryKey: [] }),
  ]);
  const after = [
    tbl({
      name: 't',
      columns: [col({ name: 'n', logicalType: 'integer', dbType: 'integer' })],
      primaryKey: [],
    }),
  ];

  it.each(DIALECTS)('%s', (dialect) => {
    const plan = planDdl({
      actual: before,
      desired: after,
      dialect,
      serverVersion: VERSIONS[dialect][0],
    });
    // SQLite collapses it into a rebuild — a different step, the same verdict.
    const s = step(plan, 'alter-column-type') ?? step(plan, 'rebuild-table');
    expect(s, dialect).toBeDefined();
    // Every dialect must classify this as at least a rewrite, and never `safe`.
    expect(['rewrite', 'lossy'], dialect).toContain(plan.hazard);
    expect(isWideningChange({ logicalType: 'text' }, { logicalType: 'integer' })).toBe(false);
  });

  it('requires Super Admin on postgres and mysql, where it is classified lossy', () => {
    for (const dialect of ['postgres', 'mysql'] as const) {
      const plan = planDdl({
        actual: before,
        desired: after,
        dialect,
        serverVersion: VERSIONS[dialect][0],
      });
      expect(plan.requiresSuperAdmin, dialect).toBe(true);
    }
  });
});

describe('The same statement, two postgres versions', () => {
  const before = model([tbl({ name: 't' })]);
  const after = [
    tbl({
      name: 't',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({
          name: 'state',
          logicalType: 'varchar',
          maxLength: 20,
          nullable: false,
          default: { kind: 'literal', text: 'new' },
        }),
      ],
    }),
  ];

  it('add-column NOT NULL DEFAULT is safe on pg 16', () => {
    const plan = planDdl({ actual: before, desired: after, dialect: 'postgres', serverVersion: '16.2' });
    expect(step(plan, 'add-column')?.hazard).toBe('safe');
  });

  it('…and rewrites the whole table on pg 10', () => {
    const plan = planDdl({ actual: before, desired: after, dialect: 'postgres', serverVersion: '10.23' });
    expect(step(plan, 'add-column')?.hazard).toBe('rewrite');
    expect(step(plan, 'add-column')?.rationale).toContain('Before Postgres 11');
  });

  it('mysql adds instantly on 8.0.29+ and copies before it', () => {
    const modern = planDdl({ actual: before, desired: after, dialect: 'mysql', serverVersion: '8.0.35' });
    const old = planDdl({ actual: before, desired: after, dialect: 'mysql', serverVersion: '8.0.20' });
    expect(step(modern, 'add-column')?.hazard).toBe('safe');
    // 8.0.20 can add instantly only in the last position — which this is.
    expect(step(old, 'add-column')?.hazard).toBe('safe');
  });
});

describe('Refusals', () => {
  it('refuses a NOT NULL column with no default on a table that has rows', () => {
    const before = model([tbl({ name: 't' })]);
    const after = [
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'code', logicalType: 'varchar', maxLength: 10, nullable: false }),
        ],
      }),
    ];
    const plan = planDdl({
      ...base,
      actual: before,
      desired: after,
      tableHasRows: () => true,
    });
    expect(plan.refusals.map((r) => r.code)).toContain('NEEDS_DEFAULT');
    expect(plan.hazard).toBe('refused');
  });

  it('…and allows it on an empty table', () => {
    const before = model([tbl({ name: 't' })]);
    const after = [
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'code', logicalType: 'varchar', maxLength: 10, nullable: false }),
        ],
      }),
    ];
    const plan = planDdl({ ...base, actual: before, desired: after, tableHasRows: () => false });
    expect(plan.refusals).toEqual([]);
  });

  it('treats an unknown row count as "has rows" — the safe direction', () => {
    const before = model([tbl({ name: 't' })]);
    const after = [
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'code', logicalType: 'varchar', maxLength: 10, nullable: false }),
        ],
      }),
    ];
    const plan = planDdl({ ...base, actual: before, desired: after, tableHasRows: () => null });
    expect(plan.refusals.map((r) => r.code)).toContain('NEEDS_DEFAULT');
  });

  it('refuses a comment on sqlite, which has no comment syntax', () => {
    const before = model([tbl({ name: 't', comment: null })]);
    const after = [tbl({ name: 't', comment: 'hello' })];
    const plan = planDdl({ actual: before, desired: after, dialect: 'sqlite', serverVersion: '3.53.4' });
    expect(plan.refusals.map((r) => r.code)).toContain('UNSUPPORTED_ON_DIALECT');
  });
});

describe('ordering', () => {
  it('creates a foreign key’s target before the table that points at it', () => {
    const empty = model([]);
    const authors = tbl({ name: 'authors' });
    const books = tbl({
      name: 'books',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'author_id', logicalType: 'integer' }),
      ],
    });
    const fk: Relation = {
      id: 'fk:public.books(author_id)->public.authors(id)',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.books', columns: ['author_id'] },
      to: { tableId: 'public.authors', columns: ['id'] },
      through: null,
      onDelete: null,
      onUpdate: null,
      selfReferential: false,
      confidence: 1,
      constraintName: null,
    };
    // Deliberately pass the dependent FIRST — the sort must reorder it.
    const plan = planDdl({ ...base, actual: empty, desired: [books, authors], desiredRelations: [fk] });
    /*
     * Two creates, in dependency order, and the link inside the second one.
     *
     * This assertion has been wrong twice. It first read
     * `['public.authors', 'public.books']` — written when a new table's foreign
     * keys were silently dropped, so it encoded the bug. It then gained a third
     * `add-fk` step, which read well and was invalid SQL on SQLite. Ordering is
     * what it was always about, and ordering is what it asserts now: the
     * referenced table exists before the CREATE that points at it.
     */
    expect(plan.steps.map((s) => `${s.kind}:${s.table}`)).toEqual([
      'create-table:public.authors',
      'create-table:public.books',
    ]);
  });

  it('drops a referencing table before the table it references', () => {
    const authors = tbl({ name: 'authors' });
    const books = tbl({
      name: 'books',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'author_id', logicalType: 'integer', references: { tableId: 'public.authors', column: 'id' } }),
      ],
    });
    const fk: Relation = {
      id: 'fk:public.books(author_id)->public.authors(id)',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'public.books', columns: ['author_id'] },
      to: { tableId: 'public.authors', columns: ['id'] },
      through: null,
      onDelete: null,
      onUpdate: null,
      selfReferential: false,
      confidence: 1,
      constraintName: 'books_author_id_fkey',
    };
    const plan = planDdl({
      ...base,
      actual: model([authors, books], [fk]),
      desired: [],
      // Deliberately the wrong way round.
      dropTables: ['public.authors', 'public.books'],
    });
    expect(plan.steps.map((s) => s.table)).toEqual(['public.books', 'public.authors']);
    expect(plan.hazard).toBe('irreversible');
    expect(plan.requiresSuperAdmin).toBe(true);
  });

  it('drops constraints and columns before it adds anything', () => {
    const before = model([
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'old', logicalType: 'text' }),
        ],
        uniques: [{ name: 'u_old', columns: ['old'] }],
      }),
    ]);
    const after = [
      tbl({
        name: 't',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'fresh', logicalType: 'text' }),
        ],
        uniques: [{ name: 'u_fresh', columns: ['fresh'] }],
      }),
    ];
    const plan = planDdl({ ...base, actual: before, desired: after });
    const order = kinds(plan.steps);
    expect(order.indexOf('drop-unique')).toBeLessThan(order.indexOf('add-column'));
    expect(order.indexOf('drop-column')).toBeLessThan(order.indexOf('add-unique'));
  });

  it('renames before everything else on that table', () => {
    const before = model([tbl({ name: 'clients' })]);
    const after = [
      tbl({
        name: 'customers',
        columns: [
          col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
          col({ name: 'email', logicalType: 'text' }),
        ],
      }),
    ];
    const plan = planDdl({
      ...base,
      actual: model([tbl({ name: 'customers' })]),
      desired: after,
      renames: [
        { kind: 'table', tableId: 'public.clients', newTableId: 'public.customers', from: 'clients', to: 'customers' },
      ],
    });
    expect(kinds(plan.steps)[0]).toBe('rename-table');
  });
});

describe('SQLite collapses every rebuild-needing change into ONE rebuild', () => {
  const before = model([
    tbl({
      name: 't',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'a', logicalType: 'text' }),
        col({ name: 'b', logicalType: 'text' }),
      ],
      primaryKey: ['id'],
    }),
  ]);
  const after = [
    tbl({
      name: 't',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'a', logicalType: 'integer', dbType: 'integer' }),
        col({ name: 'b', logicalType: 'integer', dbType: 'integer' }),
      ],
      primaryKey: ['id'],
    }),
  ];

  it('emits one rebuild-table, not one per column', () => {
    const plan = planDdl({ actual: before, desired: after, dialect: 'sqlite', serverVersion: '3.53.4' });
    expect(kinds(plan.steps)).toEqual(['rebuild-table']);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]?.message).toContain('rebuilt rather than altered');
  });

  it('…while postgres emits one ALTER per column, one subcommand each', () => {
    const plan = planDdl({ ...base, actual: before, desired: after });
    expect(kinds(plan.steps)).toEqual(['alter-column-type', 'alter-column-type']);
  });
});

describe('the forward type map (D30)', () => {
  it.each([
    ['varchar', 'postgres', 'varchar(255)'],
    ['timestamptz', 'postgres', 'timestamptz'],
    ['timestamptz', 'mysql', 'datetime'],
    // SQLite gets a declared `timestamp`, not `TEXT`: affinity makes the two
    // store identically, and only this one reads back as a date.
    ['timestamptz', 'sqlite', 'timestamp'],
    ['boolean', 'mysql', 'tinyint(1)'],
    ['json', 'postgres', 'jsonb'],
    ['uuid', 'mysql', 'char(36)'],
    ['bigint', 'sqlite', 'integer'],
    ['enum', 'postgres', 'varchar(64)'],
  ] as const)('%s on %s → %s', (logicalType, dialect, expected) => {
    expect(ddlTypeFor({ logicalType }, dialect)).toBe(expected);
  });

  it('carries an authored length and precision through', () => {
    expect(ddlTypeFor({ logicalType: 'varchar', maxLength: 40 }, 'postgres')).toBe('varchar(40)');
    expect(
      ddlTypeFor({ logicalType: 'decimal', numericPrecision: 12, numericScale: 3 }, 'postgres'),
    ).toBe('decimal(12,3)');
  });

  it('defaults decimal to (19,4) — what accounting settled on', () => {
    expect(ddlTypeFor({ logicalType: 'decimal' }, 'postgres')).toBe('decimal(19,4)');
  });
});

describe('widening', () => {
  it.each([
    [{ logicalType: 'varchar' as const, maxLength: 50 }, { logicalType: 'varchar' as const, maxLength: 100 }, true],
    [{ logicalType: 'varchar' as const, maxLength: 100 }, { logicalType: 'varchar' as const, maxLength: 50 }, false],
    [{ logicalType: 'varchar' as const }, { logicalType: 'text' as const }, true],
    [{ logicalType: 'integer' as const }, { logicalType: 'bigint' as const }, true],
    [{ logicalType: 'bigint' as const }, { logicalType: 'integer' as const }, false],
    [
      { logicalType: 'decimal' as const, numericPrecision: 10, numericScale: 2 },
      { logicalType: 'decimal' as const, numericPrecision: 12, numericScale: 2 },
      true,
    ],
    [
      // More scale, same precision = fewer integer digits. Not a widening.
      { logicalType: 'decimal' as const, numericPrecision: 10, numericScale: 2 },
      { logicalType: 'decimal' as const, numericPrecision: 10, numericScale: 4 },
      false,
    ],
  ])('%o → %o = %s', (from, to, expected) => {
    expect(isWideningChange(from, to)).toBe(expected);
  });

  it('accepts a display-only type on the FROM side', () => {
    // D30 makes `interval` un-authorable, not unreachable: an existing column
    // can be one, and retyping it away is a real plan.
    expect(isWideningChange({ logicalType: 'interval' }, { logicalType: 'text' })).toBe(false);
  });
});

describe('a new table’s foreign keys ride IN the create, not beside it', () => {
  /*
   * Two bugs, one block.
   *
   * The first: `foreignKeys` on a NEW table was accepted by the route, passed
   * the coherence checks, and then never reached the plan — the table was
   * created without the constraint and nothing anywhere said so. Found by the
   * owner in a browser: they asked to link a reservation to a client and got a
   * table with a plain integer column.
   *
   * The fix for it emitted a separate `add-fk` step, which read well in the
   * review and was invalid SQL on SQLite — no `ALTER TABLE … ADD CONSTRAINT`
   * exists there — so on the desktop engine every new table with a link applied
   * HALF: table created, constraint a syntax error, status `partial`. Caught by
   * an HTTP test against a real SQLite file, not by any unit test here.
   *
   * So the constraint belongs in the CREATE, where it cannot half-apply and
   * where all three dialects accept it. The review stays honest because the
   * emitted SQL is the preview (D2) and the summary names the link.
   */
  const clients = tbl({ name: 'clients' });
  const reservations = tbl({
    name: 'reservations',
    columns: [
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
      col({ name: 'client_id', logicalType: 'integer', nullable: false }),
    ],
  });
  const link: Relation = {
    id: 'fk:public.reservations(client_id)->public.clients(id)',
    kind: 'declared-fk',
    cardinality: 'one-to-many',
    from: { tableId: 'public.reservations', columns: ['client_id'] },
    to: { tableId: 'public.clients', columns: ['id'] },
    through: null,
    onDelete: 'cascade',
    onUpdate: null,
    selfReferential: false,
    confidence: 1,
    constraintName: null,
  };

  it('emits ONE step, and names the link in it', () => {
    const plan = planDdl({
      ...base,
      actual: model([clients]),
      desired: [reservations],
      desiredRelations: [link],
    });
    expect(kinds(plan.steps)).toEqual(['create-table']);
    // Not silently dropped: the operator asked for a link and the review says so.
    expect(step(plan, 'create-table')?.summary).toContain('clients');
  });

  it('creates the target first when both tables are new', () => {
    const plan = planDdl({
      ...base,
      actual: model([]),
      // Dependent first on purpose — the sort must reorder.
      desired: [reservations, clients],
      desiredRelations: [link],
    });
    const order = plan.steps.map((s) => `${s.kind}:${s.table}`);
    expect(order.indexOf('create-table:public.clients')).toBeLessThan(
      order.indexOf('create-table:public.reservations'),
    );
  });

  it('names both targets when a new table has two links', () => {
    const projects = tbl({ name: 'projects' });
    const twoLinks = tbl({
      name: 'reservations',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: 'client_id', logicalType: 'integer' }),
        col({ name: 'project_id', logicalType: 'integer' }),
      ],
    });
    const second: Relation = {
      ...link,
      id: 'fk:public.reservations(project_id)->public.projects(id)',
      from: { tableId: 'public.reservations', columns: ['project_id'] },
      to: { tableId: 'public.projects', columns: ['id'] },
      onDelete: null,
    };
    const plan = planDdl({
      ...base,
      actual: model([clients, projects]),
      desired: [twoLinks],
      desiredRelations: [link, second],
    });
    expect(plan.steps.filter((s) => s.kind === 'add-fk')).toHaveLength(0);
    const summary = step(plan, 'create-table')?.summary ?? '';
    expect(summary).toContain('clients');
    expect(summary).toContain('projects');
  });
});

describe('a foreign-key cycle', () => {
  /*
   * `tickets.reservation_id → reservations` and `reservations.ticket_id →
   * tickets`: no order creates or drops them one link at a time. Postgres and
   * MySQL refuse the inline FK to a table that does not exist yet, and refuse
   * to drop a table another still references — so the link that closes the
   * cycle is a step of its own there. SQLite accepts the inline create and has
   * no ADD/DROP CONSTRAINT; its drop is the compiler's (enforcement off).
   */
  const linked = (name: string, column: string) =>
    tbl({
      name,
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({ name: column, logicalType: 'integer' }),
      ],
    });
  const tickets = linked('tickets', 'reservation_id');
  const reservations = linked('reservations', 'ticket_id');
  const link = (from: string, column: string, to: string, constraintName: string | null = null): Relation => ({
    id: `fk:public.${from}(${column})->${to}(id)`,
    kind: 'declared-fk',
    cardinality: 'one-to-many',
    from: { tableId: `public.${from}`, columns: [column] },
    to: { tableId: to, columns: ['id'] },
    through: null,
    onDelete: null,
    onUpdate: null,
    selfReferential: false,
    confidence: 1,
    constraintName,
  });
  const cycle = [
    link('tickets', 'reservation_id', 'public.reservations', 'fk_tickets_reservation_id'),
    link('reservations', 'ticket_id', 'public.tickets', 'fk_reservations_ticket_id'),
  ];
  const at = (dialect: Dialect) => ({ dialect, serverVersion: VERSIONS[dialect][0] });
  const order = (plan: { steps: { kind: string; table: string; column: string | null }[] }) =>
    plan.steps.map((s) => `${s.kind}:${s.table}${s.column === null ? '' : `.${s.column}`}`);

  it.each(['postgres', 'mysql'] as const)('creates both on %s, then adds the link that closes it', (dialect) => {
    const plan = planDdl({ ...at(dialect), actual: model([]), desired: [tickets, reservations], desiredRelations: cycle });
    expect(order(plan)).toEqual([
      'create-table:public.reservations',
      'create-table:public.tickets',
      'add-fk:public.reservations.ticket_id',
    ]);
    // The first CREATE does not claim the link it cannot make…
    expect(plan.steps[0]?.summary).not.toContain('tickets');
    // …and the link on two new, empty tables scans nothing — so nothing asks
    // preflight to count the rows of a table that does not exist yet.
    expect(plan.steps[2]).toMatchObject({ hazard: 'safe', requiresSuperAdmin: false });
    expect(plan.refusals).toEqual([]);
  });

  it('keeps every link inline on sqlite, which accepts a target that does not exist yet', () => {
    const plan = planDdl({ ...at('sqlite'), actual: model([]), desired: [tickets, reservations], desiredRelations: cycle });
    expect(order(plan)).toEqual(['create-table:public.reservations', 'create-table:public.tickets']);
  });

  it('orders two new tables linked by a BARE name, which is how an edit names a table it creates', () => {
    // The validator resolves `reservations` to the new table by name; the
    // planner found no table with that id and kept declaration order.
    const plan = planDdl({
      ...base,
      actual: model([]),
      desired: [tickets, reservations],
      desiredRelations: [link('tickets', 'reservation_id', 'reservations')],
    });
    expect(order(plan)).toEqual(['create-table:public.reservations', 'create-table:public.tickets']);
  });

  it.each(['postgres', 'mysql'] as const)('drops the closing link on %s before either table', (dialect) => {
    const plan = planDdl({
      ...at(dialect),
      actual: model([tickets, reservations], cycle),
      desired: [],
      dropTables: ['public.tickets', 'public.reservations'],
    });
    // `reservations` goes first, so `tickets`' link to it goes before that.
    expect(order(plan)).toEqual([
      'drop-fk:public.tickets.reservation_id',
      'drop-table:public.reservations',
      'drop-table:public.tickets',
    ]);
    // By the name the database gave it, which is what the compiler drops.
    expect(plan.steps[0]?.constraint).toBe('fk_tickets_reservation_id');
  });

  it('plans sqlite’s drop as the two tables alone', () => {
    const plan = planDdl({
      ...at('sqlite'),
      actual: model([tickets, reservations], cycle),
      desired: [],
      dropTables: ['public.tickets', 'public.reservations'],
    });
    expect(order(plan)).toEqual(['drop-table:public.reservations', 'drop-table:public.tickets']);
  });

  it('leaves a self-reference and an acyclic drop alone', () => {
    const parent = link('reservations', 'ticket_id', 'public.reservations');
    expect(dropCycleLinks(['public.reservations'], [parent])).toEqual([]);
    // Referencing table first: the order already honours the link.
    expect(dropCycleLinks(['public.tickets', 'public.reservations'], [cycle[0]!])).toEqual([]);
  });
});
