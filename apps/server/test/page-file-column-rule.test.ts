// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FILE COLUMN IS DRAWN AS A FILE ON THE PAGE TOO.
 *
 * A print shop keeps a proof's PDF in a text column its app marks a file
 * (`rules.file`). The form uploads into it, so the column holds a stored
 * file's id; the list and the record must show that file, not its id as text.
 * The page reply carries the rule's `file` block on the column, as the form's
 * facts do. Read by the shop's owner (no Super Admin), on every engine this
 * run can reach.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, appManifest, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

function proofs(): Record<string, unknown> {
  return appManifest('proofs', {
    version: '1.0.0',
    compatibility: { minAdminiumVersion: '0.3.53', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'proofs',
          columns: [
            pk,
            { ref: 'name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'file', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['pdf'], maxBytes: 1048576 } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'proofs-list', template: 'page-crud', title: { key: 'mft.proofs.list', fallback: 'Proofs' }, nav: { group: 'manage', icon: 'file', order: 1 }, bindings: { rows: 'proofs' } }],
    roles: [{ key: 'owner', name: 'Owner', permissions: ['table:@proofs:read', 'page:@proofs-list:view'] }],
  });
}

describe.each(LEGS)('a file column on a page — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let cookie = '';

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await h.stageApp(proofs());
    const installed = await h.install('proofs', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const user = await usersRepo(h.meta).create({ email: 'owner@proofs.test', name: 'Owner', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('proofs-owner'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.15.0.3', payload: { email: 'owner@proofs.test', password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('carries the rule’s file block on the list’s column, as on the form’s', async () => {
    const row = await h.meta.db.selectFrom('adminium_pages').select('id').where('slug', '=', 'proofs-list').executeTakeFirstOrThrow();
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/pages/${row.id}`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const reply = res.json() as { data: { config: { columns: { name: string; file?: { accept?: string[] } }[] } }; columnFacts?: { columns: { spec: { name: string; file?: unknown } }[] } };
    const form = reply.columnFacts?.columns.find((column) => column.spec.name === 'file')?.spec.file;
    expect(form).toMatchObject({ accept: ['pdf'] });
    expect(reply.data.config.columns.find((column) => column.name === 'file')?.file).toEqual(form);
  });
});
