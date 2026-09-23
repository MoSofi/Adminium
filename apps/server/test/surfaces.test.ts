// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hosted app surfaces — serving, precedence and the staff gate.
 *
 * The gate is the reason this file is long. A staff bundle is reachable by TWO
 * different code paths — the static route, and the SPA fallback in the
 * not-found handler — and only the first has route hooks. The `/apps/x/staff`
 * (no trailing slash) case exists here because it takes the second path and an
 * earlier draft served it to anyone.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import {
  discoverSurfaces,
  parseSurfaceManifest,
  resolveLabel,
  type HostedSurface,
} from '../src/cli/surfaces-root.js';
import { buildAppSections, buildHostedApps } from '../src/routes/bootstrap/handlers.js';
import { makeEnv } from './helpers.js';

const DASH_HTML = '<!doctype html><html><body data-app="dashboard"></body></html>';
const STAFF_HTML = '<!doctype html><html><body data-app="clients-staff"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="clients-customer"></body></html>';

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let app: AdminiumServer | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), DASH_HTML, 'utf8');

  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  const staff = join(surfacesDir, 'clients', 'staff');
  const customer = join(surfacesDir, 'clients', 'customer');
  await mkdir(join(staff, 'assets'), { recursive: true });
  await mkdir(customer, { recursive: true });
  await writeFile(join(staff, 'index.html'), STAFF_HTML, 'utf8');
  await writeFile(join(staff, 'assets', 'staff.js'), 'export const x = 1;', 'utf8');
  // The staff side carries a nav contract; the customer side deliberately does
  // NOT, so both the present and the absent case are covered by discovery.
  await writeFile(
    join(staff, 'surface.json'),
    JSON.stringify({
      v: 1,
      appKey: 'clients',
      side: 'staff',
      appLabels: { 'en-US': 'Outline' },
      nav: [{ id: 'home', path: 'home', icon: 'house', labels: { 'en-US': 'Home' } }],
    }),
    'utf8',
  );
  await writeFile(join(customer, 'index.html'), CUSTOMER_HTML, 'utf8');

  // An empty side that must NOT register a route (a failed build leaves this).
  await mkdir(join(surfacesDir, 'ghost', 'staff'), { recursive: true });

  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(): Promise<AdminiumServer> {
  app = await buildServer({ env: makeEnv(), logger: false, staticRoot: dist, surfaces });
  return app;
}

/** A browser tab, as opposed to `fetch`. */
const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };

describe('discovery', () => {
  it('finds only sides that actually hold an index.html', () => {
    // Order is app key, then SURFACE_SIDES order (staff before customer) —
    // not alphabetical. Asserted because a route table that reorders between
    // boots makes an intermittent failure look like a code change.
    expect(surfaces.map((s) => s.prefix)).toEqual([
      '/apps/clients/staff',
      '/apps/clients/customer',
    ]);
  });

  it('is empty for an unset or missing directory', () => {
    expect(discoverSurfaces(undefined)).toEqual([]);
    expect(discoverSurfaces(join(surfacesDir, 'nope'))).toEqual([]);
  });
});

describe('customer surface — public', () => {
  it('serves its own index, not the dashboard’s', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/apps/clients/customer/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('clients-customer');
  });

  it('deep links fall back to that surface’s index', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/apps/clients/customer/invoice/42',
      headers: NAVIGATE,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('clients-customer');
    expect(res.body).not.toContain('dashboard');
  });
});

describe('staff surface — gated on the admin session', () => {
  it('redirects an anonymous navigation to login with `next`', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/apps/clients/staff/',
      headers: NAVIGATE,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login?next=%2Fapps%2Fclients%2Fstaff%2F');
  });

  it('refuses an anonymous fetch with a coded envelope, not a redirect', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/apps/clients/staff/assets/staff.js',
      headers: { accept: '*/*', 'sec-fetch-mode': 'cors' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: expect.stringContaining('UNAUTH') } });
  });

  it('gates the no-trailing-slash form, which takes the not-found path', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/apps/clients/staff',
      headers: NAVIGATE,
    });
    expect(res.statusCode).toBe(302);
    expect(res.body).not.toContain('clients-staff');
  });

  it('gates the staff surface-config.json, which names this app\'s database', async () => {
    /*
     * It carries no key — staff reads through the session — but it does name a
     * connection id, and it sits behind the same gate as the bundle it
     * configures. Asserted because "no secret in it" is the argument that would
     * otherwise justify leaving it open.
     */
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/apps/clients/staff/surface-config.json',
      headers: { accept: '*/*', 'sec-fetch-mode': 'cors' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('gates a deep link, which also takes the not-found path', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/apps/clients/staff/proposals/7',
      headers: NAVIGATE,
    });
    expect(res.statusCode).toBe(302);
    expect(res.body).not.toContain('clients-staff');
  });
});

describe('surface.json — the build-emitted nav contract', () => {
  const ok = {
    v: 1,
    appKey: 'clients',
    side: 'staff',
    appLabels: { 'en-US': 'Outline', 'de-DE': 'Outline' },
    nav: [
      { id: 'home', path: 'home', icon: 'house', labels: { 'en-US': 'Home', 'de-DE': 'Start' } },
      { id: 'entry', path: '', persona: 'floor', labels: { 'en-US': 'Entry' } },
    ],
  };

  it('parses a well-formed document', () => {
    const parsed = parseSurfaceManifest(JSON.stringify(ok));
    expect(parsed?.nav.map((n) => n.id)).toEqual(['home', 'entry']);
    expect(parsed?.nav[0]?.icon).toBe('house');
    expect(parsed?.nav[1]?.persona).toBe('floor');
    // An EMPTY path is legal — a surface whose only screen is its root.
    expect(parsed?.nav[1]?.path).toBe('');
  });

  it('returns null — never throws — for everything a bad file can be', () => {
    /*
     * Each of these is a real state a file on disk reaches: an interrupted
     * build, a hand-edit, a newer toolkit. None may take the server down, and
     * none may produce a HALF-parsed nav, which is worse than no nav: a
     * section that navigates nowhere looks like a broken app rather than a
     * missing rebuild.
     */
    const bad: [string, unknown][] = [
      ['not json', '{oh no'],
      ['a bare array', JSON.stringify([])],
      ['null', JSON.stringify(null)],
      ['a future version', JSON.stringify({ ...ok, v: 2 })],
      ['no appLabels', JSON.stringify({ ...ok, appLabels: {} })],
      ['nav is not an array', JSON.stringify({ ...ok, nav: {} })],
      ['an item with no id', JSON.stringify({ ...ok, nav: [{ path: 'x', labels: { a: 'b' } }] })],
      [
        'an ABSOLUTE path',
        JSON.stringify({ ...ok, nav: [{ id: 'x', path: '/x', labels: { a: 'b' } }] }),
      ],
      ['an item with no labels', JSON.stringify({ ...ok, nav: [{ id: 'x', path: 'x' }] })],
      [
        'a blank label',
        JSON.stringify({ ...ok, nav: [{ id: 'x', path: 'x', labels: { 'en-US': '' } }] }),
      ],
    ];
    for (const [name, raw] of bad) {
      expect(parseSurfaceManifest(raw as string), name).toBeNull();
    }
  });

  it('resolves a label to the session locale, falling back to en-US', () => {
    const labels = { 'en-US': 'Home', 'de-DE': 'Start' };
    expect(resolveLabel(labels, 'de-DE')).toBe('Start');
    // A locale the app does not ship must not render blank.
    expect(resolveLabel(labels, 'cs-CZ')).toBe('Home');
    expect(resolveLabel({ 'cs-CZ': 'Přehled' }, 'de-DE')).toBe('Přehled');
    // The spelling a user's preference is actually stored in:
    // it missed every key and fell back to English for every reader.
    expect(resolveLabel(labels, 'de_DE')).toBe('Start');
    expect(resolveLabel(labels, 'de_AT')).toBe('Start');
  });

  it('is discovered and attached, and is null when absent', async () => {
    // The staff fixture has one; the customer fixture deliberately does not,
    // which is the "predates the toolkit" case an operator will actually hit.
    const staff = surfaces.find((s) => s.side === 'staff');
    const customer = surfaces.find((s) => s.side === 'customer');
    expect(staff?.manifest?.nav.map((n) => n.id)).toEqual(['home']);
    expect(customer?.manifest).toBeNull();
  });
});

describe('bootstrap hostedApps', () => {
  const staffSurface = (manifest: HostedSurface['manifest']): HostedSurface => ({
    appKey: 'clients',
    side: 'staff',
    root: '/nowhere',
    prefix: '/apps/clients/staff',
    manifest,
  });
  const MANIFEST = {
    v: 1,
    appLabels: { 'en-US': 'Outline', 'de-DE': 'Kontur' },
    nav: [{ id: 'home', path: 'home', labels: { 'en-US': 'Home', 'de-DE': 'Start' } }],
  };
  const NONE = { apps: {}, domains: {}, statuses: {} };

  it('blends a staff surface by DEFAULT — external is the opt-out', () => {
    // D9: hosted is the normal case and the whole point of the wave is that
    // an operator should not need a second place to go. The inverse default
    // would leave every installed app invisible behind a toggle nobody looks for.
    const apps = buildHostedApps([staffSurface(MANIFEST)], NONE, 'en-US');
    expect(apps).toEqual([
      { appKey: 'clients', label: 'Outline', items: [{ id: 'home', path: 'home', label: 'Home' }] },
    ]);
  });

  it("uses the operator's name for the app over the one it was built with", () => {
    /*
     * The rename has to reach the SIDEBAR, not just the app. An operator who
     * renames "Outline" to their own business and still reads "Outline" in
     * Adminium's own navigation has been given half a feature — and the half
     * they see most often.
     *
     * One string for every locale, unlike the app's own labels: an operator
     * types one business name, and translating it is not Adminium's to do.
     */
    const settings = { apps: { clients: { name: 'Acme Client Hub' } }, domains: {}, statuses: {} };
    expect(buildHostedApps([staffSurface(MANIFEST)], settings, 'en-US')[0]?.label).toBe(
      'Acme Client Hub',
    );
    expect(buildHostedApps([staffSurface(MANIFEST)], settings, 'de-DE')[0]?.label).toBe(
      'Acme Client Hub',
    );
    // The nav ITEMS still follow the reader's locale — only the app's name is
    // the operator's to fix.
    expect(buildHostedApps([staffSurface(MANIFEST)], settings, 'de-DE')[0]?.items[0]?.label).toBe(
      'Start',
    );
  });

  it('resolves labels to the session locale', () => {
    const apps = buildHostedApps([staffSurface(MANIFEST)], NONE, 'de-DE');
    expect(apps[0]?.label).toBe('Kontur');
    expect(apps[0]?.items[0]?.label).toBe('Start');
  });

  it('adds ONE SECTION PER INSTANCE, with the same items behind each', () => {
    /*
     * The two-Dashboards shape: the items are identical because it is the
     * same app — only the database behind them differs, which is why the slug
     * has to be in the heading and not in the rows.
     */
    const settings = {
      apps: {
        clients: {
          instances: [
            { slug: 'berlin', connectionId: 'con_b' },
            { slug: 'lisbon', connectionId: 'con_l' },
          ],
        },
      },
      domains: {},
      statuses: {},
    };
    const apps = buildHostedApps([staffSurface(MANIFEST)], settings, 'en-US');
    expect(apps.map((a) => [a.appKey, a.instance, a.label])).toEqual([
      ['clients', undefined, 'Outline'],
      ['clients', 'berlin', 'Outline · berlin'],
      ['clients', 'lisbon', 'Outline · lisbon'],
    ]);
    // The app's own section keeps carrying no slug, so nothing about it moves.
    expect(apps[0]?.instance).toBeUndefined();
    expect(apps[1]?.items).toEqual(apps[0]?.items);
  });

  it('drops an app the operator placed externally', () => {
    const settings = { apps: { clients: { staff: 'external' as const } }, domains: {}, statuses: {} };
    expect(buildHostedApps([staffSurface(MANIFEST)], settings, 'en-US')).toEqual([]);
  });

  it('drops a customer surface whatever the placement', () => {
    // A customer surface is for a customer; it is never in the operator's rail.
    const customer: HostedSurface = { ...staffSurface(MANIFEST), side: 'customer' };
    expect(buildHostedApps([customer], NONE, 'en-US')).toEqual([]);
  });

  it('drops a surface with no manifest, and one with an empty nav', () => {
    // Neither is an error: both still serve at /apps/<key>/staff/. A labelled
    // heading with nothing under it would be a dead end in the rail.
    expect(buildHostedApps([staffSurface(null)], NONE, 'en-US')).toEqual([]);
    expect(buildHostedApps([staffSurface({ ...MANIFEST, nav: [] })], NONE, 'en-US')).toEqual([]);
  });

  it('folds an app’s staff screens into its own section, under the app’s name', () => {
    const hosted = buildHostedApps([staffSurface(MANIFEST)], NONE, 'de-DE');
    const sections = buildAppSections({
      apps: [{ key: 'clients', version: '2.0.0', name: 'Clients', navGroups: [] }],
      appItems: new Map(),
      hosted,
      surfaces: [staffSurface(MANIFEST)],
      settings: NONE,
      locale: 'de-DE',
      protocol: 'https',
    });
    expect(sections).toEqual([
      {
        appKey: 'clients',
        label: 'Kontur',
        version: '2.0.0',
        groups: [],
        staff: { placement: 'internal', items: [{ id: 'home', path: 'home', label: 'Start' }] },
      },
    ]);
    // With no pages and no staff screens there is no section to draw.
    expect(
      buildAppSections({
        apps: [{ key: 'clients', version: '2.0.0', name: 'Clients', navGroups: [] }],
        appItems: new Map(),
        hosted: [],
        surfaces: [],
        settings: NONE,
        locale: 'en-US',
        protocol: 'https',
      }),
    ).toEqual([]);
  });

  it('offers no staff entry to someone who may not open the staff screens', () => {
    const [section] = buildAppSections({
      apps: [{ key: 'clients', version: '2.0.0', name: 'Clients', navGroups: [] }],
      appItems: new Map([['clients', [{ group: null, item: { pageId: 'p', slug: 'clients-home', labelKey: 'nav.clients-home', fallback: 'Home', icon: 'house', order: 0, connectionId: null, connectionName: null, currency: null, sourceTable: null, appKey: 'clients' } }]]]),
      hosted: buildHostedApps([staffSurface(MANIFEST)], NONE, 'en-US'),
      surfaces: [staffSurface(MANIFEST)],
      settings: NONE,
      locale: 'en-US',
      protocol: 'https',
      mayOpenStaff: new Set(),
    });
    // The pages stay; the screens do not.
    expect(section?.groups[0]?.items.map((item) => item.slug)).toEqual(['clients-home']);
    expect(section?.staff).toBeNull();
  });

  it('links a staff side on a mapped domain to that domain', () => {
    const settings = {
      apps: { clients: { staff: 'external' as const } },
      domains: { 'till.example.test': { appKey: 'clients', side: 'staff' as const } },
      statuses: {},
    };
    const [section] = buildAppSections({
      apps: [{ key: 'clients', version: '2.0.0', name: 'Clients', navGroups: [] }],
      appItems: new Map(),
      hosted: buildHostedApps([staffSurface(MANIFEST)], settings, 'en-US'),
      surfaces: [staffSurface(MANIFEST)],
      settings,
      locale: 'en-US',
      protocol: 'https',
    });
    expect(section?.staff).toEqual({
      placement: 'external',
      url: 'https://till.example.test/',
      items: [{ id: 'home', path: 'home', label: 'Home' }],
      instances: [],
    });
  });

  it('names an external app’s screens, and links each extra instance to its own address', () => {
    const settings = {
      apps: {
        clients: {
          staff: 'external' as const,
          instances: [
            { slug: 'terrace', connectionId: 'conn_b' },
            { slug: 'harbour', connectionId: 'conn_c' },
          ],
        },
      },
      domains: { 'harbour.example.test': { appKey: 'clients', side: 'staff' as const, instance: 'harbour' } },
      statuses: {},
    };
    const [section] = buildAppSections({
      apps: [{ key: 'clients', version: '2.0.0', name: 'Clients', navGroups: [] }],
      appItems: new Map(),
      hosted: buildHostedApps([staffSurface(MANIFEST)], settings, 'de-DE'),
      surfaces: [staffSurface(MANIFEST)],
      settings,
      locale: 'de-DE',
      protocol: 'https',
    });
    expect(section?.staff).toEqual({
      placement: 'external',
      url: '/apps/clients/staff/',
      items: [{ id: 'home', path: 'home', label: 'Start' }],
      instances: [
        { slug: 'terrace', url: '/apps/clients/terrace/staff/' },
        { slug: 'harbour', url: 'https://harbour.example.test/' },
      ],
    });
  });
});

describe('framing — the internal placement\'s precondition', () => {
  it('lets the dashboard frame a staff surface at its own origin', async () => {
    /*
     * The internal placement (D6) puts `/apps/<key>/staff/` inside an iframe on
     * `/a/<key>/…`. Both are this origin, so this passes — but it passed
     * NOTHING before: helmet shipped `frame-ancestors 'none'` and
     * `X-Frame-Options: DENY`, and the frame would have rendered blank with a
     * console line and no server-side symptom at all. Asserted on the SURFACE
     * reply specifically, not just on an API reply, because a future
     * scoped-helmet registration on the surfaces plugin would break this while
     * every other header test kept passing.
     */
    const res = await (await build()).inject({ method: 'GET', url: '/apps/clients/customer/' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'self'");
    // The legacy header must AGREE — a browser reading `DENY` here never looks
    // at the directive above.
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

describe('precedence and isolation', () => {
  it('leaves the dashboard at / untouched', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dashboard');
  });

  it('leaves the dashboard’s own SPA fallback untouched', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/settings/team' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dashboard');
  });

  it('does not divert /api/* into a surface', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('an unknown app key is a normal dashboard fallback, not a surface', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/apps/nosuch/staff/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dashboard');
  });

  it('boots unchanged when no surfaces are configured', async () => {
    app = await buildServer({ env: makeEnv(), logger: false, staticRoot: dist });
    expect(app.surfaces).toEqual([]);
    const res = await app.inject({ method: 'GET', url: '/apps/clients/staff/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dashboard');
  });
});
