// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S ROLE GIVEN AN ADD-ON'S PANEL (`page:@<panel id>:view`).
 *
 * A print shop's desk role sees the design kit's panel on an order line's
 * record page: the shop names the kit, its role grants the panel by its id
 * (named under the kit's key), and the grant is written while the kit is here
 * for the shop — taken back when it is switched off or uninstalled, given
 * again when it is back. An id the kit has neither as a page nor as a panel
 * is refused at the install's check; an id under no add-on the shop names is
 * refused as before. Asked as the desk user, never as the owner.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { installFloorWords, validateManifest } from '@adminium/manifest';
import { permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordPanelsFor } from '../src/add-ons/record-panels.js';
import { roleIssues } from '../src/apps/manifest-roles.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { factsViewFor } from '../src/routes/pages/column-facts.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, DESIGN_PANEL, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const FLOOR = '0.3.44';

const shop = (grant = `page:@${DESIGN_PANEL}:view`): Doc =>
  designShopManifest('printing', {
    compatibility: { minAdminiumVersion: FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: { suggests: [{ key: DESIGN_KIT, range: '^1.0.0', reason: { 'en-US': 'Shoppers design their products.' } }] },
    people: undefined,
    roles: [{ key: 'desk', name: 'Desk', permissions: ['table:@order_lines:read', grant], tables: [{ addOn: DESIGN_KIT, table: 'designs', actions: ['read'] }] }],
  });

describe('an app role\'s grant of an add-on\'s page, as written', () => {
  it('is a word of 0.3.44, refused under an older floor', () => {
    expect(installFloorWords(shop()).map((found) => found.word)).toContain('roles.addOnPages');
    const older = { ...shop(), compatibility: { minAdminiumVersion: '0.3.43', engines: ['postgres', 'mysql', 'sqlite'] } };
    expect(validateManifest(older).ok).toBe(false);
    expect(validateManifest(shop()).ok).toBe(true);
  });

  it('is allowed for an add-on the app names, view only; refused under no add-on the app names', () => {
    const named = validateManifest(shop());
    expect(named.ok && roleIssues(named.manifest)).toEqual([]);
    const edit = validateManifest(shop(`page:@${DESIGN_PANEL}:edit`));
    expect(edit.ok && roleIssues(edit.manifest).map((issue) => issue.message)).toEqual([expect.stringContaining('to view')]);
    const stranger = validateManifest(shop('page:@stock-kit-editor:view'));
    expect(stranger.ok && roleIssues(stranger.manifest).map((issue) => issue.message)).toEqual([expect.stringContaining('names a page the app does not declare')]);
  });
});

describe.each(LEGS)('an app role given an add-on\'s panel — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  const ids = { lines: '', designs: '' };
  let desk: { id: string; cookie: string };

  const offered = async () => {
    const set = await resolvePermissionSet(h.meta, { kind: 'user', id: desk.id, label: desk.id });
    const installs = keepAddOnInstalls(h.meta, async () => parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema));
    const view = await factsViewFor(h.meta, h.connectionId);
    return ((await recordPanelsFor(await installs.fresh(), { can: async (permission) => permissionSetAllows(set, permission) }, view!, ids.lines)) ?? []).map((panel) => panel.id);
  };
  const bundle = () =>
    served.composed.app.inject({
      method: 'GET',
      url: `/api/v1/add-ons/${DESIGN_KIT}/panels/${DESIGN_PANEL}/bundle?${new URLSearchParams({ connection: h.connectionId, table: ids.lines, row: '1' }).toString()}`,
      headers: { cookie: desk.cookie },
    });
  /** What the desk role holds of the panel. */
  const held = async () => {
    const role = await rolesRepo(h.meta).findBySlug('printing-desk');
    return (await permissionsRepo(h.meta).find(role!.id, 'page', DESIGN_PANEL))?.actions ?? null;
  };
  const switched = (enabled: boolean) => h.inject({ method: 'PATCH', url: `/add-ons/${DESIGN_KIT}`, payload: { attachedTo: 'printing', enabled } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest({}, { panel: true }), { files: DESIGN_KIT_FILES });
    await h.stageApp(shop());
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    ids.lines = model.tables.find((table) => table.name === 'printing_order_lines')!.id;
    ids.designs = model.tables.find((table) => table.name === 'design_kit_designs')!.id;
    await h.rows(`INSERT INTO design_kit_designs (id, code, app, state) VALUES (7, 'AA00000000000007', 'printing', 'draft')`);
    await h.rows(`INSERT INTO printing_orders (id, name) VALUES (1, 'Ben')`);
    await h.rows(`INSERT INTO printing_order_lines (id, order_id, qty, design_id) VALUES (1, 1, 1, 7)`);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const user = await usersRepo(h.meta).create({ email: 'desk@shop.test', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('printing-desk'))!.id);
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.9.0.1', payload: { email: 'desk@shop.test', password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    desk = { id: user.id, cookie: sessionCookie(res.headers['set-cookie']) };
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('shows the panel to the desk user, and serves its code to them', async () => {
    expect(await held()).toMatchObject({ view: true });
    expect(await offered()).toEqual([DESIGN_PANEL]);
    expect((await bundle()).statusCode).toBe(200);
  });

  it.skipIf(!available)('is taken back while the kit is switched off for the shop, and given again when it is back', async () => {
    expect((await switched(false)).statusCode).toBe(200);
    expect(await held()).toBeNull();
    expect((await switched(true)).statusCode).toBe(200);
    expect(await held()).toMatchObject({ view: true });
    expect(await offered()).toEqual([DESIGN_PANEL]);
  });

  it.skipIf(!available)('refuses, at the check, an id the kit has neither as a page nor as a panel', async () => {
    await h.stageApp({ ...shop(`page:@${DESIGN_KIT}-nothing:view`), version: '1.0.1' });
    const res = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'printing', version: '1.0.1', connectionId: h.connectionId } });
    expect(JSON.stringify(res.json())).toContain(`names a page or panel the add-on \\"${DESIGN_KIT}\\" does not have`);
  });

  it.skipIf(!available)('an owner who takes it away keeps it away when the kit comes back', async () => {
    const role = await rolesRepo(h.meta).findBySlug('printing-desk');
    await permissionsRepo(h.meta).revoke(role!.id, 'page', DESIGN_PANEL);
    expect((await switched(false)).statusCode).toBe(200);
    expect((await switched(true)).statusCode).toBe(200);
    expect(await held()).toBeNull();
    expect(await offered()).toEqual([]);
  });

  it.skipIf(!available)('is taken back when the kit is uninstalled, and the ledger forgets it', async () => {
    const role = await rolesRepo(h.meta).findBySlug('printing-desk');
    await permissionsRepo(h.meta).grant(role!.id, 'page', DESIGN_PANEL, { view: true, edit: false } as never);
    const gone = await h.inject({ method: 'DELETE', url: `/add-ons/${DESIGN_KIT}` });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await held()).toBeNull();
    expect((await settingsRepo(h.meta).get('system.seededAppRoleGrants')).filter((pair) => pair.includes(`page:@${DESIGN_KIT}/`))).toEqual([]);
  });
});
