// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SMTP config resolution + the real transport.
 *
 * ── WHERE THE CONFIG LIVES, AND WHY THERE IS NO ENV VAR ─────────────────────
 * `email.smtp` is a settings-registry key (07-meta-store.md §7.1), so the
 * database is the single authority and an admin configures mail from the
 * settings screen like everything else. There is deliberately no
 * `ADMINIUM_SMTP_URL`: this repo just deleted `DATABASE_URL` for being
 * documented, validated, passed through docker-compose.yml — and read by zero
 * lines of product code (`config/env.ts` keeps the tombstone). A second,
 * env-shaped source of truth for mail would be the same mistake with the same
 * ending: two places to set it, no rule for which wins, and a support thread
 * about why the settings screen "isn't saving".
 *
 * ── THE PASSWORD AT REST ────────────────────────────────────────────────────
 * `passEncrypted` is an AES-256-GCM token under an HKDF key scoped to
 * {@link EMAIL_KEY_SALT} — the same primitive and the same discipline as the
 * DSN (`connections/crypto.ts`), the TOTP secret (`auth/totp.ts`) and the LLM
 * key. The purpose salt is what stops one leaked ciphertext from being readable
 * by another subsystem's key. The plaintext exists only inside
 * {@link SmtpConfig}, in memory, on its way to a socket: it is never in a reply
 * body (`routes/settings/schema.ts` returns `configured` and nothing else).
 *
 * THE LOG SIDE, corrected 2026-08-19: this used to claim "pino redacts
 * `email.smtp.passEncrypted` on the log side (`app.ts`)". It did not. No such
 * path was in `REDACT_PATHS`, and `*.password` does not match `pass` or
 * `passEncrypted` — pino paths are field names, not substrings, which the
 * `bootToken` comment in `app.ts` had already spelled out. A probe through the
 * real logger printed BOTH the ciphertext and the decrypted plaintext in
 * cleartext. Both field names are now covered at any depth by
 * `log-redaction.ts`'s `scrubSecretFields`, which is a rule rather than a path
 * list; `test/log-redaction.test.ts` asserts it through `buildLogger` itself.
 *
 * ── THE OUTBOUND CONNECTION IS ADMIN-CHOSEN, ON PURPOSE ─────────────────────
 * Whoever holds `system:settings:manage` can point this at any host:port and
 * make the server open a connection to it. In a self-hosted product that admin
 * already owns the process, the database and the secret, so this grants nothing
 * they did not have — it is NOT an SSRF escalation the way an end-user-supplied
 * URL would be. Two guards are still applied, because "trusted" and
 * "unsupervised" are different words:
 *
 *   - {@link assertSmtpHostAllowed} rejects a host that is not a host — a
 *     pasted `smtp://…` URL, an embedded credential, a CRLF (SMTP is a
 *     line-oriented protocol, so a newline in a config value is an injection
 *     primitive, not a typo) — and blocks the cloud-metadata endpoints via the
 *     shared `assertOutboundHostAllowed`. Loopback is NOT blocked: a relay on
 *     127.0.0.1 (postfix, MailHog) is a normal, correct self-host setup.
 *   - certificate verification is left ON. Nothing here accepts a
 *     `rejectUnauthorized: false`, an "insecure" toggle, or a
 *     `NODE_TLS_REJECT_UNAUTHORIZED` reading. An admin who needs a private CA
 *     installs it in the trust store where every other TLS client in the
 *     process will honour it too.
 *
 * The guard runs at WRITE time (the settings route) and again at RESOLVE time,
 * the way `routes/llm/config-service.ts` re-checks a stored `baseUrl`: a value
 * can also arrive through a config-bundle import (`email.smtp` is `portable`),
 * which never passes through the route.
 */

import { settingsRepo, type MetaDb } from '@adminium/meta';

import { decryptSecret, deriveKey, isEncryptedSecret } from '../config/secrets.js';
import { assertOutboundHostAllowed } from '../connections/dsn.js';
import { ValidationFailedError } from '../errors.js';
import type { EmailTransport, OutboundEmail, SmtpConfig } from './types.js';

/** HKDF salt scoping the SMTP-password encryption key. */
export const EMAIL_KEY_SALT = 'adminium:smtp-password:v1';

/** Longest hostname the DNS wire format can express. */
const MAX_HOST_LENGTH = 255;

/**
 * Timeouts. Generous enough for a slow relay, short enough that a black-holed
 * host does not hold a job worker slot for the TCP default (~2 minutes). The
 * job's own attempt budget is what turns a timeout into a retry — see the
 * "no retry in here" note on {@link createSmtpTransport}.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

/** A stored SMTP password will not decrypt under the current ADMINIUM_SECRET. */
export class EmailSecretMismatchError extends Error {
  override readonly name = 'EmailSecretMismatchError';
  constructor(cause?: unknown) {
    super(
      'The stored SMTP password was encrypted with a different ADMINIUM_SECRET and cannot be ' +
        'read back. Re-enter it under Settings → Email, or restore the secret it was saved with.',
      cause === undefined ? undefined : { cause },
    );
  }
}

/** Derives the purpose-scoped key for SMTP-password encryption at rest. */
export function emailSecretKey(masterSecret: string): Buffer {
  return deriveKey(masterSecret, EMAIL_KEY_SALT);
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

/**
 * Rejects a value that is not a bare hostname or IP literal, then applies the
 * shared outbound-host guard. Throws `ValidationFailedError` (422).
 *
 * The character class is the point: an SMTP host is a name or an address, so
 * anything carrying a scheme, a path, an `@`, whitespace or a control character
 * is a paste of something else — most often a full `smtps://user:pass@host` URL,
 * which would otherwise be stored, dialled, and fail with a DNS error naming a
 * string that contains the password.
 */
export function assertSmtpHostAllowed(host: string): void {
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) {
    throw new ValidationFailedError('SMTP host must be a hostname or IP address.', { host });
  }
  if (!/^\[?[A-Za-z0-9.:_-]+]?$/.test(host)) {
    throw new ValidationFailedError(
      'SMTP host must be a bare hostname or IP address — no scheme, port, credentials or path.',
      { host },
    );
  }
  // Metadata endpoints always blocked; loopback deliberately allowed (see header).
  assertOutboundHostAllowed(host);
}

/**
 * Reads `email.smtp` and decrypts the password. `null` when mail is not
 * configured — every caller treats that as "email features are off", which is
 * what `smtpConfigured` on `/system/info` already reports.
 */
export async function resolveSmtpConfig(meta: MetaDb, key: Uint8Array): Promise<SmtpConfig | null> {
  const stored = await settingsRepo(meta).get('email.smtp');
  if (stored === null) return null;

  // Re-guard: this row can also arrive from a config-bundle import, which never
  // passed through the settings route's validation.
  assertSmtpHostAllowed(stored.host);

  let pass = '';
  if (stored.passEncrypted.length > 0) {
    if (isEncryptedSecret(stored.passEncrypted)) {
      try {
        pass = decryptSecret(stored.passEncrypted, key);
      } catch (error) {
        throw new EmailSecretMismatchError(error);
      }
    } else {
      // Tolerated, not blessed: a value written straight into the row by hand
      // is used as-is rather than throwing, mirroring `decryptStoredKey` in
      // routes/llm/config-service.ts. The route never produces one.
      pass = stored.passEncrypted;
    }
  }

  return {
    host: stored.host,
    port: stored.port,
    user: stored.user,
    pass,
    from: stored.from,
    secure: stored.secure,
  };
}

/**
 * The real transport: a non-pooled nodemailer SMTP client, one connection per
 * message.
 *
 * NO RETRY LIVES IN HERE. `adminium_jobs` already owns attempts and backoff
 * (`jobs/worker.ts`), and a transport that retried underneath it would multiply
 * the two budgets together and turn a greylisting relay into a duplicate-mail
 * generator. A failure is thrown and the worker decides.
 *
 * nodemailer is imported lazily so a process that never sends mail — every CLI
 * subcommand, the desktop shell, the majority of test suites — never loads it.
 */
export function createSmtpTransport(cfg: SmtpConfig): EmailTransport {
  assertSmtpHostAllowed(cfg.host);

  return {
    async send(msg: OutboundEmail): Promise<void> {
      const { createTransport } = await import('nodemailer');
      const transporter = createTransport({
        host: cfg.host,
        port: cfg.port,
        // Implicit TLS (465) vs. cleartext-then-STARTTLS (587).
        secure: cfg.secure,
        // On a cleartext port, DEMAND the STARTTLS upgrade rather than letting
        // nodemailer fall back to sending credentials in the clear when the
        // relay omits the capability. Exempt for a loopback relay, where the
        // "network" is a unix-domain hop inside the same host and requiring a
        // certificate for it would break the ordinary MailHog/postfix setup.
        requireTLS: !cfg.secure && !isLoopbackHost(cfg.host),
        // An empty user means an unauthenticated relay — passing `auth` with
        // blank strings makes nodemailer attempt AUTH and fail.
        ...(cfg.user.length === 0 ? {} : { auth: { user: cfg.user, pass: cfg.pass } }),
        // Pooling is left off (nodemailer's default): one connection per
        // message, torn down in the `finally` below. A pool would keep sockets
        // open across jobs for a workload that sends a handful of messages a
        // day, and its `pool: true` option is a different transport type.
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        // Certificate verification stays on — `rejectUnauthorized` is never
        // lowered here (see the module header).
        tls: { minVersion: 'TLSv1.2' },
        // Adminium never sends an attachment by path or URL; refusing both
        // means a template variable can never become a file read or a fetch.
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        await transporter.sendMail({
          from: cfg.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          ...(msg.headers === undefined ? {} : { headers: msg.headers }),
        });
      } finally {
        transporter.close();
      }
    },
  };
}
