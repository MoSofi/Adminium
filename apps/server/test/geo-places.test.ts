// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The place list: towns found by name with no site asked, however the name
 * is typed, and the three routes that answer from it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorEnvelope } from '../src/errors.js';
import { createPlaces, defaultPlaces, placeKey, PLACES_RETRY_MS, PlacesUnavailableError, type Place } from '../src/geo/places.js';
import { RATE_BUCKETS } from '../src/plugins/core.js';
import { geoRoutes } from '../src/routes/geo/index.js';
import { geoServer, type GeoServer } from './geo.helpers.js';

const places = defaultPlaces();
const names = (found: Place[]): string[] => found.map((place) => place.plainName);

describe('a name as it is compared', () => {
  it('ignores case, accents and punctuation', () => {
    expect(placeKey('São João del-Rei')).toBe('sao joao del rei');
    expect(placeKey("  L'Aquila ")).toBe('laquila');
    expect(placeKey('Æbeltoft')).toBe('aebeltoft');
    expect(placeKey('Łódź')).toBe('lodz');
    expect(placeKey('Straße')).toBe('strasse');
  });

  it('reads an Arabic name alike however it is typed', () => {
    // Hamza on or under the alef, a madda, ta marbuta as ه, alef maqsura as ي, marks, stretching.
    const forms = ['منشأة علي آغا', 'منشاة علي اغا', 'منشاه علي اغا', 'مُنْشَأَة عَلِيّ آغا', 'منشـــأة علي آغا', 'منشأة على آغا'];
    expect(new Set(forms.map(placeKey)).size).toBe(1);
    expect(placeKey('الإسكندرية')).toBe(placeKey('الاسكندريه'));
  });
});

describe('the place list', () => {
  it('holds every place of a thousand people or more, read on the first question', async () => {
    expect(await places.count()).toBeGreaterThan(150_000);
  });

  it('finds a small Brazilian town by its name typed without accents', async () => {
    // Solidão, Pernambuco: about five thousand people.
    const found = await places.search('solidao', { country: 'BR' });
    expect(found[0]).toMatchObject({ plainName: 'Solidão', country: 'BR', countryName: 'Brazil', region: 'Pernambuco' });
    expect(found[0]!.population).toBeLessThan(10_000);
    // From the start of a word inside the name, and in any case.
    expect(names(await places.search('SEBASTIAO DO UMBUZ'))).toContain('São Sebastião do Umbuzeiro');
    expect(names(await places.search('umbuzeiro', { country: 'BR' }))).toContain('São Sebastião do Umbuzeiro');
    // Not from the middle of a word.
    expect(names(await places.search('olidao'))).not.toContain('Solidão');
  });

  it('finds a small Egyptian town by its Arabic name, with and without the hamza and the ta marbuta', async () => {
    // Munshāt ‘Alī Āghā, Kafr el-Sheikh: under four thousand people.
    for (const typed of ['منشأة علي آغا', 'منشاة علي اغا', 'منشاه علي اغا', 'منشأة علي']) {
      const found = await places.search(typed, { language: 'ar_EG' });
      expect(found[0], typed).toMatchObject({ id: 11608775, name: 'منشأة علي آغا', plainName: 'Munshāt ‘Alī Āghā', country: 'EG', countryName: 'مصر' });
    }
    // By its plain name too, without the marks, and the Arabic name is not shown to an English reader.
    const plain = await places.search('munshat ali agha');
    expect(plain[0]).toMatchObject({ id: 11608775, name: 'Munshāt ‘Alī Āghā', countryName: 'Egypt' });
  });

  it('names a place in the asker’s language where the list has it', async () => {
    expect((await places.search('munich', { language: 'de-DE' }))[0]).toMatchObject({ name: 'München', plainName: 'Munich', countryName: 'Deutschland' });
    expect((await places.search('北京', { language: 'zh_CN' }))[0]).toMatchObject({ name: '北京', plainName: 'Beijing' });
    expect((await places.search('Kairo', { language: 'da' }))[0]).toMatchObject({ plainName: 'Cairo', country: 'EG' });
    // A language the list has no name in: the plain one.
    expect((await places.byId(11608775, 'cs_CZ'))?.name).toBe('Munshāt ‘Alī Āghā');
  });

  it('puts an exact name first, then the most people', async () => {
    expect((await places.search('paris'))[0]).toMatchObject({ plainName: 'Paris', country: 'FR' });
    // A village called San comes before Shanghai, whose Czech name starts with "san": the whole name was typed.
    const found = await places.search('san', { limit: 20 });
    const exact = found.filter((place) => place.plainName === 'San');
    expect(exact.length).toBeGreaterThan(1);
    expect(found.slice(0, exact.length)).toEqual(exact);
    expect(exact.map((place) => place.population)).toEqual([...exact.map((place) => place.population)].sort((a, b) => b - a));
    const rest = found.slice(exact.length);
    expect(rest[0]!.population).toBeGreaterThan(exact[0]!.population);
    expect(rest.map((place) => place.population)).toEqual([...rest.map((place) => place.population)].sort((a, b) => b - a));
  });

  it('narrows to a country, by its code or its name in any shipped language', async () => {
    for (const country of ['US', 'us', 'United States', 'États-Unis', 'الولايات المتحدة الأمريكية']) {
      const found = await places.search('paris', { country });
      expect(found.length, country).toBeGreaterThan(1);
      expect(new Set(found.map((place) => place.country)), country).toEqual(new Set(['US']));
    }
    // A country the list does not know has no places: never every country's.
    expect(await places.search('paris', { country: 'Atlantis' })).toEqual([]);
  });

  it('answers ten unless asked otherwise, and never more than twenty', async () => {
    expect(await places.search('san')).toHaveLength(10);
    expect(await places.search('san', { limit: 3 })).toHaveLength(3);
    expect(await places.search('san', { limit: 500 })).toHaveLength(20);
    expect(await places.search('   ')).toEqual([]);
    expect(await places.search('zzzzqqqq')).toEqual([]);
  });

  it('reads one place by its id', async () => {
    expect(await places.byId(360630)).toMatchObject({ id: 360630, plainName: 'Cairo', country: 'EG', lat: 30.06263, lng: 31.24967 });
    expect(await places.byId(1)).toBeNull();
    expect(await places.byId(2.5)).toBeNull();
  });

  it('matches an address’s town: the country narrows, the region breaks a tie, else the most people', async () => {
    // Without a region: the largest Springfield (Missouri).
    expect(await places.match({ town: 'Springfield', country: 'US' })).toMatchObject({ region: 'Missouri' });
    expect(await places.match({ town: 'springfield', region: 'Illinois', country: 'United States' })).toMatchObject({ region: 'Illinois' });
    expect(await places.match({ town: 'Springfield', region: 'IL' })).toMatchObject({ region: 'Illinois' });
    // A region none of them is in decides nothing.
    expect(await places.match({ town: 'Springfield', region: 'Bavaria', country: 'US' })).toMatchObject({ region: 'Missouri' });
    expect(await places.match({ town: 'Solidao', country: 'Brazil' })).toMatchObject({ plainName: 'Solidão' });
    expect(await places.match({ town: 'منشاه علي اغا' })).toMatchObject({ id: 11608775 });
  });

  it('answers null rather than a guess', async () => {
    // The whole name, never a start of one; and never a town of another country.
    expect(await places.match({ town: 'Springf' })).toBeNull();
    expect(await places.match({ town: 'Solidão', country: 'EG' })).toBeNull();
    expect(await places.match({ town: 'Nowhereville upon Nothing' })).toBeNull();
    expect(await places.match({ town: 'Paris', country: 'Atlantis' })).toBeNull();
    expect(await places.match({ town: '  ' })).toBeNull();
  });
});

describe('a list that is missing or broken', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'geo-places-'));
    await writeFile(join(dir, 'not-gzip.tsv.gz'), 'this is not a gzip file');
    await writeFile(join(dir, 'other.tsv.gz'), gzipSync('#something-else 1 2026-01-01 1 0\n1\tA\t\tBR\t\t\t0\t0\t1\t\n'));
    await writeFile(join(dir, 'short.tsv.gz'), gzipSync('#adminium-places 1 2026-01-01 5 0\n1\tA\t\tBR\t\t\t0.00000\t0.00000\t1\t\n'));
    await writeFile(join(dir, 'small.tsv.gz'), gzipSync('#adminium-places 1 2026-01-01 2 1\n=BR\tBrazil\tfr=Brésil\n7\tAlpha\t\tBR\t01\tNorth\t1.50000\t-2.50000\t900\tfr=Alphe|ar=ألفا\n9\tBeta Ville\t\tBR\t\t\t3.00000\t4.00000\t50\t\n'));
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it('is a plain 503 on every question, never a crash', async () => {
    for (const file of ['missing.tsv.gz', 'not-gzip.tsv.gz', 'other.tsv.gz', 'short.tsv.gz']) {
      const broken = createPlaces({ file: join(dir, file) });
      for (const ask of [broken.search('a'), broken.byId(1), broken.match({ town: 'a' }), broken.count()]) {
        const error = await ask.then(
          () => null,
          (thrown: unknown) => thrown,
        );
        expect(error, file).toBeInstanceOf(PlacesUnavailableError);
        expect(error, file).toMatchObject({ statusCode: 503, code: 'PLACES_UNAVAILABLE' });
      }
    }
  });

  it('is found again once the file is put back, with no restart, and is not read over again on every question meanwhile', async () => {
    const file = join(dir, 'later.tsv.gz');
    let clock = 1_000_000;
    const later = createPlaces({ file, now: () => clock });
    await expect(later.count()).rejects.toBeInstanceOf(PlacesUnavailableError);
    await writeFile(file, gzipSync('#adminium-places 1 2026-01-01 1 0\n1\tA\t\tBR\t\t\t0.00000\t0.00000\t1\t\n'));
    // Inside the minute the failure is remembered: the file, there by now, is not opened to find out.
    expect(PLACES_RETRY_MS).toBe(60_000);
    clock += PLACES_RETRY_MS - 1;
    for (const ask of [later.count(), later.search('a'), later.byId(1)]) await expect(ask).rejects.toMatchObject({ statusCode: 503, code: 'PLACES_UNAVAILABLE' });
    clock += 1;
    expect(await later.count()).toBe(1);

    // A file that is there and broken costs its unpacking once a minute, not once a question.
    const broken = join(dir, 'broken-later.tsv.gz');
    await writeFile(broken, gzipSync('#adminium-places 1 2026-01-01 5 0\n1\tA\t\tBR\t\t\t0.00000\t0.00000\t1\t\n'));
    const mended = createPlaces({ file: broken, now: () => clock });
    await expect(mended.count()).rejects.toBeInstanceOf(PlacesUnavailableError);
    await writeFile(broken, gzipSync('#adminium-places 1 2026-01-01 1 0\n1\tA\t\tBR\t\t\t0.00000\t0.00000\t1\t\n'));
    await expect(mended.count()).rejects.toBeInstanceOf(PlacesUnavailableError);
    clock += PLACES_RETRY_MS;
    expect(await mended.count()).toBe(1);
  });

  it('reads a list of its own making whole: the first place, the last, and one with no region', async () => {
    const small = createPlaces({ file: join(dir, 'small.tsv.gz') });
    expect(await small.byId(7, 'fr_FR')).toEqual({ id: 7, name: 'Alphe', plainName: 'Alpha', country: 'BR', countryName: 'Brésil', region: 'North', lat: 1.5, lng: -2.5, population: 900 });
    expect(await small.byId(9)).toEqual({ id: 9, name: 'Beta Ville', plainName: 'Beta Ville', country: 'BR', countryName: 'Brazil', region: null, lat: 3, lng: 4, population: 50 });
    expect(names(await small.search('vil'))).toEqual(['Beta Ville']);
    expect(names(await small.search('ألف'))).toEqual(['Alpha']);
    expect(names(await small.search('a'))).toEqual(['Alpha']);
    expect(await small.byId(8)).toBeNull();
  });

  it('answers 503 from the routes, in the server’s own envelope', async () => {
    const app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id));
    });
    app.decorateRequest('user', null);
    app.decorateRequest('apiKeyPrincipal', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: unknown }).user = { id: 'usr_x' };
    });
    await app.register(geoRoutes({ meta: { db: null } as never, places: createPlaces({ file: join(dir, 'missing.tsv.gz') }) }), { prefix: '/api/v1' });
    await app.ready();
    for (const call of [
      { method: 'GET' as const, url: '/api/v1/geo/places?q=cairo&language=en' },
      { method: 'GET' as const, url: '/api/v1/geo/places/360630?language=en' },
      { method: 'POST' as const, url: '/api/v1/geo/places/match', payload: { items: [{ town: 'Cairo' }], language: 'en' } },
    ]) {
      const res = await app.inject(call);
      expect(res.statusCode, call.url).toBe(503);
      expect(res.json(), call.url).toMatchObject({ error: { code: 'PLACES_UNAVAILABLE', message: expect.stringContaining('list of places is missing') } });
    }
    await app.close();
  });
});

describe('the place routes', () => {
  let s: GeoServer;
  beforeAll(async () => {
    // Maps switched off by the operator: the list answers all the same, and asks nobody.
    s = await geoServer({ ADMINIUM_MAP_SERVER: 'off', ADMINIUM_ROUTING_SERVER: 'off' });
  }, 60_000);
  afterAll(async () => s.close());

  it('GET /geo/places answers towns for anybody signed in, on the search budget', async () => {
    const res = await s.server.app.inject({ method: 'GET', url: `/api/v1/geo/places?q=${encodeURIComponent('solidao')}&country=BR&limit=2`, headers: { cookie: s.cookie } });
    expect(res.statusCode, res.body).toBe(200);
    expect(Number(res.headers['x-ratelimit-limit'])).toBe(RATE_BUCKETS.search.max);
    const { data } = res.json() as { data: Place[] };
    expect(data.length).toBeLessThanOrEqual(2);
    expect(data[0]).toEqual({ id: 3387249, name: 'Solidão', plainName: 'Solidão', country: 'BR', countryName: 'Brazil', region: 'Pernambuco', lat: -7.60028, lng: -37.65194, population: 5210 });
    // The owner reads English; a language asked for wins.
    const arabic = await s.server.app.inject({ method: 'GET', url: `/api/v1/geo/places?q=${encodeURIComponent('منشاه علي اغا')}&language=ar_EG`, headers: { cookie: s.cookie } });
    expect((arabic.json() as { data: Place[] }).data[0]).toMatchObject({ id: 11608775, name: 'منشأة علي آغا', countryName: 'مصر' });
    // Signed out, nothing answers; and a limit over twenty is refused.
    expect((await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places?q=cairo' })).statusCode).toBe(401);
    expect((await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places?q=cairo&limit=21', headers: { cookie: s.cookie } })).statusCode).toBe(422);
    expect((await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places', headers: { cookie: s.cookie } })).statusCode).toBe(422);
  });

  it('GET /geo/places/:id answers one town, or 404', async () => {
    const res = await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places/360630?language=ar', headers: { cookie: s.cookie } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Place }).data).toMatchObject({ id: 360630, name: 'القاهرة', plainName: 'Cairo', country: 'EG' });
    expect((await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places/1', headers: { cookie: s.cookie } })).statusCode).toBe(404);
    expect((await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places/cairo', headers: { cookie: s.cookie } })).statusCode).toBe(422);
    expect((await s.server.app.inject({ method: 'GET', url: '/api/v1/geo/places/360630' })).statusCode).toBe(401);
  });

  it('POST /geo/places/match answers as many as it was asked, in order, null where there is no such town', async () => {
    const items = [{ town: 'Springfield', region: 'IL', country: 'US' }, { town: 'Nowhereville upon Nothing' }, { town: 'Solidão', country: 'BR' }, { town: 'Cairo', country: 'Egypt', region: null }];
    const res = await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/places/match', headers: s.write, payload: { items } });
    expect(res.statusCode, res.body).toBe(200);
    expect(Number(res.headers['x-ratelimit-limit'])).toBe(RATE_BUCKETS['geo-match'].max);
    const { data } = res.json() as { data: (Place | null)[] };
    expect(data).toHaveLength(4);
    expect(data[0]).toMatchObject({ plainName: 'Springfield', region: 'Illinois' });
    expect(data[1]).toBeNull();
    expect(data[2]).toMatchObject({ id: 3387249 });
    expect(data[3]).toMatchObject({ id: 360630 });

    // Two hundred at most, one at least, and nothing but the three words.
    const many = Array.from({ length: 200 }, (_, at) => ({ town: at % 2 === 0 ? 'Paris' : `No such town ${String(at)}` }));
    const full = await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/places/match', headers: s.write, payload: { items: many } });
    expect((full.json() as { data: unknown[] }).data).toHaveLength(200);
    for (const payload of [{ items: [...many, { town: 'Paris' }] }, { items: [] }, { items: [{ town: 'Paris', lat: 1 }] }, {}]) {
      expect((await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/places/match', headers: s.write, payload })).statusCode).toBe(422);
    }
    expect((await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/places/match', payload: { items } })).statusCode).toBe(401);
  });
});
