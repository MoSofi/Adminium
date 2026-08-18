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

/** One message, fully rendered — the transport adds only the From. */
export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  /** The plain-text alternative. Never optional: a body with no text part is spam-filter bait. */
  text: string;
  /** Extra headers (e.g. `Auto-Submitted`, `List-Unsubscribe`). */
  headers?: Record<string, string>;
}

/**
 * Somewhere a rendered message can be handed to. The real one wraps nodemailer
 * ({@link import('./config.js').createSmtpTransport}); tests inject a recorder.
 *
 * A `send` that resolves means the SMTP server ACCEPTED the message, not that
 * it was delivered — nothing downstream may promise otherwise. A rejection is
 * thrown, and the job worker decides whether it is worth another attempt.
 */
export interface EmailTransport {
  send(msg: OutboundEmail): Promise<void>;
}
