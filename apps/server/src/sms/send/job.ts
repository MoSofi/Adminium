// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `sms.send` job's payload, sealed.
 *
 * The number and the words live only in the sealed envelope, under a key of
 * their own. INTERNAL KIND: `POST /jobs` must not be a way to text anyone
 * anything from the business's number.
 */
import { z } from 'zod';

import { decryptSecret, deriveKey, encryptSecret } from '../../config/secrets.js';
import type { JobRegistry } from '../../jobs/registry.js';
import type { SealedText, SmsSendOutcome, TextSendReport } from './types.js';

export const SMS_SEND_JOB_KIND = 'sms.send';
/** Tries of one message, counting only those the provider certainly did not take or can de-duplicate. */
export const SMS_SEND_ATTEMPTS = 5;
/** What stands in a job's envelope once its text has ended or been erased. It opens as nothing, so it can never be sent. */
export const SEALED_TEXT_GONE = 'gone';

/** The periodic clean-up of what a dead worker left. */
export const TEXT_SETTLE_JOB = 'sms.settle';
export const TEXT_SETTLE_SCHEDULE = 'text-settle-sweep';
export const TEXT_SETTLE_CRON = '*/10 * * * *';
/** A marker older than this is given up on: it may have gone, and nobody came back. */
export const TEXT_SETTLE_AFTER_MS = 3_600_000;

const ENVELOPE_SALT = 'adminium:sms-envelope:v1';

export const textEnvelopeKey = (secret: string): Buffer => deriveKey(secret, ENVELOPE_SALT);

const reportSchema: z.ZodType<TextSendReport> = z.object({
  app: z.string().min(1).max(64),
  connectionId: z.string().min(1).max(64),
  table: z.string().min(1).max(200),
  pk: z.record(z.string(), z.union([z.string(), z.number()])),
  sentAt: z.number().int().optional(),
});
/** The stored report target; null when there is none or it cannot be read. */
export function readReportTarget(stored: string | null): TextSendReport | null {
  if (stored === null) return null;
  try {
    const parsed = reportSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const smsSendPayloadSchema = z.object({
  v: z.literal(1),
  deliveryId: z.string().min(1).max(64),
  envelope: z.string().min(1),
});
export type SmsSendPayload = z.infer<typeof smsSendPayloadSchema>;

const sealedSchema: z.ZodType<SealedText> = z.object({
  to: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  body: z.string().min(1),
  textClass: z.enum(['service', 'marketing']),
  timing: z.enum(['service', 'waiting', 'marketing']),
  country: z.string().regex(/^[A-Z]{2}$/),
  zone: z.string().nullable(),
  notAfter: z.number().int().nullable(),
  sender: z.object({ kind: z.enum(['number', 'name', 'pool']), value: z.string().min(1) }),
  accountSender: z.boolean().optional(),
  optOut: z.enum(['reply-stop', 'through-business']),
  person: z.object({ connectionId: z.string(), table: z.string(), key: z.string() }).nullable(),
  answering: z.boolean().optional(),
  scope: z
    .object({
      app: z.string().nullable().optional(),
      record: z.object({ connectionId: z.string(), table: z.string(), key: z.string() }).nullable().optional(),
    })
    .optional(),
});

export function sealText(text: SealedText, secret: string): string {
  return encryptSecret(JSON.stringify(text), textEnvelopeKey(secret));
}

/** The sealed text, or null when it cannot be opened or read: then it can never be sent. */
export function openText(envelope: string, secret: string): SealedText | null {
  try {
    const parsed = sealedSchema.safeParse(JSON.parse(decryptSecret(envelope, textEnvelopeKey(secret))));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function registerSmsSendHandler(registry: JobRegistry, handOver: (payload: SmsSendPayload, ctx: { attempt: number; maxAttempts: number; signal: AbortSignal }) => Promise<SmsSendOutcome>): void {
  registry.registerJobHandler(SMS_SEND_JOB_KIND, smsSendPayloadSchema, (payload, ctx) => handOver(payload, ctx), { internal: true });
}
