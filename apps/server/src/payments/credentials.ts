// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A payment add-on's credentials, per mode, inside the add-on's one encrypted
 * credential envelope.
 *
 * The generic connect form stores one set of secrets and needs every field in
 * one call. A payment service needs a test set and a live set, saved field by
 * field, each replaceable without disconnecting, so a shop can set up test
 * first and live later and roll one key without losing the other. So
 * the envelope's secret for a payment add-on is a small versioned document:
 *
 *     { payments: 1, test: { secretKey, webhookSecret }, live: { … } }
 *
 * It is read here, parsed (never cast), and handed to the provider half for
 * one call. A field is written with `withField`; the routes that call it are
 * Studio's own, never the generic connect route.
 */
import type { PaymentCredentials, PaymentMode } from '@adminium/add-on-contracts';
import type { CredentialEnvelope } from '@adminium/meta';
import { z } from 'zod';

const fields = z.record(z.string().min(1).max(64), z.string().min(1).max(4096));

export const paymentSecretSchema = z
  .object({
    payments: z.literal(1),
    test: fields.optional(),
    live: fields.optional(),
  })
  .strict();

export type PaymentSecret = z.infer<typeof paymentSecretSchema>;

/** One mode's fields, or null when the envelope holds none (or is not a payment envelope). */
export function modeCredentials(envelope: CredentialEnvelope | null, mode: PaymentMode): PaymentCredentials | null {
  if (envelope === null) return null;
  const parsed = paymentSecretSchema.safeParse(envelope.secret);
  if (!parsed.success) return null;
  const set = parsed.data[mode];
  return set === undefined || Object.keys(set).length === 0 ? null : set;
}

/**
 * The envelope's secret with one field of one mode set (or removed, with
 * `value: null`). Spaces around a pasted key are trimmed silently; the other
 * mode and the other fields are kept as they were.
 */
export function withField(current: CredentialEnvelope | null, mode: PaymentMode, field: string, value: string | null): PaymentSecret {
  const parsed = current === null ? null : paymentSecretSchema.safeParse(current.secret);
  const base: PaymentSecret = parsed?.success === true ? parsed.data : { payments: 1 };
  const set = { ...(base[mode] ?? {}) };
  if (value === null || value.trim() === '') delete set[field];
  else set[field] = value.trim();
  return paymentSecretSchema.parse({ ...base, [mode]: set });
}

/** The last four characters of a stored field, for "rk_test_…a1B2". Never more. */
export function lastFour(value: string): string {
  return value.length <= 4 ? '' : value.slice(-4);
}
