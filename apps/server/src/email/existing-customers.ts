// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OWNER'S "EXISTING CUSTOMERS" SWITCH, one per people table.
 *
 * "Existing customers may get marketing mail without ticking a box" is off
 * for every table until the owner turns it on, and turning it on needs their
 * tick "I offered a way to say no when we took their address". It is kept
 * as the owner's word on the table, beside the other `table.*` words: a
 * `table.existingCustomers` override row, whose `created_by` and
 * `created_at` say who and when. Each change writes a new
 * row and leaves the earlier ones disabled, so the newest active row is the
 * switch and the disabled ones are its history.
 *
 * The switch alone mails nobody: the basis also needs the app to declare the
 * table's opt-out mark and its customer column, and each row to carry the
 * mark (`outbox/marketing.ts` `existingCustomer`, the audience's breakdown).
 * Every send path reads the switch here (`email/marketing.ts`).
 */
import { overridesRepo, type MetaDb } from '@adminium/meta';

export const EXISTING_CUSTOMERS_OP = 'table.existingCustomers';

/** Where the switch stands, and who set it when. */
export interface ExistingCustomersSwitch {
  on: boolean;
  /** The owner's tick "I offered a way to say no when we took their address". */
  optOutOffered: boolean;
  at: number;
  by: string | null;
}

/** The table's switch as it stands (its newest active row), or null when nobody ever set it. */
export async function existingCustomersSwitch(meta: MetaDb, connectionId: string, table: string): Promise<ExistingCustomersSwitch | null> {
  const row = await meta.db
    .selectFrom('adminium_schema_overrides')
    .select(['value', 'createdAt', 'createdBy'])
    .where('connectionId', '=', connectionId)
    .where('op', '=', EXISTING_CUSTOMERS_OP)
    .where('tableName', '=', table)
    .where('status', '=', 'active')
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (row === undefined) return null;
  const raw = typeof row.value === 'string' ? (JSON.parse(row.value) as unknown) : row.value;
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as { on?: unknown; optOutOffered?: unknown };
  // On only with the tick: a row that somehow says on without it is read as off.
  const optOutOffered = value.optOutOffered === true;
  return { on: value.on === true && optOutOffered, optOutOffered, at: Number(row.createdAt), by: row.createdBy };
}

/** Whether the owner switched existing customers on for the table. */
export async function existingCustomersOn(meta: MetaDb, connectionId: string, table: string): Promise<boolean> {
  return (await existingCustomersSwitch(meta, connectionId, table))?.on === true;
}

/**
 * The owner's change of the switch: a new row in their name, the earlier
 * active ones disabled. On needs the tick (the override's own schema refuses
 * it otherwise).
 */
export async function setExistingCustomers(
  meta: MetaDb,
  input: { connectionId: string; table: string; on: boolean; optOutOffered: boolean; by: string },
  at: number = Date.now(),
): Promise<ExistingCustomersSwitch> {
  const overrides = overridesRepo(meta);
  const earlier = await meta.db
    .selectFrom('adminium_schema_overrides')
    .select('id')
    .where('connectionId', '=', input.connectionId)
    .where('op', '=', EXISTING_CUSTOMERS_OP)
    .where('tableName', '=', input.table)
    .where('status', '=', 'active')
    .execute();
  const row = await overrides.create(
    { connectionId: input.connectionId, op: EXISTING_CUSTOMERS_OP, tableName: input.table, value: { on: input.on, optOutOffered: input.optOutOffered }, origin: 'user', createdBy: input.by },
    at,
  );
  for (const one of earlier) await overrides.setStatus(one.id, 'disabled', at);
  return { on: input.on && input.optOutOffered, optOutOffered: input.optOutOffered, at: row.createdAt, by: row.createdBy };
}
