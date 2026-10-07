// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIST'S OWN BULK ACTION, AS ONE CALLER MAY RUN IT.
 *
 * An app's list may declare an action that makes one row of a child table
 * for every row ticked. The page reply offers it to somebody who may make
 * that row with those values — and to nobody else: the action is a create
 * of the child, whatever the page is called.
 */
import { permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DESK } from '../../../packages/manifest/test/desk-fixture.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a reply read freely
type Doc = Record<string, any>;

describe('the bulk actions a list page is told of', () => {
  let h: Harness;
  let served: Served;
  let pageId = '';
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const page = async (as: string): Promise<Doc> => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/pages/${pageId}`, headers: { cookie: cookies.get(as)! } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Doc;
  };

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>, locale?: string): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${name}@bulk.dev`, name, passwordHash: await adminPasswordHash() });
    const roles = rolesRepo(h.meta);
    if (grants === 'super-admin') await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const [ref, actions] of Object.entries(grants)) {
        await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${ids.get(ref)!}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      await permissionsRepo(h.meta).grant(role.id, 'page', pageId, { view: true, edit: false } as never);
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.3.0.${String(cookies.size + 1)}`, payload: { email: `${name}@bulk.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
    if (locale !== undefined) {
      const saved = await served.composed.app.inject({ method: 'PATCH', url: '/api/v1/me/prefs', headers: { cookie: cookies.get(name)! }, payload: { locale } });
      expect(saved.statusCode, saved.body).toBe(200);
    }
  }

  beforeAll(async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    const doc = structuredClone(DESK) as Doc;
    // The action's words in a second language, to be read by somebody who reads it.
    doc.pages[0].config.bulk[0].label = { 'en-US': 'Reissue', 'de-DE': 'Neu ausstellen' };
    await h.stageAddOn(doc, { bundled: true, files: { 'pages/look-up.js': 'export default function Page() { return null; }' } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'desk', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'desk').execute()) {
      ids.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
    }
    pageId = (await h.meta.db.selectFrom('adminium_pages').select('id').where('slug', '=', 'desk-cards').executeTakeFirstOrThrow()).id;
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    await person('boss', 'super-admin');
    await person('maker', { cards: { read: true }, card_actions: { read: true, create: true } }, 'de_DE');
    await person('reader', { cards: { read: true }, card_actions: { read: true } });
    // May make an action row, but only a top-up; and one who may not set the note the form asks for.
    await person('topper', { cards: { read: true }, card_actions: { read: true, create: true, createLimit: { writable: ['card_id', 'action', 'note'], writableValues: { action: ['top_up'] } } } });
    await person('mute', { cards: { read: true }, card_actions: { read: true, create: true, createLimit: { writable: ['card_id', 'action'] } } });
  }, 240_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  it('is told whole to somebody who may make the row: the child table by its id, the fixed values, the rows it is for, the confirm', async () => {
    const reply = await page('boss');
    expect(reply['bulkActions']).toEqual([
      {
        id: 'reissue',
        label: 'Reissue',
        child: { table: ids.get('card_actions'), via: 'card_id', form: ['note'] },
        set: { action: 'reissue' },
        where: { column: 'status', eq: 'active' },
        confirm: { title: 'Reissue {count} cards?', body: 'Each of the {count} gets a new action.', columns: ['label', 'balance'] },
        done: '{count} reissued',
      },
    ]);
  });

  it('is in the reader\'s language where the app wrote one', async () => {
    expect((await page('maker'))['bulkActions'][0].label).toBe('Neu ausstellen');
  });

  it('is left out for somebody who may not create the child row, may not give it that value, or may not fill what its form asks for', async () => {
    expect((await page('reader'))['bulkActions']).toEqual([]);
    expect((await page('topper'))['bulkActions']).toEqual([]);
    expect((await page('mute'))['bulkActions']).toEqual([]);
    expect((await page('maker'))['bulkActions']).toHaveLength(1);
  });
});
