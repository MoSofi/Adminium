// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A real app bundle, built in the test.
 *
 * The install path's first defence is `archive.ts`'s hardened USTAR allowlist,
 * so a fixture that is not a genuine npm-shaped tarball would be refused before
 * any of this suite's assertions were reached — and a fixture checked into the
 * repo would be bytes nobody can read in a review. This builds one member by
 * member, the same way `apps/server/test/app-install.test.ts` does.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const BLOCK = 512;

function put(block: Uint8Array, at: number, length: number, value: string): void {
  block.set(Buffer.from(value, 'latin1').subarray(0, length), at);
}

function tarball(files: Record<string, string>): Buffer {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const header = new Uint8Array(BLOCK);
    put(header, 0, 100, `package/${path}`);
    put(header, 100, 8, '0000644\0');
    put(header, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(header, 136, 12, '00000000000\0');
    put(header, 156, 1, '0');
    put(header, 257, 6, 'ustar\0');
    put(header, 263, 2, '00');
    header.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    put(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);

    const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const member = new Uint8Array(BLOCK + body.length + padding);
    member.set(header, 0);
    member.set(body, BLOCK);
    members.push(member);
  }
  members.push(new Uint8Array(BLOCK * 2));
  return Buffer.from(gzipSync(Buffer.concat(members.map((m) => Buffer.from(m)))));
}

/** The key the app specs share, so none leaves a staged package behind. */
export const APP_KEY = 'e2e-desk';
export const APP_VERSION = '1.0.0';
/**
 * A second version of the same app, for the update leg (48 G8-D6). Staging it
 * beside 1.0.0 is what gives the installed row an update that needs NO
 * download — which is how `app-catalogue.spec.ts` exercises Update without this
 * suite ever reaching downloads.adminium.dev.
 */
export const APP_NEXT_VERSION = '1.1.0';

/** Marks the served bundle, so "is this really our bundle" is one assertion. */
export const STAFF_MARK = 'e2e-app-staff';
export const CUSTOMER_MARK = 'e2e-app-customer';

/**
 * What an install over the API answers for `shippers`. Northwind made that
 * table, not Adminium, so the install asks what to do with it — until an
 * earlier install in the same run has recorded it, after which it is taken
 * back by default. The answer is the same either way: use it as it is.
 */
export const REUSE_CHOICES = { shippers: { action: 'reuse' } } as const;

/**
 * `requiredSchema` decides what the plan step shows, and the two specs want
 * different things from it:
 *
 *  - `reuse` names `shippers`, a table stock Northwind already has with the
 *    columns below, so the plan is installable and creates NOTHING. That is
 *    what the functional spec installs for real — this suite shares one seeded
 *    dataset and a spec that adds a table to it leaves drift for every other.
 *  - `create` names a table nothing has, so the plan step renders the Create
 *    badge and the DDL preview the comp draws. The a11y spec walks to that step
 *    and then CANCELS: planning writes nothing by design, which is the whole
 *    reason consent has a step of its own.
 */
const TABLES = {
  reuse: [
    {
      ref: 'shippers',
      columns: [
        /*
         * Not declared as the key. An app's int key numbers new rows itself,
         * and Northwind's `smallint` key does not, so claiming it would make
         * "use it as it is" rebuild a table every spec shares. This app never
         * inserts a shipper, so it has no need to.
         */
        { ref: 'shipper_id', type: 'int' },
        { ref: 'company_name', type: 'text' },
      ],
    },
  ],
  /*
   * The Overview's card families (P2) over Northwind's own tables, used as they
   * are: nothing is created and no key is claimed (see `reuse`), so the
   * composed dashboard can be installed into the dataset every spec shares.
   */
  overview: [
    {
      ref: 'orders',
      columns: [
        { ref: 'order_id', type: 'int' },
        { ref: 'order_date', type: 'date' },
        { ref: 'ship_via', type: 'int' },
        { ref: 'freight', type: 'float' },
        { ref: 'ship_country', type: 'text' },
      ],
    },
    {
      ref: 'products',
      columns: [
        { ref: 'product_name', type: 'text' },
        { ref: 'unit_price', type: 'float' },
        { ref: 'units_in_stock', type: 'int' },
        // Required and without a default: declared, or reuse is refused (an app
        // that never fills it could save no row there).
        { ref: 'discontinued', type: 'int' },
      ],
    },
  ],
  create: [
    {
      ref: 'e2e_app_probe',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'label', type: 'text' },
      ],
    },
  ],
} as const;

/**
 * One sample row per shape, in the table that shape declares. The suite never
 * ADDS it — `shippers` is Northwind's own and every spec shares it — but the
 * install step, the Add dialog and the app's page all read that it is there.
 */
const SAMPLE = {
  reuse: { ref: 'shippers', rows: [{ shipper_id: 901, company_name: 'Sample Freight' }] },
  overview: { ref: 'orders', rows: [{ order_id: 99001, ship_country: 'Nowhere' }] },
  create: { ref: 'e2e_app_probe', rows: [{ label: 'Sample probe' }] },
} as const;

const orders = { name: 'orders', type: 'table' } as const;

/**
 * The Overview's layout, card family by card family (`POS Overview.dc.html`):
 * the day control, KPI cards (one windowed to the chosen day, which is empty on
 * Northwind's 1990s dates — the empty state, drawn for real), bars over time, a
 * donut, a ranking and a mini-table.
 */
const OVERVIEW_LAYOUT = {
  version: 1,
  toolbar: { day: true },
  items: [
    { i: 'kpi-orders', widget: 'kpi-stat-card', x: 0, y: 0, w: 4, h: 3, config: { title: 'Orders', metricFormat: 'plain', binding: { kind: 'table-query', source: orders, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'orders' }] } } },
    { i: 'kpi-freight', widget: 'kpi-stat-card', x: 4, y: 0, w: 4, h: 3, config: { title: 'Freight', metricFormat: 'currency', binding: { kind: 'table-query', source: orders, shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'freight', alias: 'freight' }] } } },
    { i: 'kpi-today', widget: 'kpi-stat-card', x: 8, y: 0, w: 4, h: 3, config: { title: 'Orders on the day', metricFormat: 'plain', binding: { kind: 'table-query', source: orders, shape: 'metric+delta', aggregations: [{ fn: 'count', alias: 'orders' }], window: { column: 'order_date', last: 1, unit: 'day', param: 'day' } } } },
    { i: 'by-month', widget: 'chart-bar', x: 0, y: 3, w: 8, h: 8, config: { title: 'Freight by month', binding: { kind: 'table-query', source: orders, shape: 'timeseries', aggregations: [{ fn: 'sum', column: 'freight', alias: 'freight' }], bucket: { column: 'order_date', unit: 'month' } } } },
    { i: 'by-country', widget: 'chart-donut', x: 8, y: 3, w: 4, h: 8, config: { title: 'Orders by country', binding: { kind: 'table-query', source: orders, shape: 'categorical', aggregations: [{ fn: 'count', alias: 'orders' }], groupBy: ['ship_country'], limit: 6 } } },
    { i: 'stock', widget: 'chart-ranking-bars', x: 0, y: 11, w: 6, h: 8, config: { title: 'Most in stock', binding: { kind: 'table-query', source: { name: 'products', type: 'table' }, shape: 'categorical', aggregations: [{ fn: 'sum', column: 'units_in_stock', alias: 'stock' }], groupBy: ['product_name'], limit: 5 } } },
    { i: 'latest', widget: 'mini-table', x: 6, y: 11, w: 6, h: 8, config: { title: 'Latest orders', binding: { kind: 'table-query', source: orders, shape: 'record-list', select: ['order_id', 'order_date', 'ship_country', 'freight'], orderBy: [{ column: 'order_date', dir: 'desc' }], limit: 6 } } },
  ],
} as const;

export const SAMPLE_FILE = `seeds/${APP_KEY}.sample.json`;

function manifest(shape: keyof typeof TABLES, version: string): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: APP_KEY,
    name: 'E2E Desk',
    version,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.e2e.desc', fallback: 'A bundle built by the e2e suite.' },
    categories: ['operations'],
    /*
     * A floor this server MEETS.
     *
     * It was `1.0.0` — a version no Adminium has ever been — which went
     * unnoticed while nothing read the field. Now that an install refuses a
     * bundle needing a newer Adminium, that fixture value made every upload in
     * this suite fail with REQUIRES_NEWER_ADMINIUM.
     *
     * `0.2.8` rather than the current version: a literal that tracked the
     * release would make this fixture assert nothing, and the point of a floor
     * in test data is that it is BELOW the server, not equal to it. The refusal
     * path has its own test, which raises the floor deliberately.
     */
    compatibility: { minAdminiumVersion: '0.2.8', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: { tables: TABLES[shape] },
    sampleData: { file: SAMPLE_FILE },
    pages: [
      {
        ref: 'e2e-dashboard',
        template: 'page-dashboard',
        // Not "Dashboard": an installed app's pages land in the sidebar, and a
        // second "Dashboard" there is what the generated-app spec clicks first.
        title: { key: 'mft.e2e.page', fallback: 'E2E Desk overview' },
        nav: { group: 'manifest:e2e', icon: 'layout-dashboard', order: 1 },
        ...(shape === 'overview' ? { config: { layout: OVERVIEW_LAYOUT } } : {}),
      },
    ],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { book: '/' } },
    ],
  };
}

export interface Bundle {
  buffer: Buffer;
  /** npm's SRI spelling, which is what the upload query carries. */
  integrity: string;
}

/**
 * `version` also lands IN THE SERVED HTML, which is the only way a test can
 * tell one version's tree from another's over HTTP: an update that swapped the
 * row but kept serving the old files would otherwise answer exactly the same.
 */
export function appBundle(
  shape: keyof typeof TABLES = 'reuse',
  version: string = APP_VERSION,
): Bundle {
  const buffer = tarball({
    'manifest.json': JSON.stringify(manifest(shape, version)),
    [SAMPLE_FILE]: JSON.stringify({ format: 'adminium.sample/1', app: APP_KEY, tables: [SAMPLE[shape]] }),
    'staff/index.html': `<!doctype html><html lang="en"><head><title>Staff</title></head><body data-app="${STAFF_MARK}" data-version="${version}">Staff</body></html>`,
    'customer/index.html': `<!doctype html><html lang="en"><head><title>Customer</title></head><body data-app="${CUSTOMER_MARK}" data-version="${version}">Customer</body></html>`,
    'staff/surface.json': JSON.stringify({
      v: 1,
      appLabels: { 'en-US': 'E2E Desk' },
      nav: [{ id: 'home', path: '', icon: 'house', labels: { 'en-US': 'Desk' } }],
    }),
  });
  return { buffer, integrity: `sha512-${createHash('sha512').update(buffer).digest('base64')}` };
}
