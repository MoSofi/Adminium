// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketing mail settings: what each sender needs before marketing mail
 * may go from it, and where the mail services report bounces and spam.
 *
 *   GET  /email/marketing                          the senders, each with Adminium's DKIM key for it, the postal address and the reply address
 *   POST /email/marketing/check                    "Check again": ask DNS about one sender (DMARC, the key published) and say what a send from it meets
 *   POST /email/marketing/dkim-keys                "Make a key": a DKIM key for a sender's domain; the reply is its DNS record
 *   PUT  /email/marketing/reply-to                 "Replies to marketing mail go to"
 *   GET  /email/notice-endpoints                   the bounce card: each service's notice address and what is set
 *   POST /email/notice-endpoints/:service          make the service's notice address (and, for Postmark and Brevo, the credentials to copy into it)
 *   POST /email/notice-endpoints/:service/credentials   new credentials (the old ones stop working)
 *   POST /email/notice-endpoints/:service/address  a new notice address (the old one stops working; credentials and keys stay)
 *   PUT  /email/notice-endpoints/:service/secret   save Mailgun's signing key, SendGrid's verification key, or the Amazon SNS topic
 *
 * The postal address has its own route (`PUT /privacy/postal-address`), which
 * the same screen saves through.
 *
 * ─── Who may ───────────────────────────────────────────────────────────────
 * Everything rides the e-mail screens' grant, `settings.manage`. What makes or
 * takes a key or a credential is a signed-in person's, never an API key's.
 *
 * ─── What is never sent back, logged or audited ────────────────────────────
 * A DKIM private key: only its DNS record (the public half) leaves the
 * server. A pasted signing key (Mailgun) or verification key (SendGrid): the
 * card says when it was set, never what. The credentials Adminium makes for
 * Postmark and Brevo are in the reply that makes them, once, for the owner to
 * copy into the service; no read gives them again. The audit entries name the
 * service, the domain and the selector, never a key. Secrets travel in a body
 * field named `secret`, which the request log redacts by name.
 *
 * ─── DNS ────────────────────────────────────────────────────────────────────
 * The read of the senders asks no DNS, so the screen is never held up by it;
 * each sender's "Check again" asks, with a lookup of its own (no cache across
 * requests), only about the domain of a sender this install has.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { audited, auditExempt } from '../../audit/coverage.js';
import { bareAddress } from '../../email/document.js';
import { mailDoorReach, storedPublicOrigin } from '../../email/door-reach.js';
import { domainsUp, signingKeyFor } from '../../email/marketing.js';
import { NoticeEndpointError, createNoticeEndpoints, type NoticeEndpointStatus } from '../../email/notices/endpoints.js';
import { NOTICE_SECRET_ROW, noticeAddress } from '../../email/notices/index.js';
import { NOTICE_SERVICES, type NoticeService } from '../../email/notices/types.js';
import {
  DkimKeyError,
  createDkimKeys,
  createTxtLookup,
  domainOfAddress,
  isFreeMail,
  marketingRefusals,
  relayOf,
  senderFacts,
  type DkimKeyView,
  type DkimKeys,
  type TxtLookup,
} from '../../email/sender/index.js';
import { businessNameOf, postalAddressOf } from '../../email/sender/marketing-settings.js';
import { replyToOf } from '../../email/send.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  endpointMadeReply,
  endpointReply,
  endpointSecretBody,
  endpointsReply,
  makeKeyBody,
  makeKeyReply,
  marketingReply,
  noticeServiceParams,
  replyToBody,
  replyToReply,
  senderCheckBody,
  senderCheckReply,
  type DkimKeyReply,
  type EndpointView,
} from './schema.js';

export interface MailSettingsRoutesDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  /** Facts of this server the public-address check reads (`payments/reachability.ts`). */
  reach: { networkFeatures: boolean; desktop: boolean; trustProxy: boolean };
  /** Test seam: the TXT lookup "Check again" asks. A fresh one, with no cache, per request when absent. */
  lookup?: TxtLookup | undefined;
  now?: (() => number) | undefined;
}

/** The services whose credentials Adminium makes, for the owner to copy into them. */
const COPIED: ReadonlySet<NoticeService> = new Set(['postmark', 'brevo']);

/** The signed-in person a change is made by: never an API key. */
function personOf(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('This is done by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

interface Sender {
  address: string;
  name: string | null;
  implicit: boolean;
}

export function mailSettingsRoutes(deps: MailSettingsRoutesDeps): FastifyPluginAsyncZod {
  const { meta, secret } = deps;
  const now = deps.now ?? Date.now;
  const settings = settingsRepo(meta);
  const keys: DkimKeys = createDkimKeys({ meta, secret, now });
  const endpoints = createNoticeEndpoints({ meta, secret, now });

  const publicOrigin = () => storedPublicOrigin(meta);

  /** The senders: the SMTP From address first, then the list, each once. */
  async function senders(): Promise<Sender[]> {
    const [smtp, list] = await Promise.all([settings.get('email.smtp'), settings.get('email.senders')]);
    const out: Sender[] = [];
    const seen = new Set<string>();
    const add = (raw: string, name: string | null, implicit: boolean) => {
      const address = bareAddress(raw);
      if (address === '' || seen.has(address)) return;
      seen.add(address);
      out.push({ address, name, implicit });
    };
    if (smtp !== null && smtp.from.trim() !== '') {
      const named = /^\s*"?([^"<]*?)"?\s*</.exec(smtp.from)?.[1]?.trim() ?? '';
      add(smtp.from, named === '' ? null : named, true);
    }
    for (const sender of list ?? []) add(sender.address, sender.name.trim() === '' ? null : sender.name.trim(), false);
    return out;
  }

  /** Whether a key still opens: one that no longer does (the server's secret changed) signs nothing. */
  async function usable(key: DkimKeyView): Promise<boolean> {
    // The domain's newest key is the one shown; it opens when nodemailer's options can be made from it.
    return (await keys.signingOptionsFor(key.domain)) !== null;
  }

  async function keyView(key: DkimKeyView): Promise<DkimKeyReply> {
    return { domain: key.domain, selector: key.selector, record: key.record, createdAt: key.createdAt, usable: await usable(key) };
  }

  async function endpointView(service: NoticeService, status: NoticeEndpointStatus | null, origin: string | null): Promise<EndpointView> {
    const address = status === null || origin === null ? null : await endpoints.addressOf(service, origin);
    return {
      service,
      opened: status !== null,
      secretRow: status?.secretRow ?? NOTICE_SECRET_ROW[service],
      ready: status?.ready ?? false,
      secretSetAt: status?.secretSetAt ?? null,
      confirmedAt: status?.confirmedAt ?? null,
      lastNoticeAt: status?.lastNoticeAt ?? null,
      noticeCount: status?.noticeCount ?? 0,
      address,
    };
  }

  async function oneEndpoint(service: NoticeService): Promise<EndpointView> {
    return endpointView(service, await endpoints.status(service), await publicOrigin());
  }

  /** The domains a key may be made for: each own-domain sender's, and its parents'. */
  async function keyDomains(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const sender of await senders()) {
      const domain = domainOfAddress(sender.address);
      if (domain === null || isFreeMail(sender.address)) continue;
      for (const candidate of domainsUp(domain)) out.add(candidate);
    }
    return out;
  }

  return async (app) => {
    const manage = app.rbac.require(PERMISSIONS.settingsManage);

    // ── the senders ─────────────────────────────────────────────────────────
    app.get(
      '/email/marketing',
      { preHandler: manage, config: { audit: auditExempt('reading the marketing mail settings changes nothing') }, schema: { response: { 200: marketingReply } } },
      async () => {
        const list = await senders();
        const out = [];
        for (const sender of list) {
          const domain = domainOfAddress(sender.address);
          const freeMail = domain === null || isFreeMail(sender.address);
          const key = freeMail || domain === null ? null : await signingKeyFor(keys, domain);
          out.push({ ...sender, domain, freeMail, key: key === null ? null : await keyView(key) });
        }
        const stored = await settings.get('email.marketingReplyTo');
        return { data: { postalAddress: await postalAddressOf(meta), replyTo: replyToOf(stored), publicOrigin: await publicOrigin(), businessName: await businessNameOf(meta), senders: out } };
      },
    );

    app.post(
      '/email/marketing/check',
      {
        preHandler: manage,
        config: { audit: auditExempt('asks DNS about one of the install\'s own senders and changes nothing'), rateLimitBucket: 'mail-dns' },
        schema: { body: senderCheckBody, response: { 200: senderCheckReply } },
      },
      async (request) => {
        const address = bareAddress(request.body.address);
        // Only a sender of this install: the route is not a way to ask DNS about anybody's domain.
        if (!(await senders()).some((sender) => sender.address === address)) throw new NotFoundError('That is not one of your senders.');
        const domain = domainOfAddress(address);
        const key = domain === null ? null : await signingKeyFor(keys, domain);
        const lookup = deps.lookup ?? createTxtLookup({ cacheMs: 0 });
        const facts = await senderFacts(lookup, address, key === null ? null : { domain: key.domain, selector: key.selector, publicKey: key.publicKey });
        const { origin, open } = await mailDoorReach(meta, deps.reach);
        const refusals = marketingRefusals(address, { postalAddress: await postalAddressOf(meta), publicOrigin: origin, reachable: open }, facts);
        const free = domain === null || isFreeMail(address);
        const dmarc = free ? null : facts.dmarc === 'unchecked' ? ('unchecked' as const) : { policy: facts.dmarc.policy, recordDomain: facts.dmarc.recordDomain };
        const dkim = facts.dkim === null ? null : facts.dkim === 'unchecked' ? ('unchecked' as const) : facts.dkim.state;
        return { data: { dmarc, dkim, refusals } };
      },
    );

    app.post(
      '/email/marketing/dkim-keys',
      { preHandler: manage, config: { audit: audited('rbac'), rateLimitBucket: 'mail-settings' }, schema: { body: makeKeyBody, response: { 200: makeKeyReply } } },
      async (request) => {
        const userId = personOf(request);
        const domain = request.body.domain.trim().toLowerCase().replace(/\.$/, '');
        if (!(await keyDomains()).has(domain)) throw new ValidationFailedError('Make a key for the domain of one of your senders.', { field: 'domain', code: 'not-a-sender-domain' });
        const held = await keys.forDomain(domain);
        if (held !== null) {
          // A key that still opens stays: "Make a key" is offered only where there is none, or where it no longer opens.
          if (await usable(held)) throw new ConflictError(`${domain} has a key already.`);
          await keys.remove(held.id);
        }
        let made: DkimKeyView;
        try {
          made = await keys.make(domain, { createdBy: userId });
        } catch (error) {
          if (error instanceof DkimKeyError) {
            if (error.code === 'exists') throw new ConflictError(`${domain} has a key already.`);
            throw new ValidationFailedError(error.message, { field: 'domain', code: error.code });
          }
          throw error;
        }
        await app.rbac.audit(request, { category: 'settings', action: 'email.dkim-key.make', changes: { before: { replaced: held !== null }, after: { domain: made.domain, selector: made.selector } } });
        return { data: { key: await keyView(made) } };
      },
    );

    app.put(
      '/email/marketing/reply-to',
      { preHandler: manage, config: { audit: audited('rbac'), rateLimitBucket: 'mail-settings' }, schema: { body: replyToBody, response: { 200: replyToReply } } },
      async (request) => {
        const userId = personOf(request);
        const typed = request.body.replyTo?.trim() ?? '';
        const replyTo = typed === '' ? null : replyToOf(typed);
        if (typed !== '' && replyTo === null) throw new ValidationFailedError('Enter one e-mail address, such as hello@example.com.', { field: 'replyTo' });
        const before = replyToOf(await settings.get('email.marketingReplyTo'));
        if (before !== replyTo) await settings.set('email.marketingReplyTo', replyTo, { updatedBy: userId, at: app.rbac.now() });
        await app.rbac.audit(request, { category: 'settings', action: 'email.marketing-reply-to.update', changes: { before: { replyTo: before }, after: { replyTo } } });
        return { data: { replyTo } };
      },
    );

    // ── where the mail services report bounces and spam ─────────────────────
    app.get(
      '/email/notice-endpoints',
      { preHandler: manage, config: { audit: auditExempt('reading where the mail services report bounces changes nothing') }, schema: { response: { 200: endpointsReply } } },
      async () => {
        const origin = await publicOrigin();
        const smtp = await settings.get('email.smtp');
        const services = [];
        for (const service of NOTICE_SERVICES) services.push(await endpointView(service, await endpoints.status(service), origin));
        return { data: { publicOrigin: origin, suggested: smtp === null ? null : relayOf(smtp.host), services } };
      },
    );

    app.post(
      '/email/notice-endpoints/:service',
      { preHandler: manage, config: { audit: audited('rbac'), rateLimitBucket: 'mail-settings' }, schema: { params: noticeServiceParams, response: { 200: endpointMadeReply } } },
      async (request) => {
        const userId = personOf(request);
        const { service } = request.params;
        const opened = await endpoints.open(service, { createdBy: userId });
        // Made already: its address stands, and its credentials are never read back.
        if (opened === null) return { data: { endpoint: await oneEndpoint(service), credentials: null } };
        await app.rbac.audit(request, { category: 'settings', action: 'email.notice-endpoint.open', changes: { after: { service, credentials: opened.basic !== null } } });
        const origin = await publicOrigin();
        const endpoint = await endpointView(service, opened.status, origin);
        return { data: { endpoint: { ...endpoint, address: origin === null ? null : noticeAddress(origin, service, opened.token) }, credentials: opened.basic } };
      },
    );

    app.post(
      '/email/notice-endpoints/:service/credentials',
      { preHandler: manage, config: { audit: audited('rbac'), rateLimitBucket: 'mail-settings' }, schema: { params: noticeServiceParams, response: { 200: endpointMadeReply } } },
      async (request) => {
        personOf(request);
        const { service } = request.params;
        if (!COPIED.has(service)) throw new ValidationFailedError(`${service} does not take credentials Adminium makes.`, { field: 'service', code: 'wrong-service' });
        let made;
        try {
          made = await endpoints.replaceCredentials(service);
        } catch (error) {
          if (error instanceof NoticeEndpointError && error.code === 'no-endpoint') throw new NotFoundError(error.message);
          throw error;
        }
        await app.rbac.audit(request, { category: 'settings', action: 'email.notice-endpoint.credentials', changes: { after: { service } } });
        return { data: { endpoint: await oneEndpoint(service), credentials: made } };
      },
    );

    // A new notice address, for any service: the old one stops working at once (one that leaked, or
    // "another service" whose credentials cannot be changed). The service must be told the new one;
    // Amazon SNS asks to confirm it again. The service's credentials and keys stay as they are.
    app.post(
      '/email/notice-endpoints/:service/address',
      { preHandler: manage, config: { audit: audited('rbac'), rateLimitBucket: 'mail-settings' }, schema: { params: noticeServiceParams, response: { 200: endpointReply } } },
      async (request) => {
        personOf(request);
        const { service } = request.params;
        let token: string;
        try {
          token = await endpoints.replaceToken(service);
        } catch (error) {
          if (error instanceof NoticeEndpointError && error.code === 'no-endpoint') throw new NotFoundError(error.message);
          throw error;
        }
        await app.rbac.audit(request, { category: 'settings', action: 'email.notice-endpoint.address', changes: { after: { service } } });
        const origin = await publicOrigin();
        const endpoint = await oneEndpoint(service);
        return { data: { endpoint: { ...endpoint, address: origin === null ? null : noticeAddress(origin, service, token) } } };
      },
    );

    app.put(
      '/email/notice-endpoints/:service/secret',
      { preHandler: manage, config: { audit: audited('rbac'), rateLimitBucket: 'mail-settings' }, schema: { params: noticeServiceParams, body: endpointSecretBody, response: { 200: endpointReply } } },
      async (request) => {
        const userId = personOf(request);
        const { service } = request.params;
        const value = request.body.secret;
        // The address comes first: a key saved for a service is saved on its endpoint.
        if ((await endpoints.status(service)) === null) await endpoints.open(service, { createdBy: userId });
        try {
          if (service === 'mailgun') await endpoints.setSigningKey(service, value);
          else if (service === 'sendgrid') await endpoints.setVerificationKey(service, value);
          else if (service === 'ses') await endpoints.setTopicArn(service, value);
          else throw new ValidationFailedError(`${service} takes nothing pasted here.`, { field: 'service', code: 'wrong-service' });
        } catch (error) {
          if (error instanceof NoticeEndpointError) throw new ValidationFailedError(error.message, { field: 'secret', code: error.code });
          throw error;
        }
        await app.rbac.audit(request, { category: 'settings', action: 'email.notice-endpoint.secret', changes: { after: { service, secretRow: NOTICE_SECRET_ROW[service] } } });
        return { data: { endpoint: await oneEndpoint(service) } };
      },
    );

  };
}
