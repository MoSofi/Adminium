// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own screens as a file, both ways.
 *
 *  - `POST /project/apps/:key/pack` — Download: a project app checked,
 *    built and packed at the version asked (never lower than its folder's;
 *    a higher one is written back first), its folder going along as
 *    `source/` without anything that runs. The file is kept in the project's
 *    `.adminium/packs/`.
 *  - `GET /project/apps/:key/pack/:version` — that file.
 *  - `GET /apps/:key/editable` — whether this install's screens can be made
 *    editable here, and if not, why.
 *  - `POST /apps/:key/editable` — copy them into `apps/<key>/`: the app
 *    comes from the project folder from then on.
 *
 * All of them need `system:manifests:manage`, as installing does. The
 * `/apps/:key/*` pair picks its install the way every app route does (the
 * `X-Adminium-Install` header or `?connectionId=`) before anything else.
 */
import { readFileSync } from 'node:fs';

import { auditRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { FOLDER_SOURCE } from '../../apps/install-service.js';
import type { AppStore } from '../../apps/store.js';
import { audited } from '../../audit/coverage.js';
import { NotFoundError, ValidationFailedError } from '../../errors.js';
import { installsOf, requireInstall, selectorOf } from '../../installs/resolve.js';
import type { LoadBundler } from '../../project/build.js';
import { copySourceToFolder, editableState, type EditableRefusal } from '../../project/apps/make-editable.js';
import { keptPack, packFolderApp, PackFolderRefused } from '../../project/apps/pack-folder.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { editableReply, makeEditableReply, ownAppKeyParams, packAppBody, packAppReply, packFileParams } from './own-surfaces-schema.js';

export interface OwnSurfaceRoutesDeps {
  meta: MetaDb;
  store: AppStore;
  /** The project folder this server runs, or null. */
  projectRoot: string | null;
  /** The running Adminium. */
  adminiumVersion: string;
  /** The server's display name: where a packed file says it was made. Never a host name. */
  displayName: () => Promise<string | null>;
  /** Tests only: the bundler a side is built with. */
  loadBundler?: LoadBundler | undefined;
  /**
   * Build the project's apps and apply them, as a change to the folder does
   * under `adminium dev`: run after a folder is made from an install. Absent
   * where nothing builds the folder on its own.
   */
  refreshProject?: (() => Promise<void>) | undefined;
  log?: ((message: string) => void) | undefined;
}

/** The sentence for each refusal of Make it editable here. */
function editableRefusal(reason: EditableRefusal, key: string, installs: number | undefined): ValidationFailedError {
  const said: Record<EditableRefusal, string> = {
    NO_PROJECT: 'Editing screens needs a project folder. Open this server with the Designer to make one.',
    FOLDER_EXISTS: `apps/${key}/ already exists here. Rename or remove that folder first.`,
    SEVERAL_INSTALLS: `"${key}" is installed on ${String(installs ?? 2)} databases. Remove the others first.`,
    FROM_FOLDER: `"${key}" already comes from the project folder (apps/${key}/).`,
  };
  return new ValidationFailedError(said[reason], { reason, ...(installs === undefined ? {} : { installs }) });
}

export function ownSurfaceRoutes(deps: OwnSurfaceRoutesDeps): FastifyPluginAsyncZod {
  const manifests = installsOf(deps.meta);
  const connectionNames = async (): Promise<Map<string, string>> =>
    new Map((await deps.meta.db.selectFrom('adminium_connections').select(['id', 'name']).execute()).map((row) => [row.id, row.name]));

  const audit = async (request: FastifyRequest, action: string, after: Record<string, unknown>): Promise<void> => {
    await auditRepo(deps.meta).append({
      actorKind: 'user',
      actorId: request.user?.id ?? null,
      actorLabel: request.user?.email ?? 'unknown',
      category: 'app',
      action,
      changes: { after },
    });
  };

  const projectRootOr404 = (): string => {
    if (deps.projectRoot === null) {
      throw new NotFoundError('This server runs no project folder, so it has no app of its own to pack.', { reason: 'NO_PROJECT' });
    }
    return deps.projectRoot;
  };

  return async (app) => {
    app.post(
      '/project/apps/:key/pack',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: ownAppKeyParams, body: packAppBody, response: { 200: packAppReply } },
      },
      async (request) => {
        const root = projectRootOr404();
        const { key } = request.params;
        let packed;
        try {
          packed = await packFolderApp({
            root,
            key,
            version: request.body.version,
            label: await deps.displayName().catch(() => null),
            adminiumVersion: deps.adminiumVersion,
            loadBundler: deps.loadBundler,
          });
        } catch (error) {
          if (!(error instanceof PackFolderRefused)) throw error;
          if (error.reason === 'NOT_A_PROJECT_APP') throw new NotFoundError(error.message, { reason: error.reason });
          throw new ValidationFailedError(error.message, { reason: error.reason, ...error.details });
        }
        // What was packed, never what is in it.
        await audit(request, 'app.packed', { key, version: packed.version, integrity: packed.integrity, bytes: packed.bytes });
        return {
          key,
          version: packed.version,
          fileName: packed.fileName,
          bytes: packed.bytes,
          integrity: packed.integrity,
          fileCount: packed.fileCount,
        };
      },
    );

    app.get(
      '/project/apps/:key/pack/:version',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: packFileParams },
      },
      async (request, reply) => {
        const root = projectRootOr404();
        const { key, version } = request.params;
        const kept = keptPack(root, key, version);
        if (kept === null) throw new NotFoundError(`${key} ${version} was not packed here. Download it first.`, { reason: 'NOT_PACKED' });
        const bytes = readFileSync(kept.file);
        return reply
          .header('content-type', 'application/gzip')
          .header('content-length', String(bytes.byteLength))
          .header('content-disposition', `attachment; filename="${key}-${version}.tgz"`)
          .header('x-adminium-integrity', kept.integrity ?? '')
          .send(bytes);
      },
    );

    app.get(
      '/apps/:key/editable',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: ownAppKeyParams, response: { 200: editableReply } },
      },
      async (request) => {
        const { key } = request.params;
        const install = await requireInstall(manifests, key, selectorOf(request), { kind: 'app', connectionNames });
        return editableState({ install, installs: await manifests.listByKey(key), store: deps.store, projectRoot: deps.projectRoot, folderSource: FOLDER_SOURCE });
      },
    );

    app.post(
      '/apps/:key/editable',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: ownAppKeyParams, response: { 200: makeEditableReply } },
      },
      async (request) => {
        const { key } = request.params;
        const install = await requireInstall(manifests, key, selectorOf(request), { kind: 'app', connectionNames });
        const state = await editableState({ install, installs: await manifests.listByKey(key), store: deps.store, projectRoot: deps.projectRoot, folderSource: FOLDER_SOURCE });
        if (state.state === 'none') {
          throw new ValidationFailedError(`This file of "${key}" carries no source, so there is nothing to make editable.`, { reason: 'NO_SOURCE' });
        }
        if (state.state === 'refused' || deps.projectRoot === null) throw editableRefusal(state.reason ?? 'NO_PROJECT', key, state.installs);
        const { files } = await copySourceToFolder(deps.store, deps.projectRoot, key, install.row.version);
        // From now on the app is the folder's: the project's reconcile applies it, and uploads of the key are refused.
        await manifests.setSource(install.row.id, FOLDER_SOURCE);
        await audit(request, 'app.made-editable', { key, version: install.row.version, folder: state.folder, files });
        if (deps.refreshProject !== undefined) {
          try {
            await deps.refreshProject();
          } catch (error) {
            // The folder is there; the next build of the project applies it.
            deps.log?.(`apps/${key}/ was made from the installed app, and building it failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return { key, folder: state.folder };
      },
    );
  };
}

