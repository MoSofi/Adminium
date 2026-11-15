// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SCRIPTED CARD TESTER against the public starts (E3), through the pay
 * page's own routes, against the demo payment service, on every meta store.
 *
 * A tester makes orders through an app's checkout, so each has a public
 * start's own link; it tries a declining card on each. It gets at most the
 * breaker's number of declines from one address; spread over many addresses,
 * every public start pauses and the payment managers are told once; all the
 * while the link the shop sent for the SAME record still takes a payment.
 * The address is kept only as a keyed hash, and forgotten after its window.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { createDemoPaymentBackend, type DemoPaymentBackend } from '@adminium/add-on-contracts';
import {
  NO_RULES,
  keptPaymentsRepo,
  paymentAttemptsRepo,
  paymentMethodsRepo,
  paymentSettingsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type PayableRef,
} from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { ADDRESS_DECLINES_TO_BLOCK, ADDRESS_STARTS_PER_HOUR, DECLINING_ADDRESSES_TO_PAUSE, START_ADDRESS_KEEP_MS, addressPrefix, createCardTesting, startAddressOf, type CardTesting } from '../src/payments/card-testing.js';
import { createCheckoutService, type CheckoutService } from '../src/payments/checkout.js';
import { PAY_ADDRESS_DOC, linkSealFromSecret, mintLink, payAddressSchema } from '../src/payments/links.js';
import { toldAlready } from '../src/payments/notices.js';
import type { PayableSources } from '../src/payments/payables.js';
import { paymentProviderFor } from '../src/payments/providers.js';
import { runPaymentWatch } from '../src/payments/watch.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { solveProof } from '../src/public-api/proof.js';
import { payRoutes } from '../src/routes/pay/index.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const PAY = 'https://pay.crumbandco.de';
const T0 = Date.UTC(2026, 10, 15, 10, 5);
const order = (n: number): PayableRef => ({ kind: 'document', connectionId: null, tableName: null, rowKey: `doc_${String(n)}` });

describe('address keys', () => {
  it('names one subscriber: an IPv4 address whole, an IPv6 address by its /64', () => {
    expect(addressPrefix('203.0.113.9')).toBe('203.0.113.9');
    expect(addressPrefix('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(addressPrefix('2001:db8:1:2:aaaa::1')).toBe(addressPrefix('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(addressPrefix('2001:db8:1:2::1')).not.toBe(addressPrefix('2001:db8:1:3::1'));
    expect(addressPrefix('not an address')).toBeNull();
    // A keyed hash: the same address always the same, never the address, and another secret another hash.
    const hash = startAddressOf(TEST_SECRET, '203.0.113.9')!;
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain('203');
    expect(startAddressOf(TEST_SECRET, '203.0.113.9')).toBe(hash);
    expect(startAddressOf(`${TEST_SECRET}x`, '203.0.113.9')).not.toBe(hash);
    expect(startAddressOf(TEST_SECRET, undefined)).toBeNull();
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`a scripted card tester [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let app: FastifyInstance;
    let backend: DemoPaymentBackend;
    let checkout: CheckoutService;
    let cardTesting: CardTesting;
    let at = T0;
    const now = () => at;
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
      at = T0;
      handle = await engine.make();
      meta = handle.meta;
      await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: PAY });
      await paymentMethodsRepo(meta).put({ source: 'demo', method: 'card', label: null, enabled: true, rules: NO_RULES, details: null, position: 0 });
      // One payment manager, to be told.
      const owner = await usersRepo(meta).create({ email: 'mara@crumbandco.de', name: 'Mara', status: 'active' });
      await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
      backend = createDemoPaymentBackend({ pageUrl: (one) => `${new URL(one.successUrl ?? PAY).origin}/pay/demo/${one.attemptId}` });
      cardTesting = createCardTesting({ meta, secret: TEST_SECRET, now });
      // The demo takes pretend money in test mode only; the tester here pays through live links, so the demo stands in for a live service.
      const providerFor = (key: string) =>
        paymentProviderFor({ runtime: () => null, manifests: { findInScope: async () => null, listByKey: async () => [], getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, 'test');
      checkout = createCheckoutService({ meta, sources, providerFor, enqueue: async () => undefined, now, onPublicDecline: (attempt, count) => cardTesting.noteDecline(attempt, count) });
      app = Fastify({ logger: false });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.setErrorHandler((error: { statusCode?: number; code?: string; message: string }, request, reply) => {
        void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id));
      });
      await app.register(rbacPlugin, { meta });
      await app.register(payRoutes({ meta, sources, checkout, readyProviders: async () => ['demo'], secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, cardTesting, now }));
      await app.ready();
    }, 60_000);

    afterEach(async () => {
      await app.close();
      await handle.destroy();
    });

    /** A link for an order: a public start's own, or the one the shop sent. */
    async function linkFor(n: number, audience: 'public' | 'staff'): Promise<string> {
      return (await mintLink(meta, seal, { payable: order(n), mode: 'live', createdBy: null, ...(audience === 'public' ? { audience } : {}) }, at)).token;
    }

    /** One try at a checkout from an address: the page's answer (`url` when it starts). */
    async function tryCheckout(token: string, ip: string): Promise<{ url?: string; state?: string }> {
      const challenge = (await app.inject({ method: 'GET', url: `/pay/api/${token}/challenge`, remoteAddress: ip })).json();
      const started = await app.inject({
        method: 'POST',
        url: `/pay/api/${token}/checkout`,
        remoteAddress: ip,
        headers: { 'x-adminium-proof': `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}` },
        payload: { source: 'demo' },
      });
      expect(started.statusCode, started.payload).toBe(200);
      return started.json();
    }

    /** The card is declined, and the page reads it back from the service. */
    async function decline(n: number): Promise<void> {
      const [attempt] = await paymentAttemptsRepo(meta).forPayable(order(n), 1);
      await backend.pay(backend.checkoutForAttempt(attempt!.id)!.id, 'fails');
      await checkout.settle(attempt!.id);
    }

    it('lets one address decline at most the breaker\'s number of cards, then gives it no new checkout', async () => {
      let declined = 0;
      for (let n = 1; n <= ADDRESS_DECLINES_TO_BLOCK + 3; n += 1) {
        const token = await linkFor(n, 'public');
        const tried = await tryCheckout(token, '203.0.113.9');
        if (tried.url === undefined) {
          expect(tried.state).toBe('locked');
          continue;
        }
        await decline(n);
        declined += 1;
      }
      expect(declined).toBe(ADDRESS_DECLINES_TO_BLOCK);
      // The same /64 of an IPv6 subscriber is one address; another address still starts.
      expect((await tryCheckout(await linkFor(50, 'public'), '198.51.100.7')).url).toMatch(/\/pay\/demo\//);
      // The attempt kept a keyed hash, never the address; the watch forgets it after the window.
      const [kept] = await paymentAttemptsRepo(meta).forPayable(order(1), 1);
      expect(kept!.startAddress).toBe(startAddressOf(TEST_SECRET, '203.0.113.9'));
      at = T0 + START_ADDRESS_KEEP_MS + 60_000;
      await runPaymentWatch({ meta, sources, serviceKeys: async () => [], now });
      expect((await paymentAttemptsRepo(meta).byId(kept!.id))!.startAddress).toBeNull();
    });

    it('pauses every public start when cards decline from many addresses, tells the managers once, and the shop\'s own link still takes a payment', async () => {
      for (let n = 1; n <= DECLINING_ADDRESSES_TO_PAUSE; n += 1) {
        expect((await tryCheckout(await linkFor(n, 'public'), `192.0.2.${String(n)}`)).url, `address ${String(n)}`).toBeDefined();
        await decline(n);
      }
      expect(await cardTesting.pausedUntil()).toBe(T0 + 60 * 60_000);
      // A public link from a fresh address now reads locked; the page says so before a checkout too.
      const fresh = await linkFor(100, 'public');
      expect((await app.inject({ method: 'GET', url: `/pay/api/${fresh}`, remoteAddress: '198.51.100.20' })).json()).toMatchObject({ state: 'locked' });
      expect(await tryCheckout(fresh, '198.51.100.20')).toMatchObject({ state: 'locked' });
      // The shop's own link for the SAME record still starts a payment.
      const shop = await linkFor(100, 'staff');
      expect((await tryCheckout(shop, '198.51.100.20')).url).toMatch(/\/pay\/demo\//);
      // Told once, whichever decline tripped it.
      expect(await toldAlready(meta, [`card-testing:${String(Math.floor(T0 / (60 * 60_000)))}`])).toEqual(new Set([`card-testing:${String(Math.floor(T0 / (60 * 60_000)))}`]));
      // A person resumes: the addresses counted so far do not pause it again.
      expect(await cardTesting.resume()).toBe(true);
      expect(await cardTesting.pausedUntil()).toBeNull();
      expect((await tryCheckout(await linkFor(101, 'public'), '198.51.100.30')).url).toBeDefined();
      await decline(101);
      expect(await cardTesting.pausedUntil()).toBeNull();
      // Counted afresh since the resume (the address above is the first): the rest trip it again, and it lapses on its own after the hour.
      for (let n = 200; n < 200 + DECLINING_ADDRESSES_TO_PAUSE - 1; n += 1) {
        expect((await tryCheckout(await linkFor(n, 'public'), `100.64.0.${String(n - 199)}`)).url).toBeDefined();
        await decline(n);
      }
      expect(await cardTesting.pausedUntil()).not.toBeNull();
      at += 60 * 60_000 + 1;
      expect(await cardTesting.pausedUntil()).toBeNull();
    });

    it('counts the payments started from apps\' screens by address and for the install, and holds an address that declined too often', async () => {
      const here = startAddressOf(TEST_SECRET, '203.0.113.77')!;
      for (let n = 0; n < ADDRESS_STARTS_PER_HOUR; n += 1) expect(await cardTesting.countStart(here)).toBe(true);
      expect(await cardTesting.countStart(here)).toBe(false);
      expect(await cardTesting.countStart(startAddressOf(TEST_SECRET, '203.0.113.78'))).toBe(true);
      // An address whose cards declined too often starts nothing.
      for (let n = 1; n <= ADDRESS_DECLINES_TO_BLOCK; n += 1) {
        expect((await tryCheckout(await linkFor(n, 'public'), '203.0.113.79')).url).toBeDefined();
        await decline(n);
      }
      expect(await cardTesting.countStart(startAddressOf(TEST_SECRET, '203.0.113.79'))).toBe(false);
    });

    it('never holds a checkout of the shop\'s own links, however many cards decline there', async () => {
      for (let n = 1; n <= ADDRESS_DECLINES_TO_BLOCK + 2; n += 1) {
        expect((await tryCheckout(await linkFor(n, 'staff'), '203.0.113.50')).url).toBeDefined();
        await decline(n);
      }
      const [attempt] = await paymentAttemptsRepo(meta).forPayable(order(1), 1);
      expect(attempt!.startAddress).toBeNull();
      expect(await cardTesting.addressBlocked(startAddressOf(TEST_SECRET, '203.0.113.50')!)).toBe(false);
    });
  });
}
