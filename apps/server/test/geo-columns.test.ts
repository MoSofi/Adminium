// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area in a column, on a real database of each engine.
 *
 * What a write may give for each, what is refused and why, and that whatever
 * was given is stored alike and read back as an OBJECT: Postgres and MySQL
 * hand a JSON column back parsed and SQLite as text, so every read here is
 * run on all three. Then the other ways in and out: somebody whose role
 * reaches only their own rows, a line of an import, a file's cell, and the
 * points a map is drawn from.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { defaultPlaces } from '../src/geo/places.js';
import { AREA_MAX_POINTS, areaValueOf, placeCellText, placeValueOf, pointFromText, readGeoValue } from '../src/geo/values.js';
import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const places = defaultPlaces();
const CAIRO = { lat: 30.06263, lng: 31.24967, by: 'town', placeId: 360630, name: 'Cairo', country: 'EG' };
const TAHRIR = { lat: 30.0444, lng: 31.2357, by: 'exact' };
const SQUARE = { type: 'Polygon', coordinates: [[[31.2, 30.0], [31.3, 30.0], [31.3, 30.1], [31.2, 30.1], [31.2, 30.0]]] };

describe('a position read from text', () => {
  it('reads a pair, a geo address, and a map link whose position is written in it', () => {
    const at = { lat: 30.0444, lng: 31.2357 };
    for (const text of [
      '30.0444,31.2357',
      ' 30.0444 , 31.2357 ',
      '30.0444 31.2357',
      '+30.0444,+31.2357',
      'geo:30.0444,31.2357',
      'geo:30.0444,31.2357,12;u=35',
      'geo:30.0444,31.2357?z=15',
      // Google Maps: where the map looks, a search, a pin (which wins over where the map looks).
      'https://www.google.com/maps/@30.0444,31.2357,15z',
      'https://www.google.com/maps/@30.0444,31.2357,15z/data=!3m1!1e3?entry=ttu',
      'https://maps.google.com/?q=30.0444,31.2357',
      'https://www.google.com/maps?q=loc:30.0444,31.2357',
      'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357',
      'https://maps.google.com/maps?ll=30.0444,31.2357&z=14',
      'https://www.google.com/maps/place/Tahrir+Square/@30.0501,31.2412,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d30.0444!4d31.2357!16zL20',
      'https://www.google.com/maps/dir/?api=1&destination=30.0444,31.2357',
      // OpenStreetMap: where the map looks, and a marker (which wins).
      'https://www.openstreetmap.org/#map=15/30.0444/31.2357',
      'https://www.openstreetmap.org/?mlat=30.0444&mlon=31.2357#map=12/30.1000/31.3000',
      // Apple Maps.
      'https://maps.apple.com/?ll=30.0444,31.2357&q=Tahrir%20Square',
      'https://maps.apple.com/?q=30.0444,31.2357',
      'https://www.bing.com/maps?cp=30.0444~31.2357&lvl=15',
    ]) {
      expect(pointFromText(text), text).toEqual(at);
    }
    expect(pointFromText('-33.8688,151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(pointFromText('https://www.google.com/maps/@-33.8688,151.2093,12z')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it('reads coordinates typed in Arabic-Indic or Persian digits, with the Arabic decimal mark and comma', async () => {
    const at = { lat: 30.0444, lng: 31.2357 };
    for (const text of [
      '٣٠٫٠٤٤٤، ٣١٫٢٣٥٧',
      '٣٠.٠٤٤٤,٣١.٢٣٥٧',
      '٣٠٫٠٤٤٤ ٣١٫٢٣٥٧',
      // Persian and Urdu digits.
      '۳۰٫۰۴۴۴، ۳۱٫۲۳۵۷',
      'geo:٣٠٫٠٤٤٤,٣١٫٢٣٥٧',
    ]) {
      expect(pointFromText(text), text).toEqual(at);
    }
    expect(pointFromText('-٢٢٫٩، -٤٧٫٠٦')).toEqual({ lat: -22.9, lng: -47.06 });
    // The same range as any other pair, and stored as any other: Latin digits, an exact point.
    expect(pointFromText('٩١، ٠')).toBe('place-out-of-range');
    expect(await placeValueOf('٣٠٫٠٤٤٤، ٣١٫٢٣٥٧', places)).toEqual({ ok: true, value: { ...at, by: 'exact' } });
    // A town's name in Arabic is still no position.
    expect(pointFromText('القاهرة، مصر')).toBe('place-unreadable');
  });

  it('refuses what is not a position, and says so apart for a link that would have to be followed', () => {
    for (const text of ['somewhere nice', '30.0444', '30,0444;31,2357', 'Cairo', 'https://www.google.com/maps/place/Tahrir+Square', 'https://example.com/', 'javascript:alert(1)', 'file:///etc/passwd', '30.0444,31.2357,extra', `${'9'.repeat(5000)},1`]) {
      expect(pointFromText(text), text).toBe('place-unreadable');
    }
    for (const text of ['https://maps.app.goo.gl/AbCdEf123', 'https://goo.gl/maps/AbCdEf123', 'https://maps.apple.com/p/AbCd', 'https://maps.apple/p/AbCd', 'https://osm.org/go/xyz', 'https://www.openstreetmap.org/go/xyz', 'https://bit.ly/3abc']) {
      expect(pointFromText(text), text).toBe('place-short-link');
    }
    for (const text of ['91,0', '0,181', '-90.0001,0', 'geo:95,200', 'https://maps.google.com/?q=95,10']) {
      expect(pointFromText(text), text).toBe('place-out-of-range');
    }
    expect(pointFromText('90,180')).toEqual({ lat: 90, lng: 180 });
  });

  it('reads four thousand characters made to be slow in no time at all', async () => {
    const long = (head: string, fill: string, tail: string): string => `${head}${fill.repeat(Math.floor((4_090 - head.length - tail.length) / fill.length))}${tail}`;
    // One for each pattern a text is read by: the pair (blanks, then no number), a number's digits, a geo address, and each way a link writes a position.
    const slow = [
      long('1', ' ', 'x'),
      long('1', '\t', ',x'),
      long('1 ,', ' ', 'x'),
      long('-1.5', ' \n', '.'),
      long('1.', '1', 'x'),
      long('1,1.', '1', 'x'),
      long('geo:1,', ' ', 'x'),
      long('geo:1,1.', '1', 'x'),
      long('https://example.com/?q=1,', ' ', 'x'),
      long('https://example.com/?q=loc:1,1.', '1', 'x'),
      long('https://example.com/@1,1.', '1', 'x'),
      long('https://example.com/', '@1,1', 'x'),
      long('https://example.com/#map=', '1', 'x'),
      long('https://example.com/#map=1.', '1', '/1/x'),
      long('https://example.com/?cp=1.', '1', '~x'),
      long('https://example.com/', '!3d1!4d', 'x'),
      long('https://example.com/!3d1.', '1', '!4dx'),
    ];
    const started = performance.now();
    for (const text of slow) {
      expect(text.length).toBeLessThanOrEqual(4_096);
      expect(typeof pointFromText(text), text.slice(0, 40)).toBe('string');
      expect((await placeValueOf(text, defaultPlaces())).ok, text.slice(0, 40)).toBe(false);
      // A number written as text beside a point: the pattern an object's `lat` is read by.
      expect((await placeValueOf({ lat: long('', ' ', 'x'), lng: long('1', ' ', 'x') }, defaultPlaces())).ok).toBe(false);
    }
    // Generous: each is read in well under a millisecond; a pattern that slows by the square took 28 ms for one.
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('never asks another site what a link points at', async () => {
    // Every way out replaced by one that records and throws (the telemetry suite's recorder).
    const attempts: string[] = [];
    const thrower = (label: string) => (): never => {
      attempts.push(label);
      throw new Error(`network disabled: ${label}`);
    };
    const g = globalThis as { fetch: typeof globalThis.fetch };
    const netMod = net as unknown as Record<string, unknown>;
    const httpMod = http as unknown as Record<string, unknown>;
    const httpsMod = https as unknown as Record<string, unknown>;
    const originals = { fetch: g.fetch, connect: netMod.connect, createConnection: netMod.createConnection, socket: net.Socket.prototype.connect, http: httpMod.request, https: httpsMod.request };
    g.fetch = thrower('fetch') as unknown as typeof globalThis.fetch;
    netMod.connect = thrower('net.connect');
    netMod.createConnection = thrower('net.createConnection');
    (net.Socket.prototype as unknown as { connect: unknown }).connect = thrower('socket.connect');
    httpMod.request = thrower('http.request');
    httpsMod.request = thrower('https.request');
    try {
      expect(await placeValueOf('https://maps.app.goo.gl/AbCdEf123', places)).toEqual({ ok: false, code: 'place-short-link' });
      expect(await placeValueOf('https://www.google.com/maps/place/Tahrir+Square', places)).toEqual({ ok: false, code: 'place-unreadable' });
      expect(await placeValueOf('https://www.google.com/maps/@30.0444,31.2357,15z', places)).toEqual({ ok: true, value: TAHRIR });
      expect(await placeValueOf({ placeId: 360630 }, places)).toEqual({ ok: true, value: CAIRO });
    } finally {
      g.fetch = originals.fetch;
      netMod.connect = originals.connect;
      netMod.createConnection = originals.createConnection;
      (net.Socket.prototype as unknown as { connect: unknown }).connect = originals.socket;
      httpMod.request = originals.http;
      httpsMod.request = originals.https;
    }
    expect(attempts).toEqual([]);
  });
});

describe('a place as its column keeps it', () => {
  const kept = async (input: unknown) => placeValueOf(input, places);

  it('takes a town by its id and fills the position from the list, whatever was sent beside it', async () => {
    expect(await kept({ placeId: 360630 })).toEqual({ ok: true, value: CAIRO });
    expect(await kept({ placeId: '360630' })).toEqual({ ok: true, value: CAIRO });
    expect(await kept(CAIRO)).toEqual({ ok: true, value: CAIRO });
    // A position made up and called a town's is not kept: the list's is.
    expect(await kept({ lat: 1, lng: 2, by: 'town', placeId: 360630, name: 'Atlantis', country: 'XX' })).toEqual({ ok: true, value: CAIRO });
    expect(await kept('{"placeId": 360630}')).toEqual({ ok: true, value: CAIRO });
  });

  it('takes an exact point, with the town it is in or a label of the writer’s own', async () => {
    expect(await kept({ lat: 30.0444, lng: 31.2357 })).toEqual({ ok: true, value: TAHRIR });
    expect(await kept({ lat: '30.0444', lng: '31.2357', by: 'exact' })).toEqual({ ok: true, value: TAHRIR });
    expect(await kept({ lat: 30.04440000001, lng: 31.2357 })).toEqual({ ok: true, value: TAHRIR });
    // A town named beside an exact point is the list's town: its name is not the writer's to say.
    expect(await kept({ ...TAHRIR, placeId: 360630, name: 'Atlantis', country: 'XX' })).toEqual({ ok: true, value: { ...TAHRIR, placeId: 360630, name: 'Cairo', country: 'EG' } });
    expect(await kept({ ...TAHRIR, name: ' The depot ', country: 'eg' })).toEqual({ ok: true, value: { ...TAHRIR, name: 'The depot', country: 'EG' } });
    expect(await kept({ ...TAHRIR, extra: 'dropped' })).toEqual({ ok: true, value: TAHRIR });
  });

  it('keeps nothing as nothing', async () => {
    for (const empty of [null, undefined, '', '   ', 'null']) expect(await kept(empty)).toEqual({ ok: true, value: null });
  });

  it('refuses the rest, each with its reason', async () => {
    for (const bad of [42, true, [], [30, 31], { by: 'town' }, { lat: 30, lng: 31, by: 'town' }, { lat: 30 }, { lng: 31 }, { lat: 'north', lng: 31 }, { lat: 30, lng: 31, by: 'guess' }, { placeId: 'cairo' }, { placeId: -4 }, { placeId: 1.5 }, { ...TAHRIR, name: 5 }, { ...TAHRIR, name: 'x'.repeat(201) }, { ...TAHRIR, country: 'Egypt' }, '{not json', 'somewhere nice', {}]) {
      expect(await kept(bad), JSON.stringify(bad)).toEqual({ ok: false, code: 'place-unreadable' });
    }
    expect(await kept({ lat: 91, lng: 0 })).toEqual({ ok: false, code: 'place-out-of-range' });
    expect(await kept({ lat: 0, lng: -180.5, by: 'exact' })).toEqual({ ok: false, code: 'place-out-of-range' });
    expect(await kept({ placeId: 1 })).toEqual({ ok: false, code: 'place-unknown' });
    expect(await kept({ ...TAHRIR, placeId: 1 })).toEqual({ ok: false, code: 'place-unknown' });
    expect(await kept('https://maps.app.goo.gl/AbCdEf123')).toEqual({ ok: false, code: 'place-short-link' });
  });

  it('parses nothing longer than a place’s text may be, JSON included', async () => {
    const padded = (blanks: number): string => `{"lat":30.0444,${' '.repeat(blanks)}"lng":31.2357}`;
    expect(await kept(padded(100))).toEqual({ ok: true, value: TAHRIR });
    expect(await kept(padded(5_000))).toEqual({ ok: false, code: 'place-unreadable' });
    // Never handed to the parser: one that was would be read whole before anything said no.
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(await kept(`{"lat":1,"lng":2,"name":"${'x'.repeat(2_000_000)}"}`)).toEqual({ ok: false, code: 'place-unreadable' });
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('is a file’s cell as `lat,lng`, which reads back as that point', async () => {
    expect(placeCellText(CAIRO)).toBe('30.06263,31.24967');
    expect(placeCellText(JSON.stringify(TAHRIR))).toBe('30.0444,31.2357');
    expect(placeCellText(null)).toBeNull();
    expect(placeCellText('free text')).toBeNull();
    expect(await kept(placeCellText(TAHRIR))).toEqual({ ok: true, value: TAHRIR });
    expect(readGeoValue('{"lat":1,"lng":2,"by":"exact"}')).toEqual({ lat: 1, lng: 2, by: 'exact' });
    expect(readGeoValue('written before the rule')).toBe('written before the rule');
    // JSON that is no object is not a place: it stays the text it was stored as.
    for (const junk of ['123', 'true', 'null', '[1]', '"30,31"', '1e3']) expect(readGeoValue(junk), junk).toBe(junk);
  });
});

describe('an area as its column keeps it', () => {
  const ring = (points: number): number[][] => {
    const out = Array.from({ length: points - 1 }, (_, at) => [Math.cos((2 * Math.PI * at) / (points - 1)), Math.sin((2 * Math.PI * at) / (points - 1))]);
    return [...out, out[0]!];
  };

  it('takes a polygon, several, and a feature wrapping one, and keeps the bare shape', () => {
    expect(areaValueOf(SQUARE)).toEqual({ ok: true, value: SQUARE });
    expect(areaValueOf(JSON.stringify(SQUARE))).toEqual({ ok: true, value: SQUARE });
    expect(areaValueOf({ type: 'Feature', properties: { name: 'Zone A' }, geometry: SQUARE })).toEqual({ ok: true, value: SQUARE });
    const two = { type: 'MultiPolygon', coordinates: [SQUARE.coordinates, [[[10, 10], [11, 10], [11, 11], [10, 10]]]] };
    expect(areaValueOf(two)).toEqual({ ok: true, value: two });
    // A hole is a second ring; a height after a position is dropped; an unknown key is not kept.
    const holed = { type: 'Polygon', coordinates: [SQUARE.coordinates[0]!, [[31.22, 30.02], [31.24, 30.02], [31.24, 30.04], [31.22, 30.02]]] };
    expect(areaValueOf({ ...holed, bbox: [0, 0, 1, 1] })).toEqual({ ok: true, value: holed });
    expect(areaValueOf({ type: 'Polygon', coordinates: [[[1, 2, 99], [3, 2, 99], [3, 4, 99], [1, 2, 99]]] })).toEqual({ ok: true, value: { type: 'Polygon', coordinates: [[[1, 2], [3, 2], [3, 4], [1, 2]]] } });
    for (const empty of [null, undefined, '', 'null']) expect(areaValueOf(empty)).toEqual({ ok: true, value: null });
  });

  it('refuses a shape that is not a closed polygon on the map', () => {
    const open = { type: 'Polygon', coordinates: [[[31.2, 30.0], [31.3, 30.0], [31.3, 30.1], [31.2, 30.1]]] };
    const cases: unknown[] = [
      open,
      { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
      { type: 'Polygon', coordinates: [] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 91], [0, 0]]] },
      { type: 'Polygon', coordinates: [[[181, 0], [1, 0], [1, 1], [181, 0]]] },
      { type: 'Polygon', coordinates: [[['0', '0'], [1, 0], [1, 1], ['0', '0']]] },
      { type: 'Polygon', coordinates: [[[0], [1, 0], [1, 1], [0]]] },
      { type: 'Polygon' },
      { type: 'MultiPolygon', coordinates: [] },
      { type: 'MultiPolygon', coordinates: [SQUARE.coordinates, open.coordinates] },
      { type: 'Point', coordinates: [31.2, 30.0] },
      { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: SQUARE }] },
      { type: 'Feature', geometry: null },
      'not json',
      42,
      [],
    ];
    for (const bad of cases) expect(areaValueOf(bad), JSON.stringify(bad)).toEqual({ ok: false, code: 'area-unreadable' });
  });

  it('refuses a shape larger than a column keeps', () => {
    expect(areaValueOf({ type: 'Polygon', coordinates: [ring(AREA_MAX_POINTS)] }).ok).toBe(true);
    expect(areaValueOf({ type: 'Polygon', coordinates: [ring(AREA_MAX_POINTS + 1)] })).toEqual({ ok: false, code: 'area-too-large' });
    // Counted over every ring of every polygon.
    expect(areaValueOf({ type: 'MultiPolygon', coordinates: [[ring(1200)], [ring(801)]] })).toEqual({ ok: false, code: 'area-too-large' });
    expect(areaValueOf(`{"type":"Polygon","coordinates":[],"padding":"${'x'.repeat(300_000)}"}`)).toEqual({ ok: false, code: 'area-too-large' });
  });
});

type Reply = { statusCode: number; body: string };
type Who = PersonName | 'owner';
const OWN = { reach: 'own' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a place and an area in a column [${dialect}]`, () => {
    let w: World;
    let sites: string;
    const JSON_TYPE = dialect === 'sqlite' ? 'TEXT' : 'JSON';
    const jsonType = dialect === 'sqlite' ? 'text' : 'json';
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const table = (): string => `data/${w.connectionId}/${encodeURIComponent(sites)}`;
    let nextId = 100;
    /** Create a site with these values; answers the reply and the id it was given. */
    const create = async (who: Who, values: Record<string, unknown>): Promise<{ res: Reply; id: number }> => {
      nextId += 1;
      const id = nextId;
      return { res: await call(who, 'POST', table(), { values: { id, name: `Site ${String(id)}`, ...values } }), id };
    };
    const record = async (who: Who, id: number): Promise<Record<string, unknown>> => {
      const res = await call(who, 'GET', `${table()}/${String(id)}`);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ data: Record<string, unknown> }>(res).data;
    };
    const refusedWith = (res: Reply, column: string, code: string): void => {
      expect(res.statusCode, res.body).toBe(422);
      expect(json<{ error: { code: string; details: { fields: Record<string, { code: string }> } } }>(res).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { [column]: { code } } } });
    };
    /** What the database itself holds in a column, as an object whichever way the driver hands it back. */
    const stored = async (id: number, column: 'spot' | 'zone'): Promise<unknown> => readGeoValue((await w.rows(`SELECT ${column} FROM sites WHERE id = ${String(id)}`))[0]![column]);
    const source = () => ({ name: 'sites', ...(dialect === 'postgres' ? { schema: 'public' } : {}) });

    beforeAll(async () => {
      w = await world(dialect);
      // As an app's install makes a json column: JSON on Postgres and MySQL, TEXT on SQLite, which has no such type.
      await w.run(`CREATE TABLE sites (id INTEGER PRIMARY KEY, name VARCHAR(80) NOT NULL, owner_id VARCHAR(36), spot ${JSON_TYPE}, zone ${JSON_TYPE}, visits INTEGER)`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const snapshot = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema);
      sites = snapshot.tables.find((one) => one.name === 'sites')!.id;
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.place', tableName: sites, columnName: 'spot', value: { place: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'column.area', tableName: sites, columnName: 'zone', value: { area: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: sites, columnName: 'owner_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: sites, value: { ways: [{ column: 'owner_id' }] }, origin: 'user' });
      // A rep reaches only the sites that are theirs; everything else of the table is nobody's to them.
      const role = await rolesRepo(w.meta).create({ slug: 'site-rep', name: 'Site rep' });
      await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${sites}`, { read: true, create: true, update: true, delete: false, export: true, import: true, rowLimit: { read: OWN, update: OWN } } as never);
      await w.give('dana', 'site-rep');
      await w.give('omar', 'site-rep');
    }, 180_000);
    afterAll(async () => w?.close());

    it('says so in the column’s facts, on the kind of column an install makes for json', async () => {
      const model = await w.model();
      const found = model.tables.find((one) => one.id === sites)!;
      expect(found.columns.find((column) => column.name === 'spot')).toMatchObject({ logicalType: jsonType, place: true });
      expect(found.columns.find((column) => column.name === 'zone')).toMatchObject({ logicalType: jsonType, area: true });
      const facts = await columnFactsFor(w.meta, w.connectionId, sites);
      const fact = (name: string) => facts?.columns.find((column) => column.spec.name === name);
      expect(fact('spot')).toMatchObject({ place: true });
      expect(fact('spot')?.area).toBeUndefined();
      expect(fact('zone')).toMatchObject({ area: true });
      expect(fact('name')?.place).toBeUndefined();
    });

    it('refuses either rule on a column that is not json', async () => {
      const model = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema);
      const column = (name: string) => model.tables.find((one) => one.id === sites)!.columns.find((one) => one.name === name)!;
      expect(columnRuleIssue('column.place', { place: true }, column('spot'), model)).toBeNull();
      expect(columnRuleIssue('column.area', { area: true }, column('zone'), model)).toBeNull();
      expect(columnRuleIssue('column.place', { place: true }, column('name'), model)).toContain('A place is kept in a json column; "name" is');
      expect(columnRuleIssue('column.area', { area: true }, column('visits'), model)).toContain('An area is kept in a json column; "visits" is');
      expect(columnRuleIssue('column.place', { place: true }, column('id'), model)).toContain('cannot hold a place');
      expect(columnRuleIssue('column.area', { area: true }, column('spot'), model, undefined, { rules: [{ op: 'column.place', columnName: 'spot', value: { place: true } }] })).toContain('holds a place or an area, not both');
      // And through the route an owner saves rules by: refused whole, nothing changed.
      const before = await overridesRepo(w.meta).listForConnection(w.connectionId, { status: 'active' });
      const res = await call('owner', 'PUT', `connections/${w.connectionId}/overrides`, { overrides: [{ op: 'column.place', tableName: sites, columnName: 'name', value: { place: true } }] });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.body).toContain('A place is kept in a json column');
      expect(await overridesRepo(w.meta).listForConnection(w.connectionId, { status: 'active' })).toHaveLength(before.length);
    });

    it('stores each thing a save may give for a place alike, and reads it back as an object', async () => {
      const cases: [unknown, Record<string, unknown>][] = [
        [{ placeId: 360630 }, CAIRO],
        [CAIRO, CAIRO],
        // Called a town's, with a position of the writer's own: the list's position is kept.
        [{ lat: 1, lng: 2, by: 'town', placeId: 360630 }, CAIRO],
        [{ lat: 30.0444, lng: 31.2357 }, TAHRIR],
        [TAHRIR, TAHRIR],
        ['30.0444,31.2357', TAHRIR],
        ['geo:30.0444,31.2357;u=35', TAHRIR],
        ['https://www.google.com/maps/@30.0444,31.2357,15z', TAHRIR],
        ['https://www.google.com/maps/place/Tahrir+Square/@30.0501,31.2412,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d30.0444!4d31.2357', TAHRIR],
        ['https://www.openstreetmap.org/?mlat=30.0444&mlon=31.2357#map=12/30.1/31.3', TAHRIR],
        ['https://maps.apple.com/?ll=30.0444,31.2357&q=Tahrir', TAHRIR],
        [{ ...TAHRIR, placeId: 360630 }, { ...TAHRIR, placeId: 360630, name: 'Cairo', country: 'EG' }],
        [JSON.stringify({ placeId: 360630 }), CAIRO],
      ];
      for (const [given, kept] of cases) {
        const { res, id } = await create('owner', { spot: given });
        expect(res.statusCode, `${JSON.stringify(given)} → ${res.body}`).toBe(201);
        // The reply to the save, the record, the list and the database's own row all hold the same object.
        expect(json<{ data: Record<string, unknown> }>(res).data['spot'], JSON.stringify(given)).toEqual(kept);
        expect((await record('owner', id))['spot'], JSON.stringify(given)).toEqual(kept);
        expect(await stored(id, 'spot'), JSON.stringify(given)).toEqual(kept);
      }
      const list = json<{ data: Record<string, unknown>[] }>(await call('owner', 'GET', `${table()}?limit=100`)).data;
      expect(list.length).toBe(cases.length);
      for (const row of list) {
        expect(typeof row['spot'], JSON.stringify(row)).toBe('object');
        expect(row['spot']).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number), by: expect.stringMatching(/^(town|exact)$/) });
      }
      // No place is no place.
      const none = await create('owner', { spot: null });
      expect(none.res.statusCode, none.res.body).toBe(201);
      expect((await record('owner', none.id))['spot']).toBeNull();
    });

    it('answers what was in the column before it was called a place as it is stored, never as something it spells', async () => {
      // Written by another program, or before the rule: JSON that is no object, and on SQLite (whose json column is text) anything at all.
      const junk = ['123', 'true', 'null', '[1]', '"123"', '"30.0444,31.2357"', ...(dialect === 'sqlite' ? ['not json', '{broken'] : [])];
      const first = 9_000;
      try {
        for (const [at, text] of junk.entries()) await w.run(`INSERT INTO sites (id, name, spot) VALUES (${String(first + at)}, 'Junk ${String(at)}', '${text}')`);
        // As the driver hands each back: that, and nothing made of it, is what a reader is given.
        const raw = new Map((await w.rows(`SELECT id, spot FROM sites WHERE id >= ${String(first)}`)).map((row) => [Number(row['id']), row['spot']]));
        const list = await call('owner', 'GET', `${table()}?limit=200`);
        expect(list.statusCode, list.body).toBe(200);
        const rows = json<{ data: { id: number; spot: unknown }[] }>(list).data.filter((row) => Number(row.id) >= first);
        expect(rows).toHaveLength(junk.length);
        for (const row of rows) expect(row.spot, `${dialect} ${junk[Number(row.id) - first]!}`).toEqual(raw.get(Number(row.id)));
        if (dialect === 'sqlite') expect(rows.map((row) => row.spot)).toEqual(junk);
        // A JSON string stays a string: `"123"` is not the number 123 on any engine.
        expect(typeof rows.find((row) => Number(row.id) === first + 4)!.spot).toBe('string');
        for (const at of junk.keys()) expect((await record('owner', first + at))['spot']).toEqual(raw.get(first + at));
      } finally {
        await w.run(`DELETE FROM sites WHERE id >= ${String(first)}`);
      }
    });

    it('refuses what is not a place, naming the column and why, and stores nothing', async () => {
      const before = (await w.rows('SELECT COUNT(*) AS n FROM sites'))[0]!['n'];
      const cases: [unknown, string][] = [
        ['somewhere nice', 'place-unreadable'],
        [{ lat: 30, lng: 31, by: 'town' }, 'place-unreadable'],
        [{ lat: 'north', lng: 31 }, 'place-unreadable'],
        [42, 'place-unreadable'],
        [[30.0444, 31.2357], 'place-unreadable'],
        ['https://www.google.com/maps/place/Tahrir+Square', 'place-unreadable'],
        ['https://maps.app.goo.gl/AbCdEf123', 'place-short-link'],
        [{ lat: 91, lng: 0 }, 'place-out-of-range'],
        ['30.0444,231.2357', 'place-out-of-range'],
        [{ placeId: 1 }, 'place-unknown'],
      ];
      for (const [given, code] of cases) refusedWith((await create('owner', { spot: given })).res, 'spot', code);
      expect((await w.rows('SELECT COUNT(*) AS n FROM sites'))[0]!['n']).toEqual(before);
    });

    it('changes a place, and takes it away', async () => {
      const { id } = await create('owner', { spot: { placeId: 360630 } });
      const moved = await call('owner', 'PATCH', `${table()}/${String(id)}`, { values: { spot: '30.0444,31.2357' } });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(json<{ data: Record<string, unknown> }>(moved).data['spot']).toEqual(TAHRIR);
      expect(await stored(id, 'spot')).toEqual(TAHRIR);
      // A change that is refused leaves the place as it was.
      refusedWith(await call('owner', 'PATCH', `${table()}/${String(id)}`, { values: { spot: { placeId: 1 } } }), 'spot', 'place-unknown');
      expect((await record('owner', id))['spot']).toEqual(TAHRIR);
      // A change to another column leaves it alone and is not asked for it again.
      const renamed = await call('owner', 'PATCH', `${table()}/${String(id)}`, { values: { name: 'Renamed' } });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(json<{ data: Record<string, unknown> }>(renamed).data['spot']).toEqual(TAHRIR);
      const cleared = await call('owner', 'PATCH', `${table()}/${String(id)}`, { values: { spot: null } });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect((await record('owner', id))['spot']).toBeNull();
    });

    it('stores an area as its bare shape, reads it back as an object, and refuses what is not one', async () => {
      const made = await create('owner', { zone: { type: 'Feature', properties: { name: 'Zone A' }, geometry: SQUARE } });
      expect(made.res.statusCode, made.res.body).toBe(201);
      expect(json<{ data: Record<string, unknown> }>(made.res).data['zone']).toEqual(SQUARE);
      expect((await record('owner', made.id))['zone']).toEqual(SQUARE);
      expect(await stored(made.id, 'zone')).toEqual(SQUARE);
      const text = await create('owner', { zone: JSON.stringify(SQUARE) });
      expect(text.res.statusCode, text.res.body).toBe(201);
      expect((await record('owner', text.id))['zone']).toEqual(SQUARE);

      const open = { type: 'Polygon', coordinates: [[[31.2, 30.0], [31.3, 30.0], [31.3, 30.1], [31.2, 30.1]]] };
      refusedWith((await create('owner', { zone: open })).res, 'zone', 'area-unreadable');
      refusedWith((await create('owner', { zone: { type: 'Point', coordinates: [31.2, 30.0] } })).res, 'zone', 'area-unreadable');
      refusedWith((await create('owner', { zone: 'a field by the river' })).res, 'zone', 'area-unreadable');
      refusedWith((await create('owner', { zone: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 95], [0, 0]]] } })).res, 'zone', 'area-unreadable');
      const many = Array.from({ length: AREA_MAX_POINTS }, (_, at) => [at / 100, 1]);
      refusedWith((await create('owner', { zone: { type: 'Polygon', coordinates: [[...many, many[0]!]] } })).res, 'zone', 'area-too-large');
      // Both at once: each column is named with its own reason.
      const both = (await create('owner', { spot: 'nowhere', zone: 'nothing' })).res;
      refusedWith(both, 'spot', 'place-unreadable');
      refusedWith(both, 'zone', 'area-unreadable');
      refusedWith(await call('owner', 'PATCH', `${table()}/${String(made.id)}`, { values: { zone: open } }), 'zone', 'area-unreadable');
      expect((await record('owner', made.id))['zone']).toEqual(SQUARE);
    });

    it('holds for somebody whose role reaches only their own rows', async () => {
      const dana = w.people.dana;
      const hers = await create('dana', { owner_id: dana, spot: { placeId: 360630 }, zone: SQUARE });
      expect(hers.res.statusCode, hers.res.body).toBe(201);
      expect(json<{ data: Record<string, unknown> }>(hers.res).data).toMatchObject({ spot: CAIRO, zone: SQUARE });
      refusedWith((await create('dana', { owner_id: dana, spot: 'https://maps.app.goo.gl/AbCdEf123' })).res, 'spot', 'place-short-link');
      refusedWith(await call('dana', 'PATCH', `${table()}/${String(hers.id)}`, { values: { spot: { lat: 0, lng: 500 } } }), 'spot', 'place-out-of-range');
      const moved = await call('dana', 'PATCH', `${table()}/${String(hers.id)}`, { values: { spot: 'geo:30.0444,31.2357' } });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(json<{ data: Record<string, unknown> }>(moved).data['spot']).toEqual(TAHRIR);

      // She reads her own, as objects; Omar's and nobody's are not hers to read or to move.
      const omars = await create('omar', { owner_id: w.people.omar, spot: { placeId: 360630 } });
      expect(omars.res.statusCode, omars.res.body).toBe(201);
      const list = json<{ data: Record<string, unknown>[] }>(await call('dana', 'GET', `${table()}?limit=100`)).data;
      expect(list.map((row) => Number(row['id']))).toEqual([hers.id]);
      expect(list[0]).toMatchObject({ spot: TAHRIR, zone: SQUARE });
      expect((await call('dana', 'GET', `${table()}/${String(omars.id)}`)).statusCode).toBe(404);
      expect((await call('dana', 'PATCH', `${table()}/${String(omars.id)}`, { values: { spot: '1,1' } })).statusCode).toBe(404);
      expect(await stored(omars.id, 'spot')).toEqual(CAIRO);
    });

    it('draws a map’s points from the one place column, each saying how it is known, within the rows the reader reaches', async () => {
      await w.run('DELETE FROM sites');
      await w.run(`INSERT INTO sites (id, name, owner_id, spot, visits) VALUES (1, 'Cairo office', '${w.people.dana}', '${JSON.stringify(CAIRO)}', 7), (2, 'Tahrir kiosk', '${w.people.omar}', '${JSON.stringify(TAHRIR)}', 3), (3, 'Nowhere yet', '${w.people.dana}', NULL, 1)`);
      const points = async (who: Who) => {
        const res = await call(who, 'POST', 'widget-data/query', { descriptor: { connectionId: w.connectionId, source: source(), shape: 'geo-points', select: ['name', 'spot', 'visits'], orderBy: [{ column: 'id', dir: 'asc' }] } });
        expect(res.statusCode, res.body).toBe(200);
        return json<{ result: { shape: string; points: Record<string, unknown>[] } }>(res).result;
      };
      const all = await points('owner');
      expect(all.shape).toBe('geo-points');
      // A row with no place cannot be put on a map: it is left out, never drawn at 0,0.
      expect(all.points).toEqual([
        { name: 'Cairo office', lat: 30.06263, lng: 31.24967, by: 'town', placeId: 360630, values: { visits: 7 } },
        { name: 'Tahrir kiosk', lat: 30.0444, lng: 31.2357, by: 'exact', values: { visits: 3 } },
      ]);
      expect((await points('dana')).points).toEqual([{ name: 'Cairo office', lat: 30.06263, lng: 31.24967, by: 'town', placeId: 360630, values: { visits: 7 } }]);
      expect((await points('omar')).points).toEqual([{ name: 'Tahrir kiosk', lat: 30.0444, lng: 31.2357, by: 'exact', values: { visits: 3 } }]);
    });

    it('writes a place into a file as `lat,lng` and an area as its JSON', async () => {
      await w.run('DELETE FROM sites');
      await w.run(`INSERT INTO sites (id, name, spot, zone) VALUES (1, 'Cairo office', '${JSON.stringify(CAIRO)}', '${JSON.stringify(SQUARE)}'), (2, 'Tahrir kiosk', '${JSON.stringify(TAHRIR)}', NULL), (3, 'Nowhere yet', NULL, NULL)`);
      const asked = await call('owner', 'POST', 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: sites }, format: 'csv' });
      expect(asked.statusCode, asked.body).toBe(202);
      await w.jobs();
      const file = await call('owner', 'GET', `exports/${json<{ data: { id: string } }>(asked).data.id}/download`);
      expect(file.statusCode, file.body).toBe(200);
      const lines = file.body.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      expect(lines[0]).toBe('id,name,owner_id,spot,zone,visits');
      expect(lines[1]).toBe(`1,Cairo office,,"30.06263,31.24967","${JSON.stringify(SQUARE).replaceAll('"', '""')}",`);
      expect(lines[2]).toBe('2,Tahrir kiosk,,"30.0444,31.2357",,');
      expect(lines[3]).toBe('3,Nowhere yet,,,,');

      // JSON Lines keeps the whole place: how it is known is not lost there.
      const jsonl = await call('owner', 'POST', 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: sites }, format: 'json' });
      expect(jsonl.statusCode, jsonl.body).toBe(202);
      await w.jobs();
      const body = (await call('owner', 'GET', `exports/${json<{ data: { id: string } }>(jsonl).data.id}/download`)).body;
      const first = JSON.parse(body.trim().split('\n')[0]!) as Record<string, unknown>;
      expect(readGeoValue(first['spot'])).toEqual(CAIRO);
    });

    it('takes from an import what a save takes, and refuses the same things', async () => {
      await w.run('DELETE FROM sites');
      const csv = [
        'id,name,spot,zone',
        '1,By pair,"30.0444,31.2357",',
        `2,By town,"${JSON.stringify({ placeId: 360630 }).replaceAll('"', '""')}",`,
        '3,By link,"https://www.google.com/maps/@30.0444,31.2357,15z",',
        `4,With area,,"${JSON.stringify(SQUARE).replaceAll('"', '""')}"`,
        '5,No place,,',
        '6,Bad place,somewhere nice,',
        '7,Short link,https://maps.app.goo.gl/AbCdEf123,',
        `8,Unknown town,"${JSON.stringify({ placeId: 1 }).replaceAll('"', '""')}",`,
        `9,Open area,,"${JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] }).replaceAll('"', '""')}"`,
      ].join('\n');
      const uploaded = await call('owner', 'POST', 'imports/upload?filename=sites.csv', csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const made = await call('owner', 'POST', 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table: sites, mapping: { columns: ['id', 'name', 'spot', 'zone'].map((name) => ({ from: name, to: name })) }, options: { skipInvalid: true } });
      expect(made.statusCode, made.body).toBe(201);
      const id = json<{ data: { import: { id: string } } }>(made).data.import.id;
      expect((await call('owner', 'POST', `imports/${id}/run`, {})).statusCode).toBe(202);
      await w.jobs();
      const view = json<{ data: { status: string; stats: { total: number; inserted?: number; skipped?: number } | null } }>(await call('owner', 'GET', `imports/${id}`)).data;
      expect(view.status).toBe('succeeded');
      expect(view.stats).toMatchObject({ total: 9, inserted: 5, skipped: 4 });

      const rows = json<{ data: Record<string, unknown>[] }>(await call('owner', 'GET', `${table()}?limit=100&sort=id`)).data.sort((a, b) => Number(a['id']) - Number(b['id']));
      expect(rows.map((row) => Number(row['id']))).toEqual([1, 2, 3, 4, 5]);
      expect(rows[0]!['spot']).toEqual(TAHRIR);
      expect(rows[1]!['spot']).toEqual(CAIRO);
      expect(rows[2]!['spot']).toEqual(TAHRIR);
      expect(rows[3]).toMatchObject({ spot: null, zone: SQUARE });
      expect(rows[4]).toMatchObject({ spot: null, zone: null });
      expect(await stored(2, 'spot')).toEqual(CAIRO);
      // The report names each refused line's column and why.
      const report = (await call('owner', 'GET', `imports/${id}/error-report`)).body;
      for (const code of ['place-unreadable', 'place-short-link', 'place-unknown', 'area-unreadable']) expect(report, code).toContain(code);
    });
  });
}
