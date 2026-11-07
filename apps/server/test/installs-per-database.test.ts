// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One app, installed on two databases: two installs that share nothing.
 *
 * Fernhill's copy is the first: it owns the bare addresses and grants. Kiln's
 * (the second database, "Second") gets the slug `second` and its own roles,
 * templates, outbox and address. Then:
 *  - every key-only route answers `APP_INSTALL_AMBIGUOUS` without a
 *    selector, and the selector's install with one — never a guess;
 *  - one version per app: a different version on the second database is
 *    refused;
 *  - disabling or uninstalling one leaves the other's row, roles, templates,
 *    outbox, settings and files untouched;
 *  - install 1's grants open nothing of install 2's.
 */
import { addOnSettingsRepo, appOutboxesRepo, emailTemplatesRepo, manifestsRepo, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { grantKeyOf } from '../src/installs/resolve.js';
import { resolveForRoles } from '../src/rbac/resolver.js';
import { isGranted } from '../src/rbac/permissions.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

function bills(version = '1.0.0'): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'bills',
    name: 'Bills',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Bills.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254 }, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'invoices', columns: [id, fk('client_id', 'clients'), { ref: 'number', type: 'text', maxLength: 20, nullable: true }] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['sent'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
            fk('client_id', 'clients'),
            fk('invoice_id', 'invoices'),
            { ref: 'error', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'bills-invoices', template: 'page-crud', title: { key: 'i', fallback: 'Invoices' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'invoices' } }],
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['app:@:staff', 'table:@invoices:read'] }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error' },
      links: { client: 'client_id', invoice: 'invoice_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      kinds: { sent: 'bills-sent' },
    },
    emailTemplates: [{ key: 'bills-sent', name: 'Invoice sent', locales: { 'en-US': { subject: 'Invoice {{invoice.number}}', blocks: [{ block: 'email.text', data: { text: 'Here it is.' } }] } } }],
  };
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`one app on two databases [${dialect}]`, () => {
    it('keeps two installs apart, and every key-only route says which it means', async () => {
      const h = (open = await installHarness(dialect));
      const first = await h.install(bills());
      expect(first.statusCode, first.body).toBe(200);
      const other = await h.otherConnection();
      const second = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'bills', version: '1.0.0', connectionId: other.id } });
      expect(second.statusCode, second.body).toBe(200);

      const manifests = manifestsRepo(h.meta, PLAIN);
      const [fernhill, kiln] = await manifests.listByKey('bills');
      expect(fernhill!.row).toMatchObject({ scopeKey: h.connectionId, instanceSlug: '', status: 'installed' });
      expect(kiln!.row).toMatchObject({ scopeKey: other.id, instanceSlug: 'second', status: 'installed' });
      expect(grantKeyOf(kiln!.row)).toBe('bills~second');

      // Each install's own roles, templates and outbox.
      const roles = rolesRepo(h.meta);
      expect((await roles.listForInstall(fernhill!.row.id)).map((role) => role.slug)).toEqual(['bills-clerk']);
      expect((await roles.listForInstall(kiln!.row.id)).map((role) => role.slug)).toEqual(['bills-second-clerk']);
      const templates = emailTemplatesRepo(h.meta);
      expect((await templates.findByKeyLocale('bills-sent', 'en_US'))?.installId).toBe(fernhill!.row.id);
      expect((await templates.findByKeyLocale('bills-second-sent', 'en_US'))?.installId).toBe(kiln!.row.id);
      const kilnBox = await appOutboxesRepo(h.meta).findByInstall(kiln!.row.id);
      expect(JSON.parse(kilnBox!.definition).kinds).toEqual({ sent: 'bills-second-sent' });
      expect(JSON.parse((await appOutboxesRepo(h.meta).findByInstall(fernhill!.row.id))!.definition).kinds).toEqual({ sent: 'bills-sent' });

      // A key-only route with no selector: which one? Never a guess.
      const ambiguous = await h.inject({ method: 'GET', url: '/apps/bills/settings' });
      expect(ambiguous.statusCode, ambiguous.body).toBe(409);
      const said = JSON.parse(ambiguous.body) as { error: { code: string; details: { installs: { connectionId: string; slug: string }[] } } };
      expect(said.error.code).toBe('APP_INSTALL_AMBIGUOUS');
      expect(said.error.details.installs.map((one) => one.slug).sort()).toEqual(['', 'second']);
      // The header, or the database, names one.
      const byHeader = await h.inject({ method: 'GET', url: '/apps/bills/settings', headers: { 'x-adminium-install': kiln!.row.id } } as never);
      expect(byHeader.statusCode, byHeader.body).toBe(200);
      const byConnection = await h.inject({ method: 'GET', url: `/apps/bills/settings?connectionId=${encodeURIComponent(h.connectionId)}` });
      expect(byConnection.statusCode, byConnection.body).toBe(200);
      // Two selectors naming two installs is refused, not settled.
      const both = await h.inject({ method: 'GET', url: `/apps/bills/settings?connectionId=${encodeURIComponent(h.connectionId)}`, headers: { 'x-adminium-install': kiln!.row.id } } as never);
      expect(both.statusCode).toBe(422);

      // Each install's settings are its own.
      await addOnSettingsRepo(h.meta).patch({ manifestId: kiln!.row.id, addOnKey: 'bills' }, { tone: 'kiln' }, [{ key: 'tone' }]);
      expect(await addOnSettingsRepo(h.meta).valuesForInstall(fernhill!.row.id)).toEqual({});

      // Install 1's grants open nothing of install 2's.
      const fernhillGrants = await resolveForRoles(h.meta, await roles.listForInstall(fernhill!.row.id));
      expect(isGranted(fernhillGrants.grants, 'app:bills:staff')).toBe(true);
      expect(isGranted(fernhillGrants.grants, 'app:bills~second:staff')).toBe(false);
      const kilnGrants = await resolveForRoles(h.meta, await roles.listForInstall(kiln!.row.id));
      expect(isGranted(kilnGrants.grants, 'app:bills~second:staff')).toBe(true);
      expect(isGranted(kilnGrants.grants, 'app:bills:staff')).toBe(false);

      // Disabling Kiln's copy leaves Fernhill's serving.
      const off = await h.inject({ method: 'POST', url: '/apps/bills/disable', headers: { 'x-adminium-install': kiln!.row.id } } as never);
      expect(off.statusCode, off.body).toBe(200);
      expect((await manifests.findById(fernhill!.row.id))?.row.status).toBe('installed');
      expect((await manifests.findById(kiln!.row.id))?.row.status).toBe('disabled');
      // A disabled install suspends its own roles only.
      expect(isGranted((await resolveForRoles(h.meta, await roles.listForInstall(fernhill!.row.id))).grants, 'app:bills:staff')).toBe(true);
      const on = await h.inject({ method: 'POST', url: '/apps/bills/enable', headers: { 'x-adminium-install': kiln!.row.id } } as never);
      expect(on.statusCode, on.body).toBe(200);

      // Uninstalling Kiln's copy takes its own and nothing of Fernhill's: rows, roles, templates, outbox, files.
      const gone = await h.inject({ method: 'DELETE', url: '/apps/bills', payload: {}, headers: { 'x-adminium-install': kiln!.row.id } } as never);
      expect(gone.statusCode, gone.body).toBe(200);
      expect((await manifests.listByKey('bills')).map((m) => m.row.id)).toEqual([fernhill!.row.id]);
      expect((await roles.listForInstall(fernhill!.row.id)).map((role) => role.slug)).toEqual(['bills-clerk']);
      expect(await roles.findBySlug('bills-second-clerk')).toBeNull();
      expect((await templates.findByKeyLocale('bills-sent', 'en_US'))?.installId).toBe(fernhill!.row.id);
      expect(await templates.findByKeyLocale('bills-second-sent', 'en_US')).toBeNull();
      expect(await appOutboxesRepo(h.meta).findByInstall(fernhill!.row.id)).not.toBeNull();
      expect(JSON.parse(gone.body).filesRemoved).toBe(false);
      // With one install left, the key alone names it again.
      const single = await h.inject({ method: 'GET', url: '/apps/bills/settings' });
      expect(single.statusCode, single.body).toBe(200);
    }, 120_000);

    it('names only the copies a person reaches when it asks which, and nothing to one who reaches none', async () => {
      // Null while installing: every permission. Then one person's grants.
      let held: ReadonlySet<string> | null = null;
      const h = (open = await installHarness(dialect, { can: (permission) => held === null || held.has(permission) }));
      expect((await h.install(bills())).statusCode).toBe(200);
      const other = await h.otherConnection();
      expect((await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'bills', version: '1.0.0', connectionId: other.id } })).statusCode).toBe(200);
      const installs = (body: string) => (JSON.parse(body) as { error: { code: string; details: { installs: { slug: string; connectionName: string | null }[] } } }).error;

      // Kiln's clerk: the choice names Kiln's copy alone, by its database's name.
      held = new Set(['app:bills~second:staff']);
      for (const url of ['/apps/bills/rules', '/apps/bills/settings']) {
        const asked = await h.inject({ method: 'GET', url });
        expect(asked.statusCode, `${url} ${asked.body}`).toBe(409);
        expect(installs(asked.body).code).toBe('APP_INSTALL_AMBIGUOUS');
        expect(installs(asked.body).details.installs).toEqual([expect.objectContaining({ slug: 'second', connectionName: expect.any(String) })]);
        expect(asked.body).not.toContain(h.connectionId);
      }

      // Somebody who reaches neither copy is refused as they would be anyway: no list, no names.
      held = new Set();
      const rules = await h.inject({ method: 'GET', url: '/apps/bills/rules' });
      expect(rules.statusCode, rules.body).toBe(403);
      expect(rules.body).not.toContain('APP_INSTALL_AMBIGUOUS');
      const settings = await h.inject({ method: 'GET', url: '/apps/bills/settings' });
      expect(settings.statusCode, settings.body).toBe(404);
      expect(settings.body).not.toContain(other.id);

      // Whoever manages installs is offered both.
      held = new Set(['system:manifests:manage']);
      const both = await h.inject({ method: 'GET', url: '/apps/bills/settings' });
      expect(both.statusCode).toBe(409);
      expect(installs(both.body).details.installs.map((one) => one.slug).sort()).toEqual(['', 'second']);
    }, 120_000);

    it('runs one version per app: another version on the second database is refused', async () => {
      const h = (open = await installHarness(dialect));
      expect((await h.install(bills('1.0.0'))).statusCode).toBe(200);
      await h.stage(bills('1.1.0'));
      const other = await h.otherConnection();
      const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'bills', version: '1.1.0', connectionId: other.id } });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.body).toContain('ONE_VERSION_PER_APP');
      expect(await manifestsRepo(h.meta, PLAIN).listByKey('bills')).toHaveLength(1);
    }, 120_000);
  });
}
