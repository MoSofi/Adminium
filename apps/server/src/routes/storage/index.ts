// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage-destination routes, mounted under `/api/v1`.
 *
 * ONE GRANT GUARDS THE WHOLE GROUP: `storage.manage`. A destination carries a
 * credential and decides where every byte on the instance lands, so it is not
 * `settings.manage` (D10) and it is emphatically not `files.manage` — an admin
 * who may tidy other people's uploads has no business pointing the instance's
 * storage at a bucket they control.
 *
 * THE SECRET NEVER COMES BACK. Reads carry `hasSecret`; the write path takes
 * one and forgets it. `PATCH` without a `secret` key keeps what is stored,
 * which is what lets the editor render a destination it cannot see the
 * credential for and save a name change without one.
 *
 * TEST IS A 200 EVEN WHEN IT FAILS. "I could not reach your bucket" is a
 * successful answer to "can you reach my bucket". A 4xx would route the
 * provider's own message — `SignatureDoesNotMatch`, `NoSuchBucket`, a TLS
 * error — through an error boundary that discards it, and that message is the
 * only part an operator can act on.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  DestinationInUseError,
  destinationsRepo,
  filesRepo,
  type DsnCrypto,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
  type StorageDestination,
} from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { LOCAL_DESTINATION_ID, type DestinationResolver } from '../../files/destinations.js';
import { FILES_MIGRATE_KIND } from '../../jobs/files-migrate.js';
import {
  destinationCreateBody,
  destinationIdParams,
  destinationPatchBody,
  destinationReply,
  destinationTestDraftBody,
  destinationTestReply,
  destinationsListReply,
  storageMigrateBody,
  storageMigrateReply,
  type DestinationView,
} from './schema.js';

export const STORAGE_MANAGE_PERMISSION = 'system:storage:manage';

export interface StorageRoutesDeps {
  meta: MetaDb;
  storageCrypto: DsnCrypto;
  destinations: DestinationResolver;
  enqueue: (input: EnqueueJobInput) => Promise<Job>;
}

export function storageRoutes(deps: StorageRoutesDeps): FastifyPluginAsyncZod {
  const { meta, storageCrypto, destinations: resolver } = deps;
  const repo = destinationsRepo(meta, storageCrypto);
  const files = filesRepo(meta);

  async function toView(row: StorageDestination): Promise<DestinationView> {
    return {
      id: row.id,
      name: row.name,
      driver: row.driver,
      config: row.config,
      hasSecret: row.hasSecret,
      isDefault: row.isDefault,
      status: row.status,
      lastTestedAt: row.lastTestedAt,
      lastError: row.lastError,
      disabled: row.disabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      fileCount: await repo.countFiles(row.id),
    };
  }

  async function load(id: string): Promise<StorageDestination> {
    const row = await repo.findById(id);
    if (row === null) throw new NotFoundError(`Storage destination ${id} not found.`);
    return row;
  }

  /** `local` on the wire is the implicit destination; every other value is an id. */
  function toDestinationId(value: string | null): string | null {
    return value === null || value === LOCAL_DESTINATION_ID ? null : value;
  }

  return async (app) => {
    app.addHook('preHandler', app.rbac.require(STORAGE_MANAGE_PERMISSION));

    app.get(
      '/storage/destinations',
      { schema: { response: { 200: destinationsListReply } } },
      async () => ({ data: await Promise.all((await repo.list()).map(toView)) }),
    );

    app.post(
      '/storage/destinations',
      {
        config: { audit: audited('rbac') },
        schema: { body: destinationCreateBody, response: { 201: destinationReply } },
      },
      async (request, reply) => {
        // A remote driver with no credential is almost always a mistake, and it
        // fails later as an opaque 403 from the provider. WebDAV is the
        // exception: an anonymous share behind a VPN is a real configuration.
        if (request.body.driver === 's3' && request.body.secret === undefined) {
          throw new ValidationFailedError('An S3 destination needs an access key and a secret key.', {
            secret: 'required',
          });
        }
        const created = await repo.create(
          {
            name: request.body.name,
            driver: request.body.driver,
            config: request.body.config,
            ...(request.body.secret === undefined ? {} : { secret: request.body.secret }),
            createdBy: request.user?.id ?? null,
            ...(request.body.makeDefault === undefined ? {} : { makeDefault: request.body.makeDefault }),
          },
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.destination.create',
          // The config, never the secret — the same redaction the DSN path applies.
          changes: { after: { destinationId: created.id, name: created.name, driver: created.driver } },
        });
        return reply.status(201).send({ data: await toView(created) });
      },
    );

    app.patch(
      '/storage/destinations/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: destinationIdParams, body: destinationPatchBody, response: { 200: destinationReply } },
      },
      async (request) => {
        const before = await load(request.params.id);
        const updated = await repo.update(
          before.id,
          {
            ...(request.body.name === undefined ? {} : { name: request.body.name }),
            ...(request.body.config === undefined ? {} : { config: request.body.config }),
            ...(request.body.secret === undefined ? {} : { secret: request.body.secret }),
            ...(request.body.disabled === undefined ? {} : { disabled: request.body.disabled }),
          },
          app.rbac.now(),
        );
        if (updated === null) throw new NotFoundError(`Storage destination ${before.id} not found.`);
        // The resolver caches drivers by id + updatedAt, so an edit takes effect
        // on the next request; clearing here additionally covers a config change
        // that did not move `updatedAt` (there is none today, and relying on
        // that would be a trap for the next person).
        resolver.clearCache();
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.destination.update',
          changes: {
            before: { name: before.name, disabled: before.disabled },
            after: {
              name: updated.name,
              disabled: updated.disabled,
              // Says WHETHER the credential changed, never what it changed to.
              secretReplaced: request.body.secret !== undefined,
            },
          },
        });
        return { data: await toView(updated) };
      },
    );

    app.delete(
      '/storage/destinations/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: destinationIdParams, response: { 200: destinationReply } },
      },
      async (request) => {
        const row = await load(request.params.id);
        const view = await toView(row);
        try {
          await repo.remove(row.id);
        } catch (error) {
          if (error instanceof DestinationInUseError) {
            // The count is the whole value of this refusal: "12 files live
            // here" is actionable, a constraint violation is not (D20).
            throw new ConflictError(
              `This destination still holds ${String(error.fileCount)} file(s). Move them to another destination first.`,
              'CONFLICT',
              { fileCount: error.fileCount, destinationId: row.id },
            );
          }
          throw error;
        }
        resolver.clearCache();
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.destination.delete',
          changes: { before: { destinationId: row.id, name: row.name, driver: row.driver } },
        });
        return { data: view };
      },
    );

    app.post(
      '/storage/destinations/:id/test',
      {
        config: { audit: audited('rbac') },
        schema: { params: destinationIdParams, response: { 200: destinationTestReply } },
      },
      async (request) => {
        const row = await load(request.params.id);
        // Through the resolver, so the probe exercises exactly the driver a real
        // upload would get — including the stored credential, which is the half
        // that is usually wrong.
        const driver = await resolver.driverFor(row.id);
        const result = await driver.probe();
        await repo.recordProbe(
          row.id,
          result.ok ? { ok: true } : { ok: false, error: result.error },
          app.rbac.now(),
        );
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.destination.test',
          changes: { after: { destinationId: row.id, ok: result.ok } },
        });
        return { data: result };
      },
    );

    app.post(
      '/storage/destinations/test',
      {
        config: { audit: audited('rbac') },
        schema: { body: destinationTestDraftBody, response: { 200: destinationTestReply } },
      },
      async (request) => {
        // Testing BEFORE the first save is the path that matters: an operator
        // typing bucket credentials should find out they are wrong without
        // first storing them.
        const driver = resolver.driverForDraft({
          driver: request.body.driver,
          config: request.body.config,
          ...(request.body.secret === undefined ? {} : { secret: JSON.stringify(request.body.secret) }),
        });
        const result = await driver.probe();
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.destination.test',
          changes: { after: { draft: true, driver: request.body.driver, ok: result.ok } },
        });
        return { data: result };
      },
    );

    app.post(
      '/storage/destinations/:id/default',
      {
        config: { audit: audited('rbac') },
        schema: { params: destinationIdParams, response: { 200: destinationReply } },
      },
      async (request) => {
        const row = await load(request.params.id);
        if (row.disabled) {
          throw new ConflictError(
            'A disabled destination cannot be the default. Enable it first.',
            'CONFLICT',
            { destinationId: row.id },
          );
        }
        await repo.setDefault(row.id, app.rbac.now());
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.destination.default',
          changes: { after: { destinationId: row.id, name: row.name } },
        });
        return { data: await toView(await load(row.id)) };
      },
    );

    app.post(
      '/storage/migrate',
      {
        config: { audit: audited('rbac') },
        schema: { body: storageMigrateBody, response: { 202: storageMigrateReply } },
      },
      async (request, reply) => {
        const from = toDestinationId(request.body.from);
        const to = toDestinationId(request.body.to);
        if (from === to) {
          throw new ValidationFailedError('The source and target destinations are the same.', { to: 'same-as-from' });
        }
        // Both ends must exist BEFORE a job starts moving bytes; discovering a
        // bad id inside the worker means a half-migrated store and a failure
        // the operator sees minutes later.
        for (const [label, id] of [['from', from], ['to', to]] as const) {
          if (id !== null && (await repo.findById(id)) === null) {
            throw new ValidationFailedError(`No storage destination ${id}.`, { [label]: 'unknown' });
          }
        }
        const pending = await files.listByDestination(from, { limit: 1 });
        if (pending.length === 0) {
          throw new ConflictError('There are no files on that destination to move.', 'CONFLICT', { from });
        }

        const job = await deps.enqueue({
          kind: FILES_MIGRATE_KIND,
          payload: {
            from,
            to,
            ...(request.body.kinds === undefined ? {} : { kinds: request.body.kinds }),
            userId: request.user?.id ?? null,
          },
          ...(request.user?.id === undefined ? {} : { createdBy: request.user.id }),
        });
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'storage.migrate',
          changes: { after: { from, to, jobId: job.id } },
        });
        return reply.status(202).send({ data: { jobId: job.id } });
      },
    );
  };
}
