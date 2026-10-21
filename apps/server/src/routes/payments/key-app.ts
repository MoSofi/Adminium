// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /payments/services/:key/key-app` — "Download the app template".
 *
 * A provider whose key is made by a private app the shop uploads to its own
 * account (Stripe's) exports a function that stamps the template with this
 * install's own app id and the shop's name: such ids are unique across the
 * provider, so a template with one fixed id could be uploaded once, ever. The
 * install's id is made on the first download and kept, so every download of
 * one install is the same app. The answer is a zip of the files the function
 * gives, for a signed-in person who may manage payments.
 */
import { randomBytes } from 'node:crypto';

import { PAYMENT_KEY_APP_EXPORT, PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION } from '@adminium/add-on-contracts';
import { paymentSettingsRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';

import { providerByKey, type AddOnRuntimeState } from '../../add-ons/runtime.js';
import { audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from './ways.js';

export interface KeyAppDeps {
  meta: MetaDb;
  runtime: () => AddOnRuntimeState | null;
}

const params = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
const installSchema = z.object({ installId: z.string().regex(/^[a-z0-9]{12}$/) }).strict();

/** What the add-on's function must answer: a stamped id and name, and a few small text files with plain names. */
const templateSchema = z.object({
  appId: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,120}$/),
  appName: z.string().min(1).max(80),
  files: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/), z.string().max(64 * 1024)).refine((files) => Object.keys(files).length > 0 && Object.keys(files).length <= 10),
});

function requirePerson(request: FastifyRequest): void {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('The app template is downloaded by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  if ((request as unknown as { user?: { id?: string } }).user?.id === undefined) throw new UnauthorizedError();
}

export function keyAppRoutes(deps: KeyAppDeps): FastifyPluginAsyncZod {
  const { meta } = deps;

  /** This install's own id for the key app: made once, then always the same. */
  async function installId(key: string): Promise<string> {
    const docs = paymentSettingsRepo(meta);
    const name = `key-app:${key}`;
    const kept = await docs.get(name, installSchema);
    if (kept !== null) return kept.installId;
    const made = { installId: [...randomBytes(12)].map((byte) => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('') };
    // Two first downloads at once: the first write wins, and both read it back.
    if (!(await docs.claim(name, installSchema, made))) return (await docs.get(name, installSchema))?.installId ?? made.installId;
    return made.installId;
  }

  return async (app) => {
    app.get(
      '/payments/services/:key/key-app',
      { preHandler: app.rbac.require(PERMISSIONS.paymentsManage), config: { audit: audited('rbac') }, schema: { params } },
      async (request, reply) => {
        requirePerson(request);
        const runtime = deps.runtime();
        const entry = runtime === null ? null : providerByKey(runtime, PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION, request.params.key);
        const stamp = (entry?.module as Record<string, unknown> | undefined)?.[PAYMENT_KEY_APP_EXPORT];
        if (typeof stamp !== 'function') throw new NotFoundError('This payment service makes its key without an app.');
        const page = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
        const brand = await settingsRepo(meta).get('branding.appName');
        const shopName = page?.shopName?.trim() || (typeof brand === 'string' ? brand : '') || 'Shop';
        const template = templateSchema.parse(await (stamp as (input: { shopName: string; installId: string }) => unknown)({ shopName, installId: await installId(request.params.key) }));
        const zip = zipSync(Object.fromEntries(Object.entries(template.files).map(([file, text]) => [file, strToU8(text)])), { mtime: new Date('2026-01-01T00:00:00Z') });
        await app.rbac.audit(request, { category: 'payments', action: 'payments.key-app.downloaded', changes: { after: { service: request.params.key, appId: template.appId } } });
        return reply
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${template.appId}.zip"`)
          .header('cache-control', 'no-store')
          .send(Buffer.from(zip));
      },
    );
  };
}
