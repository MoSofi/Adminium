// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's own screens learn about its add-ons, and what the dashboard's
 * sidebar does with a page whose add-on is not there.
 *
 *  - the STAFF `surface-config.json` carries each attached, switched-on
 *    add-on's version and its `publicSettings` — never another setting;
 *  - the CUSTOMER one is public (no sign-in), so it carries `present: true`
 *    and nothing else: no version, no setting, no payment instructions;
 *  - every surface answer says `Referrer-Policy: no-referrer`;
 *  - bootstrap withholds an app's page whose `feature` needs an add-on that
 *    is not attached, and lists it apart with what it needs.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addOnSettingsRepo,
  connectionsRepo,
  manifestsRepo,
  pagesRepo,
  publicKeysRepo,
  publicScopesRepo,
} from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), `<body data-app="clients-${side}"></body>`, 'utf8');
  }
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** The portal installed, with the invoices add-on attached to it and set up. */
async function seed(fixture: AuthTestApp, opts: { attached?: boolean; enabled?: boolean } = {}) {
  const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
  const conn = await connectionsRepo(fixture.meta, crypto).create({
    name: 'src',
    engine: 'postgres',
    introspectDsn: 'postgres://ro:s@db/prod',
    dataDsn: 'postgres://rw:s@db/prod',
  });
  const repo = manifestsRepo(fixture.meta, IDENTITY);
  const app = await repo.install({
    manifestKey: 'clients',
    version: '0.2.0',
    kind: 'app',
    source: 'file',
    connectionId: conn.id,
    document: {
      name: 'Client Portal',
      addOns: {
        requires: [{ key: 'invoices', range: '>=1.1.0', reason: { 'en-US': 'Invoices.' } }],
        suggests: [{ key: 'holidays', range: '>=1.0.0', reason: { 'en-US': 'Days off.' } }],
        features: [{ id: 'capacity-holidays', label: { 'en-US': 'Holidays in Capacity' }, requires: ['holidays'] }],
      },
      pages: [
        { ref: 'clients-invoices', template: 'page-crud' },
        { ref: 'clients-capacity', template: 'page-crud', feature: 'capacity-holidays' },
      ],
    },
  });
  await repo.install({
    manifestKey: 'invoices',
    version: '1.1.0',
    kind: 'add-on',
    source: 'marketplace',
    document: {
      name: 'Invoices & Receipts',
      settings: [
        { key: 'business_name', type: 'string', default: 'Your business' },
        { key: 'tax_label', type: 'string', default: 'VAT' },
        { key: 'payment_instructions', type: 'string' },
        { key: 'api_key', type: 'string', secret: true },
      ],
      // A manifest listing a secret here is refused by the validator; the
      // config must not rely on that.
      addOn: { publicSettings: ['business_name', 'tax_label', 'api_key'] },
    },
    attachTo: opts.attached === false ? [] : ['clients'],
  });
  if (opts.enabled === false) {
    const added = await repo.findByKey('invoices');
    await repo.setAttachmentEnabled(added!.row.id, 'clients', false);
  }
  await addOnSettingsRepo(fixture.meta).patch(
    'invoices',
    { business_name: 'Acme Studio', payment_instructions: 'IBAN GB00 0000' },
    [
      { key: 'business_name', secret: false },
      { key: 'tax_label', secret: false },
      { key: 'payment_instructions', secret: false },
      { key: 'api_key', secret: true },
    ],
    { updatedBy: null },
  );
  const scope = await publicScopesRepo(fixture.meta).create({
    connectionId: conn.id,
    side: 'customer',
    name: 'portal',
    timezone: 'Europe/London',
    document: JSON.stringify({ version: 1 }),
  });
  const generated = generatePublishableKey();
  await publicKeysRepo(fixture.meta).create({
    name: 'portal key',
    prefix: generated.prefix,
    tokenHash: generated.tokenHash,
    tokenEncrypted: sealPublishableKey(crypto, generated.token),
    scopeId: scope.id,
    side: 'customer',
    appKey: 'clients',
  });
  fixture.app.surfaceSettings?.invalidate();
  return { app, conn };
}

describe('the add-ons in an app’s surface config', () => {
  it('gives the staff side public settings and the customer side only that it is there', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    await seed(t);
    const { cookie } = await login(t.app);

    const staff = await t.app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie: cookie! } });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(staff.json().addOns).toEqual({
      invoices: { version: '1.1.0', settings: { business_name: 'Acme Studio', tax_label: 'VAT' } },
    });
    expect(staff.body).not.toContain('IBAN');
    expect(staff.headers['referrer-policy']).toBe('no-referrer');

    const customer = await t.app.inject({ method: 'GET', url: '/apps/clients/customer/surface-config.json' });
    expect(customer.statusCode, customer.body).toBe(200);
    expect(customer.json().addOns).toEqual({ invoices: { present: true } });
    expect(customer.body).not.toContain('Acme');
    expect(customer.body).not.toContain('IBAN');
    expect(customer.body).not.toContain('1.1.0');
    expect(customer.headers['referrer-policy']).toBe('no-referrer');

    const page = await t.app.inject({ method: 'GET', url: '/apps/clients/customer/', headers: { accept: 'text/html' } });
    expect(page.headers['referrer-policy']).toBe('no-referrer');
  });

  it('leaves out an add-on switched off for the app, or not attached to it', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    await seed(t, { enabled: false });
    const { cookie } = await login(t.app);
    const staff = await t.app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie: cookie! } });
    expect(staff.json()).not.toHaveProperty('addOns');
    const customer = await t.app.inject({ method: 'GET', url: '/apps/clients/customer/surface-config.json' });
    expect(customer.json()).not.toHaveProperty('addOns');
  });
});

describe('a page whose feature needs an add-on that is not there', () => {
  it('leaves the sidebar and is listed apart, saying what it needs', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    const { conn } = await seed(t);
    for (const slug of ['clients-invoices', 'clients-capacity']) {
      await pagesRepo(t.meta).create({
        connectionId: conn.id,
        slug,
        type: 'page-crud',
        title: slug,
        navGroup: 'app',
        config: { app: 'clients', nav: { order: 1 } },
        origin: 'manifest',
      });
    }
    t.app.surfaceSettings?.invalidate();
    const { cookie } = await login(t.app);
    const read = async () => (await t!.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie! } })).json().data;

    let data = await read();
    const sectionSlugs = (d: { appSections: { groups: { items: { slug: string }[] }[] }[] }) =>
      d.appSections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.slug)));
    expect(sectionSlugs(data)).toEqual(['clients-invoices']);
    expect(data.featurePages).toEqual([
      expect.objectContaining({ slug: 'clients-capacity', appKey: 'clients', feature: 'capacity-holidays', needs: ['holidays'] }),
    ]);

    // With the add-on attached, the page is back.
    const repo = manifestsRepo(t.meta, IDENTITY);
    await repo.install({
      manifestKey: 'holidays',
      version: '1.0.0',
      kind: 'add-on',
      source: 'marketplace',
      document: { name: 'Holiday calendars' },
      attachTo: ['clients'],
    });
    data = await read();
    expect(sectionSlugs(data).sort()).toEqual(['clients-capacity', 'clients-invoices']);
    expect(data).not.toHaveProperty('featurePages');
  });
});
