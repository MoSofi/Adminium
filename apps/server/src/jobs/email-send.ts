// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `email.send` job handler — the delivery half of `email/send.ts`.
 *
 * It does exactly three things: decrypt the sealed envelope, resolve the SMTP
 * transport from `adminium_settings`, and hand the message over. Rendering
 * already happened at enqueue time, so nothing here reads a template, a locale
 * or a user row; a message that was queued is a message whose content is
 * final.
 *
 * INTERNAL KIND, deliberately. `POST /jobs` lets a `jobs:manage` holder
 * hand-craft a payload for any non-internal kind. For this one that would be a
 * mail-relay primitive: pick any recipient, any subject, any HTML, sent from
 * the workspace's own verified domain. The `internal: true` flag is what keeps
 * `email.send` reachable only through `enqueueEmail`, where the content comes
 * from an operator-owned template.
 *
 * FAILURES RETRY. A refused connection or a 4xx from the relay throws, and the
 * worker's existing backoff owns the rest until `maxAttempts` lands the row in
 * terminal `failed` — the dead-letter state an operator can see in the jobs UI.
 * Silently completing would lose the mail with no trace.
 */
import { z } from 'zod';
import type { MetaDb } from '@adminium/meta';

import { decryptSecret } from '../config/secrets.js';
import { createSmtpTransport, emailSecretKey, resolveSmtpConfig } from '../email/config.js';
import { EMAIL_SEND_JOB_KIND, emailEnvelopeKey } from '../email/send.js';
import type { EmailTransport, SmtpConfig } from '../email/types.js';
import type { JobRegistry } from './registry.js';

export { EMAIL_SEND_JOB_KIND };

/**
 * The stored payload. `envelope` is opaque here — its schema is enforced by
 * {@link envelopeSchema} AFTER decryption, so a tampered row fails on the GCM
 * tag rather than on a shape check.
 */
export const emailSendPayloadSchema = z.object({
  v: z.number().int().min(1).max(1),
  templateKey: z.string().min(1).max(120),
  locale: z.string().min(2).max(35),
  envelope: z.string().min(1),
});
export type EmailSendJobPayload = z.infer<typeof emailSendPayloadSchema>;

const envelopeSchema = z.object({
  to: z.string().min(3),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export interface EmailSendHandlerDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET` — derives the key that opens the envelope. */
  secret: string;
  /** Transport factory; tests inject a recorder instead of a socket. */
  createTransport?: ((cfg: SmtpConfig) => EmailTransport) | undefined;
}

/** Registers the `email.send` handler on `registry` (internal kind). */
export function registerEmailSendHandler(registry: JobRegistry, deps: EmailSendHandlerDeps): void {
  const makeTransport = deps.createTransport ?? createSmtpTransport;

  registry.registerJobHandler(
    EMAIL_SEND_JOB_KIND,
    emailSendPayloadSchema,
    async (payload, ctx) => {
      const config = await resolveSmtpConfig(deps.meta, emailSecretKey(deps.secret));
      if (config === null) {
        // Configured at enqueue, gone by delivery. Retrying is right: an
        // operator who is mid-edit on the SMTP settings gets the mail once
        // they finish, and a genuine removal dead-letters visibly.
        throw new Error('SMTP is no longer configured — cannot deliver this message');
      }

      const envelope = envelopeSchema.parse(
        JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(deps.secret))),
      );
      ctx.progress(50, { step: 'send', message: `sending ${payload.templateKey}` });
      await makeTransport(config).send({
        to: envelope.to,
        subject: envelope.subject,
        html: envelope.html,
        text: envelope.text,
      });
      ctx.progress(100, { step: 'sent' });
      // The recipient address is PII and the body is a secret — the result is
      // the only thing that survives into `adminium_jobs.result`, so it names
      // the template and nothing else.
      return { templateKey: payload.templateKey, locale: payload.locale };
    },
    { internal: true },
  );
}
