// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page itself: its HTML, its own files, the shop's logo, and the demo
 * payment service's pretend hosted page.
 *
 * ─── ITS OWN CONTENT POLICY ────────────────────────────────────────────────
 *
 * Every answer from this plugin carries a policy of its own, set in this
 * plugin's `onSend` (which runs after the global hooks that add picture and
 * map hosts to the dashboard's policy, so nothing widens it):
 *
 *   default-src 'none'; script-src, style-src and font-src only from
 *   `/pay/assets/` on this host; img-src 'self' data:; connect-src 'self';
 *   frame-ancestors 'none'; base-uri 'none'; form-action 'none'
 *
 * A path source needs the origin in front of it, so the policy names the
 * request's own origin: a page fetched under another Host is a page whose
 * own scripts that Host cannot serve, which only fails closed.
 *
 * The pay bundle is a build of its own (`apps/dashboard/vite.pay.config.ts`)
 * under `dist/pay/`, so not one dashboard file is reachable from its policy.
 * Its files are served here rather than by the dashboard's static wildcard,
 * so a file that is not there is a 404 and never the dashboard's page.
 *
 * Nothing here is cached except the hashed files, and no referrer leaves.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import type { DemoCard, DemoPaymentBackend } from '@adminium/add-on-contracts';
import { filesRepo, paymentAttemptsRepo, paymentSettingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { NotFoundError } from '../../errors.js';
import type { FileStore } from '../../files/store.js';
import { linkForToken, payReachable } from '../../payments/links.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from '../payments/ways.js';

export interface PayPageDeps {
  meta: MetaDb;
  storage: Pick<FileStore, 'read'>;
  /** The in-process demo payment service, when this install offers it. */
  demo: DemoPaymentBackend | null;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  now?: () => number;
}

const LOGO_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** The policy every pay answer carries, for the origin it was asked on. */
export function payContentPolicy(origin: string): string {
  const assets = `${origin}/pay/assets/`;
  return [
    "default-src 'none'",
    `script-src ${assets}`,
    `style-src ${assets}`,
    `font-src ${assets}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const UNBUILT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title></head><body><p>The pay page is not available on this server right now. Please contact the shop.</p></body></html>`;

const DEMO_ACTIONS = ['succeeds', 'fails', 'needs-a-step', 'settles-late', 'finish-step', 'leave'] as const;

const tokenParams = z.object({ token: z.string().min(1).max(64) });
const nonceParams = z.object({ nonce: z.string().min(1).max(64) });
const attemptParams = z.object({ attempt: z.string().min(1).max(64) });
const demoBody = z.object({ action: z.enum(DEMO_ACTIONS) });
const demoReply = z.object({ label: z.string(), amount: z.string(), currency: z.string(), status: z.string() });
const demoDoneReply = z.object({ back: z.string() });

function originOf(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

export function payPageRoutes(deps: PayPageDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? (() => Date.now());

  async function payRoot(app: { spaRoot: string | null }): Promise<string | null> {
    if (app.spaRoot === null) return null;
    const root = join(app.spaRoot, 'pay');
    try {
      return (await stat(join(root, 'index.html'))).isFile() ? root : null;
    } catch {
      return null;
    }
  }

  async function reachable(): Promise<boolean> {
    return (await payReachable(meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded: false })).state === 'reachable';
  }

  async function mayDriveDemo(request: FastifyRequest): Promise<boolean> {
    if (request.apiKeyPrincipal != null) return false;
    try {
      return await request.can(PERMISSIONS.paymentsManage);
    } catch {
      return false;
    }
  }

  return async (app) => {
    // Last word on the headers of everything this plugin answers.
    app.addHook('onSend', async (request, reply, payload) => {
      void reply.header('content-security-policy', payContentPolicy(originOf(request)));
      void reply.header('referrer-policy', 'no-referrer');
      void reply.header('x-content-type-options', 'nosniff');
      if (!request.url.startsWith('/pay/assets/')) void reply.header('cache-control', 'no-store');
      return payload;
    });

    async function page(reply: FastifyReply) {
      const root = await payRoot(app);
      if (root === null) return reply.status(503).type('text/html; charset=utf-8').send(UNBUILT);
      return reply.type('text/html; charset=utf-8').send(await readFile(join(root, 'index.html'), 'utf8'));
    }

    app.get('/pay/:token', { config: { rateLimitBucket: 'pay-page' }, schema: { params: tokenParams } }, async (_request, reply) => page(reply));
    app.get('/pay/back/:nonce', { config: { rateLimitBucket: 'pay-page' }, schema: { params: nonceParams } }, async (_request, reply) => page(reply));
    app.get('/pay/demo/:attempt', { config: { rateLimitBucket: 'pay-page' }, schema: { params: attemptParams } }, async (_request, reply) => page(reply));

    app.get('/pay/assets/*', { config: { rateLimitBucket: 'pay-page' } }, async (request, reply) => {
      const root = await payRoot(app);
      const wanted = (request.params as { '*': string })['*'];
      const type = ASSET_TYPES[extname(wanted)];
      if (root === null || type === undefined || !/^[A-Za-z0-9._/-]{1,200}$/.test(wanted) || wanted.includes('..')) return reply.status(404).send();
      const base = join(root, 'assets');
      const file = normalize(join(base, wanted));
      if (!file.startsWith(`${base}${sep}`)) return reply.status(404).send();
      try {
        if (!(await stat(file)).isFile()) return reply.status(404).send();
      } catch {
        return reply.status(404).send();
      }
      // The names carry a hash of what is in them: kept for good.
      return reply.type(type).header('cache-control', 'public, max-age=31536000, immutable').send(createReadStream(file));
    });

    app.get('/pay/api/:token/logo', { config: { rateLimitBucket: 'pay-page' }, schema: { params: tokenParams } }, async (request, reply) => {
      if (!(await reachable())) return reply.status(404).send();
      if ((await linkForToken(meta, request.params.token, now())) === null) return reply.status(404).send();
      const settings = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
      if (settings?.logoFileId == null) return reply.status(404).send();
      const file = await filesRepo(meta).findById(settings.logoFileId);
      if (file === null || !LOGO_TYPES.has(file.mime)) return reply.status(404).send();
      return reply.type(file.mime).send(await deps.storage.read(file));
    });

    app.get(
      '/pay/api/demo/:attempt',
      { config: { rateLimitBucket: 'pay-page' }, schema: { params: attemptParams, response: { 200: demoReply } } },
      async (request) => {
        const attempt = await paymentAttemptsRepo(meta).byId(request.params.attempt);
        const checkout = deps.demo === null || attempt === null ? null : deps.demo.checkoutForAttempt(attempt.id);
        if (attempt === null || checkout === null || attempt.provider !== 'demo' || !(await mayDriveDemo(request))) throw new NotFoundError();
        return { label: attempt.payableLabel, amount: checkout.amount, currency: checkout.currency, status: checkout.status };
      },
    );

    app.post(
      '/pay/api/demo/:attempt',
      {
        config: {
          rateLimitBucket: 'pay-checkout',
          // A signed-in person drives it from the pay page, which holds no token: the Origin check keeps other sites out.
          csrf: 'origin',
          audit: auditExempt('the demo payment service is pretend money in test mode; the attempt row records what happened'),
        },
        schema: { params: attemptParams, body: demoBody, response: { 200: demoDoneReply } },
      },
      async (request) => {
        const attempt = await paymentAttemptsRepo(meta).byId(request.params.attempt);
        const demo = deps.demo;
        const checkout = demo === null || attempt === null ? null : demo.checkoutForAttempt(attempt.id);
        if (demo === null || attempt === null || checkout === null || attempt.provider !== 'demo' || attempt.mode !== 'test' || !(await mayDriveDemo(request))) {
          throw new NotFoundError();
        }
        const { action } = request.body;
        try {
          if (action === 'leave') await demo.cancel(checkout.id);
          else if (action === 'finish-step') await demo.finishStep(checkout.id);
          else await demo.pay(checkout.id, action as DemoCard);
        } catch {
          // The checkout was no longer open: the back page reads how it stands.
        }
        return { back: `/pay/back/${attempt.nonce}${action === 'leave' ? '?left=1' : ''}` };
      },
    );
  };
}
