// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILE DOOR (`POST /x/forms/api/:slug/files`) on every meta engine, over
 * a catalog a test hands in and the engine's real file store:
 *
 * - a file for a file question, with the form's own human check, is taken
 *   unattached and answered with its id, name, size and kind;
 * - no check, a check spent already, or one made for another form: refused
 *   before a byte is read; a question that takes no file, a closed or unknown
 *   form: refused;
 * - 20 MB at the question's 10 MB: `too-big`; a script renamed `.jpg`:
 *   `kind`; the address's day spent: `cap`; whatever the body's type, the
 *   bytes are judged as they are;
 * - the door's own content policy and `nosniff` on every answer.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseForm } from '@adminium/add-on-contracts/forms';
import { publicUploadsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import type { FormLookup, FormsCatalog } from '../src/forms/catalog.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicUploads } from '../src/public-uploads/store.js';
import { formsDoorRoutes } from '../src/routes/forms-door/index.js';
import { ANONYMOUS, FIT_OUT, SHOWROOM, SHOWROOM_SETTINGS } from './forms-door.helpers.js';
import { createTestFileStore } from './helpers/file-store.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const MB = 1024 * 1024;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

function lookupOf(definition: unknown, settings: unknown, id: string, slug: string): FormLookup {
  const parsed = parseForm(definition, settings);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { state: 'live', live: { id, slug, addOn: 'forms', connectionId: 'conn_1', form: parsed.form } };
}

const FORMS: Record<string, FormLookup> = {
  'showroom-visit': lookupOf(SHOWROOM, SHOWROOM_SETTINGS, 'frm_1', 'showroom-visit'),
  'fit-out': lookupOf(FIT_OUT, ANONYMOUS, 'frm_2', 'fit-out'),
  'old-offer': { state: 'closed' },
};

const catalog: FormsCatalog = {
  find: async (slug) => FORMS[slug] ?? { state: 'unavailable' },
  liveSlugs: async () => [],
  forget: () => true,
};

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the file door — ${engine.name}`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let app: FastifyInstance;
    let dataDir: string;

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      await settingsRepo(meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      dataDir = await mkdtemp(join(tmpdir(), 'forms-files-door-'));
      const uploads = createPublicUploads({ meta, storage: createTestFileStore({ dataDir, meta }), secret: TEST_SECRET });
      app = Fastify({ logger: false });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate('spaRoot', null);
      await app.register(
        formsDoorRoutes({ meta, catalog, secret: TEST_SECRET, storage: { read: async () => Readable.from([]) }, websites: async () => [], networkFeatures: true, desktop: false, trustProxy: false, uploads }),
      );
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      await handle.destroy();
      await rm(dataDir, { recursive: true, force: true });
    });

    async function proof(slug: string): Promise<string> {
      const challenge = (await app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge`, headers: { host: HOST } })).json() as { id: string; salt: string; difficulty: number };
      return `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}`;
    }

    const send = async (slug: string, body: Buffer, opts: { q?: string; name?: string; proof?: string | null; type?: string } = {}) =>
      app.inject({
        method: 'POST',
        url: `/x/forms/api/${slug}/files?q=${opts.q ?? 'qfiles'}&name=${encodeURIComponent(opts.name ?? 'drawing.pdf')}`,
        headers: {
          host: HOST,
          origin: ORIGIN,
          'content-type': opts.type ?? 'application/octet-stream',
          ...(opts.proof === null ? {} : { 'x-adminium-proof': opts.proof ?? (await proof(slug)) }),
        },
        payload: body,
      });

    it('takes a file for a file question, with the form’s own check, unattached, and says what it took', async () => {
      const reply = await send('showroom-visit', PDF, { name: 'Records room – layout.pdf' });
      expect(reply.statusCode, reply.body).toBe(200);
      const taken = reply.json() as { id: string; name: string; size: number; kind: string };
      expect(taken).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) as unknown as string, name: 'Records room – layout.pdf', size: PDF.length, kind: 'pdf' });
      const row = await publicUploadsRepo(meta).findById(taken.id);
      expect(row).toMatchObject({ binding: { kind: 'form', key: 'forms/frm_1' }, attachedAt: null, owner: null });
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      expect(String(reply.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    });

    it('takes the body as bytes whatever type the browser says', async () => {
      for (const type of ['text/plain', 'application/json', 'image/png']) {
        const reply = await send('showroom-visit', PDF, { type });
        expect(reply.statusCode, `${type}: ${reply.body}`).toBe(200);
        expect((reply.json() as { kind: string }).kind).toBe('pdf');
      }
    });

    it('refuses before a byte is read without the form’s check, with one spent, or one made for another form', async () => {
      expect((await send('showroom-visit', PDF, { proof: null })).statusCode).toBe(403);
      const once = await proof('showroom-visit');
      expect((await send('showroom-visit', PDF, { proof: once })).statusCode).toBe(200);
      const again = await send('showroom-visit', PDF, { proof: once });
      expect(again.statusCode).toBe(403);
      expect(again.json()).toEqual({ code: 'proof' });
      expect((await send('showroom-visit', PDF, { proof: await proof('fit-out') })).statusCode).toBe(403);
      expect(await publicUploadsRepo(meta).keptBytes()).toBe(PDF.length);
    });

    it('refuses a question that takes no file, and a form that is closed or not there', async () => {
      const wrong = await send('showroom-visit', PDF, { q: 'qname' });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json()).toEqual({ code: 'question' });
      expect((await send('fit-out', PDF, { q: 'qnps', proof: null })).statusCode).toBe(400);
      for (const slug of ['old-offer', 'nobody-has-this']) {
        const reply = await send(slug, PDF);
        expect(reply.statusCode).toBe(404);
        expect((reply.json() as { state: string }).state).toBe('unavailable');
      }
    });

    it('refuses 20 MB at the question’s 10 MB, a script renamed .jpg, and an address past its day', async () => {
      const big = Buffer.concat([PDF, Buffer.alloc(20 * MB - PDF.length, 1)]);
      const tooBig = await send('showroom-visit', big, { name: 'scan.pdf' });
      expect(tooBig.statusCode).toBe(413);
      expect(tooBig.json()).toEqual({ code: 'too-big' });

      const script = await send('showroom-visit', Buffer.from('#!/bin/sh\nrm -rf ~\n'), { name: 'holiday.jpg', type: 'image/jpeg' });
      expect(script.statusCode).toBe(415);
      expect(script.json()).toEqual({ code: 'kind' });

      await settingsRepo(meta).set('publicUploads.perAddressDaily', 1, { updatedBy: null });
      expect((await send('showroom-visit', PDF)).statusCode).toBe(200);
      const capped = await send('showroom-visit', PDF);
      expect(capped.statusCode).toBe(429);
      expect(capped.json()).toEqual({ code: 'cap' });
      expect(await publicUploadsRepo(meta).keptBytes()).toBe(PDF.length);
    });
  });
}
