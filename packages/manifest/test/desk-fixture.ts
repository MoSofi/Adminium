// SPDX-License-Identifier: AGPL-3.0-only
import { ADD_ON_INSTALL_FLOOR } from '../src/index.js';

const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR } } as const;

/** The four forms a record page's button takes, on a card. */
export const CARD_ACTIONS = [
  { id: 'activate', label: { 'en-US': 'Activate', 'de-DE': 'Aktivieren' }, move: { to: 'active' }, tone: 'primary', confirm: 'Activate this card?', set: { activated_at: { now: true } }, ask: ['note'] },
  { id: 'send-again', label: 'Send again', set: { resent_at: { now: true }, resends: 1 }, in: ['active'], tone: 'neutral', confirm: { 'en-US': 'Send it once more?' }, ask: ['recipient_email'] },
  { id: 'find', label: 'Open at the desk', link: { addOnPage: 'desk-look-up', param: 'card' }, in: ['active', 'closed'], tone: 'neutral' },
  { id: 'top-up', label: 'Top up', child: { table: 'card_actions', via: 'card_id', form: ['amount', 'note'] }, set: { action: 'top_up' }, in: ['active'], tone: 'primary', confirm: 'Add this to the card?' },
] as const;

export const BULK = {
  id: 'reissue',
  label: 'Reissue',
  child: { table: 'card_actions', via: 'card_id', form: ['note'] },
  set: { action: 'reissue' },
  where: { column: 'status', eq: 'active' },
  confirm: { title: 'Reissue {count} cards?', body: { 'en-US': 'Each of the {count} gets a new action.' }, columns: ['label', 'balance'] },
  done: '{count} reissued',
} as const;

export const LOOK_UP = {
  kinds: [
    { id: 'gift-card', table: 'cards', code: 'code', prefix: 'GC-', where: [{ column: 'kind', eq: 'gift' }], show: ['label', 'status', 'balance'], rows: { table: 'card_actions', via: 'card_id', columns: ['action', 'amount', 'note'] } },
    { id: 'pass', table: 'cards', code: 'code', prefix: 'PS-', where: [{ column: 'kind', in: ['pass', 'pack'] }], show: ['label', 'status'] },
    { id: 'word', table: 'words', code: 'word', show: ['active'] },
  ],
  address: { table: 'cards', column: 'owner_email', show: ['kind', 'status', 'balance'] },
} as const;

/** An add-on whose cards have buttons, tab words, a bulk action and a look-up. */
export const DESK = {
  ...IDENTITY,
  kind: 'add-on',
  key: 'desk',
  name: 'Desk kit',
  version: '1.0.0',
  description: { key: 'desk.description', fallback: 'Cards at a desk.' },
  categories: ['data'],
  addOn: {
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    hostApi: 1,
    pages: [{ ref: 'desk-look-up', title: { key: 'desk.lookUp', fallback: 'Look up' }, icon: 'search', client: 'pages/look-up.js' }],
    lookUp: LOOK_UP,
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'cards',
        states: {
          column: 'status',
          initial: 'draft',
          moves: { draft: ['active'], active: ['closed', { to: 'spent', planned: true }] },
          actions: CARD_ACTIONS,
        },
        columns: [
          pk,
          { ref: 'status', type: 'enum', enum: ['draft', 'active', 'closed', 'spent'], default: 'draft' },
          { ref: 'kind', type: 'enum', enum: ['gift', 'pass', 'pack'], default: 'gift' },
          { ref: 'code', type: 'text', maxLength: 16, rules: { code: { length: 12, prefix: 'GC-' } } },
          { ref: 'label', type: 'text', maxLength: 8, nullable: true, rules: { codeLast4: { of: 'code' } } },
          { ref: 'pin', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } },
          { ref: 'balance', type: 'decimal', scale: 2, default: 0 },
          { ref: 'owner_email', type: 'text', maxLength: 200, nullable: true, rules: { normalize: 'email' } },
          { ref: 'recipient_email', type: 'text', maxLength: 200, nullable: true },
          { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          { ref: 'resends', type: 'int', default: 0 },
          { ref: 'activated_at', type: 'timestamptz', nullable: true },
          { ref: 'resent_at', type: 'timestamptz', nullable: true },
        ],
      },
      {
        ref: 'card_actions',
        columns: [
          pk,
          { ref: 'card_id', type: 'fk', references: 'cards' },
          { ref: 'action', type: 'enum', enum: ['top_up', 'reissue'], default: 'top_up' },
          { ref: 'amount', type: 'decimal', scale: 2, default: 0 },
          { ref: 'note', type: 'text', maxLength: 200, nullable: true },
        ],
      },
      {
        ref: 'words',
        columns: [pk, { ref: 'word', type: 'text', maxLength: 40, unique: true }, { ref: 'active', type: 'bool', default: true }],
      },
    ],
  },
  pages: [
    {
      ref: 'desk-cards',
      template: 'page-crud',
      title: { key: 'desk.cards', fallback: 'Cards' },
      nav: { group: 'manage', icon: 'gift', order: 1 },
      bindings: { main: 'cards' },
      config: {
        tabs: { card_actions: { empty: 'Nothing done yet', emptyBody: { 'en-US': 'A top up shows here.' }, noNew: true } },
        filters: [{ column: 'status', control: 'any-of', label: 'State' }, { column: 'kind' }, { column: 'activated_at' }, { column: 'balance', control: 'number-range' }],
        bulk: [BULK],
      },
    },
  ],
} as const;

/** An app whose roles reach the kit's tables, with two links on its overview. */
export const DESK_HOST = {
  ...IDENTITY,
  kind: 'app',
  key: 'desk-host',
  name: 'Desk host',
  version: '0.3.0',
  description: { key: 'host.description', fallback: 'A shop with a desk.' },
  categories: ['commerce'],
  pages: [{ ref: 'sales', template: 'page-crud', title: { key: 't', fallback: 'Sales' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'sales' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'desk', range: '>=1.0.0', reason: { 'en-US': 'Cards.' } }] },
  requiredSchema: { prefixed: true, tables: [{ ref: 'sales', columns: [pk, { ref: 'total', type: 'decimal', scale: 2, default: 0 }] }] },
  roles: [
    {
      key: 'cashier',
      name: 'Cashier',
      permissions: ['table:@sales:read'],
      tables: [
        { addOn: 'desk', table: 'cards', actions: ['read', 'update'], limit: { readable: ['id', 'label', 'status'], writable: ['status'], writableValues: { status: ['closed'] } } },
        { addOn: 'desk', table: 'card_actions', actions: ['read', 'create'], limit: { creatable: ['card_id', 'amount'] } },
      ],
    },
  ],
} as const;
