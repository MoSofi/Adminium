// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /add-ons/:key/codes/make` — A DISCOUNT CODE, BEFORE IT IS SAVED.
 *
 * Somebody naming a discount code either asks for one ("make one for me") or
 * types a word of their own. Asked for one, they get eight characters that no
 * code of the add-on has or reads like. With a word, they are told how it
 * will be kept, whether it is taken, and which stored codes read like it —
 * `AUTUMNS` beside `AUTUMN5` — so a customer does not mix the two up. A
 * warning, never a refusal: the save decides, and its unique index is the
 * arbiter.
 *
 * Only discount codes are compared: a word is not money, and no voucher or
 * card is ever read here. A word that starts as a voucher's or a card's code
 * does is refused, as the save refuses it. Reads on the pool; nothing is
 * stored. For somebody who may make rows of the add-on's codes; limited per
 * user.
 */
import { addOnManifestSchema, adjusterOf, type Manifest } from '@adminium/manifest';
import { appTablesRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { canonicalCode, findByCode, lookAlikes, plausibleCode, reservedStart } from '../../crud/code-lookup.js';
import { generateCode } from '../../crud/decided-columns.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { labelColumnFor } from '../../crud/labels.js';
import type { Row } from '../../crud/mask.js';
import { readViewFor } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';

export interface CodesMakeDeps {
  meta: MetaDb;
  manager: ConnectionManager;
}

export const codesMakeParams = z.object({ key: z.string().min(1).max(64) });
export const codesMakeBody = z.object({ word: z.string().min(1).max(64).optional() }).strict();
export const codesMakeReply = z.object({
  /** The code as it will be kept. */
  code: z.string(),
  /** With a word: whether a code is kept under it already, and the stored codes that read like it. */
  taken: z.boolean().optional(),
  lookAlikes: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
});

/** How long a made code is, and how often one is made again when it is taken or reads like another. */
const MADE_LENGTH = 8;
const MADE_TRIES = 20;
/** The most look-alikes answered. */
const LOOK_ALIKES = 5;

export function addOnCodesRoutes(deps: CodesMakeDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/add-ons/:key/codes/make',
      {
        preHandler: [app.requireAuth],
        config: { rateLimitBucket: 'codes-make', audit: auditExempt('a code is made or compared, and nothing is stored') },
        schema: { params: codesMakeParams, body: codesMakeBody, response: { 200: codesMakeReply } },
      },
      async (request) => {
        const addOnKey = request.params.key;
        const row = await deps.meta.db.selectFrom('adminium_manifests').select(['manifest', 'status', 'connectionId']).where('manifestKey', '=', addOnKey).where('kind', '=', 'add-on').executeTakeFirst();
        const parsed = row === undefined ? null : addOnManifestSchema.safeParse(typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest);
        const adjuster = parsed?.success === true ? adjusterOf(parsed.data as unknown as Manifest) : null;
        if (row === undefined || adjuster === null || row.connectionId === null) throw new NotFoundError('This add-on keeps no discount codes here.', { addOn: addOnKey });
        if (row.status !== 'installed') throw new AppError(409, 'FEATURE_OFF', 'This add-on is not available right now.', { addOn: addOnKey, status: row.status });

        const connectionId = row.connectionId;
        const view = await loadSnapshotView(deps.meta, connectionId);
        const records = (await appTablesRepo(deps.meta).forConnection(connectionId)).filter((record) => record.appKey === addOnKey && (record.state === 'created' || record.state === 'adopted'));
        const tableOf = (ref: string): ResolvedTable | null => {
          const record = records.find((candidate) => candidate.ref === ref);
          const model = record === undefined ? undefined : view.model.tables.find((table) => table.name === record.tableName);
          if (model === undefined) return null;
          try {
            return view.table(model.id);
          } catch {
            // A table that is there and not served: as if it were not there.
            return null;
          }
        };
        const codes = tableOf(adjuster.codes.table);
        if (codes === null) throw new NotFoundError('This add-on keeps no discount codes here.', { addOn: addOnKey });
        const permission = `table:${connectionId}:${codes.id}:create`;
        if (!(await request.can(permission))) {
          await app.rbac.audit(request, { category: 'rbac', action: 'permission.denied', connectionId, changes: { after: { permission, method: request.method, url: request.url } } });
          throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission });
        }
        const { db } = await deps.manager.data(connectionId);
        const column = adjuster.codes.column;
        const reserved = adjuster.codes.reserved ?? [];
        const alike = (canonical: string): Promise<Row[]> => lookAlikes(db, codes.id, column, canonical, LOOK_ALIKES + 1);
        const kept = (found: Row): string => canonicalCode(String(found[column] ?? ''));

        const word = request.body.word;
        if (word === undefined) {
          for (let attempt = 0; attempt < MADE_TRIES; attempt += 1) {
            const made = generateCode('', MADE_LENGTH);
            if (reservedStart(made, reserved) !== null) continue;
            if ((await alike(made)).length === 0) return { code: made };
          }
          // So many codes that eight characters keep reading like one of them: said, never answered with a code that does.
          throw new AppError(409, 'CONFLICT', 'No free code could be made. Try again.', { retry: true });
        }

        const canonical = canonicalCode(word);
        if (!plausibleCode(canonical)) throw new ValidationFailedError('A code is letters and digits.', { fields: { word: { code: 'invalid' } } });
        if (reservedStart(canonical, reserved) !== null) throw new ValidationFailedError('A discount code cannot start as a voucher\'s or a card\'s code does.', { fields: { word: { code: 'reserved' } } });
        // Whether it is taken is asked on its own: a word with many look-alikes is no less taken for them.
        const taken = (await findByCode(db, codes.id, column, { kept: true }, canonical)) !== null || (await alike(canonical)).some((one) => kept(one) === canonical);
        const others = (await lookAlikes(db, codes.id, column, canonical, LOOK_ALIKES + 1, canonical)).slice(0, LOOK_ALIKES);

        // What a look-alike belongs to (the offer it is a code of), named to somebody who reads that.
        const readView = await readViewFor(request, view);
        const names = new Map<string, string>();
        // (Only the add-on's own table of offers: a code's other links — who made it — name nothing here.)
        const offersTable = adjuster.offers[0] === undefined ? null : tableOf(adjuster.offers[0].table);
        const link = offersTable === null ? undefined : view.model.relations.find((r) => r.through === null && r.from.tableId === codes.id && r.to.tableId === offersTable.id && r.from.columns.length === 1 && r.to.columns.length === 1);
        if (link !== undefined && offersTable !== null && others.length > 0 && (await request.can(`table:${connectionId}:${link.to.tableId}:read`))) {
          const owner = offersTable;
          const label = labelColumnFor(view, owner);
          const keys = [...new Set(others.map((one) => one[link.from.columns[0]!]).filter((key) => key !== null && key !== undefined))];
          if (label !== null && readView.table(owner.id).columns.get(label)?.unreadable !== true && keys.length > 0) {
            const owners = (await db
              .selectFrom(owner.id as never)
              .select([sql.ref(link.to.columns[0]!).as('key'), sql.ref(label).as('label')])
              .where(sql.ref(link.to.columns[0]!), 'in', keys as never)
              .execute()) as { key: unknown; label: unknown }[];
            for (const one of owners) if (one.label !== null && one.label !== undefined) names.set(String(one.key), String(one.label));
          }
        }
        // Whether the word is free is the maker's to know. Which codes read like it is for somebody who reads the codes.
        const readsCodes = (await request.can(`table:${connectionId}:${codes.id}:read`)) && readView.table(codes.id).columns.get(column)?.unreadable !== true;
        return {
          code: canonical,
          taken,
          lookAlikes: readsCodes ? others.map((one) => ({ code: kept(one), name: (link === undefined ? undefined : names.get(String(one[link.from.columns[0]!]))) ?? '' })) : [],
        };
      },
    );
  };
}
