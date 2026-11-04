// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY TABLE OF THE CUSTOMISER AS IT IS BUILT, WRITTEN AND READ BACK.
 *
 * The Customiser is installed from a built checkout of the add-ons
 * repository (`ADMINIUM_ADD_ONS_REPO`), as a package that comes with the
 * server. On each engine this run reaches, every column of every one of its
 * tables is written at its full width (text to its `maxLength`, with letters
 * outside ASCII; decimals to their scale; json with nesting and every kind of
 * value; the last choice of every enum; a moment with its zone) and read
 * back through the data route as the dashboard reads it. A real 3MF and a
 * laser's SVG are uploaded through the files route into `version_files.file`
 * and saved onto a row, and their bytes come back the same.
 *
 * Without the checkout the suite is skipped, by name.
 */
import { crc32 } from 'node:zlib';

import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
interface Column {
  ref: string;
  type: string;
  role?: string;
  maxLength?: number;
  scale?: number;
  precision?: number;
  enum?: string[];
  nullable?: boolean;
  references?: string;
  rules?: { file?: unknown; code?: unknown; stamp?: unknown; validation?: { min?: number; max?: number; minLength?: number; maxLength?: number; format?: string } };
}
interface Table { ref: string; columns: Column[] }

const CUSTOMISER = 'customiser';
const built = builtAddOn(CUSTOMISER);

/** A stored (no compression) zip, as the Customiser's own writer makes a 3MF. */
function zip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let at = 0;
  for (const [name, text] of Object.entries(entries)) {
    const body = Buffer.from(text, 'utf8');
    const file = Buffer.from(name, 'utf8');
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(file.length, 26);
    parts.push(local, file, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(file.length, 28);
    entry.writeUInt32LE(at, 42);
    central.push(entry, file);
    at += 30 + file.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, dir, end]);
}

/** A name keyring's 3MF: one tetrahedron in millimetres, the core spec's three parts. */
const THREE_MF = zip({
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  '3D/3dmodel.model': '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="56" y="0" z="0"/><vertex x="0" y="24" z="0"/><vertex x="0" y="0" z="4"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
});
/** A laser's file: CUT, SCORE and ENGRAVE layers, words already outlines. */
const LASER = '<svg xmlns="http://www.w3.org/2000/svg" width="95mm" height="95mm" viewBox="0 0 95 95"><g id="CUT"><path d="M9 0H86A9 9 0 0 1 95 9V86A9 9 0 0 1 86 95H9A9 9 0 0 1 0 86V9A9 9 0 0 1 9 0Z" fill="none" stroke="#ff0000" stroke-width="0.01"/></g><g id="SCORE"/><g id="ENGRAVE"><path d="M20 60h10v4H20Z" fill="#000"/></g></svg>';

/** Text exactly `length` characters long, with letters outside ASCII among them (a width counted in characters, not bytes). */
const wide = (length: number): string => 'Ærø ß 名字 '.repeat(Math.ceil(length / 9)).slice(0, length);

describe.each(LEGS)("every table of the built Customiser, written at its widths and read back — %s", (dialect, available) => {
  const runs = available && built !== null;
  let h: Harness;
  let served: Served;
  let cookie = '';
  let trusted: string | undefined;
  const ids = new Map<string, string>();
  const made = new Map<string, number>();
  const tables = (built?.manifest['requiredSchema'] as { tables: Table[] } | undefined)?.tables ?? [];
  const outbox = built?.manifest['outbox'] as { table: string; columns: { status: string; sentAt?: string; error?: string } } | undefined;

  /**
   * What a column is written with: its widest honest value — as wide as the
   * column and its own rules let it be. A file column is filled by an
   * upload, later; a key, a stamp, a code and a row's own times are
   * Adminium's to write.
   */
  const valueOf = (table: Table, column: Column): unknown => {
    if (column.role === 'pk' || column.role === 'created_at' || column.role === 'updated_at') return undefined;
    if (column.rules?.file !== undefined || column.rules?.code !== undefined || column.rules?.stamp !== undefined) return undefined;
    // What an outbox says of a message once it is sent is Adminium's too.
    if (outbox?.table === table.ref && (column.ref === outbox.columns.sentAt || column.ref === outbox.columns.error)) return undefined;
    const rule = column.rules?.validation;
    switch (column.type) {
      case 'text': {
        const length = Math.min(column.maxLength ?? 120, rule?.maxLength ?? Number.POSITIVE_INFINITY);
        // An address is written as one is typed, at its longest: what it is kept as is lower case.
        if (rule?.format === 'email') return `${'a'.repeat(length - '@example.com'.length)}@example.com`;
        return wide(length);
      }
      case 'int':
        return rule?.max ?? 2_000_000_000;
      case 'decimal': {
        const scale = column.scale ?? 0;
        // Up to its own limit, to the last place it keeps.
        if (rule?.max !== undefined) return Number((rule.max - (scale === 0 ? 1 : 10 ** -scale)).toFixed(scale));
        return scale === 0 ? 12345 : Number(`1234.${'5'.repeat(scale)}`);
      }
      case 'bool':
        return true;
      case 'enum':
        // An outbox's message starts queued: only Adminium marks one sent, failed or skipped.
        if (outbox?.table === table.ref && outbox.columns.status === column.ref) return column.enum?.[0];
        return column.enum?.at(-1);
      case 'json':
        return { words: 'Ærø & “名字”', n: 3.5, yes: true, none: null, list: [1, 'two', { three: [3] }] };
      case 'timestamptz':
        return '2026-08-06T16:12:00.000Z';
      case 'fk':
        return made.get(column.references ?? '') ?? null;
      default:
        throw new Error(`${table.ref}.${column.ref}: no value for ${column.type}`);
    }
  };

  beforeAll(async () => {
    if (!runs) return;
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CUSTOMISER;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(built!.manifest, { bundled: true, files: built!.files });
    const res = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CUSTOMISER, version: built!.version, attachTo: [] } });
    expect(res.statusCode, res.body).toBe(200);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    for (const table of tables) ids.set(table.ref, model.tables.find((one) => one.name === `customiser_${table.ref}`)!.id);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const owner = await usersRepo(h.meta).create({ email: 'ivy@shop.test', name: 'Ivy', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(owner.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const signed = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.8.0.1', payload: { email: 'ivy@shop.test', password: ADMIN_PASSWORD } });
    expect(signed.statusCode, signed.body).toBe(200);
    cookie = sessionCookie(signed.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!runs) return;
    await served?.close();
    await h?.close();
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
  });

  it.skipIf(!runs)('writes every column of every table at its widest and reads it back as written', async () => {
    expect(tables.length).toBeGreaterThan(12);
    // The manifest lists a table after the tables it points at, so each row's links have their rows.
    for (const table of tables) {
      const values = Object.fromEntries(table.columns.map((column) => [column.ref, valueOf(table, column)]).filter(([, value]) => value !== undefined));
      const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(ids.get(table.ref)!)}`, headers: { cookie }, payload: { values } });
      // Each table takes a staff write through the data route, its ledger's receipts among them.
      if (res.statusCode !== 201) throw new Error(`${table.ref}: ${String(res.statusCode)} ${res.body.slice(0, 600)}`);
      const row = (res.json() as { data: Doc }).data;
      made.set(table.ref, Number(row['id']));
      const read = await served.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(ids.get(table.ref)!)}/${String(row['id'])}`, headers: { cookie } });
      expect(read.statusCode, `${table.ref}: ${read.body.slice(0, 300)}`).toBe(200);
      const back = (read.json() as { data: Doc }).data;
      for (const [column, value] of Object.entries(values)) {
        const got = back[column];
        const type = table.columns.find((one) => one.ref === column)!.type;
        // A generated column (a design's code, its link) is the engine's to fill: it is there and as wide as it may be.
        if (type === 'decimal') expect(Number(got), `${table.ref}.${column}`).toBeCloseTo(Number(value), 6);
        else if (type === 'json') expect(typeof got === 'string' ? JSON.parse(got) : got, `${table.ref}.${column}`).toEqual(value);
        else if (type === 'timestamptz') expect(Date.parse(String(got)), `${table.ref}.${column}`).toBe(Date.parse(String(value)));
        else if (type === 'bool') expect(got === true || got === 1 || got === '1', `${table.ref}.${column}`).toBe(true);
        else if (type === 'text' && (column === 'code' || column === 'link_token') && table.ref === 'designs') expect(String(got).length, `${table.ref}.${column}`).toBeGreaterThan(0);
        else if (type === 'fk' || type === 'int') expect(Number(got), `${table.ref}.${column}`).toBe(Number(value));
        else expect(got, `${table.ref}.${column}`).toEqual(value);
      }
    }
  });

  it.skipIf(!runs)('takes a real 3MF and a laser’s SVG into version_files, and gives the same bytes back', async () => {
    const versionFiles = ids.get('version_files')!;
    const versionId = made.get('design_versions');
    expect(versionId).toBeDefined();
    for (const [name, bytes, kind] of [
      ['design-93-v1-name-keyring.3mf', THREE_MF, 'machine'],
      ['design-91-v2-engraved-walnut-coasters.svg', Buffer.from(LASER, 'utf8'), 'machine'],
    ] as const) {
      const sent = await served.composed.app.inject({
        method: 'POST',
        url: `/api/v1/files?${new URLSearchParams({ filename: name, connectionId: h.connectionId, table: versionFiles, column: 'file' }).toString()}`,
        headers: { cookie, 'content-type': 'application/octet-stream' },
        payload: bytes,
      });
      expect(sent.statusCode, `${name}: ${sent.body}`).toBe(201);
      const body = sent.json() as { data: { id: string }; ref?: string; removed?: string[] };
      const row = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(versionFiles)}`, headers: { cookie }, payload: { values: { app: 'maker', version_id: versionId, kind, name, layers: name.endsWith('.svg') ? ['CUT', 'SCORE', 'ENGRAVE'] : [], file: body.ref ?? body.data.id, position: 1 } } });
      expect(row.statusCode, row.body).toBe(201);
      const file = await filesRepo(h.meta).findById(body.data.id);
      expect(file?.attachedAt, name).not.toBeNull();
      const content = await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${body.data.id}/content`, headers: { cookie } });
      expect(content.statusCode, name).toBe(200);
      // The 3MF comes back byte for byte; the laser's SVG is cleaned on the way in, and a clean one is left as it was.
      if (name.endsWith('.3mf')) expect(Buffer.compare(content.rawPayload, THREE_MF), name).toBe(0);
      else {
        expect(body.removed ?? [], name).toEqual([]);
        expect(content.rawPayload.toString('utf8'), name).toContain('id="ENGRAVE"');
      }
    }
  });

  it.skipIf(built !== null)('is skipped: no built Customiser (set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/customiser)', () => {
    expect(built).toBeNull();
  });
});
