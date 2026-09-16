// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A real app bundle, built in the test (47-app-installation.md step 1).
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
        { ref: 'shipper_id', type: 'int', role: 'pk' },
        { ref: 'company_name', type: 'text' },
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
    compatibility: { minAdminiumVersion: '1.0.0', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: { tables: TABLES[shape] },
    pages: [
      {
        ref: 'e2e-dashboard',
        template: 'page-dashboard',
        title: { key: 'mft.e2e.page', fallback: 'Dashboard' },
        nav: { group: 'manifest:e2e', icon: 'layout-dashboard', order: 1 },
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
