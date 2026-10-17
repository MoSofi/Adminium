// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PLACE AND AN AREA ON THE PAGES ADMINIUM MAKES, against the whole server on
 * SQLite, Postgres and MySQL: an app declares a place column and an area
 * column and a records page over their table, and installs.
 *
 * What is on trial, each a gap between the server's half and the browser's:
 *
 *  1. the two rules reach the model a page is composed from (they were on the
 *     reader's model only, so the generator saw two JSON columns);
 *  2. the page stored at install lists the place and keeps the area for its
 *     form (a generated page left every JSON column out), and the reply the
 *     dashboard reads says which control each takes;
 *  3. the map the generator offers — over the one place column, and over a
 *     lat/lng pair — asks for columns the server reads as points, and answers
 *     with them, held to the rows the reader reaches.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyModel, parseDatabaseModel, toCandidateModel, type DatabaseModel } from '@adminium/engine';
import { overridesRepo, pagesRepo, snapshotsRepo } from '@adminium/meta';

import { applyCompositionOverrides } from '../src/connections/effective-schema.js';
import { runGeneration } from '../src/generate/run.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const CAIRO = { lat: 30.06263, lng: 31.24967, by: 'town', placeId: 360630 };
const TAHRIR = { lat: 30.0444, lng: 31.2357, by: 'exact' };
const SQUARE = { type: 'Polygon', coordinates: [[[31.2, 30.0], [31.3, 30.0], [31.3, 30.1], [31.2, 30.1], [31.2, 30.0]]] };

const id = { ref: 'id', type: 'int', role: 'pk' };
const owner = { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } };
const own = { rows: { read: { reach: 'own' }, update: { reach: 'own' } } };

function depot(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'depot',
    name: 'Depot',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.depot.desc', fallback: 'Depots and their stops.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    maps: true,
    navGroups: [{ key: 'depot', label: { 'en-US': 'Depot' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'sites',
          belongs: [{ column: 'owner_id' }],
          indexes: [['owner_id']],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            owner,
            { ref: 'spot', type: 'json', nullable: true, rules: { place: true } },
            { ref: 'zone', type: 'json', nullable: true, rules: { area: true } },
            // No rule: whatever JSON is given, and on no generated list or form.
            { ref: 'notes', type: 'json', nullable: true },
            { ref: 'visits', type: 'int', nullable: true },
          ],
        },
        {
          // No rule at all: two real columns the classifier reads as a pair.
          ref: 'stops',
          belongs: [{ column: 'owner_id' }],
          indexes: [['owner_id']],
          columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, owner, { ref: 'state', type: 'enum', enum: ['planned', 'done'], default: 'planned' }, { ref: 'lat', type: 'float', nullable: true }, { ref: 'lng', type: 'float', nullable: true }],
        },
      ],
    },
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@sites:read', 'table:@sites:create', 'table:@sites:update', 'table:@stops:read', 'table:@stops:create', 'table:@stops:update', 'page:@depot-sites:view'],
        limits: { sites: own, stops: own },
      },
    ],
    pages: [{ ref: 'depot-sites', template: 'page-crud', title: { key: 't.depot-sites', fallback: 'Sites' }, nav: { group: 'depot', icon: 'list', order: 1 }, bindings: { rows: 'sites' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

interface Spec {
  name: string;
  logicalType: string;
  semantic: string | null;
  sortable?: boolean;
  hidden?: boolean;
}
interface Candidate {
  rule: string;
  widget: string;
  shape: string;
  binding: { select?: string[]; [key: string]: unknown };
  config: Record<string, unknown>;
}
interface Point {
  name: string;
  lat?: number;
  lng?: number;
  by?: string;
  code?: string;
}

/**
 * The candidate rules themselves. The server may not depend on the widgets
 * package (the engine is its way to them), and the engine hands out pages, not
 * the candidates it composes them from: read from the build the engine loads.
 */
const WIDGETS = new URL('../../../packages/widgets/dist/generate/index.js', import.meta.url).href;

/** The page's column specs, and the names of those a list shows. */
function columnsOf(envelope: unknown): { by: Map<string, Spec>; shown: string[] } {
  const columns = ((envelope as { config: { columns: Spec[] } }).config.columns ?? []) as Spec[];
  return { by: new Map(columns.map((column) => [column.name, column])), shown: columns.filter((column) => column.hidden !== true).map((column) => column.name) };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a place and an area on generated pages, on ${dialect}`, () => {
    let s: WholeServer;
    /** The model a page is composed from: the snapshot with the rules composition reads, as all three composers make it. */
    const compositionModel = async (): Promise<DatabaseModel> =>
      applyCompositionOverrides(parseDatabaseModel((await snapshotsRepo(s.meta).latest(s.connectionId))!.schema), await overridesRepo(s.meta).listForConnection(s.connectionId, { status: 'active' }));
    /** What the generator offers for one of the app's tables, by the rule that offers it. */
    const offered = async (ref: string, rule: string): Promise<Candidate | undefined> => {
      const model = await compositionModel();
      const classified = new Map(classifyModel(model).tables.map((table) => [table.tableId, table]));
      const candidateModel = toCandidateModel(model, model.tables, classified);
      const entry = candidateModel.find((one) => one.table.id === s.t(ref))!;
      const { emitCandidates } = (await import(WIDGETS)) as { emitCandidates: (table: unknown, classified: unknown, ctx: unknown) => Candidate[] };
      return emitCandidates(entry.table, entry.classified, { connectionId: s.connectionId, model: candidateModel }).find((candidate) => candidate.rule === rule);
    };
    /** The points a widget's own query answers with, for one person. */
    const points = async (who: string, binding: Candidate['binding']): Promise<Point[]> => {
      const res: Reply = await s.send(who, 'POST', '/api/v1/widget-data/query', { descriptor: { ...binding, orderBy: [{ column: 'id', dir: 'asc' }] } });
      expect(res.statusCode, res.body).toBe(200);
      const result = (res.json() as { result: { shape: string; points: Point[] } }).result;
      expect(result.shape).toBe('geo-points');
      return result.points;
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, depot(), { people: { dana: ['rep'], omar: ['rep'] } });
      expect(said(await s.make('owner', 'sites', { name: 'Cairo depot', owner_id: s.ids['dana'], spot: { placeId: 360630 }, zone: SQUARE, visits: 7 }))).toBe('ok');
      expect(said(await s.make('owner', 'sites', { name: 'Tahrir kiosk', owner_id: s.ids['omar'], spot: '30.0444,31.2357', visits: 3 }))).toBe('ok');
      // No place yet: on a list, on no map.
      expect(said(await s.make('owner', 'sites', { name: 'Nowhere yet', owner_id: s.ids['dana'] }))).toBe('ok');
      expect(said(await s.make('owner', 'stops', { title: 'North gate', owner_id: s.ids['dana'], lat: 30.0444, lng: 31.2357 }))).toBe('ok');
      expect(said(await s.make('owner', 'stops', { title: 'South gate', owner_id: s.ids['omar'], lat: 51.5, lng: -0.12 }))).toBe('ok');
      expect(said(await s.make('owner', 'stops', { title: 'Not surveyed', owner_id: s.ids['omar'] }))).toBe('ok');
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('carries both rules onto the model a page is composed from', async () => {
      const sites = (await compositionModel()).tables.find((table) => table.id === s.t('sites'))!;
      const column = (name: string) => sites.columns.find((one) => one.name === name)!;
      expect(column('spot').place).toBe(true);
      expect(column('spot').area).toBeUndefined();
      expect(column('zone').area).toBe(true);
      expect(column('zone').place).toBeUndefined();
      expect(column('notes').place).toBeUndefined();
      expect(column('notes').area).toBeUndefined();
    });

    it('stores a page whose list shows the place, and which keeps the area for its form', async () => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'depot-sites'))!;
      const { by, shown } = columnsOf((await pagesRepo(s.meta).findById(page.id))!.config);
      // The place sits beside the name; the area and the JSON nobody gave a rule are on no list.
      expect(shown.slice(0, 2)).toEqual(['name', 'spot']);
      expect(shown).not.toContain('zone');
      expect(shown).not.toContain('notes');
      // One spec on every engine (SQLite keeps both as TEXT): JSON, never sorted by.
      expect(by.get('spot')).toMatchObject({ logicalType: 'json', sortable: false });
      // A hidden spec is what a form and a record are built from: the area has its field, and no column.
      expect(by.get('zone')).toMatchObject({ logicalType: 'json', sortable: false, hidden: true });
      expect(by.has('notes')).toBe(false);
    });

    it('answers the page with the columns and the facts the dashboard draws a place field and an area field from', async () => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'depot-sites'))!;
      for (const who of ['owner', 'dana']) {
        const res = await s.get(who, `/api/v1/pages/${page.id}`);
        expect(res.statusCode, res.body).toBe(200);
        const reply = res.json() as { data: unknown; columnFacts: { columns: { spec: { name: string }; place?: true; area?: true }[] } };
        // The form is built from the page's columns, each drawn by what its fact says (`columnFacts[].place` / `.area`).
        const { by } = columnsOf(reply.data);
        const fact = (name: string) => reply.columnFacts.columns.find((column) => column.spec.name === name);
        expect(by.has('spot'), who).toBe(true);
        expect(fact('spot'), who).toMatchObject({ place: true });
        expect(fact('spot')?.area).toBeUndefined();
        expect(by.has('zone'), who).toBe(true);
        expect(fact('zone'), who).toMatchObject({ area: true });
        expect(fact('notes')?.place).toBeUndefined();
        expect(fact('notes')?.area).toBeUndefined();
      }
    });

    it('offers the map over the place column, and its query answers with points that say how each is known', async () => {
      const map = await offered('sites', 'geo.place-column');
      expect(map).toMatchObject({ widget: 'map-bubble', shape: 'geo-points', config: { nameField: 'name', placeColumn: 'spot' } });
      expect(map!.binding.select?.slice(0, 2)).toEqual(['name', 'spot']);

      // A site with no place is on no map; nobody is drawn at 0,0.
      expect(await points('owner', map!.binding)).toEqual([
        { name: 'Cairo depot', ...CAIRO, values: {} },
        { name: 'Tahrir kiosk', ...TAHRIR, values: {} },
      ]);
      // A rep reaches their own sites, and no pin of anybody else's.
      expect(await points('dana', map!.binding)).toEqual([{ name: 'Cairo depot', ...CAIRO, values: {} }]);
      expect(await points('omar', map!.binding)).toEqual([{ name: 'Tahrir kiosk', ...TAHRIR, values: {} }]);
    });

    it('offers the map over a lat/lng pair bound as the server reads it, and its query answers with points', async () => {
      const map = await offered('stops', 'geo.lat-lng-pair');
      expect(map).toMatchObject({ widget: 'map-bubble', shape: 'geo-points', config: { nameField: 'title', latColumn: 'lat', lngColumn: 'lng' } });
      // By position: the name, then the pair. A status came first in a list's columns, and was read as a region's code.
      expect(map!.binding.select).toEqual(['title', 'lat', 'lng']);

      expect(await points('owner', map!.binding)).toEqual([
        { name: 'North gate', lat: 30.0444, lng: 31.2357, values: {} },
        { name: 'South gate', lat: 51.5, lng: -0.12, values: {} },
      ]);
      expect(await points('dana', map!.binding)).toEqual([{ name: 'North gate', lat: 30.0444, lng: 31.2357, values: {} }]);
      expect(await points('omar', map!.binding)).toEqual([{ name: 'South gate', lat: 51.5, lng: -0.12, values: {} }]);

      // What the rule bound before, a list's columns: every stop answered as a region with a code, and none with a position.
      const before = await points('owner', { ...map!.binding, select: ['title', 'state'] });
      expect(before).toHaveLength(3);
      expect(before.every((point) => point.lat === undefined && point.lng === undefined && point.code === 'planned')).toBe(true);
    });

    it('lists the place on the page a generation run makes for the table, too', async () => {
      // Last: a run writes the connection's own pages beside the app's.
      const run = await runGeneration({ manager: s.manager, meta: s.meta, connectionId: s.connectionId });
      const page = run.pages.find((one) => one.template === 'page-crud' && one.source.table === s.t('sites'))!;
      const { by, shown } = columnsOf(page);
      expect(shown).toContain('spot');
      expect(shown).not.toContain('zone');
      expect(by.get('zone')).toMatchObject({ hidden: true });
      expect(by.has('notes')).toBe(false);
      // The app's own page is as its install stored it.
      const stored = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'depot-sites'))!;
      expect(columnsOf((await pagesRepo(s.meta).findById(stored.id))!.config).shown.slice(0, 2)).toEqual(['name', 'spot']);
    });
  });
}
