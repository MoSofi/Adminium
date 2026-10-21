// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page's own API, for whoever holds a pay link.
 *
 * ─── WHAT IT ANSWERS ───────────────────────────────────────────────────────
 *
 *   GET  /pay/api/:token            the page: the shop, what is due, the ways to pay, or why not
 *   GET  /pay/api/:token/challenge  the human check for this link (solved when Pay is pressed)
 *   POST /pay/api/:token/checkout   start paying with one service: where to send the customer
 *   GET  /pay/api/back/:nonce       the customer came back: how it stands now, asked of the provider
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 *
 * - Every request asks first whether customers can reach the pay address;
 *   when they cannot, every link stops working.
 * - The amount is read again on every request: a link never carries one and
 *   a browser never sends one.
 * - A link that is unknown, revoked, replaced or expired answers the same.
 * - The page never shows the customer's name, address, email or past
 *   payments: links get forwarded. Partly paid says only how much of the
 *   total is already paid.
 * - A test link opens only for a signed-in person who may manage payments;
 *   every other request ignores any staff session.
 * - Starting a checkout costs a human check bound to the link, and is capped
 *   per link, per network address and per install, in meta (every process
 *   counts the same). A link whose payments keep failing locks for the hour.
 * - Nothing is ever cached, and no referrer leaves the page.
 */
import { paymentAttemptsRepo, paymentCountersRepo, paymentLinksRepo, paymentMethodsRepo, paymentSettingsRepo, publicProofsRepo, type MetaDb, type PaymentAttempt, type PaymentLink } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import type { CheckoutService } from '../../payments/checkout.js';
import { linkForToken, payAddress, payReachable } from '../../payments/links.js';
import { resolvePayable, type PayableSources, type ResolvedPayable } from '../../payments/payables.js';
import { waysFor, type WayOffer } from '../../payments/ways.js';
import { checkProof, issueChallenge, proofKey } from '../../public-api/proof.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from '../payments/ways.js';

export interface PayRoutesDeps {
  meta: MetaDb;
  sources: PayableSources;
  checkout: CheckoutService;
  /** The providers that can take a checkout now in a mode, by key. */
  readyProviders: (mode: 'test' | 'live') => Promise<string[]>;
  secret: string;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  now?: () => number;
}

/** Checkouts one link may start in an hour. */
export const LINK_CHECKOUTS_PER_HOUR = 20;
/** Checkouts one network address may start in an hour (carrier NAT puts many phones behind one). */
export const ADDRESS_CHECKOUTS_PER_HOUR = 60;
/** Checkouts one install may start in an hour, every link together. */
export const INSTALL_CHECKOUTS_PER_HOUR = 600;
/** Failed payments on one link in an hour before it locks. */
export const LINK_FAILURES_TO_LOCK = 5;

export const PAY_STATES = [
  'ready',
  'unknown',
  'unavailable',
  'test-staff-only',
  'paid',
  'processing',
  'checking',
  'failed',
  'cancelled',
  'nothing-due',
  'voided',
  'no-ways',
  'locked',
] as const;
export type PayState = (typeof PAY_STATES)[number];

const tokenParams = z.object({ token: z.string().min(1).max(64) });
const nonceParams = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
const checkoutBody = z.object({ source: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });

const shopView = z.object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), hasLogo: z.boolean() });
const pageReply = z.object({
  state: z.enum(PAY_STATES),
  test: z.boolean(),
  shop: shopView,
  payable: z.object({ label: z.string(), currency: z.string(), due: z.string(), total: z.string(), alreadyPaid: z.string().nullable() }).nullable(),
  ways: z.array(z.object({ source: z.string(), method: z.string(), label: z.record(z.string(), z.string()).nullable(), details: z.unknown() })),
  /** For `processing`: how the payment was made and when it started. */
  processing: z.object({ method: z.string().nullable(), startedAt: z.number() }).nullable(),
});
type PageReply = z.infer<typeof pageReply>;
const challengeReply = z.object({ id: z.string(), salt: z.string(), difficulty: z.number(), expiresAt: z.number() });
const checkoutReply = z.union([z.object({ url: z.string() }), z.object({ state: z.enum(PAY_STATES), message: z.string().nullable() })]);

/** A checkout answer that is a state, not a redirect. */
function say(state: PayState, message: string | null = null): { state: PayState; message: string | null } {
  return { state, message };
}

function noStore(reply: FastifyReply): void {
  void reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
}

function paidSoFar(payable: ResolvedPayable): string | null {
  // Partly paid: the total less what is due, shown as one sentence and never as a list.
  const total = Number(payable.total);
  const due = Number(payable.due);
  if (!Number.isFinite(total) || !Number.isFinite(due) || due >= total || due <= 0) return null;
  const decimals = (payable.due.split('.')[1] ?? '').length;
  return (total - due).toFixed(decimals);
}

export function payRoutes(deps: PayRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? (() => Date.now());
  const counters = paymentCountersRepo(meta);
  const attempts = paymentAttemptsRepo(meta);
  const proofs = publicProofsRepo(meta);
  const key = proofKey(deps.secret);

  async function shop() {
    const page = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
    return { name: page?.shopName ?? 'Adminium', email: page?.contactEmail ?? null, phone: page?.contactPhone ?? null, hasLogo: (page?.logoFileId ?? null) !== null, country: page?.shopCountry ?? null };
  }

  async function reachable(): Promise<boolean> {
    return (await payReachable(meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded: false })).state === 'reachable';
  }

  /** A test link opens only for someone signed in who may manage payments. */
  async function mayOpen(request: FastifyRequest, link: PaymentLink): Promise<boolean> {
    if (link.mode === 'live') return true;
    try {
      return request.apiKeyPrincipal == null && (await request.can(PERMISSIONS.paymentsManage));
    } catch {
      return false;
    }
  }

  async function waysOf(payable: ResolvedPayable, country: string | null, mode: 'test' | 'live'): Promise<WayOffer[]> {
    return waysFor({
      methods: await paymentMethodsRepo(meta).list(),
      payable: { kind: payable.ref.kind, profileId: payable.ref.kind === 'profile' ? await profileIdOf(payable) : null, currency: payable.currency, due: payable.due, customerCountry: payable.customerCountry },
      shopCountry: country,
      providers: await deps.readyProviders(mode),
    });
  }

  async function profileIdOf(payable: ResolvedPayable): Promise<string | null> {
    if (payable.ref.connectionId === null || payable.ref.tableName === null) return null;
    return (await deps.sources.profile(payable.ref.connectionId, payable.ref.tableName))?.id ?? null;
  }

  function stateOfAttempt(attempt: PaymentAttempt): PayState | null {
    switch (attempt.state) {
      case 'processing':
        return 'processing';
      case 'succeeded':
      case 'recording':
      case 'recorded':
        return 'paid';
      // Taken but not recordable: a person decides; the customer is told the shop will check.
      case 'record_refused':
        return 'paid';
      default:
        return null;
    }
  }

  /** The page for a link, from scratch, every time. */
  async function page(request: FastifyRequest, token: string): Promise<PageReply> {
    const shopInfo = await shop();
    const { country, ...shopView } = shopInfo;
    const base: PageReply = { state: 'unknown', test: false, shop: shopView, payable: null, ways: [], processing: null };
    if (!(await reachable())) return { ...base, state: 'unavailable' };
    const link = await linkForToken(meta, token, now());
    if (link === null) return base;
    if (!(await mayOpen(request, link))) return { ...base, state: 'test-staff-only', test: true };
    const payable = await resolvePayable(deps.sources, link.payable);
    if (payable === null) return base;
    const shown = { label: payable.label, currency: payable.currency, due: payable.due, total: payable.total, alreadyPaid: paidSoFar(payable) };
    const open = await attempts.openFor(payable.ref);
    const held = open === null ? null : stateOfAttempt(open);
    if (held === 'processing') return { ...base, state: 'processing', test: link.mode === 'test', payable: shown, processing: { method: (open?.paidWith as { label?: string } | null)?.label ?? null, startedAt: open!.createdAt } };
    if (held === 'paid') return { ...base, state: 'paid', test: link.mode === 'test', payable: shown };
    if (payable.refusal !== null) {
      const state: PayState = payable.refusal.code === 'VOIDED' ? 'voided' : payable.refusal.code === 'NOTHING_DUE' ? 'paid' : payable.refusal.code === 'NOT_SENT' ? 'nothing-due' : 'unavailable';
      return { ...base, state, test: link.mode === 'test', payable: shown };
    }
    const ways = await waysOf(payable, country, link.mode);
    if (ways.length === 0) return { ...base, state: 'no-ways', test: link.mode === 'test', payable: shown };
    const locked = (await counters.read(`link-fail:${link.id}`, now())) >= LINK_FAILURES_TO_LOCK;
    // A locked link still shows the ways to pay by hand.
    if (locked) return { ...base, state: 'locked', test: link.mode === 'test', payable: shown, ways: ways.filter((way) => way.source === 'manual') };
    return { ...base, state: 'ready', test: link.mode === 'test', payable: shown, ways };
  }

  return async (app) => {
    app.get(
      '/pay/api/:token',
      { config: { rateLimitBucket: 'pay-page' }, schema: { params: tokenParams, response: { 200: pageReply } } },
      async (request, reply) => {
        noStore(reply);
        return page(request, request.params.token);
      },
    );

    app.get(
      '/pay/api/:token/challenge',
      { config: { rateLimitBucket: 'pay-page' }, schema: { params: tokenParams, response: { 200: challengeReply } } },
      async (request, reply) => {
        noStore(reply);
        const link = await linkForToken(meta, request.params.token, now());
        // An unknown link still gets a challenge: the answer must not tell which tokens exist.
        return issueChallenge(key, link?.id ?? 'none', 'pay', now());
      },
    );

    app.post(
      '/pay/api/:token/checkout',
      {
        config: {
          rateLimitBucket: 'pay-checkout',
          // A live link's page posts with no cookie; a test link's carries the
          // staff session, and the Origin check still keeps other sites out.
          csrf: 'origin',
          audit: auditExempt('the attempt row it makes is the record; a customer is not an actor the audit log names'),
        },
        schema: { params: tokenParams, body: checkoutBody, response: { 200: checkoutReply, 403: checkoutReply } },
      },
      async (request, reply) => {
        noStore(reply);
        const answer = await page(request, request.params.token);
        if (answer.state !== 'ready') return say(answer.state);
        const link = (await linkForToken(meta, request.params.token, now()))!;

        const proved = checkProof(key, request.headers['x-adminium-proof'], { keyId: link.id, purpose: 'pay', now: now() });
        if (!proved.ok || !(await proofs.spend({ id: proved.spendId, keyId: link.id, purpose: 'pay', expiresAt: proved.expiresAt }))) {
          return reply.status(403).send(say('ready', 'The check that you are a person did not pass. Try again.'));
        }
        const caps: [string, number][] = [
          [`link:${link.id}`, LINK_CHECKOUTS_PER_HOUR],
          [`address:${request.ip}`, ADDRESS_CHECKOUTS_PER_HOUR],
          ['install', INSTALL_CHECKOUTS_PER_HOUR],
        ];
        for (const [bucket, max] of caps) {
          if ((await counters.hit(`checkout-${bucket}`, now())) > max) return say('locked');
        }

        const way = answer.ways.find((one) => one.source === request.body.source && one.source !== 'manual');
        if (way === undefined) return say('no-ways');
        const payable = (await resolvePayable(deps.sources, link.payable))!;
        const address = await payAddress(meta);
        const started = await deps.checkout.start({
          link,
          payable,
          provider: request.body.source,
          methods: answer.ways.filter((one) => one.source === request.body.source).map((one) => one.method),
          payAddress: address!,
          locale: null,
        });
        if (started.kind === 'redirect') return { url: started.url };
        if (started.kind === 'in-progress') return say('processing');
        if (started.kind === 'busy') return say('checking');
        return say('failed', started.message);
      },
    );

    app.get(
      '/pay/api/back/:nonce',
      { config: { rateLimitBucket: 'pay-page' }, schema: { params: nonceParams, response: { 200: pageReply } } },
      async (request, reply): Promise<PageReply> => {
        noStore(reply);
        const { name, email, phone, hasLogo } = await shop();
        const base: PageReply = { state: 'unknown', test: false, shop: { name, email, phone, hasLogo }, payable: null, ways: [], processing: null };
        if (!(await reachable())) return { ...base, state: 'unavailable' };
        const found = await attempts.byNonce(request.params.nonce);
        if (found === null) return base;
        const link = found.linkId === null ? null : await paymentLinksRepo(meta).byId(found.linkId);
        if (link === null || !(await mayOpen(request, link))) return base;
        // Asked of the provider, once; never decided by the redirect.
        const attempt = (await deps.checkout.settle(found.id)) ?? found;
        const payable = await resolvePayable(deps.sources, attempt.payable);
        const shown = payable === null ? null : { label: payable.label, currency: payable.currency, due: payable.due, total: payable.total, alreadyPaid: paidSoFar(payable) };
        const test = attempt.mode === 'test';
        if (attempt.state === 'failed') {
          await counters.hit(`link-fail:${link.id}`, now());
          return { ...base, state: 'failed', test, payable: shown };
        }
        if (attempt.state === 'cancelled' || attempt.state === 'expired' || attempt.state === 'abandoned') return { ...base, state: 'cancelled', test, payable: shown };
        const held = stateOfAttempt(attempt);
        if (held === 'processing') return { ...base, state: 'processing', test, payable: shown, processing: { method: (attempt.paidWith as { label?: string } | null)?.label ?? null, startedAt: attempt.createdAt } };
        if (held === 'paid') return { ...base, state: 'paid', test, payable: shown };
        // Still open at the provider: the page asks again in a moment.
        return { ...base, state: 'checking', test, payable: shown };
      },
    );
  };
}

export type { PageReply as PayPageReply };
