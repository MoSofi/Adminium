// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WORKSPACE FILES ARRIVING: upload, review and install.
 *
 *  - `POST /apps/upload-workspace` takes a workspace file whole (its own
 *    limits: 128 MB, ten members, each app file at most 32 MB, read one
 *    member at a time), checks it whole, then stages each app file through
 *    the upload's own staging with its fingerprint. A refusal of one app is
 *    reported on its row; the others stage. The reply is the row the review
 *    reads.
 *  - `GET /apps/workspace-files` lists the files staged and not finished, so
 *    the review survives a reload; `GET /apps/workspace/:id/install` reads one.
 *  - `POST /apps/workspace/:id/install` runs the install: one run at a time
 *    per row; running it again installs the rest.
 *  - `DELETE /apps/workspace/:id/install` throws the staged file away.
 *
 * All of them need `system:manifests:manage`, as installing an app does.
 * Choosing a workspace needs managing connections besides.
 */
import { WORKSPACE_FILE_FLOOR, compareSemver, workspaceFileKey } from '@adminium/manifest';
import { connectionsRepo, workspaceInstallsRepo, type WorkspaceInstall } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AddOnArchiveError } from '../../add-ons/archive.js';
import { refusalReason } from '../../add-ons/upload-refusal.js';
import type { AppRoutesDeps } from '../../apps/install-service.js';
import { checkWorkspaceFile, eachWorkspaceApp, integrityOf, WORKSPACE_UPLOAD_BODY_LIMIT } from '../../apps/workspace-files.js';
import { createWorkspaceInstaller, documentOf, type AppCopy } from '../../apps/workspace-install.js';
import { audited } from '../../audit/coverage.js';
import { AppError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { WORKSPACES_CHANGED } from '../workspaces/index.js';
import { installAppBody, stagedAppReply, updateAppBody, uploadAppQuery } from './schema.js';

const appKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);

export const uploadWorkspaceQuery = uploadAppQuery.pick({ expectedSha512: true });

const workspaceFileApp = z.object({
  key: appKey,
  /** The app's name, once its file was read; its key until then. */
  name: z.string(),
  version: z.string(),
  integrity: z.string(),
  /** The database it was saved from, as the file says: only a hint for "Install on". */
  database: z.object({ name: z.string(), engine: z.string() }).nullable(),
  /** A connected database with that name and engine, when there is one: the "Install on" to start with. */
  suggested: z.string().nullable(),
  /** The database chosen to install on; null until chosen. */
  target: z.string().nullable(),
  state: z.enum(['pending', 'installed', 'updated', 'refused', 'stopped']),
  /** Why it was refused, or where it stopped, when it was. */
  refusal: z.object({ reason: z.string(), message: z.string() }).nullable(),
  /**
   * Where it goes on this server, as an app file uploaded alone says: nowhere
   * yet (`install`), over every copy (`update`), or beside the copies at its
   * version (`install-another`).
   */
  route: z.enum(['install', 'update', 'install-another']),
  /** The copies already installed, each on its database. */
  installs: z.array(z.object({ installId: z.string(), connectionId: z.string().nullable(), connectionName: z.string(), version: z.string() })),
});

const workspaceFileDto = z.object({
  id: z.string(),
  name: z.string(),
  /** Where it was made, when it was saved, and on which Adminium (null on a row without its document). */
  label: z.string().nullable(),
  savedAt: z.string().nullable(),
  adminiumVersion: z.string().nullable(),
  minAdminiumVersion: z.string(),
  /** The fingerprint of the file as uploaded: `sha512-` + base64. */
  integrity: z.string(),
  state: z.enum(['staged', 'running', 'stopped', 'done', 'discarded']),
  /** The workspace chosen, once a run chose one. */
  workspace: z.object({ mode: z.enum(['create', 'existing', 'none']), workspaceId: z.string().optional(), name: z.string().optional() }).nullable(),
  apps: z.array(workspaceFileApp),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** The upload's reply, and every read of a staged workspace file. */
export const stagedWorkspaceReply = z.object({ workspaceFile: workspaceFileDto });
export const workspaceFilesReply = z.object({ workspaceFiles: z.array(workspaceFileDto) });
export const workspaceFileParams = z.object({ id: z.string().min(1).max(64) });

export const installWorkspaceBody = z
  .object({
    /** For connection managers: create a workspace, add to an existing one, or none (the default). */
    workspace: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('create'), name: z.string().trim().min(1).max(80) }).strict(),
        z.object({ mode: z.literal('existing'), workspaceId: z.string().min(1) }).strict(),
        z.object({ mode: z.literal('none') }).strict(),
      ])
      .optional(),
    apps: z
      .array(
        z
          .object({
            key: appKey,
            /** An existing database; null leaves the app for later. */
            connectionId: z.string().min(1).nullable(),
            /** The app's review answers for an install, as `POST /apps/install` takes them. */
            install: installAppBody.omit({ key: true, version: true, connectionId: true }).optional(),
            /** The app's review answers for an update of its copies, as `POST /apps/:key/update` takes them. */
            update: updateAppBody.optional(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export interface WorkspaceFileRoutesDeps {
  deps: AppRoutesDeps;
  serverVersion: string;
  stageAppFile: (input: {
    body: Buffer;
    asserted: { key?: string | undefined; version?: string | undefined; expectedSha512: string };
    userId: string | null;
    userLabel: string;
    source?: 'upload' | 'workspace-file';
  }) => Promise<z.infer<typeof stagedAppReply>>;
  copiesOf: (key: string) => Promise<{ installId: string; connectionId: string | null; connectionName: string; version: string }[]>;
  install: (request: FastifyRequest, body: z.infer<typeof installAppBody>) => Promise<unknown>;
  update: (request: FastifyRequest, input: { key: string; installId: string; connectionId: string | null; body: z.infer<typeof updateAppBody> }) => Promise<unknown>;
  auditAppEvent: (action: string, after: Record<string, unknown>, userId: string | null, userLabel: string) => Promise<void>;
}

const CONNECTIONS_MANAGE = 'system:connections:manage';

export function workspaceFileRoutes(w: WorkspaceFileRoutesDeps): FastifyPluginAsyncZod {
  const { deps } = w;
  const installs = workspaceInstallsRepo(deps.meta);

  /** The row as the review reads it: each app with where it goes now and the database it may start on. */
  async function dto(row: WorkspaceInstall): Promise<z.infer<typeof workspaceFileDto>> {
    const document = documentOf(row);
    const connections = await connectionsRepo(deps.meta, deps.credentialCrypto).list();
    const apps = [];
    for (const app of row.apps) {
      const entry = document?.apps.find((one) => one.key === app.key);
      const copies = await w.copiesOf(app.key);
      const route = copies.length === 0 ? ('install' as const) : copies.some((copy) => compareSemver(app.version, copy.version) > 0) ? ('update' as const) : ('install-another' as const);
      const suggested = entry === undefined ? undefined : connections.find((one) => one.name === entry.database.name && one.engine === entry.database.engine);
      apps.push({
        key: app.key,
        name: app.name ?? app.key,
        version: app.version,
        integrity: app.integrity,
        database: entry === undefined ? null : { name: entry.database.name, engine: entry.database.engine },
        suggested: suggested?.id ?? null,
        target: app.target,
        state: app.state,
        refusal: app.state === 'refused' || app.state === 'stopped' ? { reason: app.reason ?? 'REFUSED', message: app.error ?? '' } : null,
        route,
        installs: copies.map((copy) => ({ installId: copy.installId, connectionId: copy.connectionId, connectionName: copy.connectionName, version: copy.version })),
      });
    }
    return {
      id: row.id,
      name: row.name,
      label: document?.label ?? null,
      savedAt: document?.savedAt ?? null,
      adminiumVersion: document?.adminiumVersion ?? null,
      minAdminiumVersion: document?.minAdminiumVersion ?? WORKSPACE_FILE_FLOOR,
      integrity: row.integrity,
      state: row.state,
      workspace: row.workspaceChoice === null ? null : { mode: row.workspaceChoice.mode, ...(row.workspaceChoice.workspaceId === undefined ? {} : { workspaceId: row.workspaceChoice.workspaceId }), ...(row.workspaceChoice.name === undefined ? {} : { name: row.workspaceChoice.name }) },
      apps,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function installerFor(request: FastifyRequest) {
    return createWorkspaceInstaller({
      meta: deps.meta,
      stagedIntegrity: async (key, version) => {
        try {
          return (await deps.store.verifyTree(key, version)).integrity;
        } catch {
          return null;
        }
      },
      discardStaged: (key, version) => deps.store.removeVersion(key, version),
      copiesOf: async (key): Promise<AppCopy[]> => (await w.copiesOf(key)).map((copy) => ({ installId: copy.installId, connectionId: copy.connectionId, version: copy.version })),
      install: async ({ key, version, connectionId, answers }) => {
        await w.install(request, { ...(answers as object), key, version, connectionId } as z.infer<typeof installAppBody>);
      },
      update: async ({ key, installId, connectionId, answers }) => {
        await w.update(request, { key, installId, connectionId, body: answers as z.infer<typeof updateAppBody> });
      },
      connectionExists: async (connectionId) => (await connectionsRepo(deps.meta, deps.credentialCrypto).findById(connectionId)) !== null,
      workspacesChanged: async () => {
        if (request.server.hasDecorator('realtime')) request.server.realtime.publish('config-changed', WORKSPACES_CHANGED, {});
      },
    });
  }

  return async (app) => {
    app.post(
      '/apps/upload-workspace',
      {
        // As the app upload: the cheap guard before up to 128 MB is buffered, then the grant.
        onRequest: app.requireAuth,
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        bodyLimit: WORKSPACE_UPLOAD_BODY_LIMIT,
        schema: { querystring: uploadWorkspaceQuery, response: { 200: stagedWorkspaceReply } },
      },
      async (request) => {
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw new ValidationFailedError('Send the workspace file as a raw `application/octet-stream` body: the .workspace.tgz Save workspace made.');
        }
        const userId = request.user?.id ?? null;
        const userLabel = request.user?.email ?? 'unknown';
        const refused = async (reason: string): Promise<void> => {
          await w.auditAppEvent('app.workspace-refused', { reason, bytes: body.byteLength }, userId, userLabel);
        };
        const integrity = integrityOf(body);
        if (integrity !== request.query.expectedSha512) {
          await refused('INTEGRITY_MISMATCH');
          throw new ValidationFailedError('The workspace file does not match the fingerprint it was sent with.', { reason: 'INTEGRITY_MISMATCH' });
        }
        let checked;
        try {
          checked = await checkWorkspaceFile(body, w.serverVersion);
        } catch (error) {
          await refused(refusalReason(error));
          if (error instanceof AddOnArchiveError) {
            throw new ValidationFailedError(`This file could not be read as a workspace file (${error.reason}).`, { reason: error.reason });
          }
          throw error;
        }
        const { file } = checked;

        // Each app file staged as an upload stages it, with the fingerprint the file gives: refused alone, or staged.
        const results = new Map<string, { name: string } | { reason: string; message: string }>();
        await eachWorkspaceApp(body, file, async (entry, member) => {
          try {
            const staged = await w.stageAppFile({ body: Buffer.from(member), asserted: { key: entry.key, version: entry.version, expectedSha512: entry.integrity }, userId, userLabel, source: 'workspace-file' });
            results.set(entry.key, { name: staged.name });
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            results.set(entry.key, { reason: refusalReason(error), message: error.message });
          }
        });
        const row = await installs.create({
          integrity: checked.integrity,
          staged: workspaceFileKey(file.name, file.savedAt),
          name: file.name,
          document: checked.document,
          createdBy: userId,
          apps: file.apps.map((entry) => {
            const result = results.get(entry.key);
            const base = { key: entry.key, version: entry.version, integrity: entry.integrity, target: null };
            if (result !== undefined && 'name' in result) return { ...base, name: result.name, state: 'pending' as const };
            return { ...base, state: 'refused' as const, reason: result?.reason ?? 'NOT_READ', error: result?.message ?? '' };
          }),
        });
        await w.auditAppEvent('app.workspace-staged', { id: row.id, name: file.name, integrity: checked.integrity, apps: file.apps.map((one) => `${one.key}@${one.version}`), refused: row.apps.filter((one) => one.state === 'refused').map((one) => one.key) }, userId, userLabel);
        return { workspaceFile: await dto(row) };
      },
    );

    app.get(
      '/apps/workspace-files',
      { preHandler: app.rbac.require(PERMISSIONS.manifestsManage), schema: { response: { 200: workspaceFilesReply } } },
      async () => {
        const out = [];
        for (const row of await installs.listOpen()) out.push(await dto(row));
        return { workspaceFiles: out };
      },
    );

    app.get(
      '/apps/workspace/:id/install',
      { preHandler: app.rbac.require(PERMISSIONS.manifestsManage), schema: { params: workspaceFileParams, response: { 200: stagedWorkspaceReply } } },
      async (request) => ({ workspaceFile: await dto(await installerFor(request).find(request.params.id)) }),
    );

    app.post(
      '/apps/workspace/:id/install',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: workspaceFileParams, body: installWorkspaceBody, response: { 200: stagedWorkspaceReply } },
      },
      async (request) => {
        const managesConnections = typeof request.can !== 'function' || (await request.can(CONNECTIONS_MANAGE as never));
        const row = await installerFor(request).run(request.params.id, request.body, { userId: request.user?.id ?? null, managesConnections });
        await w.auditAppEvent(
          'app.workspace-installed',
          { id: row.id, name: row.name, state: row.state, workspace: row.workspaceChoice, apps: row.apps.map((one) => ({ key: one.key, version: one.version, target: one.target, state: one.state, ...(one.reason === undefined ? {} : { reason: one.reason }) })) },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return { workspaceFile: await dto(row) };
      },
    );

    app.delete(
      '/apps/workspace/:id/install',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: workspaceFileParams, response: { 200: stagedWorkspaceReply } },
      },
      async (request) => {
        const row = await installerFor(request).discard(request.params.id);
        await w.auditAppEvent('app.workspace-discarded', { id: row.id, name: row.name }, request.user?.id ?? null, request.user?.email ?? 'unknown');
        return { workspaceFile: await dto(row) };
      },
    );
  };
}

