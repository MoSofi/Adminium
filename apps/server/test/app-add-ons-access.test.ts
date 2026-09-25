// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The per-add-on settings grant: `addOn:<key>:settings` lets a person keep
 * ONE add-on's settings up to date without `system:manifests:manage`, which
 * also installs, upgrades and removes add-ons — code that runs in this
 * process. An app role may carry it for an add-on the app names; nothing else
 * opens with it, and it dies with the app's switch like every app role grant.
 */
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import {
  addOnSettingsPermission,
  grantsFromMatrixRows,
  isGranted,
  matrixRowsFromGrants,
  parseGrant,
  parsePermission,
} from '../src/rbac/permissions.js';
import { addOnHarness, addOnManifest, appManifest, type Harness } from './app-add-ons.helpers.js';

const invoices = addOnManifest('invoices', {
  version: '1.1.0',
  name: 'Invoices & Receipts',
  settings: [
    { key: 'business_name', type: 'string', default: 'Your business' },
    { key: 'payment_instructions', type: 'string' },
  ],
  addOn: { attaches: [{ app: '*' }], publicSettings: ['business_name'] },
});

const studio = (roles: unknown[]) =>
  appManifest('studio', {
    addOns: { requires: [{ key: 'invoices', range: '>=1.1.0', reason: { 'en-US': 'Invoices.' } }] },
    roles,
  });

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('the grant string', () => {
  it('parses concrete only, matches its own key only, and survives the matrix both ways', () => {
    expect(parseGrant('addOn:invoices:settings')).toEqual({ kind: 'addOn', addOnKey: 'invoices', action: 'settings' });
    // Never "every add-on's settings", never another verb.
    expect(parseGrant('addOn:*:settings')).toBeNull();
    expect(parseGrant('addOn:invoices:install')).toBeNull();
    expect(parsePermission(addOnSettingsPermission('invoices'))).not.toBeNull();

    const grants = new Set(['addOn:invoices:settings']);
    expect(isGranted(grants, 'addOn:invoices:settings')).toBe(true);
    expect(isGranted(grants, 'addOn:shipping-dhl:settings')).toBe(false);
    expect(isGranted(grants, 'system:manifests:manage')).toBe(false);
    // An app wildcard is not an add-on's settings.
    expect(isGranted(new Set(['app:*:staff']), 'addOn:invoices:settings')).toBe(false);

    const { rows, invalid } = matrixRowsFromGrants(['addOn:invoices:settings', 'app:studio:staff']);
    expect(invalid).toEqual([]);
    const back = grantsFromMatrixRows(rows.map((row, i) => ({ id: String(i), roleId: 'r', ...row })) as never);
    expect(back.sort()).toEqual(['addOn:invoices:settings', 'app:studio:staff']);
    // The stored row can never answer an app's staff check.
    expect(back.some((grant) => grant.startsWith('app:add-on/'))).toBe(false);
  });
});

describe('a role holding addOn:invoices:settings (sqlite)', () => {
  it('saves that add-on’s settings and nothing else, and loses it when the app is switched off', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    await h.stageAddOn(addOnManifest('other', { version: '1.0.0', settings: [{ key: 'colour', type: 'string' }] }), { bundled: true });
    await h.stageApp(studio([{ key: 'manager', name: 'Studio manager', permissions: ['app:@:staff', 'addOn:invoices:settings'] }]));
    const installed = await h.install('studio', '0.2.0');
    expect(installed.statusCode, installed.body).toBe(200);
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'other', version: '1.0.0' } })).statusCode).toBe(200);

    const manager = await usersRepo(h.meta).create({ email: 'mia@test', name: 'Mia' });
    const role = await rolesRepo(h.meta).findBySlug('studio-manager');
    await rolesRepo(h.meta).assignToUser(manager.id, role!.id);
    expect((await permissionsRepo(h.meta).listForRole(role!.id)).map((row) => row.resourceRef)).toContain('add-on/invoices');

    const saved = await h.inject({
      method: 'PUT',
      url: '/add-ons/invoices/settings',
      payload: { values: { business_name: 'Acme Studio' } },
      as: manager,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().values).toMatchObject({ business_name: 'Acme Studio' });

    for (const [method, url, payload] of [
      ['PUT', '/add-ons/other/settings', { values: { colour: 'red' } }],
      ['DELETE', '/add-ons/invoices', undefined],
      ['POST', '/add-ons/invoices/attachments', { app: 'dashboard' }],
      ['PATCH', '/add-ons/invoices', { attachedTo: 'studio', enabled: true }],
      ['POST', '/add-ons/invoices/upgrade', undefined],
      ['POST', '/add-ons', { key: 'other', version: '1.0.0' }],
      ['PATCH', '/apps/studio/settings', { name: 'Mine' }],
    ] as const) {
      const refused = await h.inject({ method, url, payload, as: manager });
      expect(refused.statusCode, `${method} ${url}: ${refused.body}`).toBe(403);
    }
    // Signed out, nothing at all.
    const anonymous = await h.inject({ method: 'PUT', url: '/add-ons/invoices/settings', payload: { values: {} }, as: null });
    expect(anonymous.statusCode).toBe(401);

    // Switched off, the app's roles grant nothing — this one included.
    expect((await h.inject({ method: 'POST', url: '/apps/studio/disable' })).statusCode).toBe(200);
    const suspended = await h.inject({
      method: 'PUT',
      url: '/add-ons/invoices/settings',
      payload: { values: { business_name: 'Again' } },
      as: manager,
    });
    expect(suspended.statusCode).toBe(403);
  });

  it('refuses an app role that grants the settings of an add-on the app does not name', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoices, { bundled: true });
    const planned = await h.plan(studio([{ key: 'manager', name: 'Studio manager', permissions: ['addOn:shipping-dhl:settings'] }]));
    expect(planned.statusCode, planned.body).toBe(200);
    expect(planned.json().plan.installable).toBe(false);
    expect(planned.json().plan.problems).toContainEqual(
      expect.objectContaining({ code: 'ROLE_INVALID', message: expect.stringContaining('neither requires nor suggests') }),
    );
  });
});
