// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small add-on with a public side: gift cards whose balance a guest reads
 * by typing the card's code on the shop's own page (an entry served through
 * the app's key), and a card opened by the link it was sent with (the
 * add-on's one key of its own, which only reads). And a shop that names it.
 */
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

export const CARDS_KIT = 'cards-kit';
/** The add-on's entries, by the refs their endpoints are stored under. */
export const BALANCE_REF = 'cards_kit_cards_unlocked';
export const LINK_REF = 'cards_kit_cards_claimed';
export const LINK_KEY = 'cards-link';

export function cardsKitManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: CARDS_KIT,
    name: 'Cards kit',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'cards.description', fallback: 'Gift cards.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1 },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'cards',
          columns: [
            pk,
            { ref: 'code', type: 'text', maxLength: 24, rules: { code: { prefix: 'GC-', length: 12 } } },
            { ref: 'link_token', type: 'text', maxLength: 24, nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } },
            { ref: 'label', type: 'text', maxLength: 80, nullable: true },
            { ref: 'status', type: 'enum', enum: ['active', 'blocked'], default: 'active' },
            { ref: 'balance', type: 'decimal', scale: 2, default: 0 },
          ],
        },
        { ref: 'notes', columns: [pk, { ref: 'card_id', type: 'fk', references: 'cards' }, { ref: 'text', type: 'text', maxLength: 200, nullable: true }] },
      ],
    },
    publicKeys: { [LINK_KEY]: {} },
    publicAccess: [
      // Typed on the shop's page: through the shop's key.
      { table: 'cards', methods: ['GET'], select: ['id', 'balance'], unlockBy: { header: true, column: 'code', self: true, length: 12, where: [{ column: 'status', eq: 'active' }] } },
      // Opened by the link a card was sent with: through the add-on's own key.
      { table: 'cards', key: LINK_KEY, methods: ['GET'], select: ['id', 'label', 'balance'], claim: { by: 'token', column: 'link_token' } },
    ],
    roles: [{ key: 'manager', name: 'Cards manager', permissions: ['table:@cards:read', 'table:@cards:update', 'table:@notes:read'] }],
    ...over,
  };
}

/** A shop with a public side of its own, which names the cards kit. */
export function shopManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.18', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
        { ref: 'hours', columns: [pk, { ref: 'day', type: 'text', maxLength: 16, nullable: true }] },
      ],
    },
    pages: [{ ref: 'shop-home', template: 'page-dashboard', title: { key: 'mft.shop.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/' } },
    ],
    addOns: { suggests: [{ key: CARDS_KIT, range: '*', reason: { 'en-US': 'Sell and take gift cards.' } }] },
    publicAccess: [{ table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] }],
    ...over,
  };
}
