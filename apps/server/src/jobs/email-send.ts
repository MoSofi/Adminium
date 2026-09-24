// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `email.send` job handler — the delivery half of `email/send.ts`.
 *
 * It does four things: decrypt the sealed envelope, resolve the SMTP
 * transport from `adminium_settings`, read the bytes of every attachment and
 * inline image the message references, and hand the message over. Rendering
 * already happened at enqueue time, so nothing here reads a template, a
 * locale or a user row; a message that was queued is a message whose content
 * is final. What is NOT final at enqueue is the BYTES (39-email-templates-and-
 * campaigns.md D8): a fixed attachment is a library file whose bytes are read
 * right before `sendMail`, so a queue holding ten thousand copies of a PDF is
 * never a thing.
 *
 * A MISSING OR TRASHED FILE FAILS THE SEND LOUDLY. A receipt without its
 * document is worse than no receipt: the handler throws with the filename,
 * the worker retries on its schedule, and the row dead-letters where an
 * operator can see it — rather than the message going out with a hole in it.
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
import { filesRepo, type MetaDb } from '@adminium/meta';

import { decryptSecret } from '../config/secrets.js';
import { createSmtpTransport, emailSecretKey, resolveSmtpConfig } from '../email/config.js';
import { isShippedMark, loadMarkBytes } from '../email/marks.js';
import { EMAIL_SEND_JOB_KIND, emailEnvelopeKey, type EmailSendReport } from '../email/send.js';
import type {
  EmailSendAttachmentRef,
  EmailSendInlineRef,
  EmailTransport,
  OutboundAttachment,
  SmtpConfig,
} from '../email/types.js';
import type { FileStore } from '../files/store.js';
import type { JobHandlerContext, JobRegistry } from './registry.js';

export { EMAIL_SEND_JOB_KIND };

/** A fixed attachment: the library file whose bytes travel with the message. */
export const emailSendAttachmentRefSchema: z.ZodType<EmailSendAttachmentRef> = z.object({
  fileId: z.string().min(1).max(36),
  filename: z.string().min(1).max(255),
});

/** An inline image the HTML references by `cid:` — a shipped mark, or a library file (the logo, a Files image). */
export const emailSendInlineRefSchema: z.ZodType<EmailSendInlineRef> = z.discriminatedUnion('kind', [
  z.object({ cid: z.string().min(1).max(80), kind: z.literal('mark'), mark: z.string().min(1).max(20) }),
  z.object({ cid: z.string().min(1).max(80), kind: z.literal('file'), fileId: z.string().min(1).max(36) }),
]);
export type { EmailSendAttachmentRef, EmailSendInlineRef };

/**
 * The stored payload. `envelope` is opaque here — its schema is enforced by
 * {@link envelopeSchema} AFTER decryption, so a tampered row fails on the GCM
 * tag rather than on a shape check. `v: 1` rows (queued before wave 39) carry
 * no attachment or inline references and still deliver.
 */
export const emailSendPayloadSchema = z.object({
  v: z.number().int().min(1).max(2),
  templateKey: z.string().min(1).max(120),
  locale: z.string().min(2).max(35),
  envelope: z.string().min(1),
  attachments: z.array(emailSendAttachmentRefSchema).max(20).optional(),
  inline: z.array(emailSendInlineRefSchema).max(50).optional(),
  report: z
    .object({
      app: z.string().min(1).max(64),
      connectionId: z.string().min(1).max(64),
      table: z.string().min(1).max(200),
      pk: z.record(z.string(), z.union([z.string(), z.number()])),
      sentAt: z.number().int().optional(),
    })
    .optional(),
});
export type EmailSendJobPayload = z.infer<typeof emailSendPayloadSchema>;

const envelopeSchema = z.object({
  to: z.string().min(3),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  /** A configured sender's `Name <addr>`; absent = the transport's
   * `email.smtp.from`. */
  from: z.string().optional(),
});

export interface EmailSendHandlerDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET` — derives the key that opens the envelope. */
  secret: string;
  /** Transport factory; tests inject a recorder instead of a socket. */
  createTransport?: ((cfg: SmtpConfig) => EmailTransport) | undefined;
  /** Where attachment and inline-image bytes are read from. */
  storage?: FileStore | undefined;
  /**
   * A message sent for a row (an app's outbox) could not be delivered after
   * its last try: tell the row. Never throws into the job.
   */
  onGiveUp?: ((report: EmailSendReport, error: unknown) => Promise<void>) | undefined;
}

async function readAll(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

/** The bytes of a LIVE library file — throws with the filename when it is
 * missing or trashed. */
async function readLibraryFile(
  deps: EmailSendHandlerDeps,
  fileId: string,
  filename: string,
): Promise<{ content: Buffer; contentType: string; filename: string }> {
  const row = await filesRepo(deps.meta).findById(fileId);
  if (row === null || row.deletedAt !== null) {
    throw new Error(`attachment "${filename}" (${fileId}) is missing or in the trash — cannot deliver this message`);
  }
  if (deps.storage === undefined) {
    throw new Error(`attachment "${filename}" (${fileId}) cannot be read: no file store is wired to the email runner`);
  }
  const opened = await deps.storage.open({ destinationId: row.destinationId, storageKey: row.storageKey });
  return { content: await readAll(opened.stream), contentType: row.mime, filename: row.filename };
}

/**
 * Every part the message needs, as bytes: inline images first (the HTML
 * references them), then the fixed attachments. Exported so the campaign
 * runner resolves them once per run rather than once per recipient.
 */
export async function resolveEmailParts(
  deps: EmailSendHandlerDeps,
  refs: { inline?: readonly EmailSendInlineRef[] | undefined; attachments?: readonly EmailSendAttachmentRef[] | undefined },
): Promise<OutboundAttachment[]> {
  const parts: OutboundAttachment[] = [];
  for (const ref of refs.inline ?? []) {
    if (ref.kind === 'mark') {
      if (!isShippedMark(ref.mark)) throw new Error(`unknown brand mark "${ref.mark}"`);
      const mark = await loadMarkBytes(ref.mark);
      parts.push({ filename: mark.filename, content: mark.content, contentType: mark.contentType, cid: ref.cid });
    } else {
      const file = await readLibraryFile(deps, ref.fileId, ref.cid);
      parts.push({ filename: file.filename, content: file.content, contentType: file.contentType, cid: ref.cid });
    }
  }
  for (const ref of refs.attachments ?? []) {
    const file = await readLibraryFile(deps, ref.fileId, ref.filename);
    parts.push({ filename: ref.filename, content: file.content, contentType: file.contentType });
  }
  return parts;
}

/** Registers the `email.send` handler on `registry` (internal kind). */
export function registerEmailSendHandler(registry: JobRegistry, deps: EmailSendHandlerDeps): void {
  const makeTransport = deps.createTransport ?? createSmtpTransport;

  registry.registerJobHandler(
    EMAIL_SEND_JOB_KIND,
    emailSendPayloadSchema,
    async (payload, ctx) => {
      try {
        return await deliver(payload, ctx);
      } catch (error) {
        const report = payload.report;
        if (report !== undefined && ctx.attempt >= ctx.maxAttempts && deps.onGiveUp !== undefined) {
          await deps.onGiveUp(report, error).catch(() => undefined);
        }
        throw error;
      }
    },
    { internal: true },
  );

  async function deliver(payload: EmailSendJobPayload, ctx: JobHandlerContext) {
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
    // Bytes are read HERE, never at enqueue: the queue row carries
    // ids, the message carries content, and a file trashed in between fails
    // the send instead of sending a copy nobody can revoke.
    ctx.progress(25, { step: 'attachments', message: 'reading attachments' });
    const attachments = await resolveEmailParts(deps, payload);
    ctx.progress(50, { step: 'send', message: `sending ${payload.templateKey}` });
    await makeTransport(config).send({
      to: envelope.to,
      subject: envelope.subject,
      html: envelope.html,
      text: envelope.text,
      ...(envelope.from === undefined ? {} : { from: envelope.from }),
      ...(attachments.length === 0 ? {} : { attachments }),
    });
    ctx.progress(100, { step: 'sent' });
    // The recipient address is PII and the body is a secret — the result is
    // the only thing that survives into `adminium_jobs.result`, so it names
    // the template and nothing else.
    return { templateKey: payload.templateKey, locale: payload.locale };
  }
}
