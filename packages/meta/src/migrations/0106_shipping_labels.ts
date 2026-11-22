// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0106 — a bought label's file, and how long it is kept.
 *
 * On `adminium_shipping_bookings`:
 *  - `customs_ref`: the stored customs invoice (`label_ref` is the label);
 *  - `label_size`, `label_size_got`: the size asked for, and the size the
 *    stored file really is, because a carrier may answer with another;
 *  - `label_clock_at`: the label's last state after the purchase (delivery, the
 *    last tracking event, a settled refund). Its 90 days count from here, or
 *    from the purchase when nothing came after it;
 *  - `label_gone_at`, `label_gone_why`: its files were deleted for good, so
 *    nothing may fetch them again. The booking and tracking number stay.
 *
 * On `adminium_shipping_settings`: `label_size`, what this shop asks for.
 *
 * Each column is asked for first: MySQL commits each DDL, so a run stopped part
 * way comes back to the columns it already made.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { SHIPPING_CARRIER_TEXT_WIDTH } from './0105_shipping_bookings.js';
import { columnExists, createIndexUnlessMade } from './probe.js';

/** `a4`, `a6`, `4x6` or `other`. */
export const SHIPPING_LABEL_SIZE_WIDTH = 8;
/** `kept-90` or `erased`. */
export const SHIPPING_LABEL_GONE_WIDTH = 12;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const bookings = metaTable('shipping_bookings');
  const columns = [
    ['customs_ref', c.str(SHIPPING_CARRIER_TEXT_WIDTH)],
    ['label_size', c.str(SHIPPING_LABEL_SIZE_WIDTH)],
    ['label_size_got', c.str(SHIPPING_LABEL_SIZE_WIDTH)],
    ['label_clock_at', c.ts],
    ['label_gone_at', c.ts],
    ['label_gone_why', c.str(SHIPPING_LABEL_GONE_WIDTH)],
  ] as const;
  for (const [name, type] of columns) {
    if (!(await columnExists(db, c.dialect, bookings, name))) await db.schema.alterTable(bookings).addColumn(name, type).execute();
  }
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_bookings_label', bookings, ['label_gone_at']);

  const settings = metaTable('shipping_settings');
  if (!(await columnExists(db, c.dialect, settings, 'label_size'))) {
    await db.schema.alterTable(settings).addColumn('label_size', c.str(SHIPPING_LABEL_SIZE_WIDTH)).execute();
  }
}
