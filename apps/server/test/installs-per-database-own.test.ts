// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One app on two databases: each copy answers to its own switches, its own
 * address and its own grant.
 *
 * Fernhill's copy is the first (the bare addresses); Kiln's is a later one
 * (slug `second`) on the second database. Then:
 *  - a part switched off on Kiln stops Kiln's pages, cards, public entries
 *    and rules, and leaves Fernhill's on; switched off on Fernhill, it never
 *    silences Kiln;
 *  - a record of Kiln's opens at Kiln's own staff address, for Kiln's staff
 *    grant only; Fernhill's grant opens nothing of Kiln's;
 *  - a sign-in link of Kiln's key points at Kiln's guest side, never the bare
 *    install's.
 */
import { manifestsRepo, pagesRepo, rolesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { recordAddressBook } from '../src/apps/record-address.js';
import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { emailSecretKey } from '../src/email/config.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { configureEmailRuntime, emailEnvelopeKey } from '../src/email/send.js';
import { addressKey, codeKey } from '../src/public-api/claim-code.js';
import { guestBaseOn } from '../src/public-api/guest-base.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { runSignInLinkJob, startPayload } from '../src/public-api/sign-in-link.js';
import { appPartIsOn, cardsOfPartsOn, forgetClosedDoors, pagePartOff, pagesOfPartsOff, rulePartOff, withOpenDoors } from '../src/rbac/app-parts.js';
import { resolveForRoles } from '../src/rbac/resolver.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const ORIGIN = 'https://shop.example.com';

function shop(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    modules: [
      { id: 'desk', label: { 'en-US': 'Desk' }, default: 'always' },
      { id: 'vans', label: { 'en-US': 'Vans' }, default: 'on' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'clients', module: 'desk', columns: [id, { ref: 'contact_name', type: 'text', maxLength: 120 }, { ref: 'email', type: 'text', maxLength: 254, unique: true }] },
        { ref: 'vans', module: 'vans', columns: [id, { ref: 'plate', type: 'text', maxLength: 20 }] },
      ],
    },
    pages: [{ ref: 'shop-vans', template: 'page-crud', title: { key: 'v', fallback: 'Vans' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'vans' }, module: 'vans' }],
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['app:@:staff', 'table:@vans:read'] }],
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      { table: 'vans', methods: ['GET'], select: ['id', 'plate'], module: 'vans' },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', instances: true, records: { vans: '/vans/{id}' } }],
  };
}

/** Mail queued so far: who it went to and its text. */
async function mail(meta: MetaDb) {
  const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { templateKey: string; envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; text: string; html?: string };
    return { template: payload.templateKey, to: envelope.to, body: `${envelope.text}${envelope.html ?? ''}` };
  });
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function twoCopies(dialect: Parameters<typeof installHarness>[0]) {
  const h = (open = await installHarness(dialect, { full: true }));
  const first = await h.install(shop(), { publicAccess: true });
  expect(first.statusCode, first.body).toBe(200);
  const other = await h.otherConnection('Kiln');
  const second = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: other.id, publicAccess: true } });
  expect(second.statusCode, second.body).toBe(200);
  const [fernhill, kiln] = await manifestsRepo(h.meta, PLAIN).listByKey('shop');
  expect(fernhill!.row).toMatchObject({ scopeKey: h.connectionId, instanceSlug: '' });
  expect(kiln!.row).toMatchObject({ scopeKey: other.id, instanceSlug: 'kiln' });
  return { h, other, fernhill: fernhill!.row, kiln: kiln!.row };
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`each copy of an app is its own [${dialect}]`, () => {
    it('switches a part off on one copy only', async () => {
      const { h, other, fernhill, kiln } = await twoCopies(dialect);
      const manifests = manifestsRepo(h.meta, PLAIN);
      const pages = pagesRepo(h.meta);
      const [fernhillPage] = await pages.listByManifest(fernhill.id);
      const [kilnPage] = await pages.listByManifest(kiln.id);
      expect(fernhillPage?.connectionId).toBe(h.connectionId);
      expect(kilnPage?.connectionId).toBe(other.id);
      const cards = [{ i: 'a' }, { i: 'b', module: 'vans' }];
      const key = (connectionId: string) => ({ managedBy: 'shop', connectionId, scope: { byRef: new Map<string, unknown>([['shop_vans', 1], ['shop_clients_claimed', 2]]) } });
      const rule = (install: { id: string; connectionId: string | null }) => ({ managedBy: 'shop', module: 'vans', installId: install.id, connectionId: install.connectionId });

      const flip = async (install: string, on: boolean) => {
        await manifests.setModuleSwitch(install, 'vans', on);
        forgetClosedDoors(h.meta);
      };
      const state = async () => ({
        fernhill: {
          byId: await appPartIsOn(h.meta, 'shop', 'vans', { installId: fernhill.id }),
          byDatabase: await appPartIsOn(h.meta, 'shop', 'vans', { installId: null, connectionId: h.connectionId }),
          pageOff: await pagePartOff(h.meta, fernhillPage!),
          cards: (await cardsOfPartsOn(h.meta, fernhillPage!, cards)).length,
          doors: [...(await withOpenDoors(h.meta, key(h.connectionId))).scope.byRef.keys()].length,
          ruleOff: await rulePartOff(h.meta, rule(fernhill)),
        },
        kiln: {
          byId: await appPartIsOn(h.meta, 'shop', 'vans', { installId: kiln.id }),
          byDatabase: await appPartIsOn(h.meta, 'shop', 'vans', { installId: null, connectionId: other.id }),
          pageOff: await pagePartOff(h.meta, kilnPage!),
          cards: (await cardsOfPartsOn(h.meta, kilnPage!, cards)).length,
          doors: [...(await withOpenDoors(h.meta, key(other.id))).scope.byRef.keys()].length,
          ruleOff: await rulePartOff(h.meta, rule(kiln)),
        },
        // The sidebar and search read every page's row: each by its own copy's switch.
        navOff: [...(await pagesOfPartsOff(h.meta, await pages.navRows()))].sort(),
      });
      const on = { byId: true, byDatabase: true, pageOff: false, cards: 2, doors: 2, ruleOff: false };
      const off = { byId: false, byDatabase: false, pageOff: true, cards: 1, doors: 1, ruleOff: true };

      expect(await state()).toEqual({ fernhill: on, kiln: on, navOff: [] });
      // Off on Kiln: Kiln's part stops, Fernhill's goes on.
      await flip(kiln.id, false);
      expect(await state()).toEqual({ fernhill: on, kiln: off, navOff: [kilnPage!.id] });
      // Off on Fernhill and on again on Kiln: Fernhill's switch never silences Kiln.
      await flip(kiln.id, true);
      await flip(fernhill.id, false);
      expect(await state()).toEqual({ fernhill: off, kiln: on, navOff: [fernhillPage!.id] });
      // An install that is not there borrows no copy's switch.
      expect(await appPartIsOn(h.meta, 'shop', 'vans', { installId: 'man_gone' })).toBe(true);
    });

    it('opens a record of a copy at its own address, for its own staff grant', async () => {
      const { h, other, fernhill, kiln } = await twoCopies(dialect);
      const roles = rolesRepo(h.meta);
      const fernhillStaff = await resolveForRoles(h.meta, await roles.listForInstall(fernhill.id));
      const kilnStaff = await resolveForRoles(h.meta, await roles.listForInstall(kiln.id));
      const record = (connectionId: string) => ({ connectionId, table: 'shop_vans', recordId: '7' });

      const kilnBook = await recordAddressBook(h.meta, other.id);
      expect(kilnBook.placeOf(record(other.id))).toMatchObject({ appKey: 'shop', address: 'shop~kiln', url: '/apps/shop/kiln/staff/vans/7' });
      // Kiln's record, by Kiln's grant only: Fernhill's staff opens nothing of Kiln's.
      expect(kilnBook.placeFor(kilnStaff, record(other.id))?.url).toBe('/apps/shop/kiln/staff/vans/7');
      expect(kilnBook.placeFor(fernhillStaff, record(other.id))).toBeNull();
      // Fernhill's record opens inside the dashboard, by Fernhill's grant.
      const fernhillBook = await recordAddressBook(h.meta, h.connectionId);
      expect(fernhillBook.placeFor(fernhillStaff, record(h.connectionId))?.url).toBe('/a/shop/vans/7');
      expect(fernhillBook.placeFor(kilnStaff, record(h.connectionId))).toBeNull();

      // Kiln's part off: Kiln's records open in the dashboard; Fernhill's still open in the app.
      await manifestsRepo(h.meta, PLAIN).setModuleSwitch(kiln.id, 'vans', false);
      expect((await recordAddressBook(h.meta, other.id)).placeOf(record(other.id))).toBeNull();
      expect((await recordAddressBook(h.meta, h.connectionId)).placeOf(record(h.connectionId))?.url).toBe('/a/shop/vans/7');
    });

    it('mails a sign-in link of a later copy to its own guest side', async () => {
      const { h, other } = await twoCopies(dialect);
      configureEmailRuntime({ secret: TEST_SECRET });
      await seedBuiltinEmailTemplates(h.meta);
      const settings = settingsRepo(h.meta);
      await settings.set('system.publicOrigin', ORIGIN);
      await settings.set('email.smtp', {
        host: 'localhost',
        port: 587,
        user: 'postmaster',
        passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
        from: 'Shop <no-reply@shop.test>',
        secure: false,
      } as never);
      expect(await guestBaseOn({ meta: h.meta }, 'shop', h.connectionId)).toBe(`${ORIGIN}/apps/shop/customer`);
      expect(await guestBaseOn({ meta: h.meta }, 'shop', other.id)).toBe(`${ORIGIN}/apps/shop/kiln/customer`);

      await h.run(`insert into shop_clients (contact_name, email) values ('Fern Hill', 'fern@example.com')`);
      await other.run(`insert into shop_clients (contact_name, email) values ('Kay Kiln', 'kay@example.com')`);
      const keyOn = async (connectionId: string) =>
        (await h.meta.db.selectFrom('adminium_public_keys').innerJoin('adminium_public_scopes', 'adminium_public_scopes.id', 'adminium_public_keys.scopeId').select('adminium_public_keys.id').where('adminium_public_keys.managedBy', '=', 'shop').where('adminium_public_keys.purpose', '=', 'customer').where('adminium_public_scopes.connectionId', '=', connectionId).executeTakeFirstOrThrow()).id;
      const crypto = dsnCryptoFromSecret(TEST_SECRET);
      const said: string[] = [];
      const logger = { warn: (obj: Record<string, unknown>, msg?: string) => said.push(`${msg ?? ''} ${JSON.stringify(obj)}`), info: (obj: Record<string, unknown>, msg?: string) => said.push(`${msg ?? ''} ${JSON.stringify(obj)}`) };
      const deps = { meta: h.meta, manager: h.manager, views: createPublicViews(h.meta), crypto, addressSecret: addressKey(TEST_SECRET), codeSecret: codeKey(TEST_SECRET), logger };
      await runSignInLinkJob(deps, startPayload(crypto, await keyOn(other.id), 'kay@example.com', 'en_US'));
      await runSignInLinkJob(deps, startPayload(crypto, await keyOn(h.connectionId), 'fern@example.com', 'en_US'));

      const sent = (await mail(h.meta)).filter((one) => one.template === 'sign-in-link');
      const kay = sent.find((one) => one.to === 'kay@example.com');
      const fern = sent.find((one) => one.to === 'fern@example.com');
      // Kiln's person opens Kiln's own business; Fernhill's, Fernhill's.
      expect(kay?.body, `${JSON.stringify(await mail(h.meta))} ${said.join(' | ')}`).toContain(`${ORIGIN}/apps/shop/kiln/customer/c#`);
      expect(fern?.body).toContain(`${ORIGIN}/apps/shop/customer/c#`);
      expect(fern?.body).not.toContain('/kiln/');

      // A host mapped to Kiln's guest side is where Kiln's links go.
      await settings.set('surfaces.domains', { 'kiln.example': { appKey: 'shop', side: 'customer', instance: 'kiln' } } as never);
      expect(await guestBaseOn({ meta: h.meta }, 'shop', other.id)).toBe('https://kiln.example');
      expect(await guestBaseOn({ meta: h.meta }, 'shop', h.connectionId)).toBe(`${ORIGIN}/apps/shop/customer`);
    });
  });
}
