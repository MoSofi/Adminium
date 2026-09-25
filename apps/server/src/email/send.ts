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
 * WHY BYTES DO NOT. An attachment is a library file and the brand mark is a
 * shipped PNG; the payload carries their IDS and delivery reads the bytes
 * right before `sendMail`. A queue that copied every PDF into every row
 * would be a second file store with no retention policy.
 *
 * WHY THE BODY IS ENCRYPTED AT REST. A rendered password-reset or invite mail
 * contains the PLAINTEXT single-use token — the exact thing
 * `adminium_password_resets` stores only as a SHA-256 so that reading the meta
 * store cannot become an account takeover. `adminium_jobs.payload` is readable
 * through `GET /jobs/:id`, so parking the rendered HTML there raw would undo
 * that guarantee through the back door. The envelope (recipient, subject,
 * html, text, from) is therefore sealed with the same AES-256-GCM primitive
 * that protects DSNs and TOTP secrets (`config/secrets.ts`); the plaintext
 * payload carries only the template key, the locale and file ids, which are
 * not secrets.
 *
 * TWO KEYS, TWO PURPOSES. {@link emailEnvelopeKey} seals the queued body;
 * `emailSecretKey` (config.ts) opens the stored SMTP password. Separate HKDF
 * salts, — a job row and a settings row are different blast radii and must
 * not share a key.
 *
 * DEGRADATION IS THE DEFAULT. Email is optional infrastructure: a self-hosted
 * instance with no SMTP must keep working. Every path here returns quietly
 * when the transport is unconfigured, a template is missing, or the recipient
 * has no address — the CALLER's fallback (the copyable activation link, the
 * in-app notification row) is the product, not an error page.
 */
import {
  emailTemplatesRepo,
  filesRepo,
  jobsRepo,
  settingsRepo,
  type EmailAttachment,
  type EmailBrand,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
} from '@adminium/meta';
import { dirForLocale, isLocaleId } from '@adminium/i18n';

import { deriveKey, encryptSecret } from '../config/secrets.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { builtinEmailTemplates, resolveEmailTemplate, translatorForLocale } from './builtins.js';
import { emailSecretKey, resolveSmtpConfig } from './config.js';
import { bareAddress } from './document.js';
import { isShippedMark } from './marks.js';
import {
  DEFAULT_EMAIL_MARK,
  MARK_CID,
  effectiveBrand,
  renderEmail,
  type EmailInlineRef,
  type RenderEmailInput,
  type RenderedEmail,
} from './render.js';
import type { EmailRenderSource, EmailSendAttachmentRef, EmailSendInlineRef } from './types.js';

/** The `adminium_jobs.kind` of a queued outbound email. */
export const EMAIL_SEND_JOB_KIND = 'email.send';

/**
 * Payload envelope version. `2` (39) adds `attachments` and `inline`
 * references beside the sealed body; `1` rows still deliver.
 */
export const EMAIL_SEND_PAYLOAD_VERSION = 2;

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
 * The document a mapping drew, on its way out.
 *
 * Here rather than in `documents/deliver.ts` because `builtins.ts` says these
 * constants live in this file, and `email-render.test.ts` checks that every one
 * of them is seeded. A key the send layer can name from somewhere else is a key
 * that gate cannot see.
 */
export const DOCUMENT_READY_TEMPLATE_KEY = 'document-ready';
/** A guest's booking through an app's public page (`public-api/confirm.ts`). */
export const BOOKING_CONFIRMATION_TEMPLATE_KEY = 'booking-confirmation';
/** The code that raises a found session to verified, and the notice an address change sends the old one. */
export const SIGN_IN_CODE_TEMPLATE_KEY = 'sign-in-code';
export const EMAIL_CHANGED_TEMPLATE_KEY = 'email-changed';

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
   * re-emitted verbatim by the renderer, on purpose. A `generated` attachment's
   * token is resolved from here too: `vars[token]` must be a file id.
   */
  vars: Record<string, string>;
  /**
   * Used only when the key has NO stored row in any locale. A row that exists
   * but is disabled is an operator decision and always wins over this.
   */
  fallback?: { subject: string; blocks: readonly unknown[] } | undefined;
  /**
   * A security notice ("your address was changed"): a built-in the operator
   * switched off or archived is sent from its own shipped text instead, since
   * the person it protects must hear of the change whatever the settings say.
   */
  always?: boolean | undefined;
  /** The row to tell when the message fails for good. */
  report?: EmailSendReport | undefined;
  /** Collapses a second queueing of the same message while the first is pending or running. */
  dedupeKey?: string | undefined;
  /** Library files this one message carries besides the template's own (a drawn document). */
  attachments?: readonly EmailSendAttachmentRef[] | undefined;
  /**
   * Wording a person wrote in place of the template's (a held reminder edited
   * before it was approved). The body is plain text: paragraphs split on
   * blank lines, drawn as ONE text block in place of the template's blocks,
   * its variables filled in one pass and escaped like any other — never an
   * HTML block. Line breaks in the subject become spaces.
   */
  override?: { subject?: string | null | undefined; body?: string | null | undefined } | undefined;
}

/** The template with a person's wording in place of its own; unchanged where they wrote nothing. */
export function withOverride<T extends { subject: string; blocks: readonly Record<string, unknown>[] }>(source: T, override: EnqueueEmailInput['override']): T {
  if (override === undefined) return source;
  const subject = typeof override.subject === 'string' ? override.subject.replaceAll(/[\r\n]+/g, ' ').trim() : '';
  const paras =
    typeof override.body === 'string'
      ? override.body
          .replaceAll(/\r\n?/g, '\n')
          .split(/\n[ \t]*\n/)
          .map((para) => para.trim())
          .filter((para) => para !== '')
      : [];
  return {
    ...source,
    ...(subject === '' ? {} : { subject }),
    ...(paras.length === 0 ? {} : { blocks: [{ block: 'email.text', id: 'override-1', data: { paras } }] }),
  };
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
  from?: string | undefined;
}

/** The plaintext `adminium_jobs.payload` of an `email.send` row. */
/**
 * The row a message was sent for, told when the message fails for good — an
 * app's outbox row, which then reads `failed` instead of `sent`. Ids only:
 * the job row never holds an address.
 */
export interface EmailSendReport {
  app: string;
  connectionId: string;
  table: string;
  pk: Record<string, string | number>;
  /** When the row was marked sent: a later send of the same row is not this message's to fail. */
  sentAt?: number | undefined;
}

export interface EmailSendPayload {
  v: number;
  templateKey: string;
  locale: string;
  /** `enc:v1:` token over {@link EmailEnvelope} (config/secrets.ts). */
  envelope: string;
  /** Who to tell when the message cannot be delivered after every try. */
  report?: EmailSendReport;
  /** Library files whose bytes travel with the message; absent on `v: 1` rows.
   * */
  attachments?: EmailSendAttachmentRef[];
  /** Inline images the HTML references by `cid:`; absent on `v: 1` rows. */
  inline?: EmailSendInlineRef[];
}

// --- the document → what the renderer and the queue need ----------------------------

/** Everything a stored document contributes to one send, resolved once. */
export interface PreparedEmail {
  render: Pick<RenderEmailInput, 'document' | 'brand' | 'mark' | 'imageFiles'>;
  /** A configured sender's `Name <addr>`, or undefined for the transport's own. */
  from: string | undefined;
  /** Fixed attachments — the library files that exist. */
  attachments: EmailSendAttachmentRef[];
  /** Fixed attachments whose file is missing or trashed — reported, never silently dropped. */
  missing: { id: string; fileId: string }[];
}

/**
 * Resolve a document's brand, mark, images and fixed attachments against the
 * workspace. Exported for the routes (test-send carries the on-screen
 * document) and the campaign runner.
 *
 * The From header is `"${fromName} <${fromEmail}>"` only when the document
 * names a configured sender; `validateDocument` refused anything else at save
 * time, and this re-checks so a stale row cannot send from an address the
 * operator has since removed.
 */
export async function prepareEmail(meta: MetaDb, doc: EmailRenderSource): Promise<PreparedEmail> {
  const settings = settingsRepo(meta);
  const [appName, accent, logoFileId, smtp, senders] = await Promise.all([
    settings.get('branding.appName'),
    settings.get('appearance.accent'),
    settings.get('branding.logoFileId'),
    settings.get('email.smtp'),
    settings.get('email.senders'),
  ]);
  const files = filesRepo(meta);

  // The mark: the document's choice, else the workspace logo when there is one, else the comp's default.
  const wanted = doc.brand?.mark ?? (logoFileId === null ? DEFAULT_EMAIL_MARK : 'logo');
  let mark: RenderEmailInput['mark'];
  if (wanted === 'logo') {
    const logo = logoFileId === null ? null : await files.findById(logoFileId);
    mark = logo !== null && logo.deletedAt === null ? { kind: 'file', fileId: logo.id } : { kind: 'mark', mark: DEFAULT_EMAIL_MARK };
  } else {
    mark = { kind: 'mark', mark: isShippedMark(wanted) ? wanted : DEFAULT_EMAIL_MARK };
  }

  // Images: only the file ids that exist travel by CID; the rest fall back to their URL.
  const imageFiles = new Set<string>();
  for (const block of doc.blocks) {
    if (block['block'] !== 'email.image') continue;
    const data = block['data'];
    const fileId = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['fileId'] : undefined;
    if (typeof fileId !== 'string' || fileId === '') continue;
    const row = await files.findById(fileId);
    if (row !== null && row.deletedAt === null) imageFiles.add(fileId);
  }

  const attachments: EmailSendAttachmentRef[] = [];
  const missing: PreparedEmail['missing'] = [];
  for (const attachment of doc.attachments) {
    if (attachment.kind !== 'file') continue;
    const row = await files.findById(attachment.fileId);
    if (row === null || row.deletedAt !== null) missing.push({ id: attachment.id, fileId: attachment.fileId });
    else attachments.push({ fileId: row.id, filename: row.filename });
  }

  const from = senderHeader(doc.brand, [
    ...(smtp === null ? [] : [smtp.from]),
    ...senders.map((s) => (s.name.trim() === '' ? s.address : `${s.name} <${s.address}>`)),
  ]);

  return {
    render: {
      document: { subject: doc.subject, preheader: doc.preheader, blocks: doc.blocks, footer: doc.footer },
      brand: effectiveBrand(doc.brand, { appName, accent }),
      mark,
      imageFiles,
    },
    from,
    attachments,
    missing,
  };
}

/** `Name <addr>` when the document's sender is configured; undefined otherwise.
 * */
export function senderHeader(brand: EmailBrand | null, configured: readonly string[]): string | undefined {
  if (brand === null || brand.fromEmail.trim() === '') return undefined;
  const wanted = bareAddress(brand.fromEmail);
  const match = configured.find((entry) => bareAddress(entry) === wanted);
  if (match === undefined) return undefined;
  const name = brand.fromName.trim();
  return name === '' ? wanted : `${name} <${wanted}>`;
}

/**
 * A `generated` attachment names a `{{token}}`; the caller fills it with a
 * file id per send. An unknown or non-file value is skipped with one
 * warning — the caller's contract, like an unresolved `{{var}}`.
 */
export async function resolveGeneratedAttachments(
  meta: MetaDb,
  attachments: readonly EmailAttachment[],
  vars: Record<string, string>,
  logger: EmailLogger | undefined,
): Promise<EmailSendAttachmentRef[]> {
  const out: EmailSendAttachmentRef[] = [];
  const files = filesRepo(meta);
  for (const attachment of attachments) {
    if (attachment.kind !== 'generated') continue;
    const name = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/.exec(attachment.token)?.[1] ?? attachment.token;
    const fileId = vars[name];
    const row = fileId === undefined || fileId === '' ? null : await files.findById(fileId);
    if (row === null || row.deletedAt !== null) {
      logger?.warn(
        { token: attachment.token, label: attachment.label },
        'generated attachment token did not resolve to a library file — skipped',
      );
      continue;
    }
    out.push({ fileId: row.id, filename: row.filename });
  }
  return out;
}

/** The queue-side shape of the renderer's inline references. */
export function inlineRefs(rendered: RenderedEmail): EmailSendInlineRef[] {
  return rendered.inline.map((ref: EmailInlineRef) => (ref.kind === 'mark' ? { cid: ref.cid, kind: 'mark', mark: ref.mark } : { cid: ref.cid, kind: 'file', fileId: ref.fileId }));
}

// --- enqueue ------------------------------------------------------------------------

export interface EnqueueRenderedEmailInput {
  to: string;
  templateKey: string;
  locale: string;
  rendered: Pick<RenderedEmail, 'subject' | 'html' | 'text' | 'inline'>;
  from?: string | undefined;
  attachments?: readonly EmailSendAttachmentRef[] | undefined;
  /** Collapses duplicates while a job with the same key is pending/running. */
  dedupeKey?: string | null | undefined;
  report?: EmailSendReport | undefined;
}

/**
 * Seal an already-rendered message and queue it. The lower half of
 * {@link enqueueEmail}, used directly by test sends (which render the
 * on-screen document) and by anything else that already has a body.
 * Returns null when no secret is available — never throws.
 */
export async function enqueueRenderedEmail(
  deps: EnqueueEmailDeps,
  input: EnqueueRenderedEmailInput,
): Promise<Job | null> {
  const secret = deps.secret ?? runtimeSecret;
  if (secret === null || secret === undefined || secret.length === 0) {
    logUnconfiguredOnce(deps.logger, 'no master secret is available to the email layer');
    return null;
  }
  const to = input.to.trim();
  if (to.length === 0) return null;

  const envelope: EmailEnvelope = {
    to,
    subject: input.rendered.subject,
    html: input.rendered.html,
    text: input.rendered.text,
    ...(input.from === undefined ? {} : { from: input.from }),
  };
  const inline = inlineRefs(input.rendered as RenderedEmail);
  const attachments = [...(input.attachments ?? [])];
  const payload: EmailSendPayload = {
    v: EMAIL_SEND_PAYLOAD_VERSION,
    templateKey: input.templateKey,
    locale: input.locale,
    envelope: encryptSecret(JSON.stringify(envelope), emailEnvelopeKey(secret)),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(inline.length === 0 ? {} : { inline }),
    ...(input.report === undefined ? {} : { report: input.report }),
  };

  const enqueue = deps.enqueue ?? ((job: EnqueueJobInput) => jobsRepo(deps.meta).enqueue(job));
  return await enqueue({
    kind: EMAIL_SEND_JOB_KIND,
    payload: payload as unknown as Record<string, unknown>,
    maxAttempts: EMAIL_SEND_MAX_ATTEMPTS,
    ...(deps.runAt === undefined ? {} : { runAt: deps.runAt }),
    ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
  });
}

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
  const found = await resolveTemplate(meta, input, locale, deps.logger);
  if (found === null) return null;
  const row = withOverride(found, input.override);

  const prepared = await prepareEmail(meta, row);
  for (const gone of prepared.missing) {
    deps.logger?.warn(
      { templateKey: input.templateKey, attachmentId: gone.id, fileId: gone.fileId },
      'a fixed attachment names a missing or trashed file — the send will fail at delivery',
    );
    // Queue it anyway with the reference: the handler fails LOUDLY on it,
    // which is what makes the dead-letter row an operator can act on.
    prepared.attachments.push({ fileId: gone.fileId, filename: gone.fileId });
  }
  const generated = await resolveGeneratedAttachments(meta, row.attachments, input.vars, deps.logger);

  const rendered = renderEmail({
    ...prepared.render,
    locale,
    vars: input.vars,
    dir: isLocaleId(locale) ? dirForLocale(locale) : 'ltr',
  });

  return await enqueueRenderedEmail(
    { ...deps, secret },
    {
      to,
      templateKey: input.templateKey,
      locale,
      rendered,
      from: prepared.from,
      attachments: [...prepared.attachments, ...generated, ...(input.attachments ?? [])],
      report: input.report,
      ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
    },
  );
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
): Promise<EmailRenderSource | null> {
  const row = await resolveEmailTemplate(meta, input.templateKey, locale);
  if (row !== null) return row;
  if (input.always === true) {
    const def = builtinEmailTemplates((await translatorForLocale(meta, locale)).t).find((d) => d.key === input.templateKey);
    if (def !== undefined) {
      return { subject: def.subject, preheader: def.preheader ?? '', blocks: def.blocks, footer: def.footer, brand: null, attachments: [] };
    }
  }

  if (input.fallback !== undefined && !(await templateExists(meta, input.templateKey, locale))) {
    return {
      subject: input.fallback.subject,
      preheader: '',
      blocks: input.fallback.blocks as Record<string, unknown>[],
      footer: '',
      brand: null,
      attachments: [],
    };
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
 * "Email is off" is a deployment posture, not an incident: logging it on every
 * notification would drown the log of any instance that simply never set SMTP
 * up. One line per process, at info.
 */
function logUnconfiguredOnce(logger: EmailLogger | undefined, msg: string): void {
  if (unconfiguredLogged) return;
  unconfiguredLogged = true;
  logger?.info({ kind: EMAIL_SEND_JOB_KIND }, msg);
}

export { MARK_CID };
