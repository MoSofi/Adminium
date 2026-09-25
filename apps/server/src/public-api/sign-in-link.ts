// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing in by an emailed link: a person types only their address, and a
 * one-use link (with a six-digit code for another device) goes to it.
 *
 * ── THE SAME ANSWER FOR ANY ADDRESS ────────────────────────────────────────
 * The request answers 202 before anything depends on the address: whether
 * mail is set up and the app has a public address are asked first, the same
 * for everyone, and the rest — the caps, the lookup, the challenge, the mail —
 * runs later, in a job on the meta queue. An address that is nobody's gets a
 * DECOY challenge in the same shape as a real one (a code nobody was sent, a
 * token nobody holds), so everything a caller can reach afterwards — the caps,
 * the code path's tries, its day lock — behaves the same for a client and a
 * stranger. Every count is keyed by the address's keyed hash, never by the
 * person's row: a miss is capped and locked exactly as a hit is.
 *
 * ── THE NUMBERS ────────────────────────────────────────────────────────────
 * Per address: three links in fifteen minutes and ten a day, at most three
 * live at once, each for twenty minutes and one use. Five tries per code; ten
 * wrong codes in a day lock the CODE path only — a link's 256-bit token cannot
 * be guessed, so the link in the person's mailbox still works. A new link
 * never takes back an earlier one: a stranger who knows the address can make
 * it receive mail, but cannot void the link its owner is about to press.
 *
 * ── WHAT THE LINK OPENS ────────────────────────────────────────────────────
 * The link names the app's own guest side (`guest-base.ts`), never the host a
 * request came in on, and carries the token in the fragment (`/c#<token>`) so
 * no server or proxy log holds it. Opening it shows a page asking to
 * continue: reading the first name (`peek`) spends nothing, and only the
 * continue (`verify`) uses the link and opens a session — at `verified`, the
 * one way a session begins for such a person. The link stays valid only while
 * the address on the person's row is still the one it was sent to.
 */
import { createHash, randomBytes } from 'node:crypto';

import {
  publicChallengesRepo,
  publicKeysRepo,
  publicScopesRepo,
  settingsRepo,
  connectionTenantConfig,
  type MetaDb,
  type PublicChallenge,
} from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { DsnCrypto } from '@adminium/meta';
import { compileFilter } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { SIGN_IN_LINK_TEMPLATE_KEY, enqueueEmail } from '../email/send.js';
import type { JobRegistry } from '../jobs/registry.js';
import { appContact } from '../outbox/sender.js';
import { CODE_TRIES, DAY_MS, codeBinding, codeMatches, hashAddress, hashCode, newCode } from './claim-code.js';
import { guestBase } from './guest-base.js';
import { mandatoryAt } from './relative-filters.js';
import type { PublicViews } from './runtime.js';
import { compileScope, type CompiledResource, type CompiledScope, type TableColumnLookup } from './scope.js';

/** The challenge purpose a link and its code are stored under. */
export const LINK_PURPOSE = 'link';
/**
 * A link an app's own email carries (`sign-in-link-minter.ts`): the same link,
 * with no code, counted toward no caps.
 */
export const LINK_MAIL_PURPOSE = 'link-mail';
/** Every purpose a link that opens a session is stored under. */
const OPENING_PURPOSES: ReadonlySet<string> = new Set([LINK_PURPOSE, LINK_MAIL_PURPOSE]);
/** How long a link (and its code) lasts. */
export const LINK_TTL_MS = 20 * 60_000;
/** Per address: links in fifteen minutes, links a day, links live at once. */
export const LINK_SENDS_15M = 3;
export const LINK_SENDS_DAY = 10;
export const LINK_LIVE_MAX = 3;
/** Wrong codes a day that lock an address's code path (never its links). */
export const LINK_CODE_FAILURES_DAY = 10;
/** How long after it was sent a link may ask for a new one (once). */
export const LINK_RESEND_WITHIN_MS = DAY_MS;
/** A link's session lasts this long idle, and never longer than the cap. */
export const LINK_SESSION_IDLE_MS = 30 * 60_000;
export const LINK_SESSION_MAX_MS = 12 * 60 * 60_000;

/** The job that does everything an address decides, after the request has answered. */
export const SIGN_IN_LINK_JOB_KIND = 'public.sign-in-link';

/** Who a link's counts are kept against: the address, by its keyed hash — a hit and a miss alike. */
export function linkSubject(destinationHash: string): string {
  return `addr:${destinationHash}`;
}

/** A fresh token (32 random bytes) and the SHA-256 the challenge keeps instead of it. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** What a link challenge opens: the person's row by its key, or nothing (a decoy). */
interface LinkPointer {
  v: 1;
  row: string | number | null;
}

export function sealPointer(crypto: DsnCrypto, row: unknown): string {
  const value = typeof row === 'number' || typeof row === 'string' ? row : row === null || row === undefined ? null : String(row);
  return crypto.encrypt(JSON.stringify({ v: 1, row: value } satisfies LinkPointer));
}

/** The row a challenge opens, or null for a decoy or anything unreadable. */
export function openPointer(crypto: DsnCrypto, sealed: string | null): string | number | null {
  if (sealed === null) return null;
  try {
    const parsed = JSON.parse(crypto.decrypt(sealed)) as Partial<LinkPointer>;
    return parsed.v === 1 && (typeof parsed.row === 'string' || typeof parsed.row === 'number') ? parsed.row : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ the identity */

/** The identity a key signs people in through by link, as the request path needs it. */
export interface LinkIdentity {
  ref: string;
  resource: CompiledResource;
  /** The column holding the address. */
  email: string;
  /** The column a session is pinned to (the row's key). */
  column: string;
}

/** The link identity of a compiled scope, or null when the key signs nobody in that way. */
export function linkIdentityOf(scope: CompiledScope): LinkIdentity | null {
  const claim = scope.claim;
  if (claim === null || claim === undefined || claim.strategy !== 'email-link' || claim.verify !== 'email-link' || claim.email === undefined) return null;
  const resource = scope.byRef.get(claim.ref);
  const column = resource?.claim?.column;
  if (resource === undefined || column === undefined) return null;
  return { ref: claim.ref, resource, email: claim.email, column };
}

/** The identity's table rows, narrowed by the identity's own filters — what a claim would see. */
function identityQuery(db: Kysely<SourceDatabase>, view: SnapshotView, table: ResolvedTable, identity: LinkIdentity, timezone: string, dialect: Parameters<typeof compileFilter>[1]['dialect']) {
  let query = db.selectFrom(table.id as never).selectAll();
  const mandatory = mandatoryAt(identity.resource.where, table, timezone);
  if (mandatory !== null) {
    const ctx = { view, table, canReadPii: true, dynamic: db.dynamic, dialect };
    query = query.where((eb) => compileFilter(eb as never, ctx, mandatory));
  }
  return query;
}

/**
 * The one person whose address this is, or null for nobody — or for two,
 * which is nobody's.
 *
 * The database finds the candidates, and the address's own keyed hash
 * decides: a MySQL collation reads `adà@` as `ada@`, and a look-alike
 * spelling must be a stranger's address — counted, capped and answered as
 * one — never a second way to mail a client.
 */
export async function personByAddress(input: {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  table: ResolvedTable;
  identity: LinkIdentity;
  timezone: string;
  dialect: Parameters<typeof compileFilter>[1]['dialect'];
  address: string;
  addressSecret: Buffer;
}): Promise<Row | null> {
  const typed = hashAddress(input.addressSecret, input.address);
  const candidates = (await identityQuery(input.db, input.view, input.table, input.identity, input.timezone, input.dialect)
    .where(sql`lower(trim(${sql.ref(input.identity.email)}))`, '=', input.address.trim().toLowerCase() as never)
    .limit(20)
    .execute()) as Row[];
  const rows = candidates.filter((row) => {
    const email = row[input.identity.email];
    return typeof email === 'string' && hashAddress(input.addressSecret, email) === typed;
  });
  return rows.length === 1 ? (rows[0] as Row) : null;
}

/** The person a link names, by their key, while the identity still shows them. */
export async function personByKey(input: {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  table: ResolvedTable;
  identity: LinkIdentity;
  timezone: string;
  dialect: Parameters<typeof compileFilter>[1]['dialect'];
  value: string | number;
}): Promise<Row | null> {
  const rows = (await identityQuery(input.db, input.view, input.table, input.identity, input.timezone, input.dialect)
    .where(input.db.dynamic.ref(input.identity.column), '=', input.value as never)
    .limit(2)
    .execute()) as Row[];
  return rows.length === 1 ? (rows[0] as Row) : null;
}

/** The first name a link's page greets its person by: the first word of the identity's first shown column. */
export function firstNameOf(row: Row, identity: LinkIdentity): string {
  const shown = identity.resource.expose[0];
  const value = shown === undefined ? null : row[shown];
  return typeof value === 'string' ? (value.trim().split(/\s+/)[0] ?? '') : '';
}

/* -------------------------------------------------------- the key, by id */

export interface KeyedScope {
  keyId: string;
  connectionId: string;
  managedBy: string | null;
  scope: CompiledScope;
}

/**
 * A key's compiled scope, by the key's id — what a job needs, since it holds
 * no token. Null for a key revoked, expired or gone, or a scope that no
 * longer compiles: a link is never sent for a key that could not serve it.
 */
export async function scopeOfKey(meta: MetaDb, views: PublicViews, keyId: string, now: number = Date.now()): Promise<KeyedScope | null> {
  const key = await publicKeysRepo(meta).findById(keyId);
  if (key === null || key.revokedAt !== null || (key.expiresAt !== null && key.expiresAt <= now)) return null;
  const scopeRow = await publicScopesRepo(meta).findById(key.scopeId);
  if (scopeRow === null) return null;
  const view = await views.viewFor(scopeRow.connectionId);
  const columnsOf: TableColumnLookup | undefined =
    view === null
      ? undefined
      : (table) => {
          try {
            return new Set(view.table(table).columns.keys());
          } catch {
            return null;
          }
        };
  try {
    const inherited = (await connectionTenantConfig(meta, scopeRow.connectionId)) ?? undefined;
    const scope = compileScope(JSON.parse(scopeRow.document) as unknown, columnsOf, inherited, { derived: (scopeRow.derivedForKey ?? null) !== null });
    return { keyId: key.id, connectionId: scopeRow.connectionId, managedBy: key.managedBy ?? null, scope };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ the job */

export const signInLinkJobSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('start'), keyId: z.string().min(1).max(64), address: z.string().min(1).max(4096), locale: z.string().min(2).max(16) }).strict(),
  z.object({ mode: z.literal('resend'), keyId: z.string().min(1).max(64), tokenHash: z.string().regex(/^[0-9a-f]{64}$/), locale: z.string().min(2).max(16) }).strict(),
]);
export type SignInLinkJob = z.infer<typeof signInLinkJobSchema>;

export interface SignInLinkDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  views: PublicViews;
  /** Addresses in a job's payload and a challenge's pointer are sealed with this. */
  crypto: DsnCrypto;
  addressSecret: Buffer;
  codeSecret: Buffer;
  hostFor?: ((appKey: string) => Promise<string | undefined>) | undefined;
  logger?: { warn(obj: Record<string, unknown>, msg?: string): void; info(obj: Record<string, unknown>, msg?: string): void } | undefined;
  now?: () => number;
}

/** The payload of a link asked for by address: the address sealed, never plain in the queue. */
export function startPayload(crypto: DsnCrypto, keyId: string, address: string, locale: string): SignInLinkJob {
  return { mode: 'start', keyId, address: crypto.encrypt(address.trim()), locale };
}

/**
 * Everything an address decides, in one path for a hit and a miss: the caps
 * (by the address), the lookup, the challenge — real or decoy — and, for a
 * person, the email. A resend is the same, for the address a link was sent to
 * and only while it is still that person's address.
 */
export async function runSignInLinkJob(deps: SignInLinkDeps, job: SignInLinkJob): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const challenges = publicChallengesRepo(deps.meta);
  const keyed = await scopeOfKey(deps.meta, deps.views, job.keyId, now);
  const identity = keyed === null ? null : linkIdentityOf(keyed.scope);
  if (keyed === null || identity === null) return;
  const view = await deps.views.viewFor(keyed.connectionId);
  if (view === null) return;
  let table: ResolvedTable;
  try {
    table = view.table(identity.resource.table);
  } catch {
    return;
  }
  const { db, dialect } = await deps.manager.data(keyed.connectionId);
  const found = { db, view, table, identity, timezone: keyed.scope.timezone, dialect };

  let address: string;
  let known: Row | null = null;
  let resent = false;
  if (job.mode === 'start') {
    address = deps.crypto.decrypt(job.address);
  } else {
    /*
     * "Email me a new link": to that link's own address, while it is still
     * the person's — once per link, and only within a day of it being sent,
     * so a forwarded old email is not a lever to keep mailing its owner.
     */
    const earlier = await challenges.findByTokenHash(job.tokenHash);
    if (earlier === null || !OPENING_PURPOSES.has(earlier.purpose) || earlier.keyId !== keyed.keyId) return;
    const pointer = openPointer(deps.crypto, earlier.newDestinationEnc);
    if (pointer === null || !(await challenges.takeResend(earlier.id, LINK_RESEND_WITHIN_MS, now))) return;
    const row = await personByKey({ ...found, value: pointer });
    const current = row?.[identity.email];
    if (row === null || typeof current !== 'string' || hashAddress(deps.addressSecret, current) !== earlier.destinationHash) return;
    address = current;
    known = row;
    resent = true;
  }

  const destinationHash = hashAddress(deps.addressSecret, address);
  const subject = linkSubject(destinationHash);
  // The caps, before anything about the address is looked up.
  if (
    (await challenges.sentSince(subject, now - 15 * 60_000, LINK_PURPOSE)) >= LINK_SENDS_15M ||
    (await challenges.sentSince(subject, now - DAY_MS, LINK_PURPOSE)) >= LINK_SENDS_DAY ||
    (await challenges.liveLinks(subject, now)) >= LINK_LIVE_MAX
  ) {
    deps.logger?.info({ keyId: keyed.keyId, resent }, 'sign-in link held: this address has had as many as it may for now');
    return;
  }
  const person = known ?? (await personByAddress({ ...found, address, addressSecret: deps.addressSecret }));
  const { token, hash } = newLinkToken();
  const code = newCode();
  await challenges.create(
    {
      keyId: keyed.keyId,
      ref: identity.ref,
      destinationHash,
      codeHash: hashCode(deps.codeSecret, codeBinding({ sessionId: null, purpose: LINK_PURPOSE, createdAt: now }), code),
      expiresAt: now + LINK_TTL_MS,
      sessionId: null,
      purpose: LINK_PURPOSE,
      newDestinationEnc: sealPointer(deps.crypto, person === null ? null : person[identity.column]),
      subject,
      tokenHash: hash,
    },
    now,
  );
  if (person === null) return;

  /*
   * From here a failure sends nothing and closes nothing: the real link stays
   * open as a stranger's decoy stays open, so no answer a caller can reach
   * afterwards — a code typed, a link peeked — tells a client from a stranger.
   */
  const base = keyed.managedBy === null ? null : await guestBase({ meta: deps.meta, hostFor: deps.hostFor }, keyed.managedBy);
  const to = person[identity.email];
  if (base === null || typeof to !== 'string') {
    deps.logger?.warn({ keyId: keyed.keyId, app: keyed.managedBy }, 'sign-in link not sent: the app has no public address');
    return;
  }
  const contact = keyed.managedBy === null ? null : await appContact(deps.meta, deps.manager, keyed.managedBy, keyed.connectionId);
  const vars = {
    appName: contact?.name ?? String((await settingsRepo(deps.meta).get('branding.appName')) ?? 'Adminium'),
    link: `${base}/c#${token}`,
    code,
    minutes: String(LINK_TTL_MS / 60_000),
  };
  const logger = deps.logger === undefined ? {} : { logger: deps.logger as never };
  const send = (locale: string) => enqueueEmail({ meta: deps.meta, ...logger }, { to: to.trim(), templateKey: SIGN_IN_LINK_TEMPLATE_KEY, locale, vars });
  // A language whose template is switched off still signs its person in: in US English.
  if ((await send(job.locale)) === null && job.locale !== 'en_US' && (await send('en_US')) === null) {
    deps.logger?.warn({ keyId: keyed.keyId, app: keyed.managedBy }, 'sign-in link not sent: no sign-in link template could be sent');
  }
}

/** Registers the job on the shared queue — internal: only the link routes enqueue it. */
export function registerSignInLinkJob(registry: JobRegistry, deps: SignInLinkDeps): void {
  if (registry.has(SIGN_IN_LINK_JOB_KIND)) return;
  registry.registerJobHandler(SIGN_IN_LINK_JOB_KIND, signInLinkJobSchema, async (payload) => runSignInLinkJob(deps, payload), { internal: true });
}

/* ---------------------------------------------------- opening a link */

/**
 * The live link a token names on this key, and the person it opens — or
 * null for a token used, expired, taken back, a decoy's, another key's, or
 * one whose person's address has since changed. One answer for all of them.
 */
export async function openLink(input: {
  deps: Pick<SignInLinkDeps, 'meta' | 'crypto' | 'addressSecret'>;
  keyId: string;
  token: string;
  identity: LinkIdentity;
  found: { db: Kysely<SourceDatabase>; view: SnapshotView; table: ResolvedTable; timezone: string; dialect: Parameters<typeof compileFilter>[1]['dialect'] };
  now: number;
}): Promise<{ challenge: PublicChallenge; person: Row } | null> {
  const challenge = await publicChallengesRepo(input.deps.meta).findByTokenHash(hashLinkToken(input.token));
  if (challenge === null || !OPENING_PURPOSES.has(challenge.purpose) || challenge.keyId !== input.keyId) return null;
  if (challenge.consumedAt !== null || challenge.expiresAt <= input.now) return null;
  return personOfChallenge(input, challenge);
}

/** The person a link challenge opens, while the address it was sent to is still theirs. */
export async function personOfChallenge(
  input: {
    deps: Pick<SignInLinkDeps, 'crypto' | 'addressSecret'>;
    identity: LinkIdentity;
    found: { db: Kysely<SourceDatabase>; view: SnapshotView; table: ResolvedTable; timezone: string; dialect: Parameters<typeof compileFilter>[1]['dialect'] };
  },
  challenge: PublicChallenge,
): Promise<{ challenge: PublicChallenge; person: Row } | null> {
  const pointer = openPointer(input.deps.crypto, challenge.newDestinationEnc);
  if (pointer === null) return null;
  const person = await personByKey({ ...input.found, identity: input.identity, value: pointer });
  const current = person?.[input.identity.email];
  if (person === null || typeof current !== 'string' || hashAddress(input.deps.addressSecret, current) !== challenge.destinationHash) return null;
  return { challenge, person };
}

/**
 * A code typed on another device, against the links open for an address.
 * Every open code takes one of its five tries BEFORE it is compared, and only
 * a code that took one is compared — so no code is ever compared more than
 * five times, however many links are open or guesses in flight, and a right
 * code from an older email still works. (The day's count of guesses is the
 * route's, taken first.) A decoy's code matches nothing a person was sent.
 */
export async function tryLinkCode(input: {
  meta: MetaDb;
  codeSecret: Buffer;
  open: readonly PublicChallenge[];
  code: string;
  now: number;
}): Promise<{ outcome: 'right'; challenge: PublicChallenge } | { outcome: 'wrong'; triesLeft: number } | { outcome: 'expired' }> {
  const challenges = publicChallengesRepo(input.meta);
  const charged: { challenge: PublicChallenge; tries: number }[] = [];
  for (const challenge of input.open) {
    const tries = await challenges.charge(challenge.id, CODE_TRIES);
    if (tries !== null) charged.push({ challenge, tries });
  }
  if (charged.length === 0) return { outcome: 'expired' };
  let matched: PublicChallenge | null = null;
  for (const { challenge } of charged) {
    // Every charged code compared, whichever matches: the time taken says nothing about which.
    if (codeMatches(input.codeSecret, codeBinding(challenge), input.code, challenge.codeHash) && matched === null) matched = challenge;
  }
  // A code out of tries takes no more (`charge` refuses it), but its LINK is not
  // used up: guessing at a person's code must never void the link in their mailbox.
  if (matched === null) return { outcome: 'wrong', triesLeft: Math.max(CODE_TRIES - Math.min(...charged.map((c) => c.tries)), 0) };
  return (await challenges.consume(matched.id, input.now)) ? { outcome: 'right', challenge: matched } : { outcome: 'expired' };
}
