// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connected accounts: one outside account per row of an app (a team member's
 * calendar) or per install, signed in by the person it belongs to.
 *
 * ─── THE WAY IN ─────────────────────────────────────────────────────────────
 * Everyone comes through one door (`routes/connect-door`), signed in or not.
 *
 *  1. A LINK says which row, which add-ons and why. 256 random bits, kept as a
 *     hash, seven days, one per row. Opening it spends nothing, because a mail
 *     scanner opens every link. It is spent by a successful connect only.
 *  2. START, a POST from the door page, sets a `__Host-` cookie and stores its
 *     nonce's hash with the flow. An authorize address copied to someone else
 *     then ends in "Nothing was connected" in their browser.
 *  3. The provider sends the browser to the FIXED callback, whose GET does no
 *     work. The door page POSTs the code to COMPLETE, the only writer.
 *
 * ─── WHAT A CONNECT PROVES ──────────────────────────────────────────────────
 * The account's stable id comes from the sign-in itself. An account already on
 * the row can only be replaced by the same account. A short grant, an answer
 * with no refresh token, or one that does not say who signed in connects
 * nothing, and the link still works for another try.
 *
 * ─── ENDING ONE ─────────────────────────────────────────────────────────────
 * {@link ConnectedAccounts.end} is the one pipeline, used by a disconnect, an
 * uninstall and the sweep for rows that are gone or switched off: cleanups
 * first (they need a working token), then revoke, then the tokens go. What
 * could not be undone at the provider is reported, never hidden.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { DEMO_CALENDAR_SUBJECT_PREFIX } from '@adminium/add-on-contracts';
import { connectedAccountsSchema, isAddOnManifest, validateManifest, type AddOnManifest, type ConnectedAccountsRule } from '@adminium/manifest';
import {
  appTablesRepo,
  usersRepo,
  auditRepo,
  connectedAccountsRepo,
  installTarget,
  INSTALL_ACCOUNT_TABLE,
  manifestsRepo,
  realTableOf,
  type AccountTarget,
  type ConnectedAccount,
  type ConnectLink,
  type CredentialCrypto,
  type InstalledManifest,
  type MetaDb,
} from '@adminium/meta';

import type { AddOnHttpClient } from '../add-ons/egress.js';
import { AddOnOAuthError, exchangeAuthorizationCode } from '../add-ons/oauth.js';
import { strangerBusiness } from '../forms/view.js';
import { installOnConnection } from '../installs/resolve.js';
import type { Reachability } from '../payments/reachability.js';
import { mailConnected, mailConnectLink, tellClientRefused, tellConnected, tellSecretEnding, type AccountNoticeDeps } from './notices.js';
import {
  accountSpecOf,
  connectReachOf,
  CONNECT_DOOR_PATH,
  endpointsFor,
  identityOf,
  missingScopes,
  redirectUriFor,
  registrationOf,
  type AccountSpec,
  type AppRegistration,
  type ConnectReach,
} from './spec.js';
import { AccountTokenError, createTokenService, type AccountInstall, type TokenService } from './tokens.js';

/** How long a mailed or copied link works. */
export const CONNECT_LINK_DAYS = 7;
const LINK_LIFETIME_MS = CONNECT_LINK_DAYS * 86_400_000;
/** A link minted for the person pressing "Connect" right now. */
const SELF_LINK_LIFETIME_MS = 30 * 60_000;
/** How long a started sign-in stays completable. */
export const FLOW_LIFETIME_MS = 10 * 60_000;
/** A refresh token that ends this soon after connecting means the provider's app is still in testing. */
const TESTING_GRANT_MS = 8 * 86_400_000;

export type Row = Record<string, unknown>;

/** How the engine reads the app's rows. */
export interface AccountRows {
  /** The row, read as the engine. Undefined: it is not there. Throws when the database cannot answer. */
  read(connectionId: string, table: string, rowKey: string): Promise<Row | undefined>;
  /** The id the database's snapshot gives a table of an app's record (`realTableOf`), or null when it has none. */
  tableId(connectionId: string, real: string): Promise<string | null>;
  /** Up to `limit` rows of a table with their keys, read as the engine. A caller judges who may see each. */
  list(connectionId: string, table: string, limit: number): Promise<{ rowKey: string; row: Row }[]>;
}

/** What "Check my setup" can truly know about the client ID and secret, with nobody signed in. */
export type AppCheck = 'accepted' | 'refused' | 'expired' | 'not-set-up' | 'unknown' | 'unreachable';

/** A code no provider ever issued: a right ID and secret get `invalid_grant` for it, a wrong pair `invalid_client`. */
const SETUP_CHECK_CODE = 'adminium-setup-check';
/** Microsoft's own number for a client secret past its end date. */
const SECRET_EXPIRED_CODE = 7000222;
const SECRET_NOTICE_MS = 30 * 86_400_000;

/** A table whose rows may connect. */
export interface AccountTable {
  appKey: string;
  rule: ConnectedAccountsRule;
}

/** What a step may do at the end of a connection, before the tokens go (sync adds its own). */
export interface AccountCleanup {
  /** Best effort: returns what it removed, or throws, and the pipeline goes on. */
  run(input: { account: ConnectedAccount; tokens: TokenService }): Promise<{ removed: number }>;
}

export interface EndResult {
  /** Removed at the provider by the cleanups. */
  removed: number;
  /** A cleanup could not finish, so some of what was written stays there. */
  incomplete: boolean;
  /** Whether the grant was given back at the provider. Null: it declares no way to. */
  revoked: boolean | null;
}

export type DoorOutcome =
  | { outcome: 'connected'; address: string | null; addressDiffers: boolean; testing: boolean }
  | { outcome: 'partial'; missing: string[] }
  | { outcome: 'different-account' }
  | { outcome: 'other-provider' }
  | { outcome: 'denied' }
  | { outcome: 'needs-admin' }
  | { outcome: 'setup' }
  /** Nothing was connected: a stale or foreign flow, or an answer that could not be used. */
  | { outcome: 'nothing' };

export interface OpenedLink {
  link: ConnectLink;
  business: string;
  /** Where the person may write to the business. */
  contact: string | null;
  person: string | null;
  /** The address the link was made for, shown so a person can see it is theirs. */
  address: string | null;
  /** Who sent it, by name. */
  sentBy: string | null;
  providers: { key: string; name: string }[];
}

export class ConnectRefusedError extends Error {
  override readonly name = 'ConnectRefusedError';
  readonly code: 'CANNOT_CONNECT_HERE' | 'NO_PROVIDER' | 'NOT_SET_UP' | 'NO_ADDRESS' | 'MAIL_OFF';
  constructor(code: ConnectRefusedError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface ConnectedAccountsDeps {
  meta: MetaDb;
  crypto: CredentialCrypto;
  secret: string;
  httpFor(manifest: AddOnManifest): AddOnHttpClient;
  rows: AccountRows;
  /** This server's public address, read from settings. Never a request's. */
  publicOrigin(): Promise<string | null>;
  /** Whether the outside can reach this server, for a request or with none. */
  reach(forwarded: boolean): Promise<Reachability>;
  notices?: Omit<AccountNoticeDeps, 'meta' | 'secret'>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Text of a cell, or null when it holds none. */
function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** A column read as off. Databases hand a boolean back as `false`, `0` or `'0'`. */
function isOff(value: unknown): boolean {
  return value === false || value === 0 || value === '0' || value === 'f' || value === 'false';
}

export function parseAddOn(document: unknown): AddOnManifest | null {
  const read = validateManifest(document);
  return read.ok && isAddOnManifest(read.manifest) ? read.manifest : null;
}

const providerName = (manifest: AddOnManifest): string => manifest.name;

export function createConnectedAccounts(deps: ConnectedAccountsDeps) {
  const { meta, crypto } = deps;
  const repo = connectedAccountsRepo(meta, crypto);
  const manifests = manifestsRepo(meta, crypto);
  const now = deps.now ?? Date.now;
  const noticeDeps: AccountNoticeDeps = { meta, secret: deps.secret, ...deps.notices, ...(deps.now === undefined ? {} : { now: deps.now }) };
  const cleanups: AccountCleanup[] = [];
  const onConnected: ((account: ConnectedAccount) => Promise<void>)[] = [];

  /**
   * The table's rule, from the installed app that declares it. `unsure`: an app
   * declares connected accounts on a table the schema snapshot does not show
   * now, so "this table declares none" cannot be said (a re-sync under a role
   * that lost its rights looks just like that).
   */
  async function lookUpTable(connectionId: string, table: string): Promise<{ table: AccountTable | null; unsure: boolean }> {
    const records = (await appTablesRepo(meta).forConnection(connectionId)).filter((record) => record.role === 'app' && record.state !== 'released' && record.state !== 'dropped' && record.state !== 'pending');
    let unsure = false;
    for (const record of records) {
      const app = record.manifestId === null ? await manifests.findInScope(record.appKey, connectionId) : await manifests.findById(record.manifestId);
      if (app === null || app.row.kind !== 'app') continue;
      const tables = (app.document as { requiredSchema?: { tables?: { ref?: unknown; connectedAccounts?: unknown }[] } }).requiredSchema?.tables ?? [];
      const declared = tables.find((one) => one.ref === record.ref)?.connectedAccounts;
      if (declared === undefined) continue;
      const id = await deps.rows.tableId(connectionId, realTableOf(record));
      if (id === null) {
        unsure = true;
        continue;
      }
      if (id !== table) continue;
      const parsed = connectedAccountsSchema.safeParse(declared);
      if (parsed.success) return { table: { appKey: record.appKey, rule: parsed.data }, unsure: false };
    }
    return { table: null, unsure };
  }

  const tableOf = async (connectionId: string, table: string): Promise<AccountTable | null> => (await lookUpTable(connectionId, table)).table;

  /** Every table on a database whose rows may connect through this add-on. */
  async function tablesFrom(connectionId: string, addOnKey: string): Promise<{ id: string; table: AccountTable }[]> {
    const records = (await appTablesRepo(meta).forConnection(connectionId)).filter((record) => record.role === 'app' && record.state !== 'released' && record.state !== 'dropped' && record.state !== 'pending');
    const out: { id: string; table: AccountTable }[] = [];
    for (const record of records) {
      const app = record.manifestId === null ? await manifests.findInScope(record.appKey, connectionId) : await manifests.findById(record.manifestId);
      if (app === null || app.row.kind !== 'app') continue;
      const tables = (app.document as { requiredSchema?: { tables?: { ref?: unknown; connectedAccounts?: unknown }[] } }).requiredSchema?.tables ?? [];
      const parsed = connectedAccountsSchema.safeParse(tables.find((one) => one.ref === record.ref)?.connectedAccounts);
      if (!parsed.success || !parsed.data.from.includes(addOnKey)) continue;
      const id = await deps.rows.tableId(connectionId, realTableOf(record));
      if (id !== null) out.push({ id, table: { appKey: record.appKey, rule: parsed.data } });
    }
    return out;
  }

  /** The add-on install a row's connection goes through: named by the rule, attached to the app and switched on. */
  async function providerOn(target: AccountTarget, table: AccountTable, addOnKey: string): Promise<{ install: InstalledManifest; manifest: AddOnManifest; spec: AccountSpec } | null> {
    if (!table.rule.from.includes(addOnKey)) return null;
    const install = await installOnConnection(manifests, addOnKey, target.connectionId);
    if (install === null || install.row.status !== 'installed') return null;
    if (!install.attachments.some((attachment) => attachment.attachedTo === table.appKey && attachment.disabledAt === null)) return null;
    const manifest = parseAddOn(install.document);
    const spec = manifest === null ? null : accountSpecOf(manifest);
    return manifest === null || spec === null || spec.per !== 'row' ? null : { install, manifest, spec };
  }

  async function installOf(manifestId: string): Promise<(AccountInstall & { manifest: AddOnManifest }) | null> {
    const install = await manifests.findById(manifestId);
    if (install === null) return null;
    const manifest = parseAddOn(install.document);
    const spec = manifest === null ? null : accountSpecOf(manifest);
    if (manifest === null || spec === null) return null;
    let registration: AppRegistration | null = null;
    try {
      registration = registrationOf(await manifests.getCredential(manifestId));
    } catch {
      // Sealed under another secret: as good as none, and said as such on the install's page.
    }
    return { spec, registration, http: deps.httpFor(manifest), manifest };
  }

  const tokens: TokenService = createTokenService({
    repo,
    installOf,
    onClientRefused: async (manifestId) => {
      const install = await manifests.findById(manifestId).catch(() => null);
      const manifest = install === null ? null : parseAddOn(install.document);
      if (manifest === null) return;
      const appKeys = new Set((install?.attachments ?? []).map((attachment) => attachment.attachedTo));
      // Told to the managers of each app it serves, and to Super Admins through any of them.
      for (const appKey of appKeys.size === 0 ? [null] : appKeys) await tellClientRefused(noticeDeps, { appKey, provider: providerName(manifest) });
    },
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
  });

  /** The row's own address and name, as its rule names them. */
  function personOf(row: Row | undefined, rule: ConnectedAccountsRule): { address: string | null; name: string | null } {
    const address = rule.address === undefined ? null : textOf(row?.[rule.address]);
    return { address: address !== null && address.includes('@') ? address : null, name: rule.name === undefined ? null : textOf(row?.[rule.name]) };
  }

  const rowIsLive = (row: Row | undefined, rule: ConnectedAccountsRule): boolean => row !== undefined && (rule.active === undefined || !isOff(row[rule.active]));

  async function assertCanConnect(forwarded: boolean): Promise<string> {
    const answer = await deps.reach(forwarded);
    if (connectReachOf(answer) === 'cannot-connect') {
      throw new ConnectRefusedError('CANNOT_CONNECT_HERE', `This server has no public https address (${answer.state}), so a provider's sign-in cannot come back to it.`);
    }
    const origin = await deps.publicOrigin();
    if (origin === null) throw new ConnectRefusedError('CANNOT_CONNECT_HERE', 'This server has no public address yet.');
    return origin;
  }

  /** The add-ons a link for this row may offer, set up and on. */
  async function offeredFor(target: AccountTarget, table: AccountTable): Promise<string[]> {
    const offered: string[] = [];
    for (const key of table.rule.from) {
      const found = await providerOn(target, table, key);
      if (found === null) continue;
      const held = await installOf(found.install.row.id);
      if (held?.registration != null) offered.push(key);
    }
    return offered;
  }

  /**
   * Makes a link. With `deliver`, it is queued first: a new link retires the
   * row's last, so one that could not be sent must not cost the person the
   * link they already hold.
   */
  async function mint(
    target: AccountTarget,
    providers: string[],
    lifetime: number,
    createdBy: string | null,
    origin: string,
    manifestIds: readonly string[],
    deliver?: (url: string, about: string) => Promise<boolean>,
  ): Promise<{ url: string; link: ConnectLink }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    // In the fragment: no server, proxy or referrer ever holds it.
    const url = `${origin}${CONNECT_DOOR_PATH}#${token}`;
    if (deliver !== undefined && !(await deliver(url, tokenHash.slice(0, 32)))) {
      throw new ConnectRefusedError('MAIL_OFF', 'Mail is not set up, so the link could not be sent.');
    }
    const held = await repo.forTarget(target);
    const purpose = held.some((account) => manifestIds.includes(account.manifestId)) ? 'reconnect' : 'connect';
    const at = now();
    const link = await repo.mintLink({ ...target, providers, purpose, tokenHash, createdBy, expiresAt: at + lifetime }, at);
    return { url, link };
  }

  /** Gives a grant back at the provider. Best effort: false when it could not. */
  async function revokeAt(install: AccountInstall, refreshToken: string): Promise<boolean> {
    if (install.spec.revokeUrl === null) return false;
    try {
      const response = await install.http(install.spec.revokeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Whether this provider account is connected through the install on another
   * row. A provider's revoke ends the account's whole grant to this app, so
   * giving one back would cut that other connection too.
   */
  async function subjectHeldElsewhere(manifestId: string, subject: string, except: string | null): Promise<boolean> {
    return (await repo.forInstall(manifestId)).some((account) => account.subject === subject && account.id !== except);
  }

  /** A sign-in that connected nothing leaves no grant behind, unless that account is connected here already. */
  async function giveBack(install: AccountInstall, manifestId: string, subject: string, refreshToken: string): Promise<void> {
    if (!(await subjectHeldElsewhere(manifestId, subject, null))) await revokeAt(install, refreshToken);
  }

  /** What a link opens, while its row is still there and on. */
  async function resolveLink(link: ConnectLink): Promise<{ person: string | null; address: string | null; appKey: string | null; rule: ConnectedAccountsRule | null; providers: { key: string; name: string; manifestId: string }[] } | null> {
    if (link.tableName === INSTALL_ACCOUNT_TABLE) {
      const held = await installOf(link.rowKey);
      if (held === null || !link.providers.includes(held.spec.key)) return null;
      return { person: null, address: null, appKey: null, rule: null, providers: [{ key: held.spec.key, name: providerName(held.manifest), manifestId: link.rowKey }] };
    }
    const table = await tableOf(link.connectionId, link.tableName);
    if (table === null) return null;
    const row = await deps.rows.read(link.connectionId, link.tableName, link.rowKey);
    if (!rowIsLive(row, table.rule)) return null;
    const person = personOf(row, table.rule);
    const providers: { key: string; name: string; manifestId: string }[] = [];
    for (const key of link.providers) {
      const found = await providerOn(link, table, key);
      if (found !== null) providers.push({ key, name: providerName(found.manifest), manifestId: found.install.row.id });
    }
    return { person: person.name, address: person.address, appKey: table.appKey, rule: table.rule, providers };
  }

  /**
   * Whether an account's row still stands. `unknown` (the database did not
   * answer, or the snapshot lost the table) ends nothing: a revoke cannot be
   * taken back, and a passing failure must never cost people their connection.
   */
  async function standingOf(account: ConnectedAccount): Promise<'live' | 'gone' | 'unknown'> {
    if (account.tableName === INSTALL_ACCOUNT_TABLE) return 'live';
    try {
      const found = await lookUpTable(account.connectionId, account.tableName);
      if (found.table === null) return found.unsure ? 'unknown' : 'gone';
      const install = await manifests.findById(account.manifestId);
      // A demo calendar hangs off the app itself, having no add-on (`calendar-sync/`).
      const demo = account.subject.startsWith(DEMO_CALENDAR_SUBJECT_PREFIX) && install?.row.manifestKey === found.table.appKey;
      if (!demo && (install === null || !found.table.rule.from.includes(install.row.manifestKey))) return 'gone';
      const row = await deps.rows.read(account.connectionId, account.tableName, account.rowKey);
      return rowIsLive(row, found.table.rule) ? 'live' : 'gone';
    } catch {
      return 'unknown';
    }
  }

  /** Thirty days before the client secret's written end date: one notice, per date. */
  async function warnSecretEnding(manifestId: string): Promise<void> {
    const held = await installOf(manifestId);
    const date = held?.registration?.secretEndsOn ?? null;
    if (held === null || held.registration === null || date === null || held.registration.secretToldFor === date) return;
    if (Date.parse(`${date}T00:00:00Z`) - now() > SECRET_NOTICE_MS) return;
    // Marked first: a second process must not tell everyone again.
    await manifests.setCredential(manifestId, { kind: 'oauth2', secret: { ...held.registration, secretToldFor: date } });
    const install = await manifests.findById(manifestId);
    const appKeys = new Set((install?.attachments ?? []).map((attachment) => attachment.attachedTo));
    for (const appKey of appKeys.size === 0 ? [null] : appKeys) await tellSecretEnding(noticeDeps, { appKey, provider: providerName(held.manifest), date });
  }

  async function end(accountId: string): Promise<EndResult | null> {
    const account = await repo.find(accountId);
    if (account === null) return null;
    // From here no call may use it, and a second end finds it on its way out.
    await repo.setState(account.id, 'disconnecting', now());
    let removed = 0;
    let incomplete = false;
    for (const cleanup of cleanups) {
      try {
        removed += (await cleanup.run({ account, tokens })).removed;
      } catch {
        incomplete = true;
      }
    }
    let revoked: boolean | null = null;
    const install = await installOf(account.manifestId).catch(() => null);
    if (install !== null && install.spec.revokeUrl !== null) {
      revoked = false;
      const held = await repo.tokensOf(account.id).catch(() => null);
      if (held !== null && !(await subjectHeldElsewhere(account.manifestId, account.subject, account.id))) revoked = await revokeAt(install, held.refreshToken);
    }
    await repo.remove(account.id);
    await repo.removeLinksOnTarget(account);
    return { removed, incomplete, revoked };
  }

  return {
    repo,
    tokens,
    tableOf,
    installOf,
    personOf,
    rowIsLive,

    /** The row, read as the engine. */
    readRow: (target: AccountTarget) => deps.rows.read(target.connectionId, target.tableName, target.rowKey),

    /** A later piece's step at the end of a connection (stopping channels, deleting future events). */
    addCleanup(cleanup: AccountCleanup): void {
      cleanups.push(cleanup);
    },

    /** A later piece's step when an account connects or reconnects. */
    addOnConnected(hook: (account: ConnectedAccount) => Promise<void>): void {
      onConnected.push(hook);
    },

    tablesFrom,

    /** Up to `limit` rows of a table that may connect, with their keys. */
    listRows: (connectionId: string, table: string, limit: number) => deps.rows.list(connectionId, table, limit),

    /**
     * "Check my setup": whether the provider accepts this ID and secret, and
     * nothing else. Only the `error` word and the numbered codes are read from
     * its answer, and any token it hands back is dropped unread.
     */
    async checkApp(manifestId: string, input: { grant: 'pair' | 'app'; scope?: string | undefined }): Promise<AppCheck> {
      const held = await installOf(manifestId);
      if (held === null || held.registration === null) return 'not-set-up';
      const { registration, spec } = held;
      const directory = registration.tenant ?? spec.tenantDefault;
      // An app's own sign-in needs a named directory: Microsoft refuses it on `common`.
      if (input.grant === 'app' && (directory === null || ['common', 'organizations', 'consumers'].includes(directory.toLowerCase()) || input.scope === undefined)) return 'unknown';
      const origin = await deps.publicOrigin();
      const form: Record<string, string> =
        input.grant === 'app'
          ? { grant_type: 'client_credentials', client_id: registration.clientId, client_secret: registration.clientSecret, scope: input.scope ?? '' }
          : { grant_type: 'authorization_code', client_id: registration.clientId, client_secret: registration.clientSecret, code: SETUP_CHECK_CODE, redirect_uri: redirectUriFor(origin ?? 'https://adminium.invalid', spec.key) };
      let response: Response;
      try {
        response = await held.http(endpointsFor(spec, registration).tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams(form).toString(),
        });
      } catch {
        return 'unreachable';
      }
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return 'accepted';
      }
      if (response.status >= 500) {
        await response.body?.cancel().catch(() => undefined);
        return 'unreachable';
      }
      const body = (await response.json().catch(() => null)) as { error?: unknown; error_codes?: unknown } | null;
      const codes = Array.isArray(body?.error_codes) ? body.error_codes : [];
      if (codes.includes(SECRET_EXPIRED_CODE)) return 'expired';
      if (body?.error === 'invalid_client' || body?.error === 'unauthorized_client') return 'refused';
      if (input.grant === 'pair' && body?.error === 'invalid_grant') return 'accepted';
      return 'unknown';
    },

    /** The crypto the account store seals with, for a piece that shares it. */
    crypto,

    /** Whether people can connect through this server at all. */
    async reachNow(forwarded: boolean): Promise<ConnectReach> {
      return connectReachOf(await deps.reach(forwarded));
    },

    /** The address to register at the provider, built only from the stored public origin. */
    async redirectUri(addOnKey: string): Promise<string | null> {
      const origin = await deps.publicOrigin();
      return origin === null ? null : redirectUriFor(origin, addOnKey);
    },

    /** A link for a row, for the add-ons it may use. A new one retires the row's last. */
    async linkForRow(target: AccountTarget, table: AccountTable, input: { createdBy: string | null; forwarded: boolean; self?: boolean; only?: string; deliver?: (url: string, about: string) => Promise<boolean> }): Promise<{ url: string; link: ConnectLink; address: string | null; person: string | null }> {
      const origin = await assertCanConnect(input.forwarded);
      const row = await deps.rows.read(target.connectionId, target.tableName, target.rowKey);
      if (!rowIsLive(row, table.rule)) throw new ConnectRefusedError('NO_PROVIDER', 'This row cannot connect an account.');
      const offered = await offeredFor(target, table);
      const providers = input.only === undefined ? offered : offered.filter((key) => key === input.only);
      if (providers.length === 0) throw new ConnectRefusedError('NOT_SET_UP', 'No connected-account add-on is set up for this row yet.');
      const ids: string[] = [];
      for (const key of providers) {
        const found = await providerOn(target, table, key);
        if (found !== null) ids.push(found.install.row.id);
      }
      const minted = await mint(target, providers, input.self === true ? SELF_LINK_LIFETIME_MS : LINK_LIFETIME_MS, input.createdBy, origin, ids, input.deliver);
      const person = personOf(row, table.rule);
      return { ...minted, address: person.address, person: person.name };
    },

    /** A link for an install-level account. */
    async linkForInstall(manifestId: string, addOnKey: string, input: { createdBy: string | null; forwarded: boolean }): Promise<{ url: string; link: ConnectLink }> {
      const origin = await assertCanConnect(input.forwarded);
      const held = await installOf(manifestId);
      if (held === null || held.spec.per !== 'install') throw new ConnectRefusedError('NO_PROVIDER', `"${addOnKey}" keeps no install-level account.`);
      if (held.registration === null) throw new ConnectRefusedError('NOT_SET_UP', `"${addOnKey}" has no app registration yet.`);
      return mint(installTarget(manifestId), [addOnKey], SELF_LINK_LIFETIME_MS, input.createdBy, origin, [manifestId]);
    },

    /** Sends a row's link to the row's own address. Never to one typed by whoever asks. */
    async sendLink(target: AccountTarget, table: AccountTable, input: { createdBy: string | null; forwarded: boolean }): Promise<{ sentTo: string }> {
      const row = await deps.rows.read(target.connectionId, target.tableName, target.rowKey);
      const person = personOf(row, table.rule);
      if (person.address === null) throw new ConnectRefusedError('NO_ADDRESS', 'This row has no e-mail address to send a link to.');
      const address = person.address;
      const { business } = await strangerBusiness(meta);
      await this.linkForRow(target, table, {
        createdBy: input.createdBy,
        forwarded: input.forwarded,
        deliver: (link, about) => mailConnectLink(noticeDeps, { to: address, business: business.name, person: person.name ?? address, link, days: CONNECT_LINK_DAYS, about }),
      });
      return { sentTo: person.address };
    },

    // ─── The door ───────────────────────────────────────────────────────────

    /** What a link opens. Null reads the same for unknown, retired, spent, expired and a row that is gone. */
    async open(token: string): Promise<OpenedLink | null> {
      const link = await repo.linkByHash(hashToken(token), now());
      if (link === null) return null;
      const resolved = await resolveLink(link).catch(() => null);
      if (resolved === null || resolved.providers.length === 0) return null;
      const { business } = await strangerBusiness(meta);
      const sender = link.createdBy === null ? null : await usersRepo(meta).findById(link.createdBy).catch(() => null);
      return {
        link,
        business: business.name,
        contact: business.email,
        person: resolved.person,
        address: resolved.address,
        sentBy: sender?.name ?? null,
        providers: resolved.providers.map(({ key, name }) => ({ key, name })),
      };
    },

    /** Starts a sign-in from the door page. Returns where to send the browser and the nonce for its cookie. */
    async start(input: { token: string; provider: string; forwarded: boolean }): Promise<{ authorizeUrl: string; nonce: string } | null> {
      const link = await repo.linkByHash(hashToken(input.token), now());
      if (link === null) return null;
      const resolved = await resolveLink(link).catch(() => null);
      const provider = resolved?.providers.find((one) => one.key === input.provider);
      if (resolved === null || resolved === undefined || provider === undefined) return null;
      const origin = await assertCanConnect(input.forwarded);
      const held = await installOf(provider.manifestId);
      if (held === null || held.registration === null) return null;

      const endpoints = endpointsFor(held.spec, held.registration);
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const redirectUri = redirectUriFor(origin, held.spec.key);
      const at = now();
      await repo.putFlow(
        {
          stateHash: hashToken(state),
          nonceHash: hashToken(nonce),
          manifestId: provider.manifestId,
          connectionId: link.connectionId,
          tableName: link.tableName,
          rowKey: link.rowKey,
          linkId: link.id,
          verifierSealed: crypto.encrypt(verifier),
          redirectUri,
          expiresAt: at + FLOW_LIFETIME_MS,
        },
        at,
      );

      const url = new URL(endpoints.authorizeUrl);
      for (const [name, value] of Object.entries(held.spec.authorizeParams)) url.searchParams.set(name, value);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', held.registration.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
      if (held.spec.scopes.length > 0) url.searchParams.set('scope', held.spec.scopes.join(' '));
      if (resolved.address !== null) url.searchParams.set('login_hint', resolved.address);
      return { authorizeUrl: url.href, nonce };
    },

    /** Finishes a sign-in: the one place an account is written. */
    async complete(input: { state: string; code: string | null; error: string | null; nonce: string | null }): Promise<DoorOutcome> {
      const flow = await repo.flowByState(hashToken(input.state), now());
      // A wrong browser leaves the flow in place: it cannot burn the right one's sign-in.
      if (flow === null || input.nonce === null || !sameHash(flow.nonceHash, hashToken(input.nonce))) return { outcome: 'nothing' };
      if (!(await repo.takeFlow(flow.id))) return { outcome: 'nothing' };

      if (input.error !== null) {
        if (input.error === 'access_denied') return { outcome: 'denied' };
        if (input.error === 'consent_required' || input.error === 'interaction_required') return { outcome: 'needs-admin' };
        return { outcome: 'nothing' };
      }
      if (input.code === null) return { outcome: 'nothing' };

      const link = await repo.linkById(flow.linkId, now());
      if (link === null) return { outcome: 'nothing' };
      const resolved = await resolveLink(link).catch(() => null);
      if (resolved === null || resolved === undefined || !resolved.providers.some((one) => one.manifestId === flow.manifestId)) return { outcome: 'nothing' };
      const held = await installOf(flow.manifestId);
      if (held === null || held.registration === null) return { outcome: 'setup' };

      let result;
      try {
        result = await exchangeAuthorizationCode({
          http: held.http,
          connect: endpointsFor(held.spec, held.registration),
          allow: held.spec.allow,
          addOnKey: held.spec.key,
          flow: { codeVerifier: crypto.decrypt(flow.verifierSealed), clientId: held.registration.clientId, clientSecret: held.registration.clientSecret, redirectUri: flow.redirectUri },
          code: input.code,
          now: now(),
        });
      } catch (error) {
        if (error instanceof AddOnOAuthError && (error.providerCode === 'invalid_client' || error.providerCode === 'unauthorized_client')) {
          if (await repo.markRefused(flow.manifestId, error.providerCode, now())) {
            await tellClientRefused(noticeDeps, { appKey: resolved.appKey, provider: providerName(held.manifest) });
          }
          return { outcome: 'setup' };
        }
        return { outcome: 'nothing' };
      }

      const identity = identityOf(held.spec, result.idToken, held.registration.clientId);
      const refreshToken = result.envelope.refreshToken;
      // Saved without one it would read "Connected" and die within the hour.
      if (identity === null || refreshToken === null) return { outcome: 'nothing' };
      const missing = missingScopes(held.spec.requiredScopes, result.scopes);
      if (missing.length > 0) {
        await giveBack(held, flow.manifestId, identity.subject, refreshToken);
        return { outcome: 'partial', missing };
      }

      const target: AccountTarget = { connectionId: flow.connectionId, tableName: flow.tableName, rowKey: flow.rowKey };
      const already = await repo.forTarget(target);
      const here = already.find((account) => account.manifestId === flow.manifestId);
      if (already.some((account) => account.manifestId !== flow.manifestId)) {
        await giveBack(held, flow.manifestId, identity.subject, refreshToken);
        return { outcome: 'other-provider' };
      }
      if (here !== undefined && here.subject !== identity.subject) {
        await giveBack(held, flow.manifestId, identity.subject, refreshToken);
        return { outcome: 'different-account' };
      }

      const account = await repo.connect(
        {
          manifestId: flow.manifestId,
          target,
          subject: identity.subject,
          address: identity.address,
          tokens: { accessToken: result.envelope.accessToken, refreshToken },
          expiresAt: result.expiresAt,
          refreshExpiresAt: result.refreshExpiresAt,
          scopes: result.scopes,
          state: 'connected',
        },
        link.id,
        now(),
      );
      // The link went while the provider was answering: a disconnect or a newer link stands.
      if (account === null) {
        await giveBack(held, flow.manifestId, identity.subject, refreshToken);
        return { outcome: 'nothing' };
      }
      await repo.clearRefused(flow.manifestId);
      // A later piece's first steps for a new connection (T08: the first read). Never undoes the connect.
      for (const hook of onConnected) await hook(account).catch(() => undefined);

      // The door runs as nobody, so the record says what was connected, for which row, through which link.
      await auditRepo(meta)
        .append({
          actorKind: 'system',
          actorId: link.createdBy,
          actorLabel: 'connect link',
          category: 'add-on',
          action: 'connected-account.connected',
          changes: { after: { addOn: held.spec.key, table: target.tableName, row: target.rowKey, account: identity.address, reconnect: here !== undefined } },
        })
        .catch(() => undefined);

      const address = identity.address;
      const onFile = resolved.address;
      const addressDiffers = onFile !== null && address !== null && onFile.toLowerCase() !== address.toLowerCase();
      if (here === undefined) {
        const { business } = await strangerBusiness(meta).catch(() => ({ business: { name: '' } }));
        const person = resolved.person ?? onFile ?? held.manifest.name;
        const shown = address ?? identity.subject;
        await tellConnected(noticeDeps, { appKey: resolved.appKey, provider: providerName(held.manifest), person, account: shown });
        if (onFile !== null) await mailConnected(noticeDeps, { to: onFile, business: business.name, person, provider: providerName(held.manifest), account: shown, about: `${account.id}:${account.version}` });
      }
      return {
        outcome: 'connected',
        address,
        addressDiffers,
        testing: result.refreshExpiresAt !== null && result.refreshExpiresAt - now() <= TESTING_GRANT_MS,
      };
    },

    // ─── Ending ─────────────────────────────────────────────────────────────

    end,

    /**
     * Ended by the engine, once its row is still gone when the job runs: the
     * sweep's answer may be an hour old. With the record a person's disconnect
     * writes for itself.
     */
    async endBySystem(accountId: string): Promise<EndResult | null> {
      const account = await repo.find(accountId);
      if (account === null) return null;
      if (account.state !== 'disconnecting' && (await standingOf(account)) !== 'gone') return null;
      const ended = await end(accountId);
      if (ended !== null) {
        await auditRepo(meta)
          .append({ actorKind: 'system', actorId: null, actorLabel: 'connected accounts', category: 'add-on', action: 'connected-account.ended', changes: { after: { table: account.tableName, row: account.rowKey, ...ended } } })
          .catch(() => undefined);
      }
      return ended;
    },

    /** Every account of an install, before it is removed. */
    async endInstall(manifestId: string): Promise<void> {
      for (const account of await repo.forInstall(manifestId)) await end(account.id).catch(() => undefined);
    },

    /**
     * What the tick does: clears what expired, and returns the accounts whose
     * row is gone or switched off, or whose table no longer declares them.
     * A database that cannot answer, or a snapshot that lost the table, ends nothing.
     */
    async sweep(): Promise<{ flows: number; links: number; ending: string[] }> {
      const cleared = await repo.sweep(now());
      const ending: string[] = [];
      const installs = new Set<string>();
      let after: string | null = null;
      for (;;) {
        const page: ConnectedAccount[] = await repo.page(after, 200);
        if (page.length === 0) break;
        for (const account of page) {
          after = account.id;
          installs.add(account.manifestId);
          if (account.state === 'disconnecting' || (await standingOf(account)) === 'gone') ending.push(account.id);
        }
        if (page.length < 200) break;
      }
      for (const manifestId of installs) await warnSecretEnding(manifestId).catch(() => undefined);
      return { ...cleared, ending };
    },
  };
}

export type ConnectedAccounts = ReturnType<typeof createConnectedAccounts>;
export { AccountTokenError };
