// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SCREEN ON A RECORD PAGE, GATED THREE WAYS.
 *
 * The design kit declares a panel on its designs (`addOn.panels`); a shop's
 * order lines link into its designs (`rules.addOnLink`), so the panel shows
 * on an order line's record page. It is offered, and its code served, only
 * to a reader who (1) reads the order line, (2) holds a grant on the kit's
 * designs, and (3) holds the panel's own permission — each one missing hides
 * it (and refuses its code), asked as the reader and never as the owner.
 * Switched off for the shop, it is gone; a code file is pinned as a page's.
 *
 * On every engine this run can reach, through the real installer and the
 * whole server, people signing in with a password.
 */
import { createHash } from 'node:crypto';

import { parseDatabaseModel } from '@adminium/engine';
import { permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordPanelsFor } from '../src/add-ons/record-panels.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { factsViewFor } from '../src/routes/pages/column-facts.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, DESIGN_PANEL, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

describe.each(LEGS)('a design kit\'s panel on an order line\'s record page — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  /** The tables by their names here: an order line's, and the kit's designs. */
  const ids = { lines: '', designs: '' };
  let signIns = 0;
  const people: Record<'all' | 'noLine' | 'noDesigns' | 'noPanel' | 'desk' | 'deskNoPanel' | 'otherDesk', { id: string; cookie: string }> = {} as never;

  /** Somebody holding exactly these grants, signed in; with `screensOnlyOf`, in a role that opens only that app's screens. */
  const person = async (email: string, grants: string[], screensOnlyOf?: string) => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(h.meta).create({ slug: `own-${user.id.slice(-8)}`, name: 'Own', ...(screensOnlyOf === undefined ? {} : { appKey: screensOnlyOf, screensOnly: true }) });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.${String(signIns >> 8)}.${String(signIns & 255)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { id: user.id, cookie: sessionCookie(res.headers['set-cookie']) };
  };
  const bundle = (who: { cookie: string }, row: string, table = ids.lines) =>
    served.composed.app.inject({
      method: 'GET',
      url: `/api/v1/add-ons/${DESIGN_KIT}/panels/${DESIGN_PANEL}/bundle?${new URLSearchParams({ connection: h.connectionId, table, row }).toString()}`,
      headers: { cookie: who.cookie },
    });
  /** The panels a record page of the order lines offers this person, asked as they are. */
  const offered = async (who: { id: string }) => {
    const set = await resolvePermissionSet(h.meta, { kind: 'user', id: who.id, label: who.id });
    const installs = keepAddOnInstalls(h.meta, async () => parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema));
    const view = await factsViewFor(h.meta, h.connectionId);
    return (await recordPanelsFor(await installs.fresh(), { can: async (permission) => permissionSetAllows(set, permission), locale: 'de-DE' }, view!, ids.lines)) ?? [];
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // The kit also declares a fill of the record editor slot and ships no file for it, as a released package does: never an error.
    const kit = designKitManifest({}, { panel: true }) as { addOn: Record<string, unknown> };
    kit.addOn['slots'] = [{ slot: 'record.editor.panel', client: 'dist/record-editor.js', order: 0 }];
    await h.stageAddOn(kit, { files: DESIGN_KIT_FILES });
    // The shop suggests the kit rather than requiring it: an owner may switch a suggested add-on off for it.
    await h.stageApp(designShopManifest('printing', { addOns: { suggests: [{ key: DESIGN_KIT, range: '^1.0.0', reason: { 'en-US': 'Shoppers design their products.' } }] }, people: undefined }));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    ids.lines = model.tables.find((table) => table.name === 'printing_order_lines')!.id;
    ids.designs = model.tables.find((table) => table.name === 'design_kit_designs')!.id;
    await h.rows(`INSERT INTO design_kit_designs (id, code, app, state) VALUES (7, 'AA00000000000007', 'printing', 'draft')`);
    await h.rows(`INSERT INTO printing_orders (id, name) VALUES (1, 'Ben')`);
    await h.rows(`INSERT INTO printing_order_lines (id, order_id, qty, design_id) VALUES (1, 1, 1, 7), (2, 1, 1, NULL)`);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const line = `table:${h.connectionId}:${ids.lines}:read`;
    const designs = `table:${h.connectionId}:${ids.designs}:read`;
    const panel = `page:${DESIGN_PANEL}:view`;
    people.all = await person('all@shop.test', [line, designs, panel]);
    people.noLine = await person('noline@shop.test', [designs, panel]);
    people.noDesigns = await person('nodesigns@shop.test', [line, panel]);
    people.noPanel = await person('nopanel@shop.test', [line, designs]);
    // People who open only an app's own screens: the shop's desk, with and without the panel; another app's desk.
    people.desk = await person('desk@shop.test', [line, designs, panel], 'printing');
    people.deskNoPanel = await person('desknopanel@shop.test', [line, designs], 'printing');
    people.otherDesk = await person('otherdesk@shop.test', [line, designs, panel], 'bakery');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('is offered to a reader with all three, named in their language, with the line\'s link into the designs', async () => {
    expect(await offered(people.all)).toEqual([{ addOn: DESIGN_KIT, id: DESIGN_PANEL, title: 'Entwurf', titleKey: 'design-kit.panel.title', column: 'design_id', order: 0 }]);
  });

  it.skipIf(!available)('is hidden from a reader who does not read the order lines', async () => {
    expect(await offered(people.noLine)).toEqual([]);
  });

  it.skipIf(!available)('is hidden from a reader with no grant on the kit\'s designs', async () => {
    expect(await offered(people.noDesigns)).toEqual([]);
  });

  it.skipIf(!available)('is hidden from a reader without the panel\'s own permission', async () => {
    expect(await offered(people.noPanel)).toEqual([]);
  });

  it.skipIf(!available)('serves its code, pinned, to a reader with all three — on a line with a design and on one without', async () => {
    const file = DESIGN_KIT_FILES['dist/panel.js']!;
    for (const row of ['1', '2']) {
      const res = await bundle(people.all, row);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toBe(file);
      expect(res.headers['x-adminium-integrity']).toBe(`sha256-${createHash('sha256').update(file).digest('base64')}`);
    }
  });

  it.skipIf(!available)('refuses its code for each gate missing, and for a row that is not there', async () => {
    expect((await bundle(people.noLine, '1')).statusCode).toBe(404);
    expect((await bundle(people.noDesigns, '1')).statusCode).toBe(403);
    expect((await bundle(people.noPanel, '1')).statusCode).toBe(403);
    expect((await bundle(people.all, '999')).statusCode).toBe(404);
    // A table that links into nothing of the kit's has no panel.
    expect((await bundle(people.all, '1', ids.designs)).statusCode).toBe(404);
  });

  it.skipIf(!available)('serves its code to the shop\'s screens-only desk holding the panel, and to no other screens-only person', async () => {
    const served = await bundle(people.desk, '1');
    expect(served.statusCode, served.body).toBe(200);
    expect(served.body).toBe(DESIGN_KIT_FILES['dist/panel.js']);
    // Without the panel's permission the route itself refuses, as it does anyone.
    const noPanel = await bundle(people.deskNoPanel, '1');
    expect([noPanel.statusCode, noPanel.json().error?.code]).toEqual([403, 'FORBIDDEN']);
    // An add-on none of their apps uses is not theirs to ask, whatever their grants.
    const other = await bundle(people.otherDesk, '1');
    expect([other.statusCode, other.json().error?.code]).toEqual([403, 'APP_SCREENS_ONLY']);
  });

  it.skipIf(!available)('draws nothing for a declared fill of the record editor slot with no file, and is no error for it', async () => {
    // The page offers the panel alone; the list of add-ons names no file it does not have.
    expect((await offered(people.all)).map((panel) => panel.id)).toEqual([DESIGN_PANEL]);
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons', headers: { cookie: people.all.cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const paths = ((res.json() as { addOns: { key: string; bundles: { path: string }[] }[] }).addOns.find((addOn) => addOn.key === DESIGN_KIT)?.bundles ?? []).map((one) => one.path);
    expect(paths).not.toContain('dist/record-editor.js');
  });

  it.skipIf(!available)('lists its code\'s fingerprint only to a reader who holds the panel\'s permission, never on the open address', async () => {
    const listed = async (who: { cookie: string }) => {
      const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/add-ons', headers: { cookie: who.cookie } });
      expect(res.statusCode, res.body).toBe(200);
      return ((res.json() as { addOns: { key: string; bundles: { path: string; panel?: string }[] }[] }).addOns.find((addOn) => addOn.key === DESIGN_KIT)?.bundles ?? []).filter((one) => one.path === 'dist/panel.js');
    };
    expect(await listed(people.all)).toEqual([expect.objectContaining({ panel: DESIGN_PANEL, url: `/api/v1/add-ons/${DESIGN_KIT}/panels/${DESIGN_PANEL}/bundle` })]);
    expect(await listed(people.noPanel)).toEqual([]);
    const open = await served.composed.app.inject({ method: 'GET', url: `/api/v1/add-ons/${DESIGN_KIT}/bundle/dist/panel.js`, headers: { cookie: people.all.cookie } });
    expect(open.statusCode).not.toBe(200);
  });

  it.skipIf(!available)('is gone, and its code refused, while the kit is switched off for the shop', async () => {
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${DESIGN_KIT}`, payload: { attachedTo: 'printing', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    try {
      expect(await offered(people.all)).toEqual([]);
      expect((await bundle(people.all, '1')).statusCode).toBe(404);
    } finally {
      const on = await h.inject({ method: 'PATCH', url: `/add-ons/${DESIGN_KIT}`, payload: { attachedTo: 'printing', enabled: true } });
      expect(on.statusCode, on.body).toBe(200);
    }
    expect(await offered(people.all)).toHaveLength(1);
  });
});
