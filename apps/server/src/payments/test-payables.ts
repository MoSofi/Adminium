// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Throwaway payables for staff: "Send a test payment" and the pay page's full
 * preview.
 *
 * A test payable is a pretend invoice of a small amount that lives only in
 * the payments' own settings documents: no shop row, no designer invoice. It
 * is named as a `document` payable whose row key starts `paytest_`, so every
 * part of the payment path (links, attempts, the record job, kept payments)
 * takes it as it is, and the resolver reads it from here. Its payments are
 * test payments, kept in meta like every other one, and never reach a table.
 *
 * It names the one service it is for: the pay page offers that service only
 * (the demo service for a preview), whatever the ways' rules say, so a test
 * of Stripe is a test of Stripe.
 */
import { randomBytes } from 'node:crypto';

import { paymentSettingsRepo, type MetaDb, type PayableRef } from '@adminium/meta';
import { z } from 'zod';

export const TEST_PAYABLE_PREFIX = 'paytest_';

export const testPayableSchema = z
  .object({
    label: z.string().min(1).max(40),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    /** The one service the pay page offers for it (`demo` for the preview). */
    provider: z.string().min(1).max(80),
    createdAt: z.number().int().nonnegative(),
    createdBy: z.string().nullable(),
  })
  .strict();
export type TestPayable = z.infer<typeof testPayableSchema>;

function docName(id: string): string {
  return `test-payable:${id}`;
}

export function isTestPayable(ref: Pick<PayableRef, 'kind' | 'rowKey'>): boolean {
  return ref.kind === 'document' && ref.rowKey.startsWith(TEST_PAYABLE_PREFIX);
}

/** The pretend amount in a currency: one unit, at the currency's own decimals. */
export function oneUnit(scale: number): string {
  return scale === 0 ? '1' : `1.${'0'.repeat(scale)}`;
}

export async function createTestPayable(
  meta: MetaDb,
  input: { provider: string; currency: string; amount: string; createdBy: string | null },
  at: number = Date.now(),
): Promise<{ ref: PayableRef; payable: TestPayable }> {
  const id = `${TEST_PAYABLE_PREFIX}${randomBytes(9).toString('base64url')}`;
  const payable: TestPayable = {
    label: `TEST-${id.slice(TEST_PAYABLE_PREFIX.length, TEST_PAYABLE_PREFIX.length + 4).toUpperCase()}`,
    currency: input.currency,
    amount: input.amount,
    provider: input.provider,
    createdAt: at,
    createdBy: input.createdBy,
  };
  await paymentSettingsRepo(meta).set(docName(id), testPayableSchema, payable, at);
  return { ref: { kind: 'document', connectionId: null, tableName: null, rowKey: id }, payable };
}

export async function readTestPayable(meta: MetaDb, rowKey: string): Promise<TestPayable | null> {
  if (!rowKey.startsWith(TEST_PAYABLE_PREFIX)) return null;
  return paymentSettingsRepo(meta).get(docName(rowKey), testPayableSchema);
}
