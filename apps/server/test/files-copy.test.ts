// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Choosing a picture a record or the Files page already has: `POST
 * /files/:id/copy` makes the record its OWN copy, an upload the caller made
 * for that column. Every check is asked before a byte is read, and a source
 * the caller may not read answers exactly as a file that is not there.
 *
 * On a real database of each engine, through the whole server: the read rule
 * a copy asks is the record's (its table, the columns a role reads, the rows
 * it reaches), and only a real row can answer it.
 */
import { filesRepo, overridesRepo, pagesRepo, permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { FILES_RETENTION_SCHEDULE_NAME } from '../src/compose.js';
import { png } from './picture-images.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string; headers: Record<string, unknown> };

const PICTURES = ['png', 'jpeg', 'webp', 'gif'];
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const DAY_MS = 86_400_000;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a copy of a file for a column [${dialect}]`, () => {
    let w: World;
    let dishes: string;
    let menus: string;
    let badges: string;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const files = () => filesRepo(w.meta);

    /** Upload bytes for a column of a table (or the Files page's own, with no table); answers the file's id. */
    const uploaded = async (who: Who, bytes: Buffer, opts: { table?: string | null; column?: string; filename?: string; type?: string } = {}): Promise<string> => {
      const query = new URLSearchParams({ connectionId: w.connectionId, filename: opts.filename ?? 'dish.png' });
      const table = opts.table === undefined ? 'dishes' : opts.table;
      if (table !== null) query.set('table', table);
      if (opts.column !== undefined) query.set('column', opts.column);
      const res = await call(who, 'POST', `files?${query.toString()}`, bytes, { 'content-type': opts.type ?? 'image/png' });
      expect(res.statusCode, res.body).toBe(201);
      return json<{ data: { id: string } }>(res).data.id;
    };
    const copy = async (who: Who, id: string, table: string, column: string): Promise<Reply> =>
      call(who, 'POST', `files/${id}/copy`, { connectionId: w.connectionId, table, column });
    const copied = async (who: Who, id: string, table: string, column: string): Promise<{ id: string; ref: string }> => {
      const res = await copy(who, id, table, column);
      expect(res.statusCode, res.body).toBe(201);
      const body = json<{ data: { id: string }; ref: string }>(res);
      return { id: body.data.id, ref: body.ref };
    };
    let nextId = 100;
    /** A dish saved by `who`, naming files; answers its key. */
    const dish = async (who: Who, values: Record<string, unknown>): Promise<number> => {
      nextId += 1;
      const res = await call(who, 'POST', `data/${w.connectionId}/${encodeURIComponent(dishes)}`, { values: { id: nextId, name: `Dish ${String(nextId)}`, owner_id: w.people.dana, ...values } });
      expect(res.statusCode, res.body).toBe(201);
      return nextId;
    };
    const page = async (table: string, slug: string, columns: Record<string, unknown>[]): Promise<void> => {
      await pagesRepo(w.meta).create({
        connectionId: w.connectionId,
        slug,
        type: 'page-crud',
        title: slug,
        navOrder: 1,
        config: { v: 1, kind: 'page', template: 'page-crud', source: { connectionId: w.connectionId, table }, config: { columns } },
      });
    };

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(`CREATE TABLE menus (id INTEGER PRIMARY KEY, title VARCHAR(80), cover VARCHAR(400), leaflet VARCHAR(400))`);
      await w.run(`CREATE TABLE dishes (id INTEGER PRIMARY KEY, name VARCHAR(80) NOT NULL, photo VARCHAR(400), photo_key VARCHAR(400), photo_url VARCHAR(600), scan VARCHAR(400), vault VARCHAR(400), owner_id VARCHAR(36), menu_id INTEGER, FOREIGN KEY (menu_id) REFERENCES menus(id))`);
      await w.run(`CREATE TABLE badges (id INTEGER PRIMARY KEY, picture VARCHAR(64))`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const tables = (await w.model()).tables;
      const idOf = (name: string): string => tables.find((table) => table.name === name)!.id;
      dishes = idOf('dishes');
      menus = idOf('menus');
      badges = idOf('badges');
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.pii', tableName: dishes, columnName: 'scan', value: { masked: true }, origin: 'user' } as never);
      await overrides.create({ connectionId: w.connectionId, op: 'column.secret', tableName: dishes, columnName: 'vault', value: { secret: true }, origin: 'user' } as never);
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: dishes, columnName: 'owner_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: dishes, value: { ways: [{ column: 'owner_id' }] }, origin: 'user' });
      // A dish takes its photo from its menu's cover when it names one: a value a save never sent.
      await overrides.create({ connectionId: w.connectionId, op: 'column.copy', tableName: dishes, columnName: 'photo', value: { via: 'menu_id', from: 'cover', mode: 'always' }, origin: 'user' } as never);
      // An app's own picture column: a picture in it is kept without its camera notes.
      await overrides.create({ connectionId: w.connectionId, op: 'column.file', tableName: badges, columnName: 'picture', value: { accept: ['png'], maxBytes: 64 * 1024 }, origin: 'app' } as never);
      await page(dishes, 'dishes', [
        { name: 'name' },
        { name: 'photo', file: { ref: 'id', accept: PICTURES, inline: true } },
        { name: 'photo_key', file: { ref: 'key', accept: PICTURES, inline: true } },
        { name: 'photo_url', file: { ref: 'url', accept: PICTURES, inline: true } },
        { name: 'scan', file: { ref: 'id' } },
        { name: 'vault', file: { ref: 'id' } },
      ]);
      await page(menus, 'menus', [
        { name: 'title' },
        { name: 'cover', file: { ref: 'id', accept: PICTURES, inline: true, maxBytes: 1024 } },
        { name: 'leaflet', file: { ref: 'id' } },
      ]);

      const grant = async (slug: string, table: string, actions: Record<string, unknown>): Promise<void> => {
        const role = (await rolesRepo(w.meta).findBySlug(slug)) ?? (await rolesRepo(w.meta).create({ slug, name: slug }));
        await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${table}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      };
      const ALL = { read: true, create: true, update: true, delete: true };
      // Dana cooks: every dish, menu and badge.
      for (const table of [dishes, menus, badges]) await grant('cook', table, ALL);
      await w.give('dana', 'cook');
      // Omar tastes: he reads dishes and changes nothing.
      await grant('taster', dishes, { read: true });
      await w.give('omar', 'taster');
      // Lena reads a dish's name and photo, and changes menus.
      await grant('limited', dishes, { read: true, readLimit: { readable: ['name', 'photo'] } });
      await grant('limited', menus, ALL);
      await w.give('lena', 'limited');
      // Sam reads only the dishes that are his, and changes menus.
      await grant('own', dishes, { read: true, rowLimit: { read: { reach: 'own' } } });
      await grant('own', menus, ALL);
      await w.give('sam', 'own');
      // Mara keeps the Files page and cooks.
      await w.system('librarian', ['files.manage']);
      await w.give('mara', 'librarian');
      await w.give('mara', 'cook');
    }, 180_000);
    afterAll(async () => w?.close());

    it('makes a new, unclaimed upload of the caller’s, in the column’s own place, and audits it', async () => {
      const original = await uploaded('dana', png().bytes, { column: 'photo' });
      await dish('dana', { photo: original });
      const { id, ref } = await copied('dana', original, 'dishes', 'photo');
      expect(id).not.toBe(original);
      expect(ref).toBe(id);
      const [source, made] = [await files().findById(original), await files().findById(id)];
      expect(made).toMatchObject({ attachedAt: null, uploadedBy: w.people.dana, entityConnectionId: w.connectionId, entityTable: null, sha256: source!.sha256, destinationId: source!.destinationId, kind: 'upload', deletedAt: null });
      const audit = await w.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'file.copy').execute();
      expect(audit.some((row) => JSON.stringify(row).includes(original) && JSON.stringify(row).includes(id))).toBe(true);
    });

    it('a save takes the copy for its record and leaves the original where it was', async () => {
      const original = await uploaded('dana', png().bytes, { column: 'photo' });
      const first = await dish('dana', { photo: original });
      const { ref } = await copied('dana', original, 'dishes', 'photo');
      const second = await dish('dana', { photo: ref });
      expect(await files().findById(ref)).toMatchObject({ entityId: String(second), deletedAt: null });
      expect((await files().findById(ref))!.attachedAt).not.toBeNull();
      expect(await files().findById(original)).toMatchObject({ entityId: String(first), deletedAt: null });
    });

    it('a copy no save named is swept as an abandoned upload is', async () => {
      const original = await uploaded('dana', png().bytes, { column: 'photo' });
      await dish('dana', { photo: original });
      const { id } = await copied('dana', original, 'dishes', 'photo');
      await w.meta.db.updateTable('adminium_files').set({ createdAt: Date.now() - 2 * DAY_MS }).where('id', '=', id).execute();
      await w.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
      expect((await files().findById(id))!.deletedAt).not.toBeNull();
      expect((await files().findById(original))!.deletedAt).toBeNull();
    });

    it('deleting the original leaves the copy served', async () => {
      const library = await uploaded('mara', png({ fill: 90 }).bytes, { table: null });
      const { ref } = await copied('mara', library, 'dishes', 'photo');
      await dish('mara', { photo: ref });
      expect((await call('mara', 'DELETE', `files/${library}`)).statusCode).toBe(200);
      const served = await call('dana', 'GET', `files/${ref}/content`);
      expect(served.statusCode, served.body).toBe(200);
    });

    it('a library file is copied by its uploader or a file manager, and answers 404 to anyone else', async () => {
      const library = await uploaded('mara', png({ fill: 40 }).bytes, { table: null });
      expect((await copy('dana', library, 'dishes', 'photo')).statusCode).toBe(404);
      expect((await copy('mara', library, 'dishes', 'photo')).statusCode).toBe(201);
      // Another person's create-form upload is theirs alone, a file manager or not.
      const pending = await uploaded('dana', png({ fill: 41 }).bytes, { column: 'photo' });
      expect((await copy('mara', pending, 'dishes', 'photo')).statusCode).toBe(404);
      expect((await copy('dana', pending, 'dishes', 'photo')).statusCode).toBe(201);
    });

    it('a file the caller may not read answers as one that is not there: a hidden column, a secret one, a row out of reach, the bin', async () => {
      const missing = await copy('lena', 'file_01ZZZZZZZZZZZZZZZZZZZZZZZZ', 'menus', 'cover');
      expect(missing.statusCode).toBe(404);
      const nothing = json<{ error: { message: string } }>(missing).error.message.replace('file_01ZZZZZZZZZZZZZZZZZZZZZZZZ', '');

      // Held only in `scan`, a column Lena's role does not read.
      const scan = await uploaded('dana', PDF, { column: 'scan', filename: 'scan.pdf', type: 'application/pdf' });
      await dish('dana', { scan });
      const hidden = await copy('lena', scan, 'menus', 'leaflet');
      expect(hidden.statusCode).toBe(404);
      expect(json<{ error: { message: string } }>(hidden).error.message.replace(scan, '')).toBe(nothing);
      // …which Dana reads: but a personal column's file stays in its table.
      expect((await copy('dana', scan, 'menus', 'leaflet')).statusCode).toBe(404);
      expect((await copy('dana', scan, 'dishes', 'scan')).statusCode).toBe(201);
      // A secret column's file is copied by nobody. (Nobody writes one through the dashboard: an app does, and its record holds the file.)
      const vault = await uploaded('dana', PDF, { column: 'vault', filename: 'vault.pdf', type: 'application/pdf' });
      await w.run(`INSERT INTO dishes (id, name, vault, owner_id) VALUES (900, 'Vault', '${vault}', '${w.people.dana}')`);
      await files().attach(vault, { connectionId: w.connectionId, table: dishes, pk: { id: 900 }, label: '900' });
      expect((await copy('dana', vault, 'dishes', 'vault')).statusCode).toBe(404);

      // A dish of Dana's, out of Sam's reach.
      const photo = await uploaded('dana', png({ fill: 12 }).bytes, { column: 'photo' });
      await dish('dana', { photo });
      expect((await copy('sam', photo, 'menus', 'cover')).statusCode).toBe(404);
      // …while Sam's own is his to copy.
      const his = await uploaded('dana', png({ fill: 13 }).bytes, { column: 'photo' });
      await dish('dana', { photo: his, owner_id: w.people.sam });
      expect((await copy('sam', his, 'menus', 'cover')).statusCode).toBe(201);

      // In the bin.
      const binned = await uploaded('dana', png({ fill: 14 }).bytes, { column: 'photo' });
      await files().markDeleted(binned, Date.now());
      const bin = await copy('dana', binned, 'dishes', 'photo');
      expect(bin.statusCode).toBe(404);
      expect(json<{ error: { message: string } }>(bin).error.message.replace(binned, '')).toBe(nothing);
    });

    it('a file of another connection, or of none, is not copied across', async () => {
      const elsewhere = await uploaded('mara', png({ fill: 50 }).bytes, { table: null });
      await w.meta.db.updateTable('adminium_files').set({ entityConnectionId: null }).where('id', '=', elsewhere).execute();
      expect((await copy('mara', elsewhere, 'dishes', 'photo')).statusCode).toBe(404);
      await w.meta.db.updateTable('adminium_files').set({ entityConnectionId: 'conn_01ZZZZZZZZZZZZZZZZZZZZZZZZ' }).where('id', '=', elsewhere).execute();
      expect((await copy('mara', elsewhere, 'dishes', 'photo')).statusCode).toBe(404);
    });

    it('asks the target first: no change to the table is a 403, a column that holds no files a 422', async () => {
      const library = await uploaded('mara', png({ fill: 60 }).bytes, { table: null });
      const refused = await copy('omar', library, 'dishes', 'photo');
      expect(refused.statusCode).toBe(403);
      expect(json<{ error: { details: { permission: string } } }>(refused).error.details.permission).toBe(`table:${w.connectionId}:${dishes}:update`);
      // Asked before the source: a file that does not exist is refused the same.
      expect((await copy('omar', 'file_01ZZZZZZZZZZZZZZZZZZZZZZZZ', 'dishes', 'photo')).statusCode).toBe(403);
      expect((await copy('mara', library, 'dishes', 'name')).statusCode).toBe(422);
    });

    it('refuses a kind the column does not take and a file larger than it allows, before a byte is read', async () => {
      const pdf = await uploaded('mara', PDF, { table: null, filename: 'menu.pdf', type: 'application/pdf' });
      const kind = await copy('mara', pdf, 'dishes', 'photo');
      expect(kind.statusCode).toBe(422);
      expect(json<{ error: { code: string } }>(kind).error.code).toBe('TYPE_NOT_ACCEPTED');
      const big = await uploaded('mara', png({ width: 64, height: 64, text: 'x'.repeat(2000) }).bytes, { table: null, filename: 'big.png' });
      const large = await copy('mara', big, 'menus', 'cover');
      expect(large.statusCode).toBe(422);
      expect(json<{ error: { code: string; details: { maxBytes: number } } }>(large).error).toMatchObject({ code: 'TOO_LARGE', details: { maxBytes: 1024 } });
    });

    it('into an app’s own picture column: cleaned of camera notes as an upload is, and the save is then taken', async () => {
      const raw = png({ text: 'GPS 51.5074 N', exif: true });
      const library = await uploaded('mara', raw.bytes, { table: null, filename: 'badge.png' });
      const { id, ref } = await copied('mara', library, 'badges', 'picture');
      expect(ref).toBe(id);
      const made = (await files().findById(id))!;
      expect(made.sha256).not.toBe((await files().findById(library))!.sha256);
      expect(made.sizeBytes).toBe(raw.clean.length);
      const saved = await call('mara', 'POST', `data/${w.connectionId}/${encodeURIComponent(badges)}`, { values: { id: 1, picture: ref } });
      expect(saved.statusCode, saved.body).toBe(201);
      expect((await files().findById(id))!.entityId).toBe('1');
    });

    it('answers a `key` or a `url` column with a value in that column’s shape', async () => {
      const library = await uploaded('mara', png({ fill: 70 }).bytes, { table: null });
      const key = await copied('mara', library, 'dishes', 'photo_key');
      expect(key.ref).toBe((await files().findById(key.id))!.storageKey);
      const url = await copied('mara', library, 'dishes', 'photo_url');
      expect(url.ref).toMatch(new RegExp(`/api/v1/files/${url.id}/content$`));
      expect(url.ref.startsWith('http')).toBe(true);
    });

    describe('the lists a picture is chosen from', () => {
      type Listed = { id: string; uploadedBy: string | null; mime: string; recordLabel?: string };
      const list = async (who: Who, query: Record<string, string>): Promise<Reply> => call(who, 'GET', `files?${new URLSearchParams({ connectionId: w.connectionId, ...query }).toString()}`);
      const listed = async (who: Who, query: Record<string, string>): Promise<Listed[]> => {
        const res = await list(who, query);
        expect(res.statusCode, res.body).toBe(200);
        return json<{ data: Listed[] }>(res).data;
      };
      const usedIn = (table: string, column: string): Record<string, string> => ({ usedInTable: table, usedInColumn: column });
      let danas: string;
      let sams: string;
      let hiddenKey: string;

      beforeAll(async () => {
        danas = await uploaded('dana', png({ fill: 101 }).bytes, { column: 'photo' });
        await dish('dana', { photo: danas, name: 'Spicy wings' });
        sams = (await copied('dana', danas, 'dishes', 'photo')).id;
        await dish('dana', { photo: sams, name: 'Classic burger', owner_id: w.people.sam });
        hiddenKey = await uploaded('dana', png({ fill: 102 }).bytes, { column: 'photo_key' });
        const key = (await files().findById(hiddenKey))!.storageKey;
        await dish('dana', { photo_key: key, name: 'Hidden one' });
      });

      it('needs read on the table and on the column: else a 403', async () => {
        expect((await list('kim', usedIn('dishes', 'photo'))).statusCode).toBe(403);
        expect((await list('lena', usedIn('dishes', 'scan'))).statusCode).toBe(403);
        expect((await list('lena', usedIn('dishes', 'photo'))).statusCode).toBe(200);
        // Two names, both needed.
        expect((await list('dana', { usedInTable: 'dishes' })).statusCode).toBe(422);
      });

      it('lists other people’s files of the table, each one the caller may read: no hidden column’s, no row out of reach', async () => {
        const all = (await listed('dana', usedIn('dishes', 'photo'))).map((file) => file.id);
        expect(all).toEqual(expect.arrayContaining([danas, sams, hiddenKey]));
        // Lena's role does not read `photo_key`.
        const lenas = (await listed('lena', usedIn('dishes', 'photo'))).map((file) => file.id);
        expect(lenas).toEqual(expect.arrayContaining([danas, sams]));
        expect(lenas).not.toContain(hiddenKey);
        // Sam reaches his own dish only, whoever uploaded its picture.
        const his = (await listed('sam', usedIn('dishes', 'photo'))).map((file) => file.id);
        expect(his).toContain(sams);
        expect(his).not.toContain(danas);
        // An `uploadedBy` is heard only from a file manager.
        expect((await listed('lena', { ...usedIn('dishes', 'photo'), uploadedBy: w.people.mara })).map((file) => file.id)).toContain(danas);
      });

      it('names each record as the caller’s grid does: never by a personal column', async () => {
        const named = await listed('dana', usedIn('dishes', 'photo'));
        expect(named.find((file) => file.id === sams)?.recordLabel).toBe('Classic burger');
        // A menu whose title is personal is called by its key.
        await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: menus, columnName: 'title', value: { masked: true }, origin: 'user' } as never);
        const cover = (await copied('dana', danas, 'menus', 'cover')).id;
        const saved = await call('dana', 'POST', `data/${w.connectionId}/${encodeURIComponent(menus)}`, { values: { id: 7, title: 'Secret menu', cover } });
        expect(saved.statusCode, saved.body).toBe(201);
        const menu = (await listed('lena', usedIn('menus', 'cover'))).find((file) => file.id === cover);
        expect(menu?.recordLabel).toBe('7');
      });

      it('lists live files only: the bin with a "used in" is refused', async () => {
        const binned = await uploaded('dana', png({ fill: 103 }).bytes, { column: 'photo' });
        await dish('dana', { photo: binned });
        await files().markDeleted(binned, Date.now());
        expect((await listed('dana', usedIn('dishes', 'photo'))).map((file) => file.id)).not.toContain(binned);
        expect((await list('dana', { ...usedIn('dishes', 'photo'), state: 'trash' })).statusCode).toBe(422);
      });

      it('the Files page’s own uploads: a file manager’s list, or one’s own; `accept` filters by kind', async () => {
        const picture = await uploaded('mara', png({ fill: 104 }).bytes, { table: null });
        const pdf = await uploaded('mara', PDF, { table: null, filename: 'menu.pdf', type: 'application/pdf' });
        const library = (await listed('mara', { state: 'library' })).map((file) => file.id);
        expect(library).toEqual(expect.arrayContaining([picture, pdf]));
        // A record's file and an upload no record took are not the library's.
        expect(library).not.toContain(danas);
        const pictures = await listed('mara', { state: 'library', accept: 'png,jpeg,webp,gif' });
        expect(pictures.map((file) => file.id)).toContain(picture);
        expect(pictures.map((file) => file.id)).not.toContain(pdf);
        expect(pictures.every((file) => file.mime.startsWith('image/'))).toBe(true);
        expect((await listed('dana', { state: 'library' })).map((file) => file.id)).not.toContain(picture);
        expect((await list('mara', { state: 'library', accept: 'png,nope' })).statusCode).toBe(422);
      });
    });

    describe('what a save may name in a page’s file column', () => {
      const save = async (who: Who, values: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<Reply> => {
        nextId += 1;
        return call(who, 'POST', `data/${w.connectionId}/${encodeURIComponent(dishes)}`, { values: { id: nextId, name: `Dish ${String(nextId)}`, owner_id: w.people.dana, ...values }, ...extra });
      };
      const issue = (res: Reply, column: string): string | undefined =>
        (JSON.parse(res.body) as { error?: { details?: { fields?: Record<string, { code: string }> } } }).error?.details?.fields?.[column]?.code;

      it('another person’s upload no record took is refused, and stays theirs', async () => {
        const marasPending = await uploaded('mara', png({ fill: 120 }).bytes, { column: 'photo' });
        const res = await save('dana', { photo: marasPending });
        expect(res.statusCode, res.body).toBe(422);
        expect(issue(res, 'photo')).toBe('file-not-here');
        expect(await files().findById(marasPending)).toMatchObject({ attachedAt: null, entityTable: null, deletedAt: null });
        // In a link's shape too.
        const asLink = await save('dana', { photo_url: `https://elsewhere.example/api/v1/files/${marasPending}/content` });
        expect(issue(asLink, 'photo_url')).toBe('file-not-here');
        // Her own, and a link to another site, are hers to save.
        const own = await uploaded('dana', png({ fill: 121 }).bytes, { column: 'photo' });
        expect((await save('dana', { photo: own, photo_url: 'https://img.example.net/wings.jpg' })).statusCode).toBe(201);
      });

      it('a file another record or the Files page holds is refused: it is copied, never named', async () => {
        const held = await uploaded('dana', png({ fill: 122 }).bytes, { column: 'photo' });
        const first = await dish('dana', { photo: held });
        expect(issue(await save('dana', { photo: held }), 'photo')).toBe('file-not-here');
        const library = await uploaded('mara', png({ fill: 123 }).bytes, { table: null });
        expect(issue(await save('mara', { photo: library }), 'photo')).toBe('file-not-here');
        expect(await files().findById(held)).toMatchObject({ entityId: String(first) });
        // A record saved again keeps what it held.
        const kept = await call('dana', 'PATCH', `data/${w.connectionId}/${encodeURIComponent(dishes)}/${String(first)}`, { values: { name: 'Renamed', photo: held } });
        expect(kept.statusCode, kept.body).toBe(200);
      });

      it('judges the values as they are written: a copy rule that names somebody else’s upload is refused', async () => {
        const marasPending = await uploaded('mara', png({ fill: 124 }).bytes, { table: 'menus', column: 'cover' });
        await w.run(`INSERT INTO menus (id, title, cover) VALUES (40, 'Lunch', '${marasPending}')`);
        const res = await save('dana', { menu_id: 40 });
        expect(res.statusCode, res.body).toBe(422);
        expect(issue(res, 'photo')).toBe('file-not-here');
      });

      it('a save from a page whose settings changed since the form opened is refused, and the upload is kept', async () => {
        const stored = (await pagesRepo(w.meta).listForConnection(w.connectionId)).find((one) => one.slug === 'dishes')!;
        const upload = await uploaded('dana', png({ fill: 125 }).bytes, { column: 'photo' });
        const page = { id: stored.id, revision: stored.revision };
        const changed = await save('dana', { photo: upload }, { page: { ...page, revision: stored.revision + 1 } });
        expect(changed.statusCode, changed.body).toBe(409);
        expect(json<{ error: { code: string } }>(changed).error.code).toBe('PAGE_CHANGED');
        expect(await files().findById(upload)).toMatchObject({ attachedAt: null, deletedAt: null });
        const again = await save('dana', { photo: upload }, { page });
        expect(again.statusCode, again.body).toBe(201);
        expect((await files().findById(upload))!.attachedAt).not.toBeNull();
        // An edit too.
        const edit = await call('dana', 'PATCH', `data/${w.connectionId}/${encodeURIComponent(dishes)}/${String(nextId)}`, { values: { name: 'Again' }, page: { ...page, revision: page.revision + 3 } });
        expect(edit.statusCode).toBe(409);
      });
    });

    it('spends the uploads’ budget', async () => {
      const library = await uploaded('mara', png({ fill: 80 }).bytes, { table: null });
      const res = await copy('mara', library, 'dishes', 'photo');
      expect(res.statusCode).toBe(201);
      expect(res.headers['x-ratelimit-limit']).toBe('240');
    });
  });
}
