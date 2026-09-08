// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email pipeline's shared vocabulary — three types, no behaviour.
 *
 * It exists as its own module so the three halves of the pipeline can be
 * written against one another without importing one another: `config.ts`
 * produces an {@link EmailTransport}, `render.ts` produces the body an
 * {@link OutboundEmail} carries, and `send.ts` puts the two together inside a
 * job. Only this file is shared, so none of them can reach into another's
 * internals, and a test can stand in for any of them with an object literal.
 *
 * {@link EmailTransport} is deliberately one method wide. Everything a real
 * SMTP client also offers — pooling, verify(), DSN receipts, per-message
 * retry — is either the job worker's job (retry/backoff already exist there,
 * `jobs/worker.ts`) or something no caller has asked for. A one-method
 * interface is also the whole reason the test suite never opens a socket.
 */

/**
 * A resolved SMTP account: what `email.smtp` holds once the stored password is
 * decrypted. `pass` is PLAINTEXT — this type only ever exists in memory, on the
 * way from the settings row to a transport. Nothing may log a value of it, and
 * nothing may put one in a reply body.
 *
 * `secure: true` means implicit TLS (SMTPS, the connection is TLS from the
 * first byte — port 465). `secure: false` means a cleartext connection that is
 * upgraded with STARTTLS — port 587, and the ordinary case.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  /** SMTP AUTH username. Empty string = an open relay that wants no auth. */
  user: string;
  /** SMTP AUTH password, plaintext. Empty when `user` is empty. */
  pass: string;
  /** Envelope + header From. May be `Name <addr@example.com>`. */
  from: string;
  /** Implicit TLS (465) rather than STARTTLS-on-cleartext (587). */
  secure: boolean;
}

/**
 * One attachment or inline image, as BYTES. Never a path, never a URL: the
 * transport runs with `disableFileAccess` and `disableUrlAccess`, so this is
 * the only shape it can send — and the only shape it must ever be handed
 * (39-email-templates-and-campaigns.md D8, D9).
 */
export interface OutboundAttachment {
  filename: string;
  content: Buffer;
  contentType?: string | undefined;
  /** Present for an inline image the HTML references as `cid:<cid>`. */
  cid?: string | undefined;
}

/** One message, fully rendered — the transport adds only the From. */
export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  /** The plain-text alternative. Never optional: a body with no text part is spam-filter bait. */
  text: string;
  /** Extra headers (e.g. `Auto-Submitted`, `List-Unsubscribe`). */
  headers?: Record<string, string>;
  /** Overrides the transport's `email.smtp.from` — a configured sender (39 D7). */
  from?: string | undefined;
  attachments?: OutboundAttachment[] | undefined;
}

/**
 * Somewhere a rendered message can be handed to. The real one wraps nodemailer
 * ({@link import('./config.js').createSmtpTransport}); tests inject a recorder.
 *
 * A `send` that resolves means the SMTP server ACCEPTED the message, not that
 * it was delivered — nothing downstream may promise otherwise. A rejection is
 * thrown, and the job worker decides whether it is worth another attempt.
 */
/**
 * What the relay said. Void from a transport that does not report it (every
 * test recorder); the SMTP transport returns the reply line, because Workflow
 * Logs draws it as an automation step's log — "250 OK · delivered to …"
 * (42 D15) — and a discarded reply cannot be shown later.
 */
export interface EmailSendResult {
  /** e.g. `250 2.0.0 Ok: queued as 4B1C2`. */
  response?: string | undefined;
  messageId?: string | undefined;
}

export interface EmailTransport {
  send(msg: OutboundEmail): Promise<EmailSendResult | void>;
}

// --- the document, as every half of the pipeline sees it (39 §3.3) -------------------

import type { EmailAttachment, EmailBlockStyle, EmailBrand } from '@adminium/meta';

/**
 * One block as the editor and the renderer both see it. A type alias, not an
 * interface: an alias gets the implicit index signature that lets a block be
 * handed to the repo's open `Record<string, unknown>[]` without a cast.
 */
export type EmailBlock = {
  id: string;
  block: string;
  data: Record<string, unknown>;
  style: EmailBlockStyle;
};

export interface EmailDocument {
  /** ≤300; CR/LF stripped at render (a subject is a header). */
  subject: string;
  /** ≤300; the inbox preview line. */
  preheader: string;
  blocks: EmailBlock[];
  /** ≤2000, pre-wrap; the fixed footer (39 D5). */
  footer: string;
  /** null = the workspace defaults (39 D6). */
  brand: EmailBrand | null;
  attachments: EmailAttachment[];
}

/** A document as a send needs it — a row or a normalized document both fit. */
export type EmailRenderSource = {
  subject: string;
  preheader: string;
  blocks: readonly Record<string, unknown>[];
  footer: string;
  brand: EmailBrand | null;
  attachments: readonly EmailAttachment[];
};

// --- what a queued message references (39 D8, D9) ---------------------------------------

/** A fixed attachment: the library file whose bytes travel with the message. */
export interface EmailSendAttachmentRef {
  fileId: string;
  filename: string;
}

/** An inline image the HTML references by `cid:` — a shipped mark, or a library file (the logo, a Files image). */
export type EmailSendInlineRef =
  | { cid: string; kind: 'mark'; mark: string }
  | { cid: string; kind: 'file'; fileId: string };
