// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT FOLLOWS A BOUGHT LABEL: safe to run any number of times.
 *
 * The purchase itself is never a job. This is: it copies the booking into the
 * carrier's own `shipments` table, keyed by the booking's id so the copy can
 * exist only once, and writes the tracking number onto the order. It moves no
 * status and mails nobody: buying a label is not shipping, and the order moves
 * when staff press "Handed over".
 *
 * A test label reaches neither table. It is a sample, and its tracking numbers
 * repeat.
 */
import { validateManifest, type ShippingOrder } from '@adminium/manifest';
import { isDuplicateKeyError, shippingBookingsRepo, type MetaDb, type ManifestsRepo, type ShippingBooking } from '@adminium/meta';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { afterRecordWrite } from '../crud/after-record-write.js';
import { isUniqueViolation } from '../crud/decided-columns.js';
import { pkLabel } from '../crud/records.js';
import { StateMoveRefused } from '../crud/states.js';
import type { WriteActor } from '../crud/write-context.js';
import { HookRejectedError, type RecordWriteService } from '../crud/write-service.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { CheckRefusedError, ValidationFailedError } from '../errors.js';
import type { JobRegistry } from '../jobs/registry.js';
import { pkOfRowKey, type PayableSources } from '../payments/payables.js';
import { carrierCopyTable, isTestBooking } from './bookings.js';

export const SHIPPING_APPLY_JOB = 'shipping.apply';
export const SHIPPING_APPLY_PICKUP_NAME = 'shipping.apply.pickup';
export const SHIPPING_APPLY_PICKUP_CRON = '*/5 * * * *';
const APPLY_PICKUP_AFTER_MS = 2 * 60_000;
const APPLY_MAX_ATTEMPTS = 12;

const ACTOR: WriteActor & { kind: 'system' } = { kind: 'system', id: null, label: 'Shipping' };

export interface ApplyDeps {
  meta: MetaDb;
  manifests: Pick<ManifestsRepo, 'findById'>;
  sources: Pick<PayableSources, 'table' | 'readRow'>;
  writes: RecordWriteService;
  app?: FastifyInstance;
  now?: () => number;
  /** Crash injection for tests: called between the steps named. */
  faults?: { afterCopy?: () => Promise<void> | void; afterWrite?: () => Promise<void> | void };
}

export type ApplyOutcome = { state: 'applied'; already: boolean } | { state: 'skipped'; reason: string };

/** The copy, with the booking's id as its key. A window this table requires and the carrier never gave means no copy. */
async function copyToCarrierTable(deps: ApplyDeps, booking: ShippingBooking): Promise<void> {
  const copies = await carrierCopyTable(deps.meta, deps.sources, booking.connectionId, booking.carrierKey);
  if (copies === null) return;
  const { table, target } = copies;
  const at = new Date(booking.answeredAt ?? booking.updatedAt).toISOString();
  const values: Record<string, unknown> = {
    id: booking.id,
    order_reference: booking.reference,
    carrier: booking.carrierName ?? booking.carrierKey,
    service: booking.service,
    tracking: booking.tracking,
    amount: booking.amount ?? booking.quotedAmount,
    currency: booking.currency ?? booking.quotedCurrency,
    status: 'booked',
    created_at: at,
  };
  const row: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const column = table.columns.get(name);
    if (column !== undefined) row[name] = normalizeWriteValue(column, value);
  }
  // A column it requires and nothing here can honestly fill, such as a collection window no carrier promised: the booking table stays the record.
  for (const [name, column] of table.columns) {
    if (row[name] === undefined && !column.nullable) return;
  }
  const { db } = target;
  const there = await db.selectFrom(table.id).selectAll().where((eb) => eb(db.dynamic.ref('id'), '=', booking.id)).executeTakeFirst();
  if (there !== undefined) return;
  try {
    await deps.writes.create({
      target,
      values: row,
      context: { origin: 'shipping', hops: 0, actor: ACTOR, request: null },
      announce: async (created) => {
        if (deps.app === undefined) return;
        const pk = Object.fromEntries(table.primaryKey.map((column) => [column, created[column]]));
        await afterRecordWrite(deps.app, {
          request: null,
          actor: ACTOR,
          meta: deps.meta,
          connectionId: target.connectionId,
          table,
          action: 'create',
          entity: { connectionId: target.connectionId, table: table.id, pk, label: pkLabel(table, pk) },
          before: null,
          after: created,
          origin: 'schedule',
        });
      },
    });
  } catch (error) {
    if (isDuplicateKeyError(error) || isUniqueViolation(error)) return;
    // The shop's own rule said no. Trying again would say no again and hold the tracking number back, so the booking table stays the record.
    if (ruleSaidNo(error)) {
      deps.app?.log.warn({ bookingId: booking.id, code: (error as { code?: string }).code }, 'a shop rule refused the carrier copy of a booking');
      return;
    }
    throw error;
  }
}

/** The order's mapping as its app declares it now, or null when the app has gone or no longer declares it. */
async function mappingOf(deps: ApplyDeps, booking: ShippingBooking): Promise<ShippingOrder | null> {
  const install = await deps.manifests.findById(booking.installId);
  if (install === null) return null;
  const read = validateManifest(install.document);
  if (!read.ok || read.manifest.kind !== 'app') return null;
  return read.manifest.shipping?.orders.find((order) => order.table === booking.tableRef) ?? null;
}

/**
 * Writes the number onto the order: the first outbound parcel's alone, because
 * the order's screens and mail tell the customer this number. Only into an
 * empty column, in the UPDATE itself, so nothing a person typed is replaced.
 */
async function writeTracking(deps: ApplyDeps, booking: ShippingBooking): Promise<void> {
  if (booking.tracking === null || booking.purpose !== 'outbound' || booking.parcelNumber !== 1) return;
  const mapping = await mappingOf(deps, booking);
  if (mapping?.tracking === undefined) return;
  const name = booking.tableName;
  const found = await deps.sources.table(booking.connectionId, name);
  if (found === null) return;
  const pk = pkOfRowKey(found.table, booking.rowKey);
  if (pk === null) return;
  const row = await deps.sources.readRow(booking.connectionId, name, booking.rowKey);
  if (row === null) return;
  const held = row[mapping.tracking];
  if (held !== null && held !== undefined && String(held).trim() !== '') return;
  const trackingName = mapping.tracking;
  const trackingColumn = found.table.columns.get(trackingName);
  if (trackingColumn === undefined) return;
  const values: Record<string, unknown> = { [mapping.tracking]: normalizeWriteValue(trackingColumn, booking.tracking) };
  const carrierColumn = mapping.carrier === undefined ? undefined : found.table.columns.get(mapping.carrier);
  if (mapping.carrier !== undefined && carrierColumn !== undefined) values[mapping.carrier] = normalizeWriteValue(carrierColumn, booking.carrierName ?? booking.carrierKey);
  await deps.writes.update({
    target: found.target,
    pk,
    values,
    context: { origin: 'shipping', hops: 0, actor: ACTOR, request: null },
    refine: (query) => query.where((eb) => eb.or([eb(found.target.db.dynamic.ref(trackingName), 'is', null), eb(found.target.db.dynamic.ref(trackingName), '=', '')])),
    skipIfNone: true,
    announce: async (outcome) => {
      if (deps.app === undefined || outcome.count === 0) return;
      await afterRecordWrite(deps.app, {
        request: null,
        actor: ACTOR,
        meta: deps.meta,
        connectionId: found.target.connectionId,
        table: found.table,
        action: 'update',
        entity: { connectionId: found.target.connectionId, table: found.table.id, pk, label: pkLabel(found.table, pk) },
        before: outcome.before ?? row,
        after: outcome.after,
        // Told as Adminium's own background work is: no person pressed anything here.
        origin: 'schedule',
      });
    },
  });
}

/** Told as Adminium's own background work is: no person pressed anything here. */
function announceUpdate(deps: ApplyDeps, found: { target: { connectionId: string }; table: Parameters<typeof pkLabel>[0] & Parameters<typeof afterRecordWrite>[1]['table'] }, pk: Record<string, unknown>, stored: Record<string, unknown> | null) {
  return async (outcome: { count: number; before?: Record<string, unknown> | null | undefined; after?: unknown }): Promise<void> => {
    if (deps.app === undefined || outcome.count === 0) return;
    await afterRecordWrite(deps.app, {
      request: null,
      actor: ACTOR,
      meta: deps.meta,
      connectionId: found.target.connectionId,
      table: found.table,
      action: 'update',
      entity: { connectionId: found.target.connectionId, table: found.table.id, pk, label: pkLabel(found.table, pk) },
      before: outcome.before ?? stored,
      after: outcome.after as never,
      origin: 'schedule',
    });
  };
}

/** A shop rule that says no to Adminium's own tidy-up: the booking table stays the record. */
const ruleSaidNo = (error: unknown): boolean => error instanceof HookRejectedError || error instanceof ValidationFailedError || error instanceof CheckRefusedError || error instanceof StateMoveRefused;

/**
 * A refunded label's number comes off the order, so nobody is sent to a dead
 * number and the next label can be written there. Only while the column still
 * holds THIS number, in the UPDATE itself: whatever a person typed stays.
 */
async function clearTracking(deps: ApplyDeps, booking: ShippingBooking): Promise<void> {
  if (booking.tracking === null || booking.purpose !== 'outbound' || booking.parcelNumber !== 1) return;
  const mapping = await mappingOf(deps, booking);
  if (mapping?.tracking === undefined) return;
  const found = await deps.sources.table(booking.connectionId, booking.tableName);
  if (found === null) return;
  const pk = pkOfRowKey(found.table, booking.rowKey);
  const row = await deps.sources.readRow(booking.connectionId, booking.tableName, booking.rowKey);
  if (pk === null || row === null || String(row[mapping.tracking] ?? '').trim() !== booking.tracking) return;
  const trackingName = mapping.tracking;
  if (found.table.columns.get(trackingName)?.nullable !== true) return;
  const values: Record<string, unknown> = { [trackingName]: null };
  if (mapping.carrier !== undefined && found.table.columns.get(mapping.carrier)?.nullable === true && String(row[mapping.carrier] ?? '') === (booking.carrierName ?? booking.carrierKey)) values[mapping.carrier] = null;
  try {
    await deps.writes.update({
      target: found.target,
      pk,
      values,
      context: { origin: 'shipping', hops: 0, actor: ACTOR, request: null },
      refine: (query) => query.where((eb) => eb(found.target.db.dynamic.ref(trackingName), '=', booking.tracking)),
      skipIfNone: true,
      announce: announceUpdate(deps, found, pk, row),
    });
  } catch (error) {
    if (!ruleSaidNo(error)) throw error;
    deps.app?.log.warn({ bookingId: booking.id }, 'a shop rule kept a refunded label\'s number on its order');
  }
}

/** The carrier's copy says the label is dead, so it can never read as a label on the order. */
async function cancelCopy(deps: ApplyDeps, booking: ShippingBooking): Promise<void> {
  const copies = await carrierCopyTable(deps.meta, deps.sources, booking.connectionId, booking.carrierKey);
  if (copies === null || !copies.table.columns.has('status')) return;
  const { table, target } = copies;
  const status = table.columns.get('status')!;
  try {
    await deps.writes.update({
      target,
      pk: { id: booking.id },
      values: { status: normalizeWriteValue(status, 'cancelled') },
      context: { origin: 'shipping', hops: 0, actor: ACTOR, request: null },
      skipIfNone: true,
      announce: announceUpdate(deps, { target, table }, { id: booking.id }, null),
    });
  } catch (error) {
    if (!ruleSaidNo(error)) throw error;
    deps.app?.log.warn({ bookingId: booking.id }, 'a shop rule kept a refunded label\'s carrier copy');
  }
}

/** What a refund undoes. `applied_at` going back to null is what says it is done, so a crash runs it again. */
async function undoApplied(deps: ApplyDeps, booking: ShippingBooking, now: () => number): Promise<ApplyOutcome> {
  const repo = shippingBookingsRepo(deps.meta);
  if (booking.appliedAt === null) return { state: 'applied', already: true };
  if (!isTestBooking(booking)) {
    await cancelCopy(deps, booking);
    await clearTracking(deps, booking);
    // A replacement bought while this refund was open found the column taken. It is free now.
    const holder = await repo.open(booking, booking.mode);
    if (holder !== null && holder.id !== booking.id && holder.state === 'booked') await writeTracking(deps, holder);
  }
  await repo.note(booking.id, ['voided'], { appliedAt: null }, now());
  return { state: 'applied', already: false };
}

/** Runs what is still owed for one bought label. Each step says it is done only once it is. */
export async function applyBooking(deps: ApplyDeps, id: string): Promise<ApplyOutcome> {
  const repo = shippingBookingsRepo(deps.meta);
  const now = deps.now ?? Date.now;
  const booking = await repo.byId(id);
  if (booking === null) return { state: 'skipped', reason: 'no such booking' };
  if (booking.state === 'voided') return undoApplied(deps, booking, now);
  if (booking.state !== 'booked') return { state: 'skipped', reason: `the booking is ${booking.state}` };
  if (booking.appliedAt !== null) return { state: 'applied', already: true };
  if (isTestBooking(booking)) {
    await repo.note(id, ['booked'], { copiedAt: now(), appliedAt: now() }, now());
    return { state: 'applied', already: false };
  }
  if (booking.copiedAt === null) {
    await copyToCarrierTable(deps, booking);
    await repo.note(id, ['booked'], { copiedAt: now() }, now());
  }
  await deps.faults?.afterCopy?.();
  await writeTracking(deps, booking);
  await deps.faults?.afterWrite?.();
  await repo.note(id, ['booked'], { appliedAt: now() }, now());
  return { state: 'applied', already: false };
}

const payloadSchema = z.object({ bookingId: z.string().min(1).max(64) }).strict();

export function registerShippingApplyHandler(registry: JobRegistry, deps: ApplyDeps): void {
  registry.registerJobHandler(SHIPPING_APPLY_JOB, payloadSchema, async (payload) => applyBooking(deps, payload.bookingId), { internal: true });
}

type Enqueue = (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;

/** Queues the steps for one booking. A racing enqueue of the same booking is "already queued". */
export async function enqueueApply(enqueue: Enqueue, bookingId: string): Promise<boolean> {
  try {
    await enqueue({ kind: SHIPPING_APPLY_JOB, payload: { bookingId }, dedupeKey: `${SHIPPING_APPLY_JOB}:${bookingId}`, maxAttempts: APPLY_MAX_ATTEMPTS });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/** Bought labels whose steps never finished: a crash before the queue, or a job that gave up. Calls no carrier. */
export async function pickUpApplies(meta: MetaDb, enqueue: Enqueue, at: number = Date.now()): Promise<number> {
  let queued = 0;
  for (const booking of await shippingBookingsRepo(meta).unapplied(at - APPLY_PICKUP_AFTER_MS)) if (await enqueueApply(enqueue, booking.id)) queued += 1;
  return queued;
}
