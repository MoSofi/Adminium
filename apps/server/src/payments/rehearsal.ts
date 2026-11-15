// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REHEARSAL: walking an app's own checkout in test mode before going live.
 *
 * A person who manages payments switches rehearsal on for themselves (it
 * lapses after a few hours). While it is on, and while they are signed in on
 * the app's customer side opened on the staff address (`/apps/<key>/customer/`,
 * where their session reaches the public API — a host mapped to customers
 * refuses sign-in), the app reads "Pay now" in test mode; each row they make
 * there or on the app's staff screens is a sample row from the start, so
 * "Remove sample data" takes it; and a test payment on a sample row is written
 * into the app's own tables like a real one, with the TEST badge. A real order
 * is never stamped: only the rehearsing person's own rows are, and only while
 * the switch is on. A test payment never reaches a row that is not a sample row.
 */
import { appTablesRepo, payableProfilesRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { findSampleApp, listRuleMadeRow, sampleListsNaming } from '../apps/sample-data.js';
import { noteRehearsalRow, rehearsalUntil } from './rehearsal-state.js';

export { REHEARSAL_MS, rehearsalConfig, rehearsalUntil, setRehearsal } from './rehearsal-state.js';

/**
 * The signed-in person rehearsing on this request, or null: a staff session on
 * this very origin (a write also carries the CSRF header the dashboard sends),
 * who may manage payments and has rehearsal on.
 */
export async function rehearsingPerson(
  request: FastifyRequest,
  meta: MetaDb,
  checks: { sameOrigin: (request: FastifyRequest) => boolean; csrfOk: (request: FastifyRequest) => boolean },
): Promise<string | null> {
  const user = (request as unknown as { user?: { id?: string } | null }).user;
  if (user?.id === undefined || (request as unknown as { session?: unknown }).session == null) return null;
  if (!checks.sameOrigin(request)) return null;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !checks.csrfOk(request)) return null;
  try {
    if (!(await request.can('system:payments:manage'))) return null;
  } catch {
    return null;
  }
  return (await rehearsalUntil(meta, user.id)) === null ? null : user.id;
}

export interface RehearsalTarget {
  connectionId: string;
  db: Kysely<SourceDatabase>;
  dialect: string;
  table: ResolvedTable;
}

/**
 * A row a rehearsing person made, entered in its app's list of sample rows
 * (the list made first when the app never had sample data). Its own app's
 * list: `owner` is the app the row was made in.
 */
export async function stampRehearsalRow(
  deps: { meta: MetaDb; ledgerFor: (appKey: string, connectionId: string) => Promise<string | null> },
  target: RehearsalTarget,
  pk: Row,
  appKey: string,
  at: number = Date.now(),
  /** The rehearsing person: the mail the row makes goes to them, marked TEST. */
  userId?: string,
): Promise<boolean> {
  const ledger = await deps.ledgerFor(appKey, target.connectionId);
  if (ledger === null) return false;
  const listed = (await listRuleMadeRow(deps.meta, target, pk, [{ ledger, owner: appKey }], at)) > 0;
  if (listed && userId !== undefined) await noteRehearsalRow(deps.meta, target.connectionId, target.table.id, pk, userId, at);
  return listed;
}

/** Whether a row is one of its app's sample rows now (a rehearsal order, or one "Add sample data" made). */
export async function isSampleRow(meta: MetaDb, target: RehearsalTarget, pk: Row): Promise<boolean> {
  return (await sampleListsNaming(meta, target.db, target.connectionId, target.table, pk)).length > 0;
}

/** The ledger maker, over the sample-data service: null when the app is not installed on that database. */
export function ledgerMaker(meta: MetaDb, ledgerFor: (app: NonNullable<Awaited<ReturnType<typeof findSampleApp>>>, connectionId: string) => Promise<string>) {
  return async (appKey: string, connectionId: string): Promise<string | null> => {
    const app = await findSampleApp(meta, appKey, { connectionId });
    return app === null ? null : ledgerFor(app, connectionId);
  };
}

/**
 * What hears a person's create on a staff screen: while they rehearse, a row
 * of an app that takes payments (a till's ticket, a quote, an invoice, a
 * visit) is entered in that app's list of sample rows. Never throws.
 */
export function createRehearsalWatch(deps: {
  meta: MetaDb;
  ledgerFor: (appKey: string, connectionId: string) => Promise<string | null>;
  dataFor: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: string }>;
  warn?: (fields: Record<string, unknown>, message: string) => void;
}) {
  return {
    async onCreate(input: { connectionId: string; table: ResolvedTable; pk: Row; userId: string }): Promise<void> {
      try {
        if ((await rehearsalUntil(deps.meta, input.userId)) === null) return;
        const tables = appTablesRepo(deps.meta);
        let records = await tables.byTable(input.connectionId, input.table.name);
        if (records.length === 0 && input.table.schema !== '') records = await tables.byTable(input.connectionId, `${input.table.schema}.${input.table.name}`);
        const owner = records.find((record) => record.role === 'app' && record.owned && record.state === 'created');
        if (owner === undefined) return;
        const pays = (await payableProfilesRepo(deps.meta).list(input.connectionId)).some((profile) => profile.ownerApp === owner.appKey);
        if (!pays) return;
        const { db, dialect } = await deps.dataFor(input.connectionId);
        await stampRehearsalRow(deps, { connectionId: input.connectionId, db, dialect, table: input.table }, input.pk, owner.appKey, Date.now(), input.userId);
      } catch (error) {
        deps.warn?.({ err: error, table: input.table.id }, 'rehearsal: a row could not be entered as sample data');
      }
    },
  };
}
