// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SMALL ADD-ON THAT KEEPS CUSTOMERS' REVIEWS, AND TWO APPS THAT BIND IT.
 *
 * The kit declares `addOn.reviews`: its reviews and their totals, each held
 * to the columns the engine writes, shared by the apps it is attached to and
 * held to each app's own rows (`appColumn`). An app's role reads and
 * moderates its own app's reviews; its public entries read the published
 * reviews and the totals through each app's key.
 *
 * Each app (`shop`, `studio`) sells products in orders with lines; a line
 * may be reviewed once its order is shipped (`review`), by the customer the
 * order's claim reaches. Its orders open by their own link on the `link` key,
 * and to a signed-in customer on the app's own key.
 */
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

export const REVIEWS_KIT = 'reviews-kit';
export const REVIEWS_FLOOR = '0.3.68';
export const REVIEWS_TABLE = 'reviews_kit_reviews';
export const TOTALS_TABLE = 'reviews_kit_review_totals';
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT' } as const;

const text = (ref: string, maxLength: number, extra: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...extra });
const moment = (ref: string, nullable = true) => ({ ref, type: 'timestamptz', ...(nullable ? { nullable: true } : {}) });
const whole = (ref: string) => ({ ref, type: 'int', default: 0 });

/** The kit: its reviews and totals, what an app's role may hold of them, and its two public reads. */
export function reviewsKitManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  const readable = ['id', 'app', 'subject_table', 'subject_key', 'about_table', 'about_key', 'about_name', 'about_detail', 'stars', 'title', 'body', 'shown_name', 'state', 'hide_reason', 'reply', 'replied_at', 'submitted_at'];
  return {
    ...IDENTITY,
    kind: 'add-on',
    key: REVIEWS_KIT,
    name: 'Reviews kit',
    version: '1.0.0',
    description: { key: 'reviews-kit.description', fallback: 'What customers say.' },
    categories: ['marketing'],
    compatibility: { minAdminiumVersion: REVIEWS_FLOOR },
    addOn: { attaches: [{ app: 'shop', range: '*' }, { app: 'studio', range: '*' }], connect: { kind: 'none' }, reviews: { reviews: 'reviews', totals: 'review_totals' } },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'reviews',
          unique: [['app', 'subject_table', 'subject_key']],
          appGrants: { actions: ['read', 'update'], readable, writable: ['state', 'hide_reason', 'reply'], appColumn: 'app' },
          columns: [
            pk,
            text('app', 64),
            text('subject_table', 64),
            text('subject_key', 200),
            text('about_table', 64),
            text('about_key', 200),
            text('about_name', 200),
            text('about_detail', 200, { nullable: true }),
            { ref: 'stars', type: 'int' },
            text('title', 80, { nullable: true }),
            { ref: 'body', type: 'text', nullable: true },
            text('shown_name', 80, { default: '' }),
            { ref: 'state', type: 'enum', enum: ['waiting', 'published', 'hidden'], default: 'waiting' },
            { ref: 'hide_reason', type: 'enum', enum: ['abusive', 'names-someone', 'not-about-us', 'looks-fake'], nullable: true },
            { ref: 'reply', type: 'text', nullable: true },
            moment('replied_at'),
            moment('submitted_at', false),
            text('person_table', 64, { nullable: true }),
            text('person_key', 200, { nullable: true }),
          ],
        },
        {
          ref: 'review_totals',
          unique: [['app', 'about_table', 'about_key']],
          appGrants: { actions: ['read'], appColumn: 'app' },
          columns: [pk, text('app', 64), text('about_table', 64), text('about_key', 200), whole('count'), whole('sum'), whole('c1'), whole('c2'), whole('c3'), whole('c4'), whole('c5')],
        },
      ],
    },
    publicAccess: [
      { table: 'reviews', methods: ['GET'], appColumn: 'app', filters: [{ column: 'state', op: 'eq', value: 'published' }], select: ['id', 'about_key', 'stars', 'title', 'body', 'shown_name', 'reply', 'submitted_at'] },
      { table: 'review_totals', methods: ['GET'], appColumn: 'app', select: ['id', 'about_table', 'about_key', 'count', 'sum', 'c1', 'c2', 'c3', 'c4', 'c5'] },
    ],
    ...over,
  };
}

/** A shop whose shipped order lines may be reviewed, with an owner who moderates its reviews. */
export function reviewedShopManifest(key: 'shop' | 'studio', over: Record<string, unknown> = {}): Record<string, unknown> {
  const lineSelect = ['id', 'order_id', 'product_id', 'product_name', 'reviewed_at'];
  return {
    ...IDENTITY,
    kind: 'app',
    key,
    name: key === 'shop' ? 'Shop' : 'Studio',
    version: '1.0.0',
    description: { key: `mft.${key}.desc`, fallback: 'A shop.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: REVIEWS_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', columns: [pk, text('first_name', 80, { nullable: true }), text('last_name', 80, { nullable: true }), text('email', 120, { nullable: true }), moment('forgotten_at')] },
        { ref: 'products', columns: [pk, text('name', 80, { nullable: true })] },
        {
          ref: 'orders',
          columns: [
            pk,
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'status', type: 'enum', enum: ['new', 'shipped', 'cancelled'], default: 'new' },
            text('link_token', 16, { nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } }),
          ],
        },
        {
          ref: 'order_lines',
          review: {
            by: { addOn: REVIEWS_KIT },
            about: { link: 'product_id', name: 'product_name' },
            when: { path: ['order_id', 'status'], in: ['shipped'] },
            person: ['order_id', 'customer_id'],
            shownName: { first: 'first_name', last: 'last_name' },
            stamp: 'reviewed_at',
          },
          columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'product_id', type: 'fk', references: 'products', nullable: true }, text('product_name', 80, { nullable: true }), moment('reviewed_at')],
        },
      ],
    },
    pages: [{ ref: `${key}-home`, template: 'page-dashboard', title: { key: `mft.${key}.page.home`, fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/' } },
    ],
    addOns: { requires: [{ key: REVIEWS_KIT, range: '^1.0.0', reason: { 'en-US': 'Customers review what they bought.' } }] },
    people: [{ table: 'customers', kind: 'people', email: 'email', name: 'first_name' }],
    roles: [{ key: 'owner', name: 'Owner', permissions: ['app:@:staff', 'table:@orders:read'], tables: [{ addOn: REVIEWS_KIT, table: 'reviews', actions: ['read', 'update'] }, { addOn: REVIEWS_KIT, table: 'review_totals', actions: ['read'] }] }],
    publicKeys: { link: {} },
    publicAccess: [
      { table: 'products', methods: ['GET'], select: ['id', 'name'] },
      { table: 'customers', methods: ['GET'], claim: { match: ['email'], verify: 'email-code', email: 'email' }, forget: { columns: ['first_name', 'last_name', 'email'], stamp: 'forgotten_at' }, select: ['id'] },
      { table: 'orders', methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: ['id', 'status'] },
      { table: 'order_lines', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: lineSelect },
      { table: 'orders', key: 'link', methods: ['GET'], claim: { by: 'token', column: 'link_token', own: true }, select: ['id', 'status'] },
      { table: 'order_lines', key: 'link', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: lineSelect },
    ],
    ...over,
  };
}
