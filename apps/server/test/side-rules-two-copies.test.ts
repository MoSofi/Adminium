// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAFF SIDE ASKS FOR ITS OWN COPY'S RULES when the app is installed on two
 * databases.
 *
 * `/apps/<key>/rules` is named by the app's key alone, so with two copies it
 * must be told which one: without it the server answers 409
 * `APP_INSTALL_AMBIGUOUS`, even to a clerk who opens one copy. The side's
 * served config names its copy (`installId`), and the side sends it back as
 * `X-Adminium-Install`. Driven through the side module itself, against the
 * real routes, as each copy's clerk.
 */
import { manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const id = { ref: 'id', type: 'int', role: 'pk' };

const bills = {
  kind: 'app',
  manifestVersion: 1,
  key: 'bills',
  name: 'Bills',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'Bills.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: { prefixed: true, tables: [{ ref: 'invoices', columns: [id, { ref: 'number', type: 'text', maxLength: 20, nullable: true }] }] },
  pages: [{ ref: 'bills-invoices', template: 'page-crud', title: { key: 'i', fallback: 'Invoices' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'invoices' } }],
  roles: [{ key: 'clerk', name: 'Clerk', permissions: ['app:@:staff', 'table:@invoices:read'] }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

/** The side module as the app's staff bundle has it: its key written in. */
async function bundledSide(): Promise<typeof import('../src/side/index.js')> {
  const defined = globalThis as Record<string, unknown>;
  defined['__ADMINIUM_APP_KEY__'] = 'bills';
  defined['__ADMINIUM_SIDE__'] = 'staff';
  vi.resetModules();
  try {
    return await import('../src/side/index.js');
  } finally {
    delete defined['__ADMINIUM_APP_KEY__'];
    delete defined['__ADMINIUM_SIDE__'];
  }
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a staff side's rules with the app on two databases [${dialect}]`, () => {
    it('names its own copy, so each copy’s clerk is answered', async () => {
      let held: ReadonlySet<string> | null = null;
      const h = (open = await installHarness(dialect, { can: (permission) => held === null || held.has(permission) }));
      expect((await h.install(bills)).statusCode).toBe(200);
      const other = await h.otherConnection();
      expect((await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'bills', version: '1.0.0', connectionId: other.id } })).statusCode).toBe(200);
      const [first, second] = await manifestsRepo(h.meta, PLAIN).listByKey('bills');

      // Without a copy named, the key alone is refused.
      held = new Set(['app:bills~second:staff']);
      expect((await h.inject({ method: 'GET', url: '/apps/bills/rules' })).statusCode).toBe(409);

      const side = await bundledSide();
      for (const [copy, grant, address] of [
        [second!, 'app:bills~second:staff', '/apps/bills/second/staff/'],
        [first!, 'app:bills:staff', '/apps/bills/staff/'],
      ] as const) {
        held = new Set([grant]);
        const asked: { url: string; install: string | null }[] = [];
        const fetch = (async (input: string, init: RequestInit = {}) => {
          const url = String(input);
          asked.push({ url, install: new Headers(init.headers).get('x-adminium-install') });
          // The config the server serves beside the copy's screens names the copy.
          if (url.endsWith('surface-config.json')) return Response.json({ connectionId: copy.row.scopeKey, installId: copy.row.id, slug: copy.row.instanceSlug });
          const reply = await h.inject({ method: (init.method ?? 'GET') as 'GET', url: url.replace(/^\/api\/v1/, ''), headers: Object.fromEntries(new Headers(init.headers)) } as never);
          return new Response(reply.body, { status: reply.statusCode, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof globalThis.fetch;
        const staff = await side.connectStaff({ fetch, pathname: address });
        await expect(staff.rules(), address).resolves.toEqual([]);
        expect(asked.find((call) => call.url.endsWith('/rules'))?.install).toBe(copy.row.id);
      }
    }, 120_000);
  });
}
