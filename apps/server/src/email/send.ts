// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The outbound-email ENQUEUE half (the handler half is `jobs/email-send.ts`).
 *
 * WHY A JOB AND NOT A DIRECT SEND. An SMTP round trip is a network call with a
 * remote timeout; doing it inline would put a third party on the critical path
 * of `POST /auth/password/forgot` and `POST /users`. The queue already owns
 * retry/backoff/dead-lettering (`jobs/worker.ts`), so `email.send` rides
 * `adminium_jobs` — no outbox table, no migration (v1 decision).
 *
 * WHY RENDERING HAPPENS AT ENQUEUE TIME. The template row, the recipient's
 * locale and the substitution vars are all request-scoped facts. Resolving
 * them later would mean a job that fails minutes after the request because a
 * template was edited, or one that renders in the wrong language because the
 * recipient changed their preference in between.
 *
 * WHY THE BODY IS ENCRYPTED AT REST. A rendered password-reset or invite mail
 * contains the PLAINTEXT single-use token — the exact thing
 * `adminium_password_resets` stores only as a SHA-256 so that reading the meta
 * store cannot become an account takeover. `adminium_jobs.payload` is readable
 * through `GET /jobs/:id`, so parking the rendered HTML there raw would undo
 * that guarantee through the back door. The envelope (recipient, subject,
 * html, text) is therefore sealed with the same AES-256-GCM primitive that
 * protects DSNs and TOTP secrets (`config/secrets.ts`); the plaintext payload
 * carries only the template key and locale, which are not secrets.
 *
 * TWO KEYS, TWO PURPOSES. {@link emailEnvelopeKey} seals the queued body;
 * `emailSecretKey` (config.ts) opens the stored SMTP password. Separate HKDF
 * salts, per 01 §7.1 — a job row and a settings row are different blast radii
 * and must not share a key.
 *
 * DEGRADATION IS THE DEFAULT. Email is optional infrastructure: a self-hosted
 * instance with no SMTP must keep working. Every path here returns quietly
 * when the transport is unconfigured, a template is missing, or the recipient
 * has no address — the CALLER's fallback (the copyable activation link, the
 * in-app notification row) is the product, not an error page.
 */
import {
  emailTemplatesRepo,
  jobsRepo,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
} from '@adminium/meta';
import { dirForLocale, isLocaleId } from '@adminium/i18n';

import { deriveKey, encryptSecret } from '../config/secrets.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { resolveEmailTemplate } from './builtins.js';
import { emailSecretKey, resolveSmtpConfig } from './config.js';
import { renderEmail } from './render.js';

/** The `adminium_jobs.kind` of a queued outbound email. */
export const EMAIL_SEND_JOB_KIND = 'email.send';

/** Payload envelope version — bumped if the sealed shape ever changes. */
export const EMAIL_SEND_PAYLOAD_VERSION = 1;

/**
 * Retry budget for one message. Five attempts on the worker's 30 s-doubling
 * backoff spans ~8 minutes, which covers a restarting relay without keeping a
 * password-reset mail alive long past the 30-minute token TTL.
 */
export const EMAIL_SEND_MAX_ATTEMPTS = 5;

/**
 * HKDF salt for the QUEUED-BODY key. Distinct from `EMAIL_KEY_SALT` in
 * config.ts (which scopes the SMTP password) exactly as `auth/totp.ts` and
 * `connections/crypto.ts` are distinct from each other: one compromised
 * ciphertext must not be readable by another subsystem's key.
 */
const EMAIL_ENVELOPE_SALT = 'adminium:email-envelope:v1';

/** Derives the key that seals a queued message body at rest. */
export function emailEnvelopeKey(masterSecret: string): Buffer {
  return deriveKey(masterSecret, EMAIL_ENVELOPE_SALT);
}

/** Built-in template keys this server sends through (see `email/builtins.ts`). */
export const PASSWORD_RESET_TEMPLATE_KEY = 'password-reset';
export const USER_INVITE_TEMPLATE_KEY = 'user-invite';

/**
 * The template key a notification's email channel renders through. One key for
 * every notification kind: the row's own `title`/`body` ARE the content, so a
 * per-kind template would be thirty near-identical rows for an operator to keep
 * in sync — and every kind added later would silently have no email at all.
 */
export const NOTIFICATION_EMAIL_TEMPLATE_KEY = 'notification';

/**
 * Inline last resort for the `notification` key, used ONLY when no row exists
 * in any locale — an instance whose boot seed has not run yet, or a test
 * harness that mounts `notify` without one. `email/builtins.ts` seeds a proper
 * localized row, and that row always wins.
 *
 * Deliberately content-free: everything visible comes from the notification
 * itself, so this carries no strings of its own to drift out of sync with the
 * eight locale bundles.
 */
export const NOTIFICATION_FALLBACK_TEMPLATE = {
  subject: '{{title}}',
  blocks: [
    { block: 'email.heading', id: 'heading', data: { text: '{{title}}', level: 1 } },
    { block: 'email.text', id: 'body', data: { text: '{{body}}' } },
    { block: 'email.divider', id: 'rule' },
    { block: 'email.footer', id: 'footer', data: { text: '{{actionUrl}}' } },
  ] as readonly unknown[],
} as const;

/** Minimal structured logger — satisfied by `app.log` / pino / the worker's. */
export interface EmailLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface EnqueueEmailDeps {
  meta: MetaDb;
  /**
   * `ADMINIUM_SECRET`. Optional: call sites holding an `Env` pass it
   * explicitly; the ones that do not (the notification writer sits deep in a
   * producer's call stack) fall back to the value the composition root handed
   * {@link configureEmailRuntime}.
   */
  secret?: string | undefined;
  logger?: EmailLogger | undefined;
  /** Queue writer; defaults to `jobsRepo(meta).enqueue` (tests may record). */
  enqueue?: ((input: EnqueueJobInput) => Promise<Job>) | undefined;
  /** Deliver no earlier than this instant (default: immediately). */
  runAt?: number | undefined;
}

export interface EnqueueEmailInput {
  to: string;
  templateKey: string;
  /** Recipient locale id (`en_US`); defaults to the workspace default. */
  locale?: string | undefined;
  /**
   * Substitutions. Read the expected names off
   * `BUILTIN_EMAIL_TEMPLATE_VARS` rather than guessing — an omitted var is
   * re-emitted verbatim by the renderer, on purpose.
   */
  vars: Record<string, string>;
  /**
   * Used only when the key has NO stored row in any locale. A row that exists
   * but is disabled is an operator decision and always wins over this.
   */
  fallback?: { subject: string; blocks: readonly unknown[] } | undefined;
}

// --- composition-root runtime -------------------------------------------------------

let runtimeSecret: string | null = null;
let unconfiguredLogged = false;

/**
 * Hands the master secret to the email layer once, from `compose.ts`.
 *
 * A module-level value rather than a parameter because the notification writer
 * (`notifications/notify.ts`) is called by producers all over the server that
 * have no reason to know about `Env` — threading a credential through every one
 * of them to serve one optional side effect would be the worse trade.
 */
export function configureEmailRuntime(opts: { secret: string }): void {
  runtimeSecret = opts.secret;
  unconfiguredLogged = false;
}

/** The configured master secret, or null before/without a composition root. */
export function emailRuntimeSecret(): string | null {
  return runtimeSecret;
}

/** Test seam: forget the runtime secret and the once-only log latch. */
export function resetEmailRuntime(): void {
  runtimeSecret = null;
  unconfiguredLogged = false;
}

// --- payload ------------------------------------------------------------------------

/**
 * The sealed half of an `email.send` payload, before encryption. Everything
 * here is either a secret (the token inside `html`/`text`) or personal data
 * (`to`), which is why none of it appears in the stored row.
 */
interface EmailEnvelope {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** The plaintext `adminium_jobs.payload` of an `email.send` row. */
export interface EmailSendPayload {
  v: number;
  templateKey: string;
  locale: string;
  /** `enc:v1:` token over {@link EmailEnvelope} (config/secrets.ts). */
  envelope: string;
}

// --- enqueue ------------------------------------------------------------------------

/**
 * Renders `templateKey` for `to` and queues it.
 *
 * Returns the queued job, or `null` when nothing was queued — no SMTP, no
 * secret, no template row, or a template the operator disabled. NEVER throws
 * for any of those: the caller's own fallback is the contract.
 */
export async function enqueueEmail(
  deps: EnqueueEmailDeps,
  input: EnqueueEmailInput,
): Promise<Job | null> {
  const { meta } = deps;
  const secret = deps.secret ?? runtimeSecret;
  if (secret === null || secret === undefined || secret.length === 0) {
    logUnconfiguredOnce(deps.logger, 'no master secret is available to the email layer');
    return null;
  }
  const to = input.to.trim();
  if (to.length === 0) return null;

  // Cheap short-circuit: an instance with no SMTP must not accumulate a queue
  // of mail it can never deliver, so the check is here and not in the handler.
  // It is also the one call in this function that can throw (a bad stored host,
  // a password encrypted under a different ADMINIUM_SECRET) — and this function
  // promises its callers that it never does. `isEmailConfigured` is the door
  // that DOES surface those, for the routes that want to explain them.
  try {
    if ((await resolveSmtpConfig(meta, emailSecretKey(secret))) === null) {
      logUnconfiguredOnce(deps.logger, 'SMTP is not configured — outbound email is disabled');
      return null;
    }
  } catch (error) {
    deps.logger?.warn({ err: error }, 'stored SMTP settings could not be resolved');
    return null;
  }

  const locale = input.locale ?? (await recipientLocale(meta, null));
  const template = await resolveTemplate(meta, input, locale, deps.logger);
  if (template === null) return null;

  const rendered = renderEmail({
    template,
    locale,
    vars: input.vars,
    dir: isLocaleId(locale) ? dirForLocale(locale) : 'ltr',
  });

  const envelope: EmailEnvelope = {
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
  const payload: EmailSendPayload = {
    v: EMAIL_SEND_PAYLOAD_VERSION,
    templateKey: input.templateKey,
    locale,
    envelope: encryptSecret(JSON.stringify(envelope), emailEnvelopeKey(secret)),
  };

  const enqueue = deps.enqueue ?? ((job: EnqueueJobInput) => jobsRepo(meta).enqueue(job));
  return await enqueue({
    kind: EMAIL_SEND_JOB_KIND,
    payload: payload as unknown as Record<string, unknown>,
    maxAttempts: EMAIL_SEND_MAX_ATTEMPTS,
    ...(deps.runAt === undefined ? {} : { runAt: deps.runAt }),
  });
}

/** True when this instance can actually deliver mail right now. */
export async function isEmailConfigured(meta: MetaDb, secret: string | null): Promise<boolean> {
  const resolved = secret ?? runtimeSecret;
  if (resolved === null || resolved.length === 0) return false;
  return (await resolveSmtpConfig(meta, emailSecretKey(resolved))) !== null;
}

/**
 * The stored row for `templateKey`, or the caller's inline fallback when the
 * key has never been seeded.
 *
 * The distinction the two extra lookups buy: `resolveEmailTemplate` returns
 * null both for "no such template" and for "the operator switched this one
 * off", and only the first of those may be papered over with a fallback.
 */
async function resolveTemplate(
  meta: MetaDb,
  input: EnqueueEmailInput,
  locale: string,
  logger: EmailLogger | undefined,
): Promise<{ subject: string; blocks: readonly unknown[] } | null> {
  const row = await resolveEmailTemplate(meta, input.templateKey, locale);
  if (row !== null) return { subject: row.subject, blocks: row.blocks };

  if (input.fallback !== undefined && !(await templateExists(meta, input.templateKey, locale))) {
    return { subject: input.fallback.subject, blocks: input.fallback.blocks };
  }
  logger?.warn(
    { templateKey: input.templateKey, locale },
    'no enabled email template for this key — nothing sent',
  );
  return null;
}

async function templateExists(meta: MetaDb, key: string, locale: string): Promise<boolean> {
  const repo = emailTemplatesRepo(meta);
  if ((await repo.findByKeyLocale(key, locale)) !== null) return true;
  return (await repo.findByKeyLocale(key, 'en_US')) !== null;
}

/**
 * The absolute origin a link in an outbound email should point at, taken from
 * the request that triggered it.
 *
 * THIS IS DERIVED, NOT CONFIGURED, and the trade-off is deliberate. There is
 * no `system.publicUrl` setting and (v1 decision) no new env var, so the only
 * thing that knows where this instance answers is the request in hand. The
 * consequence an operator must know about: a forged `Host` header can point a
 * reset link at an attacker's origin, so a reverse proxy in front of Adminium
 * should pin `Host` to the real hostname — the standard deployment posture,
 * and the one `@fastify/cors`'s same-origin default already assumes.
 *
 * The `Origin` header wins when present: a browser sets it, and a page cannot
 * forge it cross-origin.
 */
export function requestOrigin(request: {
  protocol: string;
  host?: string | undefined;
  hostname: string;
  headers: Record<string, unknown>;
}): string {
  const origin = request.headers['origin'];
  if (typeof origin === 'string' && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, '');
  return `${request.protocol}://${request.host ?? request.hostname}`;
}

/**
 * "Email is off" is a deployment posture, not an incident: logging it on every
 * notification would drown the log of any instance that simply never set SMTP
 * up. One line per process, at info.
 */
function logUnconfiguredOnce(logger: EmailLogger | undefined, msg: string): void {
  if (unconfiguredLogged) return;
  unconfiguredLogged = true;
  logger?.info({ kind: EMAIL_SEND_JOB_KIND }, msg);
}
