// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILE DOOR: `POST /x/forms/api/:slug/files?q=<question>&name=<file name>`.
 *
 * One file per request, the request's body being the file itself (no
 * multipart: the bytes go straight to the spool, as the staff upload route's
 * do). What it takes it from the form, never from the request:
 *
 *  - the form must be live, and the outside able to reach this server (the
 *    door's own `lookUp`); a closed, draft or unknown form is "not available",
 *    and so is a named survey without its invitation's open token (`t`);
 *  - `q` must name a file question of the form: its kinds and its size cap
 *    (`maxMb`, at most 10) are what the file is judged by;
 *  - the form's own human check, one per upload (`x-adminium-proof`, purpose
 *    `form`, bound to the form; spent once), checked before a byte is read.
 *
 * Then the upload store takes it (`public-uploads/store.ts`): the address's
 * daily cap, the store's quota, the cap per file (the body is cut off past
 * it, never read whole), the content sniffed, a picture cleaned of what the
 * camera wrote. It answers:
 *
 *   200 `{ id, name, size, kind }`          taken, unattached, for the answer to name
 *   413 `{ code: 'too-big' }`               415 `{ code: 'kind' }`
 *   507 `{ code: 'quota' }`                 429 `{ code: 'cap' }`
 *   403 `{ code: 'proof' }`                 400 `{ code: 'question' }`
 *   404 `{ state: 'unavailable', … }`       the form is not there for strangers
 *
 * The file is never served back to anyone but staff with the grant of the
 * answer that takes it (`routes/forms-files/`).
 */
import type { Readable } from 'node:stream';

import { publicProofsRepo, type MetaDb } from '@adminium/meta';
import type { FormQuestionOf } from '@adminium/add-on-contracts/forms';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { spentKeyOf } from '../../forms/answer.js';
import type { LiveForm } from '../../forms/catalog.js';
import { FORM_FILE_MB, FORM_UPLOAD_KIND, formUploadKey } from '../../forms/files.js';
import { checkProof } from '../../public-api/proof.js';
import type { PublicUploads, UploadRefusal } from '../../public-uploads/store.js';
import { tagRoutes } from '../../security/route-audience.js';

/** The most a file question allows (`maxMb` ≤ 10), plus room for nothing else: the spool's own cap is the question's. */
export const FORM_FILE_BODY_LIMIT = 10 * FORM_FILE_MB + 64 * 1024;

const STATUS: Readonly<Record<UploadRefusal, number>> = { 'too-big': 413, kind: 415, quota: 507, cap: 429 };

export interface FormsFileRoutesDeps {
  meta: MetaDb;
  uploads: PublicUploads;
  /** The proof key (`proofKey(secret)`). */
  key: Buffer;
  /** The form a request names, as strangers may be served it now (the door's own). */
  lookUp: (request: FastifyRequest, slug: string, token: string | undefined) => Promise<{ state: 'live'; live: LiveForm } | { state: 'closed' | 'unavailable' | 'already' | 'dead' }>;
  /** The door's one "not available" answer. */
  unavailable: (reply: FastifyReply) => Promise<FastifyReply>;
  /** The key a form's proof is bound to, and the least work it must carry. */
  proofOf: (live: LiveForm) => { keyId: string; difficulty: number };
  now: () => number;
}

const params = z.object({ slug: z.string().min(1).max(120) });
const query = z.object({ q: z.string().min(1).max(40), name: z.string().max(1024).optional(), t: z.string().max(2000).optional(), preview: z.string().max(8).optional() });

export function formsFileRoutes(deps: FormsFileRoutesDeps): FastifyPluginAsyncZod {
  const proofs = publicProofsRepo(deps.meta);

  return async (app) => {
    // Doors anybody may open: hidden with the other public pages (`security/route-audience.ts`).
    tagRoutes(app, 'public');
    // The body is the file: every type is handed over as the stream it is, inside this plugin only.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

    app.post(
      '/x/forms/api/:slug/files',
      {
        bodyLimit: FORM_FILE_BODY_LIMIT,
        config: {
          rateLimitBucket: 'forms-door',
          csrf: 'origin',
          audit: auditExempt('a stranger uploading a file for a form: the upload row is the record; a stranger is not an actor the audit log names'),
        },
        schema: { hide: true, params, querystring: query },
      },
      async (request, reply) => {
        // A preview takes nothing: its page sends no file, and a request that says it is one is refused before anything is read.
        if (request.query.preview !== undefined) return deps.unavailable(reply);
        const found = await deps.lookUp(request, request.params.slug, request.query.t);
        if (found.state !== 'live') return deps.unavailable(reply);
        const { live } = found;
        const question = live.form.definition.questions.find((one): one is FormQuestionOf<'file'> => one.id === request.query.q && one.kind === 'file');
        if (question === undefined) return reply.status(400).send({ code: 'question' });

        const asked = deps.proofOf(live);
        const proved = checkProof(deps.key, request.headers['x-adminium-proof'], { keyId: asked.keyId, purpose: 'form', now: deps.now(), difficulty: asked.difficulty });
        if (!proved.ok || !(await proofs.spend({ id: proved.spendId, keyId: spentKeyOf(live), purpose: 'form', expiresAt: proved.expiresAt }))) {
          return reply.status(403).send({ code: 'proof' });
        }

        const taken = await deps.uploads.take({
          source: request.body as Readable,
          name: request.query.name ?? 'file',
          binding: { kind: FORM_UPLOAD_KIND, key: formUploadKey(live) },
          ip: request.ip,
          kinds: question.kinds,
          maxBytes: question.maxMb * FORM_FILE_MB,
        });
        if (!taken.ok) return reply.status(STATUS[taken.code]).send({ code: taken.code });
        return taken.upload;
      },
    );
  };
}
