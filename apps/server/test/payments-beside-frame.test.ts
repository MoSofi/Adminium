// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PAYMENT STARTED FROM A FRAME ON THE OWNER'S WEBSITE, on every meta store.
 * Its tab was opened beside the frame, so it ends with "you can close this
 * tab" and no way back. The mark lives on the link, never in an address; a
 * framed link is still a public start's link for every limit that counts it.
 */
import { createDemoPaymentBackend, type DemoPaymentBackend } from '@adminium/add-on-contracts';
import { NO_RULES, connectionsRepo, keptPaymentsRepo, paymentAttemptsRepo, paymentLinksRepo, paymentMethodsRepo, paymentSettingsRepo, appTablesRepo, type MetaDb, type PayableRef } from '@adminium/meta';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { errorEnvelope } from '../src/errors.js';
import { createCheckoutService, type CheckoutService } from '../src/payments/checkout.js';
import { PAY_ADDRESS_DOC, linkSealFromSecret, mintLink, payAddressSchema } from '../src/payments/links.js';
import type { PayableSources } from '../src/payments/payables.js';
import { paymentProviderFor } from '../src/payments/providers.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { embeddableApps, CHOICES_MAX } from '../src/privacy/embeds.js';
import { solveProof } from '../src/public-api/proof.js';
import { payRoutes } from '../src/routes/pay/index.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const PAY = 'https://pay.lumenstudio.example';
const T0 = Date.UTC(2026, 10, 21, 10, 5);
const order: PayableRef = { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_7' };

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`a payment from a frame [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let app: FastifyInstance;
    let backend: DemoPaymentBackend;
    let checkout: CheckoutService;
    const seal = linkSealFromSecret(TEST_SECRET);
    const sources: PayableSources = {
      table: async () => null,
      readRow: async () => null,
      shapeOf: async () => null,
      connectionCurrency: async () => null,
      profile: async () => null,
      keptPaid: (ref, currency) => keptPaymentsRepo(meta).paid(ref, currency, 'live'),
      document: async (id) => (id.startsWith('doc_') ? { status: 'sent', number: id.toUpperCase(), currency: 'EUR', totalMinor: 1000, due: null } : null),
    };

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: PAY });
      await paymentMethodsRepo(meta).put({ source: 'demo', method: 'card', label: null, enabled: true, rules: NO_RULES, details: null, position: 0 });
      backend = createDemoPaymentBackend({ pageUrl: (one) => `${new URL(one.successUrl ?? PAY).origin}/pay/demo/${one.attemptId}` });
      const providerFor = (key: string) =>
        paymentProviderFor({ runtime: () => null, manifests: { findInScope: async () => null, listByKey: async () => [], getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, 'test');
      checkout = createCheckoutService({ meta, sources, providerFor, enqueue: async () => undefined, now: () => T0 });
      app = Fastify({ logger: false });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.setErrorHandler((error: { statusCode?: number; code?: string; message: string }, request, reply) => {
        void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id));
      });
      await app.register(rbacPlugin, { meta });
      await app.register(payRoutes({ meta, sources, checkout, readyProviders: async () => ['demo'], secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, now: () => T0 }));
      await app.ready();
    }, 60_000);

    afterEach(async () => {
      await app.close();
      await handle.destroy();
    });

    it('keeps the mark on the link, read as a public link, and the last start decides it', async () => {
      const repo = paymentLinksRepo(meta);
      const made = await mintLink(meta, seal, { payable: order, mode: 'live', createdBy: null, audience: 'public', beside: true }, T0);
      expect(made.link).toMatchObject({ audience: 'public', beside: true });
      const held = await repo.currentFor(order, 'public');
      expect(held).toMatchObject({ id: made.link.id, audience: 'public', beside: true });
      await repo.setBeside(made.link.id, false);
      const after = await repo.byId(made.link.id);
      expect(after?.audience).toBe('public');
      expect(after?.beside).toBeUndefined();
      await repo.setBeside(made.link.id, true);
      expect((await repo.byId(made.link.id))?.beside).toBe(true);
    });

    it('never marks a link the shop sent', async () => {
      const repo = paymentLinksRepo(meta);
      const made = await mintLink(meta, seal, { payable: order, mode: 'live', createdBy: null }, T0);
      await repo.setBeside(made.link.id, true);
      const after = await repo.byId(made.link.id);
      expect(after?.audience).toBe('staff');
      expect(after?.beside).toBeUndefined();
    });

    it('a new public link takes the place of a framed one, the same way', async () => {
      const first = await mintLink(meta, seal, { payable: order, mode: 'live', createdBy: null, audience: 'public', beside: true }, T0);
      const second = await mintLink(meta, seal, { payable: order, mode: 'live', createdBy: null, audience: 'public' }, T0 + 1);
      expect(second.replaced).toBe(true);
      expect((await paymentLinksRepo(meta).byId(first.link.id))?.current).toBe(false);
    });

    it('the page says so, with no way back, from the link and on the way back', async () => {
      const { token } = await mintLink(meta, seal, { payable: order, mode: 'live', createdBy: null, audience: 'public', beside: true }, T0);
      const page = (await app.inject({ method: 'GET', url: `/pay/api/${token}` })).json();
      expect(page.state).toBe('ready');
      expect(page.beside).toBe(true);
      expect(page.back).toBeNull();

      const challenge = (await app.inject({ method: 'GET', url: `/pay/api/${token}/challenge` })).json();
      const started = await app.inject({
        method: 'POST',
        url: `/pay/api/${token}/checkout`,
        headers: { 'x-adminium-proof': `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}` },
        payload: { source: 'demo' },
      });
      expect(started.statusCode, started.payload).toBe(200);
      // Nothing of it in the address the service is given.
      expect(started.json().url).not.toContain('beside');
      const [attempt] = await paymentAttemptsRepo(meta).forPayable(order, 1);
      // The demo answers test mode only, so this live link's way back stays "checking": the mark is what is read here.
      const back = (await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}` })).json();
      expect(back.state).toBe('checking');
      expect(back.beside).toBe(true);
      expect(back.back ?? null).toBeNull();
    });

    it('a link not started from a frame says nothing of it', async () => {
      const { token } = await mintLink(meta, seal, { payable: order, mode: 'live', createdBy: null, audience: 'public' }, T0);
      const page = (await app.inject({ method: 'GET', url: `/pay/api/${token}` })).json();
      expect(page.beside).toBeUndefined();
    });
  });

  describe.skipIf(!engine.available)(`what the snippet maker may offer [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let conn: string;
    const deps = () => ({ meta, manager: { data: async () => ({ db: meta.db, dialect: engine.name }) } as never });

    async function installed(id: string, slug: string, frontends: unknown[], status = 'installed', connectionId: string | null = conn): Promise<void> {
      await meta.db
        .insertInto('adminium_manifests')
        .values({
          id,
          manifestKey: 'bookings',
          version: '1.0.0',
          source: 'file',
          manifest: JSON.stringify({ key: 'bookings', name: { 'en-US': 'Bookings' }, frontends }),
          licenseKeyEncrypted: null,
          connectionId,
          status,
          kind: 'app',
          scopeKey: `${id}-scope`,
          instanceSlug: slug,
          packageIntegrity: null,
          packageFileId: null,
          installedBy: null,
          installedAt: 0,
          updatedAt: 0,
        } as never)
        .execute();
    }

    const CHOOSE = { query: 'service', table: 'services', value: 'slug', label: 'name', title: 'A particular service', any: 'Any service' };
    const customer = (embed: unknown) => [{ side: 'customer', kind: 'spa', embed }];

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      conn = (await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'Lumen', engine: 'sqlite', introspectDsn: 'sqlite::memory:' })).id;
      await meta.db.schema.createTable('zz_lumen_services').addColumn('slug', 'varchar(100)').addColumn('name', 'varchar(100)').execute();
      await meta.db.insertInto('zz_lumen_services' as never).values([{ slug: 'gel', name: 'Gel Manicure' }, { slug: 'cut', name: 'Cut & Style' }, { slug: 'bad value', name: 'Left out' }] as never).execute();
      await appTablesRepo(meta).record({ appKey: 'bookings', manifestId: null, connectionId: conn, ref: 'services', tableName: 'zz_lumen_services', owned: true, state: 'created' });
    }, 60_000);

    afterEach(async () => {
      await meta.db.schema.dropTable('zz_lumen_services').ifExists().execute();
      await handle.destroy();
    });

    it('lists each screen and its choices, by their words, leaving out a value no snippet can carry', async () => {
      await installed('mft_a', '', customer({ paths: ['/', { path: '/book', label: 'Book a service', choose: CHOOSE }], modes: ['inline', 'floating'] }));
      expect(await embeddableApps(deps())).toEqual([
        {
          app: 'bookings',
          name: { 'en-US': 'Bookings' },
          mount: '/apps/bookings/customer',
          modes: ['inline', 'floating'],
          screens: [
            { path: '/', label: null, choose: null },
            {
              path: '/book',
              label: 'Book a service',
              choose: { query: 'service', title: 'A particular service', any: 'Any service', values: [{ value: 'cut', label: 'Cut & Style' }, { value: 'gel', label: 'Gel Manicure' }] },
            },
          ],
        },
      ]);
    });

    it('names a later copy by its own address', async () => {
      await installed('mft_b', 'north', customer({ paths: ['/book'] }));
      const [one] = await embeddableApps(deps());
      expect(one).toMatchObject({ app: 'bookings~north', mount: '/apps/bookings/north/customer', modes: ['inline', 'button', 'floating'] });
    });

    it('leaves out an app that declares nothing, a switched-off one, and a stored document it cannot read', async () => {
      await installed('mft_c', '', [{ side: 'customer', kind: 'spa' }]);
      await installed('mft_d', 'off', customer({ paths: ['/'] }), 'disabled');
      await installed('mft_e', 'broken', customer({ paths: ['/'] }));
      await meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify({ frontends: 'nope' }) } as never).where('id', '=', 'mft_e').execute();
      expect(await embeddableApps(deps())).toEqual([]);
    });

    it('still offers the screen when its table cannot be read', async () => {
      await installed('mft_f', '', customer({ paths: [{ path: '/book', choose: { ...CHOOSE, table: 'gone' } }] }));
      expect((await embeddableApps(deps()))[0]!.screens[0]!.choose).toBeNull();
      await meta.db.schema.dropTable('zz_lumen_services').execute();
      await meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify({ key: 'bookings', frontends: customer({ paths: [{ path: '/book', choose: CHOOSE }] }) }) } as never).where('id', '=', 'mft_f').execute();
      const [one] = await embeddableApps(deps());
      expect(one!.screens[0]!.choose).toBeNull();
      expect(one!.name).toBe('bookings');
      await meta.db.schema.createTable('zz_lumen_services').addColumn('slug', 'varchar(100)').addColumn('name', 'varchar(100)').execute();
    });

    it('reads a number as a value, and a bounded number of rows', async () => {
      expect(CHOICES_MAX).toBe(200);
      await meta.db.schema.dropTable('zz_lumen_services').execute();
      await meta.db.schema.createTable('zz_lumen_services').addColumn('slug', 'integer').addColumn('name', 'varchar(100)').execute();
      await meta.db.insertInto('zz_lumen_services' as never).values([{ slug: 12, name: 'Twelve' }, { slug: 3, name: null }] as never).execute();
      await installed('mft_g', '', customer({ paths: [{ path: '/book', choose: CHOOSE }] }));
      expect((await embeddableApps(deps()))[0]!.screens[0]!.choose?.values).toEqual([{ value: '12', label: 'Twelve' }]);
    });

    it('offers no choice for an install on no database', async () => {
      await installed('mft_h', '', customer({ paths: [{ path: '/book', choose: CHOOSE }] }), 'installed', null);
      expect((await embeddableApps(deps()))[0]!.screens[0]!.choose).toBeNull();
    });
  });
}
