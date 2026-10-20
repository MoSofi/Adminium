// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/designer/figma`: a person's own Figma connection, and importing a frame.
 *
 * Every route acts on the signed-in person only, behind the Designer's own permission and rate
 * bucket. The token goes one way: it is checked with Figma (`/v1/me`) before anything is kept, kept
 * encrypted, and never sent back; a reply says only whether there is one, whose it is and its Figma
 * handle. On a live server the token is the person's own, so the refusal that keeps model
 * connections in Settings → AI does not apply here.
 *
 * Seeing and removing a token always works, also while the Designer is switched off on a live
 * server, so a person can take theirs off from their Security page. Connecting and importing need the
 * Designer on.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import { ForbiddenError, ValidationFailedError } from '../../errors.js';
import { FigmaError, figmaWords, type FigmaClient } from '../../designer/figma/client.js';
import type { FigmaImports } from '../../designer/figma/imports.js';
import { FIGMA_LINK_WORDS, parseFigmaLink } from '../../designer/figma/link.js';
import type { FigmaReader } from '../../designer/figma/service.js';
import type { FigmaTokens } from '../../designer/figma/tokens.js';
import { plainWords } from '../../designer/untrusted.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { designerFigmaImportBody, designerFigmaImportReply, designerFigmaReply, designerFigmaTokenBody } from './schema.js';

export interface FigmaRoutesDeps {
  tokens: FigmaTokens;
  client: FigmaClient;
  reader: FigmaReader;
  imports: FigmaImports;
  /** Whether this server may call outside itself. */
  network(): boolean;
  /** Whether what is kept of a frame outlives the next deploy. */
  lasting: boolean;
  /** On a live server: whether a Super Admin has the Designer switched on. */
  live?: { state(): Promise<{ on: boolean }> } | undefined;
}

const RATE = { rateLimitBucket: 'designer' } as const;

/** A Figma refusal as the page reads it: a sentence, and the refusal itself for the page to say in its own words. */
export function figmaFailure(error: FigmaError): ValidationFailedError {
  return new ValidationFailedError(figmaWords(error.refusal), { reason: 'FIGMA', figma: error.refusal });
}

/** The names the two halves of an import are shown by: the frame's own name, as one plain line. */
export function importNames(frame: string): { pictureName: string; outlineName: string } {
  const name = plainWords(frame, 100) || 'Figma frame';
  return { pictureName: `${name}.png`, outlineName: `${name} — Figma design.md` };
}

export function figmaRoutes(deps: FigmaRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.designerUse);
    const userOf = (id: string | undefined): string => {
      if (id === undefined) throw new ForbiddenError('Sign in first.');
      return id;
    };
    const designerOn = async (): Promise<void> => {
      if (deps.live !== undefined && !(await deps.live.state()).on) throw new ForbiddenError('Adminium Designer is switched off on this server.', 'FORBIDDEN', { reason: 'DESIGNER_OFF' });
    };
    const statusOf = async (userId: string) => ({ ...(await deps.tokens.status(userId)), network: deps.network(), lasting: deps.lasting });

    app.get('/designer/figma', { preHandler: guard, config: RATE, schema: { response: { 200: designerFigmaReply } } }, async (request) => statusOf(userOf(request.user?.id)));

    app.put(
      '/designer/figma',
      { preHandler: guard, config: { ...RATE, audit: audited('rbac') }, schema: { body: designerFigmaTokenBody, response: { 200: designerFigmaReply } } },
      async (request) => {
        await designerOn();
        const userId = userOf(request.user?.id);
        let who: { id: string; handle: string };
        try {
          who = await deps.client.me(request.body.token);
        } catch (error) {
          if (!(error instanceof FigmaError)) throw error;
          // Figma refused the token: nothing is kept.
          if (error.refusal.kind === 'no-access' || error.refusal.kind === 'token') {
            throw new ValidationFailedError('Figma did not accept this token. Check it and paste it again.', { reason: 'FIGMA', figma: { kind: 'token' } });
          }
          throw figmaFailure(error);
        }
        await deps.tokens.save(userId, request.body.token, who);
        // The handle only: the token is never in an audit entry.
        await app.rbac.audit(request, { category: 'auth', action: 'designer.figma.connected', changes: { after: { handle: who.handle } } });
        return statusOf(userId);
      },
    );

    app.delete('/designer/figma', { preHandler: guard, config: { ...RATE, audit: audited('rbac') }, schema: { response: { 200: designerFigmaReply } } }, async (request) => {
      const userId = userOf(request.user?.id);
      const removed = await deps.tokens.remove(userId);
      // What was read with it goes too.
      deps.reader.forget(userId);
      if (removed) await app.rbac.audit(request, { category: 'auth', action: 'designer.figma.disconnected', changes: { after: {} } });
      return statusOf(userId);
    });

    app.post(
      '/designer/figma/import',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('an import reads Figma and keeps nothing until the message it goes with is sent; that turn is audited') },
        schema: { body: designerFigmaImportBody, response: { 200: designerFigmaImportReply } },
      },
      async (request) => {
        await designerOn();
        const userId = userOf(request.user?.id);
        const parsed = parseFigmaLink(request.body.link);
        if (!parsed.ok) throw new ValidationFailedError(FIGMA_LINK_WORDS[parsed.reason], { reason: 'FIGMA_LINK', link: parsed.reason });
        try {
          const done = await deps.reader.importFrame(userId, parsed.link, { by: 'person' });
          return { importId: deps.imports.keep(userId, done), ...importNames(done.frame), width: done.width, height: done.height, reads: done.reads };
        } catch (error) {
          if (error instanceof FigmaError) throw figmaFailure(error);
          throw error;
        }
      },
    );
  };
}
