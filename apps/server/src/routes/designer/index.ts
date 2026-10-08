// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/designer/*` — Adminium Designer's sessions, turns and models.
 *
 * Registered only when the server runs the Designer (`adminium design`).
 * Every route needs `system:designer:use`, which only Super Admin holds
 * unless it is granted on purpose: the Designer's model writes code this
 * server runs. Every route declares the `designer` rate bucket itself, so no
 * address pattern can take its limit away.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Designer } from '../../designer/service.js';
import type { Starter } from '../../designer/start-with-app.js';
import { sourceArchiveUrl } from '../../project/apps/source-archive.js';
import type { Actor } from '../../designer/runner.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { LocalOwnerError } from '../../auth/local-owner.js';
import type { Live } from '../../designer/live.js';
import type { Versions } from '../../designer/versions.js';
import type { ArchitectureDocument } from '../../designer/architecture.js';
import { safeTarget, type PreviewTickets } from '../../designer/preview.js';
import { parseSelected, type AiConnections, type ConnectionId } from '../../llm/connections.js';
import { pickLocalized } from '../../add-ons/catalog.js';
import type { AppCatalog } from '../../apps/catalog.js';
import type { z } from 'zod';
import { APPS_DIR, listAppKeys, MANIFEST_PARTS_DIR } from '../../project/apps/read-app.js';
import { nameFromKey } from '../../project/apps/scaffold-app.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { auditExempt } from '../../audit/coverage.js';
import { ATTACHMENT_MAX_CSV_BYTES, AttachmentError, type Attachment, type Attachments } from '../../designer/attachments.js';
import { addDesignSkill, removeDesignSkill, SKILL_UPLOAD_MAX_BYTES, SkillUploadError } from '../../designer/skill-upload.js';
import {
  designerAnswerBody,
  designerAnswerReply,
  designerAppsReply,
  designerConnectionDraft,
  designerConnectionReply,
  designerConnectionSaveBody,
  designerConnectionTestReply,
  designerAppsListReply,
  designerCatalogApp,
  designerEventsQuery,
  designerModelCheckBody,
  designerModelCheckReply,
  designerModelsReply,
  designerAttachmentParams,
  designerAttachmentQuery,
  designerAttachmentReply,
  designerReadsImagesBody,
  designerReadsImagesReply,
  designerPreviewBody,
  designerPreviewReply,
  designerEventsReply,
  designerSessionCreateBody,
  designerSessionCreateReply,
  designerSessionParams,
  designerSessionPatchBody,
  designerSessionReply,
  designerStateReply,
  designerOwnerPasswordBody,
  designerOwnerPasswordReply,
  designerRestoreBody,
  designerRestoreReply,
  designerLookBody,
  designerLookReply,
  designerPictureThumbParams,
  designerStyleAddedReply,
  designerStyleParams,
  designerStyleRemovedReply,
  designerStyleUploadQuery,
  designerStylesReply,
  designerStopReply,
  designerVersionParams,
  designerVersionsReply,
  designerSightBody,
  designerSightReply,
  designerTurnBody,
  designerTurnReply,
  designerArchitectureReply,
  designerStartBody,
  designerStartCheckQuery,
  designerStartCheckReply,
  designerStartJob,
  designerStartParams,
  designerFileQuery,
  designerFileReply,
  designerFilesReply,
  designerFilesSaveBody,
  designerFilesSaveReply,
} from './schema.js';
import { FILES_SAVE_BODY_BYTES } from '../../designer/files.js';

export interface DesignerRoutesDeps {
  designer: Designer;
  versions: Versions | null;
  connections: AiConnections;
  mode: 'local' | 'live';
  root: string;
  limits: () => Promise<{ maxSteps: number; turnTokens: number; sessionTokens: number }>;
  /** The adminium.dev app list, for "Start with an app". */
  appCatalog?: { isEnabled(): Promise<boolean>; fetchCatalog(signal?: AbortSignal): Promise<AppCatalog> } | undefined;
  /** The live Designer's switch: with it, every route here answers only while it is on. Absent on a `design` server. */
  live?: Live | undefined;
  /** "Start with an app": copying one of the list into the project. Absent where the server cannot. */
  starter?: Starter | undefined;
  /** The preview's tickets and its address; null where the server has no preview name. */
  preview: { tickets: PreviewTickets; origin: string } | null;
  /** The names of the roles an app brings: whom its preview is seen as. */
  previewRoles?: ((appKey: string) => Promise<string[]>) | undefined;
  /** The owner `design` made, and their first password. Present only on a `design` server. */
  owner?: { needsPassword(userId: string | null): Promise<boolean>; set(input: { email: string; password: string }, by: Actor): Promise<string> } | undefined;
  /** What people attach to a message. */
  attachments: Attachments;
  /** A row in the audit log, for what the routes themselves change (a style added or removed). */
  audit?: (action: string, actor: Actor, detail: Record<string, unknown>) => Promise<void>;
  /** The pictures a card is showing, to serve each one's small copy. Absent where the Designer looks for none. */
  pictures?: import('../../designer/pictures.js').PictureShelf;
  /** How an app fits together, from what the engine applied. */
  architecture?: ((appKey: string) => Promise<ArchitectureDocument>) | undefined;
}

/** The largest file a message takes (a CSV), and a little for the request around it. */
const ATTACHMENT_BODY_LIMIT = ATTACHMENT_MAX_CSV_BYTES + 64 * 1024;

/** An attachment as the page is told of it: never its hash, never where it is kept. */
const publicAttachment = (entry: Attachment) => ({
  id: entry.id,
  label: entry.label,
  kind: entry.kind,
  mediaType: entry.mediaType,
  bytes: entry.bytes,
  ...(entry.rows === undefined ? {} : { rows: entry.rows }),
  ...(entry.columns === undefined ? {} : { columns: entry.columns }),
});

/** How long the adminium.dev list is kept. */
const CATALOG_CACHE_MS = 60 * 60 * 1000;

/** How many events one catch-up read gives. */
export const EVENTS_PAGE = 2000;

const RATE = { rateLimitBucket: 'designer' } as const;

/** The person asking. */
function actorOf(request: FastifyRequest): Actor {
  return { id: request.user?.id ?? null, label: request.user?.email ?? 'unknown' };
}

/** An app's name as its `app.json` says it, or one made from its key. */
function appName(root: string, key: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(root, APPS_DIR, key, MANIFEST_PARTS_DIR, 'app.json'), 'utf8')) as { name?: unknown };
    if (typeof parsed.name === 'string' && parsed.name.trim() !== '') return parsed.name;
    if (parsed.name !== null && typeof parsed.name === 'object') {
      const text = (parsed.name as Record<string, unknown>)['en-US'] ?? (parsed.name as { fallback?: unknown }).fallback;
      if (typeof text === 'string' && text.trim() !== '') return text;
    }
  } catch {
    // A single manifest.json, or one that does not read: the key says enough.
  }
  return nameFromKey(key);
}

export function designerRoutes(deps: DesignerRoutesDeps): FastifyPluginAsyncZod {
  const { designer, connections } = deps;
  const { store, runner } = designer;

  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.designerUse);

    // A file attached to a message comes as its raw bytes, in this plugin only (there is no multipart parser in this server).
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    // On a live server the Designer answers only while a Super Admin has it switched on.
    if (deps.live !== undefined) {
      const live = deps.live;
      app.addHook('preHandler', async () => {
        if (!(await live.state()).on) throw new ForbiddenError('Adminium Designer is switched off on this server.', 'FORBIDDEN', { reason: 'DESIGNER_OFF' });
      });
    }

    /*
     * On a live server a model's address is the server's own setting (Settings → AI, or the operator's
     * environment): someone who may use the Designer does not point the server at an address of their choosing.
     */
    const onLive = deps.mode === 'live';
    const refuseOnLive = (): void => {
      if (onLive) throw new ForbiddenError('On a live server, model connections are set in Settings → AI.', 'FORBIDDEN', { reason: 'LIVE' });
    };

    app.get('/designer/state', { preHandler: guard, config: RATE, schema: { response: { 200: designerStateReply } } }, async (request) => ({
      mode: deps.mode,
      project: basename(deps.root),
      limits: await deps.limits(),
      active: runner.active(),
      ownerNeedsPassword: deps.owner === undefined ? false : await deps.owner.needsPassword(request.user?.id ?? null),
    }));

    // The owner `design` made, given an address and a password on the page (as `adminium owner set` does in the terminal).
    // Only on a `design` server, only for that owner, only while they have none: it never changes a password that exists.
    if (deps.owner !== undefined) {
      const owner = deps.owner;
      app.post(
        '/designer/owner-password',
        {
          preHandler: guard,
          config: { ...RATE, audit: auditExempt('setting the local owner’s first password is audited by the route itself, without the password') },
          schema: { body: designerOwnerPasswordBody, response: { 200: designerOwnerPasswordReply } },
        },
        async (request) => {
          const by = actorOf(request);
          if (!(await owner.needsPassword(by.id))) {
            throw new ConflictError('Only the owner this project was made with, while they have no password, sets one here. Change a password under your account.', 'CONFLICT', { reason: 'NOT_THE_LOCAL_OWNER' });
          }
          try {
            return { email: await owner.set(request.body, by) };
          } catch (error) {
            if (!(error instanceof LocalOwnerError)) throw error;
            if (error.reason === 'not-local' || error.reason === 'has-password') throw new ConflictError(error.message, 'CONFLICT', { reason: 'NOT_THE_LOCAL_OWNER' });
            throw new ValidationFailedError(error.message, { reason: error.reason === 'password-short' ? 'PASSWORD' : 'EMAIL' });
          }
        },
      );
    }

    // "Your apps": every app of the folder, with the newest session that built it.
    const publicLook = (appKey: string) => designer.publicLook(appKey);

    app.get('/designer/sessions', { preHandler: guard, config: RATE, schema: { response: { 200: designerAppsReply } } }, async () => {
      const sessions = store.list();
      return {
        apps: listAppKeys(deps.root).map((key) => {
          const newest = sessions.find((session) => session.appKey === key) ?? null;
          return {
            key,
            name: appName(deps.root, key),
            version: newest?.version ?? null,
            editedAt: newest?.updatedAt ?? null,
            sessionId: newest?.id ?? null,
            sessions: sessions
              .filter((session) => session.appKey === key)
              .slice(0, 50)
              .map((session) => ({ id: session.id, title: session.title, updatedAt: session.updatedAt, turns: session.turns })),
          };
        }),
      };
    });

    app.post(
      '/designer/sessions',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the session and its first turn are audited by the Designer itself') },
        schema: { body: designerSessionCreateBody, response: { 201: designerSessionCreateReply } },
      },
      async (request, reply) => {
        const by = actorOf(request);
        const { text, sees, ...input } = request.body;
        // With a first message the folder is kept for its turn before the session is made: a session whose turn is then refused is not left behind.
        const claim = text === undefined ? null : runner.claim();
        try {
          const session = await designer.createSession(input, by);
          const turn = text === undefined || claim === null ? null : (await runner.start(session.id, { text, by, claim, ...(sees === true ? { sees: true } : {}) })).turn;
          return await reply.code(201).send({ session: store.read(session.id), turn });
        } finally {
          claim?.release();
        }
      },
    );

    app.get(
      '/designer/sessions/:id',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, response: { 200: designerSessionReply } } },
      async (request) => {
        const session = store.read(request.params.id);
        return { session, waiting: runner.waiting(session.id), active: runner.active()?.sessionId === session.id, look: publicLook(session.appKey) };
      },
    );

    app.patch(
      '/designer/sessions/:id',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a session’s title and model are the person’s working state, not configuration') },
        schema: { params: designerSessionParams, body: designerSessionPatchBody, response: { 200: designerSessionReply } },
      },
      async (request) => {
        const current = store.read(request.params.id);
        if (request.body.connectionId !== undefined && (await connections.find(request.body.connectionId)) === null) {
          throw new NotFoundError('There is no such model connection.', { connectionId: request.body.connectionId });
        }
        const session = store.update(current.id, {
          ...(request.body.title === undefined ? {} : { title: request.body.title, titled: true }),
          ...(request.body.connectionId === undefined ? {} : { connectionId: request.body.connectionId }),
          ...(request.body.model === undefined ? {} : { model: request.body.model }),
        });
        return { session, waiting: runner.waiting(session.id), active: runner.active()?.sessionId === session.id, look: publicLook(session.appKey) };
      },
    );

    app.post(
      '/designer/sessions/:id/turns',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('every turn is audited by the Designer itself, start and end') },
        schema: { params: designerSessionParams, body: designerTurnBody, response: { 202: designerTurnReply } },
      },
      async (request, reply) => {
        const started = await runner.start(request.params.id, {
          text: request.body.text,
          by: actorOf(request),
          ...(request.body.attachments === undefined ? {} : { attachments: request.body.attachments }),
          ...(request.body.sees === true ? { sees: true } : {}),
        });
        return reply.code(202).send(started);
      },
    );

    // What the preview saw of the screen the turn built: kept for that turn to read, and nothing else is done with it.
    app.post(
      '/designer/sessions/:id/sight',
      {
        preHandler: guard,
        bodyLimit: 1_200_000,
        config: { rateLimitBucket: 'designer-files', audit: auditExempt('what the preview saw of a page changes nothing by itself; the turn that reads it is audited') },
        schema: { params: designerSessionParams, body: designerSightBody, response: { 200: designerSightReply } },
      },
      async (request) => ({ kept: designer.sawPage(store.read(request.params.id).id, request.body) }),
    );

    /*
     * A file for a message: a picture or a CSV, as raw bytes. Who is asking is
     * settled on the request's first line (`onRequest`), before a byte of the
     * body is read; the permission and the CSRF check follow as on every
     * Designer route. What the file is, is read from its bytes.
     */
    app.post(
      '/designer/sessions/:id/attachments',
      {
        onRequest: app.requireAuth,
        preHandler: guard,
        bodyLimit: ATTACHMENT_BODY_LIMIT,
        config: { rateLimitBucket: 'designer-files', audit: auditExempt('a file attached to a Designer message changes nothing by itself; the turn that carries it is audited') },
        schema: { params: designerSessionParams, querystring: designerAttachmentQuery, response: { 201: designerAttachmentReply } },
      },
      async (request, reply) => {
        const session = store.read(request.params.id);
        if (!Buffer.isBuffer(request.body)) throw new ValidationFailedError('Send the file itself as the request body.', { reason: 'ATTACHMENT' });
        try {
          // A picture's colours, as the page read them: thousandths of the picture each.
          const palette = (request.query.palette ?? '')
            .split(',')
            .filter((entry) => entry !== '')
            .map((entry) => ({ hex: `#${entry.slice(0, 6)}`, share: Math.min(1, Number(entry.slice(7)) / 1000) }));
          const made = deps.attachments.add(session.id, { filename: request.query.filename, bytes: request.body, ...(palette.length === 0 ? {} : { palette }) });
          return await reply.code(201).send({ attachment: publicAttachment(made) });
        } catch (error) {
          if (error instanceof AttachmentError) throw new ValidationFailedError(error.message, { reason: error.reason });
          throw error;
        }
      },
    );

    // The file back, for the page's own thumbnail and nothing else: its bytes can run nothing, whatever they hold.
    app.get(
      '/designer/sessions/:id/attachments/:attachment',
      { preHandler: guard, config: RATE, schema: { params: designerAttachmentParams } },
      async (request, reply) => {
        const session = store.read(request.params.id);
        const entry = deps.attachments.find(session.id, request.params.attachment);
        const bytes = entry === null ? null : deps.attachments.read(session.id, entry.id);
        if (entry === null || bytes === null) throw new NotFoundError('There is no such file in this session.');
        return reply
          .header('content-type', entry.kind === 'image' ? entry.mediaType : entry.kind === 'font' ? 'font/woff2' : 'text/csv; charset=utf-8')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .header('cache-control', 'private, max-age=3600')
          .header('content-disposition', entry.kind === 'image' ? 'inline' : `attachment; filename="attachment.${entry.kind === 'font' ? 'woff2' : 'csv'}"`)
          .send(bytes);
      },
    );

    // A picture on a pictures card, as a small copy. The card names it by ids of this server's: the address it came from never reaches the page.
    app.get(
      '/designer/sessions/:id/picture-thumb/:shelf/:picture',
      { preHandler: guard, config: { rateLimitBucket: 'designer-files' as const }, schema: { params: designerPictureThumbParams } },
      async (request, reply) => {
        const session = store.read(request.params.id);
        const thumb = (await deps.pictures?.thumb(session.id, request.params.shelf, request.params.picture)) ?? null;
        if (thumb === null) throw new NotFoundError('There is no such picture on a card of this session.');
        return reply
          .header('content-type', thumb.mime)
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .header('cache-control', 'private, max-age=3600')
          .header('content-disposition', 'inline')
          .send(thumb.bytes);
      },
    );

    app.post(
      '/designer/sessions/:id/stop',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the turn’s end is audited, with how it ended') },
        schema: { params: designerSessionParams, response: { 200: designerStopReply } },
      },
      async (request) => {
        store.read(request.params.id);
        return { stopped: runner.stop(request.params.id) };
      },
    );

    app.post(
      '/designer/sessions/:id/answers',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('an answer is an event of the session; a removal it accepts is audited by the install service') },
        schema: { params: designerSessionParams, body: designerAnswerBody, response: { 200: designerAnswerReply } },
      },
      async (request) => {
        store.read(request.params.id);
        runner.answer(request.params.id, request.body.cardId, request.body.value, actorOf(request));
        return { answered: true as const };
      },
    );

    // The catch-up read: everything after the last event a page saw. Named `-since` so it keeps its rate limit.
    app.get(
      '/designer/sessions/:id/events-since',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, querystring: designerEventsQuery, response: { 200: designerEventsReply } } },
      async (request) => {
        store.read(request.params.id);
        runner.events(request.params.id).flush();
        const { events, more } = store.eventsSince(request.params.id, request.query.after, EVENTS_PAGE);
        return { events, more, last: store.lastSeq(request.params.id) };
      },
    );

    app.get(
      '/designer/sessions/:id/versions',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, response: { 200: designerVersionsReply } } },
      async (request) => {
        store.read(request.params.id);
        const available = deps.versions !== null && (await deps.versions.available());
        return { available, versions: available && deps.versions !== null ? await deps.versions.list(request.params.id) : [] };
      },
    );

    // "Change the look": a direction written to every side, built, applied and saved. No model is called.
    app.post(
      '/designer/sessions/:id/look',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the Designer audits a change of look itself, with the direction') },
        schema: { params: designerSessionParams, body: designerLookBody, response: { 200: designerLookReply } },
      },
      async (request) => {
        const done = await designer.setLook(request.params.id, { skill: request.body.skill ?? (request.body.direction as string), accent: request.body.accent }, actorOf(request));
        return done;
      },
    );

    // "Add your own": a style's folder as a .zip, or one SKILL.md, checked and saved into the project's design-skills/.
    app.post(
      '/designer/styles',
      {
        preHandler: guard,
        onRequest: app.requireAuth,
        bodyLimit: SKILL_UPLOAD_MAX_BYTES + 64 * 1024,
        config: { rateLimitBucket: 'designer-files' as const, audit: auditExempt('the Designer audits a style added to the project itself, with its name') },
        schema: { querystring: designerStyleUploadQuery, response: { 201: designerStyleAddedReply } },
      },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) throw new ValidationFailedError('Send the file itself, as its bytes.', { reason: 'NOT_A_SKILL' });
        try {
          const added = addDesignSkill(deps.root, { filename: request.query.filename, bytes: request.body });
          await deps.audit?.('designer.style.added', actorOf(request), { style: added.key });
          return reply.code(201).send(added);
        } catch (error) {
          if (error instanceof SkillUploadError) throw new ValidationFailedError(error.message, { reason: error.reason });
          throw error;
        }
      },
    );

    // A style of the project's own, removed: its folder is deleted. An app that uses it keeps the files it was given.
    app.delete(
      '/designer/styles/:key',
      { preHandler: guard, config: { ...RATE, audit: auditExempt('the Designer audits a style removed from the project itself, with its name') }, schema: { params: designerStyleParams, response: { 200: designerStyleRemovedReply } } },
      async (request) => {
        const style = designer.styles().find((entry) => entry.key === request.params.key && entry.origin === 'project');
        if (style === undefined || !removeDesignSkill(deps.root, style.key)) throw new NotFoundError('There is no style of this project by that name.', { style: request.params.key });
        await deps.audit?.('designer.style.removed', actorOf(request), { style: style.key });
        return { removed: true as const };
      },
    );

    // A style's own small picture. Shown through <img> only, under headers that let it run nothing.
    app.get('/designer/styles/:key/preview', { preHandler: guard, config: RATE, schema: { params: designerStyleParams } }, async (request, reply) => {
      const style = designer.styles().find((entry) => entry.key === request.params.key);
      const file = style === undefined || !style.hasPreview ? null : join(style.dir, 'preview.svg');
      if (file === null || !existsSync(file) || statSync(file).size > 48 * 1024) throw new NotFoundError('That style has no picture.');
      return reply
        .header('content-type', 'image/svg+xml')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .header('cache-control', 'private, max-age=600')
        .header('content-disposition', 'inline')
        .send(readFileSync(file));
    });

    // The styles a person can pick: built in, and the project's own.
    app.get('/designer/styles', { preHandler: guard, config: RATE, schema: { response: { 200: designerStylesReply } } }, async () => ({
      styles: designer.styles().map((skill) => ({
        key: skill.key,
        title: skill.title,
        description: skill.description,
        origin: skill.origin,
        hasTheme: skill.hasTheme,
        hasPreview: skill.hasPreview,
        ...(skill.swatch === undefined ? {} : { swatch: skill.swatch }),
        ...(skill.problem === undefined ? {} : { problem: skill.problem }),
      })),
    }));

    // Going back to a version (O1: as a new version on top), or putting the files back after a stop (O3).
    app.post(
      '/designer/sessions/:id/versions/:n/restore',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('the Designer audits a restore itself, with the version it went back to') },
        schema: { params: designerVersionParams, body: designerRestoreBody, response: { 200: designerRestoreReply } },
      },
      async (request) => designer.restore(request.params.id, request.params.n, { record: request.body.record, by: actorOf(request) }),
    );

    /*
     * The Code tab: the files of the app a person may open and change by hand. The list is the server's and is made
     * afresh for every call; a path is opened or saved only when it is on it. A save is all or none, runs the engine's
     * check, build and apply, and is kept as a version named for the files. None of the three calls a model.
     */
    app.get(
      '/designer/sessions/:id/files',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, response: { 200: designerFilesReply } } },
      async (request, reply) => reply.header('cache-control', 'no-store').send(await designer.listFiles(request.params.id)),
    );
    app.get(
      '/designer/sessions/:id/files/content',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, querystring: designerFileQuery, response: { 200: designerFileReply } } },
      async (request, reply) => reply.header('cache-control', 'no-store').send(await designer.readFile(request.params.id, request.query.path)),
    );
    app.put(
      '/designer/sessions/:id/files',
      {
        preHandler: guard,
        bodyLimit: FILES_SAVE_BODY_BYTES,
        config: { ...RATE, audit: auditExempt('the Designer audits a hand save itself, with the files and the version it made') },
        schema: { params: designerSessionParams, body: designerFilesSaveBody, response: { 200: designerFilesSaveReply } },
      },
      async (request) => designer.saveFiles(request.params.id, request.body.files, actorOf(request)),
    );

    // The preview's way in: a one-use ticket, spent on the preview's own name for a session that holds only the app's roles.
    app.post(
      '/designer/sessions/:id/preview-ticket',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a preview ticket signs in a user that holds only the app’s own roles, for a minute') },
        schema: { params: designerSessionParams, body: designerPreviewBody, response: { 200: designerPreviewReply } },
      },
      async (request) => {
        const session = store.read(request.params.id);
        if (deps.preview === null) throw new NotFoundError('This server has no preview.', { reason: 'NO_PREVIEW' });
        const to = safeTarget(request.body.to, session.appKey);
        if (to === null) throw new NotFoundError('That is not a page of this app.', { to: request.body.to });
        const ticket = deps.preview.tickets.issue(session.appKey);
        const url = `${deps.preview.origin}/designer-preview/enter?ticket=${ticket}&to=${encodeURIComponent(to)}`;
        return { url, origin: deps.preview.origin, seenAs: (await deps.previewRoles?.(session.appKey)) ?? [] };
      },
    );

    // The Architecture tab: read only, from what the engine applied.
    app.get(
      '/designer/sessions/:id/architecture',
      { preHandler: guard, config: RATE, schema: { params: designerSessionParams, response: { 200: designerArchitectureReply } } },
      async (request) => {
        const session = store.read(request.params.id);
        if (deps.architecture === undefined) throw new NotFoundError('This server cannot draw the app.', { reason: 'NO_ARCHITECTURE' });
        return deps.architecture(session.appKey);
      },
    );

    // "Start with an app": the adminium.dev list, installable apps only, read on the server and kept an hour.
    let listed: { at: number; apps: z.infer<typeof designerCatalogApp>[] } | null = null;
    app.get('/designer/apps', { preHandler: guard, config: RATE, schema: { response: { 200: designerAppsListReply } } }, async () => {
      if (deps.appCatalog === undefined || !(await deps.appCatalog.isEnabled())) return { state: 'off' as const, apps: [] };
      if (listed !== null && Date.now() - listed.at < CATALOG_CACHE_MS) return { state: 'ok' as const, apps: listed.apps };
      try {
        const catalog = await deps.appCatalog.fetchCatalog(AbortSignal.timeout(10_000));
        const apps = catalog.apps.map((entry) => ({
          key: entry.key,
          version: entry.version,
          name: pickLocalized(entry.name, 'en-US') ?? entry.key,
          tagline: pickLocalized(entry.tagline, 'en-US') ?? '',
          category: entry.categories[0] ?? null,
          sides: entry.sides,
          copyable: typeof entry.repo === 'string' && sourceArchiveUrl(entry.repo, entry.version) !== null,
          iconTint: entry.iconTint ?? null,
          iconPaths: entry.iconPaths ?? [],
          monogram: entry.monogram ?? null,
        }));
        listed = { at: Date.now(), apps };
        return { state: 'ok' as const, apps };
      } catch {
        return { state: 'unreachable' as const, apps: [] };
      }
    });

    // "Start with an app": the copy's key as it is typed, then the copy itself as a job the sheet watches.
    app.get(
      '/designer/start-check',
      { preHandler: guard, config: RATE, schema: { querystring: designerStartCheckQuery, response: { 200: designerStartCheckReply } } },
      async (request) => {
        if (deps.starter === undefined) throw new NotFoundError('This server cannot copy an app.', { reason: 'NO_STARTER' });
        const problem = await deps.starter.keyProblem(request.query.newKey);
        return { problem, build: problem === null ? deps.starter.buildFor(request.query.newKey) : null };
      },
    );
    app.post(
      '/designer/start',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a copy is audited by the Designer itself, once it is applied') },
        schema: { body: designerStartBody, response: { 202: designerStartJob } },
      },
      async (request, reply) => {
        if (deps.starter === undefined) throw new NotFoundError('This server cannot copy an app.', { reason: 'NO_STARTER' });
        // A copy's build is a command this server runs: on a live server, approving one is a Super Admin's.
        if (onLive && !(await app.rbac.resolve(request)).superAdmin) {
          throw new ForbiddenError('On a live server, only a Super Admin copies an app: its build is a command the server runs.', 'FORBIDDEN', { reason: 'SUPER_ADMIN' });
        }
        const job = await deps.starter.start({ ...request.body, by: actorOf(request) });
        return reply.code(202).send(job);
      },
    );
    app.get(
      '/designer/start-status/:jobId',
      { preHandler: guard, config: RATE, schema: { params: designerStartParams, response: { 200: designerStartJob } } },
      async (request) => {
        if (deps.starter === undefined) throw new NotFoundError('This server cannot copy an app.', { reason: 'NO_STARTER' });
        return deps.starter.job(request.params.jobId);
      },
    );

    // The models the picker lists: every connection with its models, the selected one, what is known to build.
    app.get('/designer/models', { preHandler: guard, config: RATE, schema: { response: { 200: designerModelsReply } } }, async () => {
      const all = await connections.list();
      const listedModels = await Promise.all(
        all.map(async (connection) => {
          try {
            const { models, source } = await connections.models(connection.id);
            const withSelected = connection.model !== null && !models.some((model) => model.id === connection.model) ? [{ id: connection.model, label: connection.model }, ...models] : models;
            return { id: connection.id, provider: connection.provider, source: connection.source, state: source === 'live' || withSelected.length > 0 ? ('ok' as const) : ('unreachable' as const), models: withSelected };
          } catch {
            return { id: connection.id, provider: connection.provider, source: connection.source, state: 'unreachable' as const, models: connection.model === null ? [] : [{ id: connection.model, label: connection.model }] };
          }
        }),
      );
      const chosen = await connections.default();
      const selected = (() => {
        const env = parseSelected(connections.selected() ?? undefined);
        if (env !== null && all.some((connection) => connection.id === `env:${env.provider}`)) return { connectionId: `env:${env.provider}`, model: env.model };
        return chosen === null || chosen.model === null ? null : { connectionId: chosen.connection.id, model: chosen.model };
      })();
      const verdicts = listedModels.flatMap((connection) =>
        connection.models.flatMap((model) => {
          const verdict = connections.verdict(connection.id as ConnectionId, model.id);
          return verdict === null ? [] : [{ connectionId: connection.id, model: model.id, canBuild: verdict.canBuild, message: verdict.canBuild ? null : verdict.message }];
        }),
      );
      return { connections: listedModels, selected, verdicts, canAdd: connections.envWritable && !onLive };
    });

    // Whether one model can build: a round trip, kept for the process (Q15).
    app.post(
      '/designer/models/check',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a check calls the model and saves nothing') },
        schema: { body: designerModelCheckBody, response: { 200: designerModelCheckReply } },
      },
      async (request) => {
        if ((await connections.find(request.body.connectionId)) === null) throw new NotFoundError('There is no such model connection.', { connectionId: request.body.connectionId });
        const verdict = await connections.canBuildWith(request.body.connectionId as ConnectionId, request.body.model);
        if (verdict.canBuild) return { canBuild: true, message: null };
        return { canBuild: verdict.reason === 'error' ? null : false, message: verdict.message };
      },
    );

    // Whether a model reads pictures: asked when a person first attaches one, kept for the process's life.
    app.post(
      '/designer/models/reads-images',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a check calls the model and saves nothing') },
        schema: { body: designerReadsImagesBody, response: { 200: designerReadsImagesReply } },
      },
      async (request) => {
        if ((await connections.find(request.body.connectionId)) === null) throw new NotFoundError('There is no such model connection.', { connectionId: request.body.connectionId });
        return { readsImages: await connections.readsImages(request.body.connectionId as ConnectionId, request.body.model) };
      },
    );

    // Models: try one without saving it, and keep one in the project's .env.
    app.post(
      '/designer/connections/test',
      {
        preHandler: guard,
        config: { ...RATE, audit: auditExempt('a test saves nothing') },
        schema: { body: designerConnectionDraft, response: { 200: designerConnectionTestReply } },
      },
      async (request) => {
        refuseOnLive();
        return connections.test(request.body);
      },
    );

    app.put(
      '/designer/connections',
      { preHandler: guard, config: RATE, schema: { body: designerConnectionSaveBody, response: { 200: designerConnectionReply } } },
      async (request) => {
        refuseOnLive();
        const saved = await connections.save(request.body);
        // Provider and model only: the key is never in an audit entry.
        await app.rbac.audit(request, {
          category: 'llm',
          action: 'designer.model.saved',
          changes: { after: { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl } },
        });
        return saved;
      },
    );
  };
}
