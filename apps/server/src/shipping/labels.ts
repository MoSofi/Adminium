// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A BOUGHT LABEL'S FILE: a customer's name, address and perhaps phone.
 *
 * ─── WHERE IT LIVES ────────────────────────────────────────────────────────
 *
 * In the file store, as the kind `ship-label`, which no generic files route
 * serves, attached to the order row. `label_ref` names the stored file. A
 * carrier's address for it is never stored: it is signed, and a stored one
 * would be a password-free link to a customer's address. Each fetch asks the
 * carrier for a fresh one.
 *
 * ─── A FAILED FETCH IS NOT A FAILED BOOKING ────────────────────────────────
 *
 * The label is already paid for. A fetch that fails leaves it "owed", and a
 * person retries. Only a person's request calls the carrier.
 *
 * ─── HOW LONG IT IS KEPT ──────────────────────────────────────────────────
 *
 * 90 days from the label's last state: delivery, the last tracking event, a
 * settled refund (`label_clock_at`), or the purchase when nothing came after.
 * The booking and tracking number stay. `label_gone_at` is written BEFORE the
 * bytes go and is never cleared, so a re-fetch cannot bring back a label that
 * was deleted or whose person was erased.
 */
import { LABEL_SIZES, shipmentDocumentFileSchema, type LabelSize, type ShipmentDocumentKind } from '@adminium/add-on-contracts';
import {
  DAY_MS,
  SHIPPING_LABEL_FILE_KIND,
  filesRepo,
  newId,
  shippingBookingsRepo,
  shippingRepo,
  type MetaDb,
  type RecordRef,
  type ShippingBooking,
  type ShippingLabelGoneWhy,
  type StoredFile,
} from '@adminium/meta';

import { FileNotFoundError, type OpenedBytes } from '../files/drivers/driver.js';
import type { FileStore } from '../files/store.js';
import type { ResolvedCarrier } from './carriers.js';
import { ShippingRefusal } from './refusals.js';

export const SHIPPING_LABELS_SWEEP_NAME = 'shipping.labels.sweep';
/** Daily, in the quiet of the night. */
export const SHIPPING_LABELS_SWEEP_CRON = '40 3 * * *';

/** How long a label's file is kept after its last state. */
export const LABEL_KEEP_MS = 90 * DAY_MS;
/** How long a carrier keeps a label to fetch again. */
export const LABEL_REFETCH_MS = 365 * DAY_MS;
/** The largest label or customs invoice taken from a carrier. */
export const LABEL_MAX_BYTES = 10 * 1024 * 1024;
/** How long a purchase's reply waits for its label. A slower one lands afterwards, or is owed. */
export const LABEL_WAIT_MS = 12_000;
/** A stored file no booking names is left this long, because a fetch may be about to record it. */
const ORPHAN_AFTER_MS = DAY_MS;
const BATCH = 200;

/** Asked for until a shop chooses: it prints on any office printer. */
export const DEFAULT_LABEL_SIZE: LabelSize = 'a4';

export type LabelFileState = 'none' | 'ready' | 'owed' | 'gone';

export interface LabelView {
  state: LabelFileState;
  /** The size asked for. */
  size: string | null;
  /** The size the file really is, when it can say. */
  sizeGot: string | null;
  /** The carrier answered with another size than the one asked for. */
  sizeDiffers: boolean;
  customsInvoice: boolean;
  /** The carrier made a customs invoice and it has not been stored yet: a person retries. */
  customsInvoiceOwed: boolean;
}

type LabelFields = Pick<ShippingBooking, 'state' | 'labelRef' | 'customsRef' | 'customsDue' | 'labelSize' | 'labelSizeGot' | 'labelGoneAt'>;

/**
 * How a booking's label stands. Only `booked` can have one to hand out: a list
 * of what is allowed, so a state added later (a requested refund) is refused
 * until someone decides otherwise.
 */
export function labelStateOf(booking: LabelFields): LabelFileState {
  if (booking.labelGoneAt !== null) return 'gone';
  if (booking.state !== 'booked') return 'none';
  return booking.labelRef === null ? 'owed' : 'ready';
}

export function labelView(booking: LabelFields): LabelView {
  const state = labelStateOf(booking);
  return {
    state,
    size: booking.labelSize,
    sizeGot: booking.labelSizeGot,
    sizeDiffers: booking.labelSize !== null && booking.labelSizeGot !== null && booking.labelSize !== booking.labelSizeGot,
    customsInvoice: state === 'ready' && booking.customsRef !== null,
    customsInvoiceOwed: (state === 'ready' || state === 'owed') && booking.customsDue && booking.customsRef === null,
  };
}

/** The size this shop asks carriers for. */
export async function labelSizeOf(meta: MetaDb, installId: string): Promise<LabelSize> {
  const saved = (await shippingRepo(meta).settings(installId))?.labelSize ?? null;
  return (LABEL_SIZES as readonly string[]).includes(saved ?? '') ? (saved as LabelSize) : DEFAULT_LABEL_SIZE;
}

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FORMATS: Readonly<Record<string, { magic: Buffer; extension: string }>> = {
  'application/pdf': { magic: PDF_MAGIC, extension: 'pdf' },
  'image/png': { magic: PNG_MAGIC, extension: 'png' },
};

/** The format a carrier declared, when the bytes really are it. Anything else is not stored. */
export function checkedFormat(mediaType: string, bytes: Uint8Array): { mime: string; extension: string } | null {
  const mime = mediaType.split(';')[0]!.trim().toLowerCase();
  const format = FORMATS[mime];
  if (format === undefined || bytes.byteLength < format.magic.length) return null;
  return Buffer.from(bytes.buffer, bytes.byteOffset, format.magic.length).equals(format.magic) ? { mime, extension: format.extension } : null;
}

const PAGE_SIZES: readonly (readonly [LabelSize, number, number])[] = [
  ['a4', 595.28, 841.89],
  ['a6', 297.64, 419.53],
  ['4x6', 288, 432],
];
/** Carriers round page sizes, so a point or two either way is the same paper. */
const PAGE_TOLERANCE = 3;

/** The size of a PDF's first page, `other` for a page of no known size, or null when the file does not say in plain text. */
export function pdfPageSize(bytes: Uint8Array): LabelSize | 'other' | null {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const box = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(text);
  if (box === null) return null;
  const [x0, y0, x1, y1] = box.slice(1).map(Number) as [number, number, number, number];
  const sides = [Math.abs(x1 - x0), Math.abs(y1 - y0)].sort((a, b) => a - b) as [number, number];
  if (!sides.every((side) => Number.isFinite(side) && side > 0)) return null;
  const known = PAGE_SIZES.find(([, short, long]) => Math.abs(sides[0] - short) <= PAGE_TOLERANCE && Math.abs(sides[1] - long) <= PAGE_TOLERANCE);
  return known?.[0] ?? 'other';
}

export interface LabelDeps {
  meta: MetaDb;
  storage: FileStore;
  now: () => number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

/** The order a stored file is attached to. */
export type LabelOwner = Pick<RecordRef, 'pk'>;

const refOf = (booking: ShippingBooking, kind: ShipmentDocumentKind): string | null => (kind === 'label' ? booking.labelRef : booking.customsRef);

/** Bytes first, then the row, as the bin's own sweep does. Answers whether it went. */
async function removeFile(deps: Pick<LabelDeps, 'meta' | 'storage'>, id: string): Promise<boolean> {
  const files = filesRepo(deps.meta);
  const file = await files.findById(id);
  if (file === null) return true;
  try {
    await deps.storage.remove(file);
    await files.purge(file.id);
    return true;
  } catch {
    return false;
  }
}

function refuseUnlessHeld(booking: ShippingBooking): void {
  if (booking.labelGoneAt !== null) throw new ShippingRefusal('LABEL_GONE', 'This label file has been deleted, as personal data is after its keeping time. The booking and tracking number stay.', { booking: booking.id });
  if (booking.state !== 'booked') throw new ShippingRefusal('LABEL_NOT_AVAILABLE', 'This booking has no label to use.', { booking: booking.id, state: booking.state });
}

/**
 * Fetches a document from the carrier and stores it. Answers the booking as it
 * now stands. A stored one is left as it is. Two fetches at once both end with
 * one file: the loser removes its copy.
 */
export async function fetchDocument(deps: LabelDeps, booking: ShippingBooking, resolved: ResolvedCarrier, owner: LabelOwner, kind: ShipmentDocumentKind, by: string): Promise<ShippingBooking> {
  const repo = shippingBookingsRepo(deps.meta);
  refuseUnlessHeld(booking);
  if (refOf(booking, kind) !== null) return booking;
  const shipmentId = booking.carrierShipmentId;
  const fetcher = resolved.carrier.fetchDocument;
  if (shipmentId === null || typeof fetcher !== 'function') {
    throw new ShippingRefusal('LABEL_NOT_OFFERED', 'This carrier does not hand over this file through Adminium.', { booking: booking.id, carrier: booking.carrierKey });
  }
  if ((booking.answeredAt ?? booking.createdAt) <= deps.now() - LABEL_REFETCH_MS) {
    throw new ShippingRefusal('LABEL_EXPIRED', 'The carrier no longer keeps this label.', { booking: booking.id });
  }

  const failed = (why: string) => {
    deps.log?.('a label could not be fetched', { key: booking.carrierKey, booking: booking.id, why });
    return new ShippingRefusal('LABEL_FETCH_FAILED', 'The label could not be fetched. It is paid for: try again.', { booking: booking.id });
  };
  let answer: unknown;
  try {
    answer = await fetcher.call(resolved.carrier, shipmentId, kind);
  } catch {
    throw failed('carrier');
  }
  const parsed = shipmentDocumentFileSchema.safeParse(answer);
  if (!parsed.success || parsed.data.kind !== kind) throw failed('contract');
  const bytes = parsed.data.bytes;
  if (bytes.byteLength > LABEL_MAX_BYTES) throw failed('size');
  const format = checkedFormat(parsed.data.mediaType, bytes);
  if (format === null) throw failed('format');

  const id = newId('file');
  const test = booking.mode === 'test' ? '-sample' : '';
  const filename = `${kind}-${booking.id}${test}.${format.extension}`;
  const now = deps.now();
  const files = filesRepo(deps.meta);
  const stored = await deps.storage.write({ id, kind: SHIPPING_LABEL_FILE_KIND, filename, mime: format.mime, bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
  try {
    await files.create(
      {
        id,
        filename,
        mime: format.mime,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        kind: SHIPPING_LABEL_FILE_KIND,
        entity: { connectionId: booking.connectionId, table: booking.tableName, pk: owner.pk, label: booking.rowKey },
        attachedAt: now,
        uploadedBy: by,
        storageKey: stored.storageKey,
        destinationId: stored.destinationId,
        storage: stored.storage,
      },
      now,
    );
  } catch (error) {
    await deps.storage.remove({ destinationId: stored.destinationId, storageKey: stored.storageKey }).catch(() => undefined);
    throw error;
  }
  const size = kind === 'label' && format.mime === 'application/pdf' ? pdfPageSize(bytes) : null;
  if (!(await repo.storeDocument(booking.id, kind, id, size, now))) await removeFile(deps, id);
  return (await repo.byId(booking.id))!;
}

/**
 * The first fetch, right after a purchase. Never throws and never holds the
 * reply for long: a label that is slow lands afterwards, and one that fails is
 * owed, because the purchase itself has already succeeded.
 */
export async function firstFetch(deps: LabelDeps, booking: ShippingBooking, resolved: ResolvedCarrier, owner: LabelOwner, by: string, waitMs: number = LABEL_WAIT_MS): Promise<ShippingBooking> {
  if (booking.state !== 'booked') return booking;
  const work = (async () => {
    const labelled = await fetchDocument(deps, booking, resolved, owner, 'label', by).catch(() => booking);
    if (!labelled.customsDue || labelled.customsRef !== null) return labelled;
    return fetchDocument(deps, labelled, resolved, owner, 'customs-invoice', by).catch(() => labelled);
  })();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<ShippingBooking>((resolve) => {
    timer = setTimeout(() => resolve(booking), waitMs);
    timer.unref();
  });
  const answered = await Promise.race([work, late]);
  clearTimeout(timer);
  return answered;
}

/**
 * The stored file and its bytes, for a person who has already been checked.
 * Bytes that are really gone (a host with no lasting disk) make the label owed
 * again. A store that cannot answer right now changes nothing: the label may
 * be paid for and impossible to fetch again.
 */
export async function storedDocument(deps: LabelDeps, booking: ShippingBooking, kind: ShipmentDocumentKind): Promise<{ file: StoredFile; opened: OpenedBytes }> {
  refuseUnlessHeld(booking);
  const owed = () => new ShippingRefusal('LABEL_OWED', 'The label has not been fetched yet. Try again.', { booking: booking.id });
  const ref = refOf(booking, kind);
  if (ref === null) throw owed();
  const files = filesRepo(deps.meta);
  const file = await files.findById(ref);
  const lost = async () => {
    await shippingBookingsRepo(deps.meta).dropDocument(booking.id, kind, ref, deps.now());
    if (file !== null) await removeFile(deps, file.id);
    return owed();
  };
  if (file === null || file.deletedAt !== null || file.kind !== SHIPPING_LABEL_FILE_KIND) throw await lost();
  try {
    return { file, opened: await deps.storage.open(file) };
  } catch (error) {
    if (error instanceof FileNotFoundError) throw await lost();
    deps.log?.('a stored label could not be read', { booking: booking.id });
    throw new ShippingRefusal('LABEL_UNREADABLE', 'The file store could not be read just now. The label is safe: try again.', { booking: booking.id });
  }
}

/** A booking's files deleted for good. Answers how many went, and the ids that could not (the orphan sweep tries those again). */
async function deleteFilesOf(deps: Pick<LabelDeps, 'meta' | 'storage'>, id: string, why: ShippingLabelGoneWhy, at: number): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0;
  const failed: string[] = [];
  for (const fileId of await shippingBookingsRepo(deps.meta).markLabelGone(id, why, at)) {
    if (await removeFile(deps, fileId)) deleted += 1;
    else failed.push(fileId);
  }
  return { deleted, failed };
}

declare module 'fastify' {
  interface FastifyInstance {
    shippingRows: { onRowDeleted(connectionId: string, tableName: string, rowKey: string): Promise<void> };
  }
}

/** States whose purchase is still being settled: they keep their row, so someone can finish them. */
const STILL_SETTLING: ReadonlySet<string> = new Set(['reserved', 'calling', 'unknown', 'voiding']);

async function retire(deps: Pick<LabelDeps, 'meta' | 'storage'>, bookings: readonly ShippingBooking[], at: number): Promise<void> {
  for (const booking of bookings) await deleteFilesOf(deps, booking.id, 'erased', at);
  await shippingBookingsRepo(deps.meta).retire(bookings.map((booking) => booking.id), at);
}

/**
 * An app's tables are being deleted. A reinstall makes the same table names
 * and starts the ids again, so a new customer's order would otherwise inherit
 * an old customer's label, address and tracking number.
 */
export async function retireDroppedTables(deps: Pick<LabelDeps, 'meta' | 'storage'>, connectionId: string, tableNames: readonly string[], at: number): Promise<void> {
  await retire(deps, await shippingBookingsRepo(deps.meta).onTables(connectionId, tableNames), at);
}

/** A row was deleted, and its id can be used again (SQLite reuses the highest). Its settled labels let go of it. */
export async function retireDeletedRow(deps: Pick<LabelDeps, 'meta' | 'storage'>, connectionId: string, tableName: string, rowKey: string, at: number): Promise<void> {
  const held = await shippingBookingsRepo(deps.meta).forRow(connectionId, tableName, rowKey);
  await retire(deps, held.filter((booking) => !STILL_SETTLING.has(booking.state)), at);
}

/** The daily sweep: labels past their 90 days, then stored files no booking names. */
export async function sweepLabelFiles(deps: LabelDeps): Promise<{ deleted: number; failed: number; orphans: number }> {
  const repo = shippingBookingsRepo(deps.meta);
  const now = deps.now();
  let deleted = 0;
  // A file that just refused is tried again tomorrow, not twice in one run.
  const failed = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const batch = await repo.labelsPast(now - LABEL_KEEP_MS, BATCH, after);
    for (const booking of batch) {
      const one = await deleteFilesOf(deps, booking.id, 'kept-90', now);
      deleted += one.deleted;
      for (const id of one.failed) failed.add(id);
    }
    if (batch.length < BATCH) break;
    after = batch.at(-1)!.id;
  }
  let orphans = 0;
  let afterOrphan: string | undefined;
  for (;;) {
    // By id, so files that keep refusing never stand in front of the rest.
    const page = await repo.orphanLabelFiles(now - ORPHAN_AFTER_MS, BATCH, afterOrphan);
    for (const id of page) {
      if (failed.has(id)) continue;
      if (await removeFile(deps, id)) orphans += 1;
      else failed.add(id);
    }
    if (page.length < BATCH) break;
    afterOrphan = page.at(-1);
  }
  return { deleted, failed: failed.size, orphans };
}

/** A row of a person's, as the privacy search found it. */
export interface LabelPersonRow {
  connectionId: string;
  table: string;
  key: string;
}

/** The bookings on these rows. */
export async function bookingsOfRows(meta: MetaDb, rows: readonly LabelPersonRow[]): Promise<ShippingBooking[]> {
  const repo = shippingBookingsRepo(meta);
  const out = new Map<string, ShippingBooking>();
  for (const connectionId of new Set(rows.map((row) => row.connectionId))) {
    const mine = rows.filter((row) => row.connectionId === connectionId);
    const tables = [...new Set(mine.map((row) => row.table))];
    const wanted = new Set(mine.map((row) => `${row.table}\u0000${row.key}`));
    const keys = [...new Set(mine.map((row) => row.key))];
    for (let at = 0; at < keys.length; at += BATCH) {
      for (const booking of await repo.ofRows(connectionId, tables, keys.slice(at, at + BATCH))) {
        if (wanted.has(`${booking.tableName}\u0000${booking.rowKey}`)) out.set(booking.id, booking);
      }
    }
  }
  return [...out.values()];
}

/**
 * An erased person's labels. An order the law keeps stays, but its label is not
 * that record, so this runs on every row of theirs, kept or not. Every attempt
 * is closed, a purchase still under way too: if it lands later, its label can
 * never be fetched. The booking and tracking number stay.
 */
export async function eraseLabelsOfRows(deps: Pick<LabelDeps, 'meta' | 'storage'>, rows: readonly LabelPersonRow[], at: number): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const booking of await bookingsOfRows(deps.meta, rows)) {
    const one = await deleteFilesOf(deps, booking.id, 'erased', at);
    deleted += one.deleted;
    failed += one.failed.length;
  }
  return { deleted, failed };
}
