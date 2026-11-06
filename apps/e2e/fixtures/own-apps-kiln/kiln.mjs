// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kiln Street Pottery, as data: the tables a person makes in Studio, the rows
 * they type in, and the setup around them. Plain values only; `build.mjs`
 * turns them into API calls.
 *
 * Every table is made by Adminium itself (the schema plan + apply routes), so
 * nothing here depends on the engine: logical types only, no SQL.
 */

export const BUSINESS = 'Kiln Street Pottery';
export const TIMEZONE = 'Europe/London';
export const CURRENCY = 'GBP';
/** The second language, beside en_US. */
export const LOCALE = 'fr_FR';

const id = { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } };
const money = (name, nullable = false) => ({ name, logicalType: 'decimal', numericPrecision: 10, numericScale: 2, nullable });

/** Round 1: tables nothing points out of. */
export const PARENT_TABLES = [
  {
    name: 'members',
    columns: [
      id,
      { name: 'name', logicalType: 'varchar', maxLength: 120, nullable: false },
      { name: 'email', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'membership', logicalType: 'enum', nullable: false, default: { kind: 'literal', text: 'drop_in' } },
      { name: 'joined_on', logicalType: 'date', nullable: false },
    ],
    primaryKey: ['id'],
    uniques: [{ columns: ['email'] }],
    enumValues: { membership: ['drop_in', 'monthly', 'studio_key'] },
  },
  {
    name: 'classes',
    columns: [
      id,
      { name: 'title', logicalType: 'varchar', maxLength: 120, nullable: false },
      { name: 'level', logicalType: 'enum', nullable: false },
      { name: 'starts_on', logicalType: 'date', nullable: false },
      { name: 'seats', logicalType: 'integer', nullable: false },
      money('price'),
    ],
    primaryKey: ['id'],
    enumValues: { level: ['beginner', 'intermediate', 'advanced'] },
  },
  {
    name: 'firings',
    columns: [
      id,
      { name: 'kiln', logicalType: 'enum', nullable: false },
      { name: 'cone', logicalType: 'varchar', maxLength: 8, nullable: false },
      { name: 'fired_on', logicalType: 'date', nullable: false },
      { name: 'status', logicalType: 'enum', nullable: false, default: { kind: 'literal', text: 'loading' } },
    ],
    primaryKey: ['id'],
    enumValues: { kiln: ['big_electric', 'test_kiln', 'gas_reduction'], status: ['loading', 'firing', 'cooling', 'unloaded'] },
  },
];

/** Round 2: tables with foreign keys into round 1 (the targets exist by then). */
export const CHILD_TABLES = (schemaPrefix) => [
  {
    name: 'pieces',
    columns: [
      id,
      { name: 'member_id', logicalType: 'integer', nullable: false },
      { name: 'firing_id', logicalType: 'integer', nullable: true },
      { name: 'title', logicalType: 'varchar', maxLength: 120, nullable: false },
      // A free-text column the option list is bound to (an option list, not a database enum).
      { name: 'glaze', logicalType: 'varchar', maxLength: 40, nullable: true },
      { name: 'stage', logicalType: 'enum', nullable: false, default: { kind: 'literal', text: 'greenware' } },
    ],
    primaryKey: ['id'],
    enumValues: { stage: ['greenware', 'bisqued', 'glazed', 'finished'] },
    foreignKeys: [
      { columns: ['member_id'], toTable: `${schemaPrefix}members`, toColumns: ['id'], onDelete: 'restrict' },
      { columns: ['firing_id'], toTable: `${schemaPrefix}firings`, toColumns: ['id'], onDelete: 'set-null' },
    ],
  },
  {
    name: 'shop_orders',
    columns: [
      id,
      { name: 'number', logicalType: 'varchar', maxLength: 24, nullable: false },
      { name: 'member_id', logicalType: 'integer', nullable: true },
      { name: 'customer_email', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'ordered_on', logicalType: 'date', nullable: false },
      money('total'),
      { name: 'status', logicalType: 'enum', nullable: false, default: { kind: 'literal', text: 'open' } },
    ],
    primaryKey: ['id'],
    uniques: [{ columns: ['number'] }],
    enumValues: { status: ['open', 'paid', 'refunded'] },
    foreignKeys: [{ columns: ['member_id'], toTable: `${schemaPrefix}members`, toColumns: ['id'], onDelete: 'set-null' }],
  },
];

export const TABLES = ['members', 'classes', 'firings', 'pieces', 'shop_orders'];

// ── rows (ids are 1..n in insert order: the database is new) ──────────────────

export const MEMBERS = [
  ['Ines Calder', 'ines@kilnstreet.test', 'studio_key', '2025-02-03'],
  ['Tobias Wren', 'tobias@kilnstreet.test', 'monthly', '2025-03-11'],
  ['Amara Osei', 'amara@kilnstreet.test', 'monthly', '2025-04-22'],
  ['Hugo Lefèvre', 'hugo@kilnstreet.test', 'drop_in', '2025-06-07'],
  ['Mei Tanaka', 'mei@kilnstreet.test', 'studio_key', '2025-07-19'],
  ['Rosa Quinn', 'rosa@kilnstreet.test', 'drop_in', '2025-09-02'],
  ['Felix Hart', 'felix@kilnstreet.test', 'monthly', '2026-01-14'],
  ['Nadia Brook', 'nadia@kilnstreet.test', 'drop_in', '2026-03-28'],
].map(([name, email, membership, joined_on]) => ({ name, email, membership, joined_on }));

export const CLASSES = [
  ['Wheel throwing for beginners', 'beginner', '2026-11-10', 8, '145.00'],
  ['Hand-building: pinch and coil', 'beginner', '2026-11-17', 10, '95.00'],
  ['Trimming and handles', 'intermediate', '2026-11-24', 6, '120.00'],
  ['Glaze chemistry evening', 'advanced', '2026-12-02', 6, '60.00'],
  ['Christmas mug weekend', 'beginner', '2026-12-12', 12, '85.00'],
].map(([title, level, starts_on, seats, price]) => ({ title, level, starts_on, seats, price }));

export const FIRINGS = [
  ['big_electric', '04', '2026-10-20', 'unloaded'],
  ['gas_reduction', '10', '2026-10-27', 'unloaded'],
  ['big_electric', '6', '2026-11-03', 'cooling'],
  ['test_kiln', '6', '2026-11-06', 'loading'],
].map(([kiln, cone, fired_on, status]) => ({ kiln, cone, fired_on, status }));

/** member, firing (or null), title, glaze (or null), stage */
export const PIECES = [
  [1, 1, 'Tall jug', null, 'bisqued'],
  [1, 2, 'Serving bowl', 'celadon', 'finished'],
  [2, 2, 'Pair of cups', 'tenmoku', 'finished'],
  [2, 3, 'Planter', 'shino', 'glazed'],
  [3, 1, 'Pinch pots (set of 3)', null, 'bisqued'],
  [3, 3, 'Bud vase', 'celadon', 'glazed'],
  [4, null, 'First cylinder', null, 'greenware'],
  [5, 2, 'Lidded jar', 'ash', 'finished'],
  [5, 4, 'Test tiles', 'chun', 'glazed'],
  [6, null, 'Coil vase', null, 'greenware'],
  [7, 3, 'Breakfast plate', 'tenmoku', 'glazed'],
  [8, null, 'Mug', null, 'greenware'],
].map(([member_id, firing_id, title, glaze, stage]) => ({ member_id, firing_id, title, glaze, stage }));

export const SHOP_ORDERS = [
  ['KS-0001', 2, 'tobias@kilnstreet.test', '2026-10-02', '48.00', 'paid'],
  ['KS-0002', null, 'visitor.one@example.test', '2026-10-05', '22.50', 'paid'],
  ['KS-0003', 5, 'mei@kilnstreet.test', '2026-10-11', '135.00', 'paid'],
  ['KS-0004', null, 'visitor.two@example.test', '2026-10-18', '64.00', 'refunded'],
  ['KS-0005', 3, 'amara@kilnstreet.test', '2026-10-26', '18.00', 'open'],
  ['KS-0006', null, 'visitor.three@example.test', '2026-11-01', '96.00', 'open'],
  ['KS-0007', 7, 'felix@kilnstreet.test', '2026-11-03', '30.00', 'open'],
].map(([number, member_id, customer_email, ordered_on, total, status]) => ({ number, member_id, customer_email, ordered_on, total, status }));

// ── the setup around the tables ───────────────────────────────────────────────

export const OPTION_LIST = {
  key: 'glazes',
  name: 'Glazes',
  items: [
    { value: 'celadon', label: 'Celadon', tone: 'pos' },
    { value: 'tenmoku', label: 'Tenmoku', tone: 'neutral' },
    { value: 'shino', label: 'Shino', tone: 'warn' },
    { value: 'ash', label: 'Wood ash', tone: 'muted' },
    { value: 'chun', label: 'Chun blue', tone: 'info' },
  ],
};

/** Table labels, English and the second language (`table.label` overrides). */
export const TABLE_LABELS = {
  members: [['Member', 'Members'], ['Membre', 'Membres']],
  classes: [['Class', 'Classes'], ['Cours', 'Cours']],
  firings: [['Firing', 'Firings'], ['Cuisson', 'Cuissons']],
  pieces: [['Piece', 'Pieces'], ['Pièce', 'Pièces']],
  shop_orders: [['Shop order', 'Shop orders'], ['Commande', 'Commandes']],
};

/** Column labels in both languages (`column.label` overrides). */
export const COLUMN_LABELS = [
  ['pieces', 'glaze', 'Glaze', 'Émail'],
  ['firings', 'fired_on', 'Fired on', 'Date de cuisson'],
  ['classes', 'starts_on', 'Starts on', 'Début'],
];

/** Edited UI wording in the second language (keys from the en-US source). */
export const UI_WORDING = [{ namespace: 'common', key: 'account.title', value: 'Mon compte' }];

/** The way to pay that needs no keys, named in both languages. */
export const WAY_LABEL = { 'en-US': 'Pay at the studio counter', 'fr-FR': "Payer au comptoir de l'atelier" };

/** The public endpoint: next classes, for the studio's own website. */
export const ENDPOINT = {
  ref: 'upcoming_classes',
  select: ['id', 'title', 'level', 'starts_on', 'seats', 'price'],
  order: 'starts_on.asc',
};
