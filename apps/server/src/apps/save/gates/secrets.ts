// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SECRET SCAN: every secret this server keeps, looked for in the file.
 *
 * `collectKnownSecrets` opens each sealed value with the key its own feature
 * derives (the same salt, the same info), so a value the feature can read is
 * a value this scan knows. The list of what it reads is `SECRET_SOURCES`; a
 * test fails when the meta schema grows a sealed column, a sealed key inside
 * a JSON column, or a `secret: true` setting that is not on it.
 *
 * `scanForSecrets` looks for each secret in every string of the file:
 *  - whole, and as every 12-character piece (any longer piece holds one), so
 *    half a key is found too. A web address is looked for whole and by what
 *    follows its origin; a database address by each part on its own (user,
 *    password, host), less the parts too common to mean anything;
 *  - in its plain, JSON-escaped, URL-encoded, base64 (at each of the three
 *    byte alignments), base64url and hex forms;
 *  - and in the file's strings decoded (URL-decoded, JSON-unescaped, and each
 *    run that looks like base64 or hex, decoded), searched for the plain form.
 *
 * A hit is a `choice`: clear the field, or leave the item out. It names the
 * kind, the item, the field and which secret it is (a connection's password,
 * the SMTP password), never the value.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

import { llmKeyCryptoFromSecret } from '@adminium/llm';
import { readJsonFrom, SETTINGS_REGISTRY, type MetaDb } from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../../../add-ons/credential-crypto.js';
import { totpEncryptionKey } from '../../../auth/totp.js';
import { webhookSecretKey } from '../../../automations/actions/webhook.js';
import { decryptSecret, deriveKey, encryptSecret, isEncryptedSecret } from '../../../config/secrets.js';
import { dsnCryptoFromSecret } from '../../../connections/crypto.js';
import { addressKeysWrapKey, stopListAddressKey } from '../../../consent/keys.js';
import { FIGMA_TOKEN_SALT } from '../../../designer/figma/tokens.js';
import { emailSecretKey } from '../../../email/config.js';
import { NOTICE_KEY_SALT } from '../../../email/notices/endpoints.js';
import { DKIM_KEY_SALT } from '../../../email/sender/dkim-keys.js';
import { storageCryptoFromSecret } from '../../../files/crypto.js';
import { linkSealFromSecret } from '../../../payments/links.js';
import { SIGN_IN_LINK_JOB_KIND } from '../../../public-api/sign-in-link.js';
import type { CheckItem } from '../check.js';
import type { SaveChoices } from '../types.js';
import { itemTargetOf, targetOf, type GateContent, type Leaf, type PathPart } from './content.js';

/**
 * Every sealed place this scan opens: `<table>.<column>` for a meta column,
 * `<table>.<column>#<key>` for a sealed key inside a JSON column. The coverage
 * test reads the meta schema and fails on one that is not here.
 */
export const SECRET_SOURCES = [
  'adminium_users.totpSecretEncrypted',
  'adminium_users.figmaTokenEncrypted',
  'adminium_storage_destinations.secretEncrypted',
  'adminium_connections.introspectDsnEncrypted',
  'adminium_connections.dataDsnEncrypted',
  'adminium_webhooks.secretEncrypted',
  'adminium_manifests.licenseKeyEncrypted',
  'adminium_add_on_credentials.payload',
  'adminium_public_keys.tokenEncrypted',
  'adminium_public_challenges.newDestinationEnc',
  'adminium_payment_links.tokenSealed',
  'adminium_address_keys.keyEncrypted',
  'adminium_stop_list.addressEncrypted',
  'adminium_email_notice_endpoints.tokenEncrypted',
  'adminium_email_notice_endpoints.secretEncrypted',
  'adminium_email_dkim_keys.privateKeyEncrypted',
  'adminium_automations.graph#headerValueEncrypted',
  'adminium_jobs.payload#address',
] as const;

/** The `secret: true` settings this scan reads, each by its own rule. Any other is read too, string by string. */
export const SECRET_SETTINGS = ['email.smtp', 'llm.apiKey'] as const;

/** Plain values beside the sealed ones: addresses a request goes to, the project's `.env`, the server's own secret. */
export const PLAIN_SECRET_SOURCES = ['adminium_webhooks.url', 'adminium_automations.graph#url', 'adminium_automations.graph#headerName', 'project .env', 'ADMINIUM_SECRET'] as const;

/**
 * How a secret is looked for:
 *  - `opaque`: whole, and every 12-character piece (a key, a password, a token);
 *  - `address`: a web address, whole, and every piece of what follows its origin;
 *  - `whole`: only the whole value (a host, a user name, an email address).
 */
export type SecretShape = 'opaque' | 'address' | 'whole';

export interface KnownSecret {
  /** Which secret, in words for the Check list: "a connection's password". Never the value. */
  label: string;
  value: string;
  shape: SecretShape;
  /**
   * Known here, but not shaped like a secret: a host, a user name, a sender
   * address, a value of the project's `.env` whose name says nothing secret
   * (a public site's address). Save as app still asks about it, since a hit
   * may be a slip; a hard refusal (a download, a workspace file's own list)
   * never rests on it.
   */
  soft?: true;
}

/** A `.env` name that says its value is a secret: a key, a token, a password, a database address. */
export const SECRET_ENV_NAME =
  /SECRET|TOKEN|PASSW|API_?KEY|PRIVATE|CREDENTIAL|DSN|SALT|CONNECTION_STRING|(?:^|_)(?:KEYS?|PASS|PWD|AUTH|SIGNING)(?:_|$)|(?:DATABASE|(?:^|_)DB|REDIS|MONGO(?:DB)?|POSTGRES(?:QL)?|PG|MYSQL|AMQP|RABBITMQ)_UR[LI]$/i;

/** `.env` files that hold examples, not this project's values. */
const ENV_EXAMPLE = /\.(?:example|sample|template|dist|defaults?)$/i;

/** Shorter than this, a value means nothing on its own and is not looked for. */
export const SECRET_MIN_LENGTH = 8;
/** The length every form looked for is at least, and what the index is keyed by. */
const FORM_MIN_LENGTH = SECRET_MIN_LENGTH;
/** The piece length: a value found by any piece this long is found. */
export const SECRET_PIECE_LENGTH = 12;

/** Values every database address and mail setup shares: finding one says nothing. */
const TOO_COMMON = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'postgres',
  'postgresql',
  'mysql',
  'mariadb',
  'sqlite',
  'root',
  'admin',
  'administrator',
  'user',
  'username',
  'password',
  'default',
  'public',
  'adminium',
  'production',
  'development',
  'staging',
  'test',
  'true',
  'false',
  'null',
  'undefined',
  'authorization',
  'x-api-key',
  'content-type',
]);

function meaningful(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < SECRET_MIN_LENGTH) return false;
  if (TOO_COMMON.has(trimmed.toLowerCase())) return false;
  // A number (a port, a count) is no secret.
  return !/^[\d.:-]+$/.test(trimmed);
}

// ── collecting ───────────────────────────────────────────────────────────────

class SecretList {
  readonly #out: KnownSecret[] = [];
  readonly #seen = new Map<string, KnownSecret>();

  add(label: string, value: unknown, shape?: SecretShape, soft = false): void {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!meaningful(trimmed)) return;
    const kind = shape ?? shapeOf(trimmed);
    const key = `${kind}\u0000${trimmed}`;
    const held = this.#seen.get(key);
    if (held !== undefined) {
      // The same value kept as a secret elsewhere is a secret.
      if (!soft && held.soft === true) {
        delete held.soft;
        held.label = label;
      }
      return;
    }
    const secret: KnownSecret = { label, value: trimmed, shape: kind, ...(soft ? { soft: true as const } : {}) };
    this.#seen.set(key, secret);
    this.#out.push(secret);
  }

  /** A value that may be JSON: each string of it, else the value itself. */
  addOpened(label: string, opened: string | null): void {
    if (opened === null) return;
    const parsed = parseJsonObject(opened);
    if (parsed === undefined) {
      this.addAny(label, opened);
      return;
    }
    walkValues(parsed, (value) => this.addAny(label, value));
  }

  /**
   * A value of any form: a database address by its parts (its user and host
   * known, not secret), a PEM key by its body, else as it is.
   */
  addAny(label: string, value: string, soft = false): void {
    const parts = databaseAddressParts(value);
    if (parts !== null) {
      // An address with a password is a secret whatever it was named.
      const plain = soft && parts.password === '';
      this.add(`${label} (the whole address)`, value, 'whole', plain);
      this.add(`${label} (its user)`, parts.user, 'whole', true);
      this.add(`${label} (its password)`, parts.password, 'opaque', plain);
      this.add(`${label} (its host)`, parts.host, 'whole', true);
      return;
    }
    const pem = pemBody(value);
    if (pem !== null) {
      this.add(label, pem, 'opaque');
      return;
    }
    this.add(label, value, undefined, soft);
  }

  list(): KnownSecret[] {
    return this.#out;
  }
}

function shapeOf(value: string): SecretShape {
  if (/^https?:\/\//i.test(value)) return 'address';
  // An email address or a host name is looked for whole: a piece of it is a common word.
  if (/^[^\s@]+@[^\s@]+$/.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return 'whole';
  return 'opaque';
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function walkValues(value: unknown, visit: (value: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const child of value) walkValues(child, visit);
  else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) walkValues(child, visit);
}

/** A database address's user, password and host, or null when the value is not one with credentials. */
export function databaseAddressParts(value: string): { user: string; password: string; host: string } | null {
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? safeUrl(value) : null;
  if (url !== null && (url.username !== '' || url.password !== '') && !/^https?:$/i.test(url.protocol)) {
    return { user: safeDecode(url.username), password: safeDecode(url.password), host: url.hostname };
  }
  // The key=value form (`host=db password=… user=…`).
  if (/\bpassword=/i.test(value) && /\b(?:host|user)=/i.test(value)) {
    const read = (name: string) => new RegExp(`\\b${name}=('([^']*)'|(\\S+))`, 'i').exec(value);
    const pick = (name: string) => {
      const found = read(name);
      return found === null ? '' : (found[2] ?? found[3] ?? '');
    };
    return { user: pick('user'), password: pick('password'), host: pick('host') };
  }
  return null;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A PEM block's base64 body, without its armour lines and line breaks. */
function pemBody(value: string): string | null {
  const found = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/.exec(value);
  return found === null ? null : (found[1] ?? '').replace(/\s+/g, '');
}

/** Opens a sealed value with a feature's own decrypt, or null when this server's secret cannot. */
function opener(decrypt: (token: string) => string): (token: unknown) => string | null {
  return (token) => {
    if (typeof token !== 'string' || token === '') return null;
    try {
      return decrypt(token);
    } catch {
      return null;
    }
  };
}

const withKey = (key: Uint8Array) => (token: string) => decryptSecret(token, key);

/** A sealed value, or the value itself where it was kept in plain text (a value written before sealing). */
function openedOrPlain(open: (token: unknown) => string | null, value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return isEncryptedSecret(value) ? open(value) : value;
}

/**
 * Every secret this server keeps, opened. Reads each sealed column with the
 * key its feature derives; a value that does not open (another secret, a
 * sentinel) is skipped, since nothing could put it in a file either.
 */
export async function collectKnownSecrets(meta: MetaDb, masterSecret: string, projectEnvFile?: string | null): Promise<KnownSecret[]> {
  const list = new SecretList();
  const { db } = meta;

  const dsn = opener(dsnCryptoFromSecret(masterSecret).decrypt);
  const storage = opener(storageCryptoFromSecret(masterSecret).decrypt);
  const credential = opener(addOnCredentialCryptoFromSecret(masterSecret).decrypt);
  const totp = opener(withKey(totpEncryptionKey(masterSecret)));
  const figma = opener(withKey(deriveKey(masterSecret, FIGMA_TOKEN_SALT)));
  const dkim = opener(withKey(deriveKey(masterSecret, DKIM_KEY_SALT)));
  const notice = opener(withKey(deriveKey(masterSecret, NOTICE_KEY_SALT)));
  const webhook = opener(withKey(webhookSecretKey(masterSecret)));
  const smtp = opener(withKey(emailSecretKey(masterSecret)));
  const addressKeys = opener(withKey(addressKeysWrapKey(masterSecret)));
  const stopList = opener(withKey(stopListAddressKey(masterSecret)));
  const link = opener(linkSealFromSecret(masterSecret).unseal);
  const llmOpen = opener(llmKeyCryptoFromSecret(masterSecret, { deriveKey, encryptSecret, decryptSecret }).decrypt);
  /** For a column no feature reads: every key there is, first that opens it. */
  const anyKey = (token: unknown): string | null => {
    for (const open of [dsn, storage, credential, totp, figma, dkim, notice, webhook, smtp, addressKeys, stopList, link, llmOpen]) {
      const opened = open(token);
      if (opened !== null) return opened;
    }
    return null;
  };

  list.add('the server\'s secret (ADMINIUM_SECRET)', masterSecret, 'opaque');

  for (const row of await db.selectFrom('adminium_users').select(['totpSecretEncrypted', 'figmaTokenEncrypted']).execute()) {
    list.add('a person\'s sign-in code key', totp(row.totpSecretEncrypted), 'opaque');
    list.add('a person\'s Figma token', figma(row.figmaTokenEncrypted), 'opaque');
  }
  for (const row of await db.selectFrom('adminium_storage_destinations').select(['secretEncrypted']).execute()) {
    list.addOpened('a storage place\'s credentials', storage(row.secretEncrypted));
  }
  for (const row of await db.selectFrom('adminium_connections').select(['introspectDsnEncrypted', 'dataDsnEncrypted']).execute()) {
    list.addAny('a database connection', dsn(row.dataDsnEncrypted) ?? '');
    list.addAny('a database connection', dsn(row.introspectDsnEncrypted) ?? '');
  }
  for (const row of await db.selectFrom('adminium_webhooks').select(['url', 'secretEncrypted']).execute()) {
    list.add('a webhook\'s address', row.url, 'address');
    list.addOpened('a webhook\'s signing secret', openedOrPlain(anyKey, row.secretEncrypted));
  }
  for (const row of await db.selectFrom('adminium_manifests').select(['licenseKeyEncrypted']).execute()) {
    list.addOpened('an app\'s licence key', openedOrPlain(anyKey, row.licenseKeyEncrypted));
  }
  for (const row of await db.selectFrom('adminium_add_on_credentials').select(['payload']).execute()) {
    list.addOpened('an add-on\'s key', credential(row.payload));
  }
  for (const row of await db.selectFrom('adminium_public_keys').select(['tokenEncrypted']).execute()) {
    list.add('a public key\'s token', dsn(row.tokenEncrypted), 'opaque');
  }
  for (const row of await db.selectFrom('adminium_public_challenges').select(['newDestinationEnc']).execute()) {
    const opened = dsn(row.newDestinationEnc);
    const pointer = opened === null ? undefined : parseJsonObject(opened);
    // A sign-in link's pointer names a row by its key; an email change's names the new address.
    if (pointer !== undefined) list.add('a sign-in link\'s person', String((pointer as { row?: unknown } | null)?.row ?? ''), 'whole');
    else list.add('an address a person is changing to', opened, 'whole');
  }
  for (const row of await db.selectFrom('adminium_payment_links').select(['tokenSealed']).execute()) {
    list.add('a pay link\'s token', link(row.tokenSealed), 'opaque');
  }
  for (const row of await db.selectFrom('adminium_address_keys').select(['keyEncrypted']).execute()) {
    list.add('a key email addresses are kept under', addressKeys(row.keyEncrypted), 'opaque');
  }
  for (const row of await db.selectFrom('adminium_stop_list').select(['addressEncrypted']).execute()) {
    list.add('an address on the do-not-email list', stopList(row.addressEncrypted), 'whole');
  }
  for (const row of await db.selectFrom('adminium_email_notice_endpoints').select(['tokenEncrypted', 'secretEncrypted']).execute()) {
    list.add('a mail service\'s notice token', notice(row.tokenEncrypted), 'opaque');
    list.addOpened('a mail service\'s notice key', notice(row.secretEncrypted));
  }
  for (const row of await db.selectFrom('adminium_email_dkim_keys').select(['privateKeyEncrypted']).execute()) {
    list.addAny('a sending domain\'s private key', dkim(row.privateKeyEncrypted) ?? '');
  }
  for (const row of await db.selectFrom('adminium_automations').select(['graph']).execute()) {
    walkWebhookSteps(readJsonFrom(meta, row.graph), (step) => {
      list.add('a rule\'s webhook address', step['url'], 'address');
      list.add('a rule\'s webhook header', step['headerName'], 'whole', true);
      list.add('a rule\'s webhook header value', openedOrPlain(webhook, step['headerValueEncrypted']), 'opaque');
    });
  }
  for (const row of await db.selectFrom('adminium_jobs').select(['payload']).where('kind', '=', SIGN_IN_LINK_JOB_KIND).execute()) {
    const payload = readJsonFrom<{ address?: unknown } | null>(meta, row.payload);
    list.add('an address a sign-in link was asked for', dsn(payload?.address), 'whole');
  }

  // Settings: the two this server keeps sealed by their own rule, then any other secret one, string by string.
  const secretKeys = Object.entries(SETTINGS_REGISTRY)
    .filter(([, def]) => (def as { secret?: boolean }).secret === true)
    .map(([key]) => key);
  const settings = secretKeys.length === 0 ? [] : await db.selectFrom('adminium_settings').select(['key', 'value']).where('key', 'in', secretKeys).execute();
  for (const row of settings) {
    const value = readJsonFrom<unknown>(meta, row.value);
    if (row.key === 'email.smtp') {
      const stored = (value ?? {}) as { host?: unknown; user?: unknown; passEncrypted?: unknown; from?: unknown };
      list.add('the SMTP password', openedOrPlain(smtp, stored.passEncrypted), 'opaque');
      list.add('the SMTP user', stored.user, 'whole', true);
      list.add('the SMTP host', stored.host, 'whole', true);
      list.add('the SMTP sender address', stored.from, 'whole', true);
    } else if (row.key === 'llm.apiKey') {
      list.add('the AI provider\'s key', openedOrPlain(llmOpen, value), 'opaque');
    } else {
      walkValues(value, (one) => list.addOpened(`the setting ${row.key}`, openedOrPlain(anyKey, one)));
    }
  }

  if (projectEnvFile !== undefined && projectEnvFile !== null) {
    for (const file of projectEnvFiles(projectEnvFile)) {
      let text: string | null = null;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        text = null;
      }
      if (text === null) continue;
      const where = basename(file) === basename(projectEnvFile) ? '' : ` (${basename(file)})`;
      for (const [name, value] of Object.entries(parseEnv(text))) {
        if (typeof value === 'string') list.addAny(`the project's ${name}${where}`, value, !SECRET_ENV_NAME.test(name));
      }
    }
  }
  return list.list();
}

/**
 * The project's `.env` and the files beside it that hold its values too
 * (`.env.local`, `.env.production`, any `.env.<name>`), never an example's.
 */
export function projectEnvFiles(envFile: string): string[] {
  const dir = dirname(envFile);
  const base = basename(envFile);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [envFile];
  }
  const siblings = names.filter((name) => name.startsWith(`${base}.`) && !ENV_EXAMPLE.test(name)).sort();
  return [envFile, ...siblings.map((name) => join(dir, name))];
}

/** Each webhook step of a rule's graph, at any depth. */
function walkWebhookSteps(graph: unknown, visit: (step: Record<string, unknown>) => void): void {
  if (Array.isArray(graph)) {
    for (const child of graph) walkWebhookSteps(child, visit);
    return;
  }
  if (graph === null || typeof graph !== 'object') return;
  const node = graph as Record<string, unknown>;
  if (node['kind'] === 'webhook' || 'headerValueEncrypted' in node) visit(node);
  for (const child of Object.values(node)) walkWebhookSteps(child, visit);
}

// ── looking ──────────────────────────────────────────────────────────────────

/** The base64 of `bytes` from each alignment, cut to the characters that do not depend on what comes before or after. */
function base64Cores(bytes: Buffer): string[] {
  const out: string[] = [];
  for (let skip = 0; skip < 3; skip += 1) {
    const rest = bytes.subarray(skip);
    const whole = Math.floor(rest.length / 3) * 3;
    if (whole < 6) continue;
    out.push(rest.subarray(0, whole).toString('base64'));
  }
  return out;
}

/** The forms a piece is looked for in. Each at least 8 characters, so a short form finds nothing by chance. */
function formsOf(piece: string): string[] {
  const bytes = Buffer.from(piece, 'utf8');
  const forms = new Set<string>([piece]);
  forms.add(JSON.stringify(piece).slice(1, -1));
  forms.add(encodeURIComponent(piece));
  forms.add(encodeURIComponent(piece).replace(/%20/g, '+'));
  for (const core of base64Cores(bytes)) {
    forms.add(core);
    forms.add(core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  const hex = bytes.toString('hex');
  forms.add(hex);
  forms.add(hex.toUpperCase());
  return [...forms].filter((form) => form.length >= FORM_MIN_LENGTH);
}

/** The pieces a secret is looked for by. */
function piecesOf(secret: KnownSecret): string[] {
  const windows = (text: string): string[] => {
    if (text.length <= SECRET_PIECE_LENGTH) return [text];
    const out: string[] = [];
    for (let at = 0; at + SECRET_PIECE_LENGTH <= text.length; at += 1) out.push(text.slice(at, at + SECRET_PIECE_LENGTH));
    return out;
  };
  if (secret.shape === 'whole') return [secret.value];
  if (secret.shape === 'opaque') return windows(secret.value);
  // An address: whole, and what follows its origin (its path, query and fragment).
  const url = safeUrl(secret.value);
  const tail = url === null ? '' : secret.value.slice(secret.value.indexOf(url.host) + url.host.length);
  return [secret.value, ...(tail.length >= SECRET_MIN_LENGTH && !TOO_COMMON.has(tail) ? windows(tail) : [])];
}

/** Every form of every piece, by its first characters, each naming the secret it is a piece of. */
export interface SecretIndex {
  byStart: Map<string, { form: string; secret: number }[]>;
  secrets: readonly KnownSecret[];
}

export function indexSecrets(secrets: readonly KnownSecret[]): SecretIndex {
  const byStart = new Map<string, { form: string; secret: number }[]>();
  const seen = new Set<string>();
  secrets.forEach((secret, index) => {
    for (const piece of piecesOf(secret)) {
      for (const form of formsOf(piece)) {
        if (seen.has(form)) continue;
        seen.add(form);
        const start = form.slice(0, FORM_MIN_LENGTH);
        const bucket = byStart.get(start);
        if (bucket === undefined) byStart.set(start, [{ form, secret: index }]);
        else bucket.push({ form, secret: index });
      }
    }
  });
  return { byStart, secrets };
}

/** The first secret a text holds, by its index, or null. One pass: each place's first characters, then the forms that start so. */
function firstHit(text: string, index: SecretIndex): number | null {
  for (let at = 0; at + FORM_MIN_LENGTH <= text.length; at += 1) {
    const bucket = index.byStart.get(text.slice(at, at + FORM_MIN_LENGTH));
    if (bucket === undefined) continue;
    for (const { form, secret } of bucket) if (text.startsWith(form, at)) return secret;
  }
  return null;
}

/** The text, and what it says decoded: URL-decoded, JSON-unescaped, and each base64 or hex run read. */
export function decodedForms(text: string): string[] {
  const out = [text];
  if (text.includes('%') || text.includes('+')) out.push(urlDecoded(text));
  if (text.includes('\\')) out.push(jsonUnescaped(text));
  for (const run of text.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) ?? []) {
    const plain = run.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    for (let skip = 0; skip < 4; skip += 1) {
      const body = plain.slice(skip);
      const usable = body.slice(0, body.length - (body.length % 4));
      if (usable.length < 12) continue;
      out.push(Buffer.from(usable, 'base64').toString('latin1'));
      out.push(Buffer.from(usable, 'base64').toString('utf8'));
    }
  }
  for (const run of text.match(/[0-9a-fA-F]{24,}/g) ?? []) {
    for (let skip = 0; skip < 2; skip += 1) {
      const body = run.slice(skip);
      out.push(Buffer.from(body.slice(0, body.length - (body.length % 2)), 'hex').toString('utf8'));
    }
  }
  return out;
}

function urlDecoded(text: string): string {
  const spaced = text.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    // A stray `%`: decode each escape that is one.
    return spaced.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
}

function jsonUnescaped(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, code: string) => {
    if (code.startsWith('u')) return String.fromCharCode(parseInt(code.slice(1), 16));
    const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    return map[code] ?? code;
  });
}

/** The secret a leaf holds, by its index, or null. */
export function secretIn(value: string, index: SecretIndex): number | null {
  for (const form of decodedForms(value)) {
    const hit = firstHit(form, index);
    if (hit !== null) return hit;
  }
  return null;
}

/** Where a leaf is for the Check list. An object's key is named by its parent, so the key itself is never printed. */
export function leafPlace(content: GateContent, leaf: Leaf): { kind: string; item: string; field: string; path: string } {
  if (!leaf.isKey) return content.placeOf(leaf);
  const parent: PathPart[] = leaf.parts.slice(0, -1);
  const place = content.placeOf({ file: leaf.file, parts: parent });
  return { ...place, field: `${place.field}{key}`, path: `${place.path} (a key)` };
}

/** Each place of the file that holds a secret this server keeps, as a choice; places the person already answered are left out. */
export function scanForSecrets(content: GateContent, secrets: readonly KnownSecret[], choices: Pick<SaveChoices, 'clear' | 'leaveOut'>): CheckItem[] {
  const index = indexSecrets(secrets);
  if (index.byStart.size === 0) return [];
  const clear = new Set(choices.clear ?? []);
  const leaveOut = new Set(choices.leaveOut ?? []);
  const out: CheckItem[] = [];
  const seen = new Set<string>();
  for (const leaf of content.leaves) {
    const hit = secretIn(leaf.value, index);
    if (hit === null) continue;
    const place = leafPlace(content, leaf);
    const target = targetOf(place);
    if (seen.has(target) || clear.has(target) || leaveOut.has(itemTargetOf(place))) continue;
    seen.add(target);
    const label = index.secrets[hit]?.label ?? 'a secret';
    out.push({
      group: 'choice',
      code: 'SECRET_FOUND',
      kind: place.kind,
      item: place.item,
      ...(place.field === '' ? {} : { field: place.field }),
      message: `${place.path} holds ${label}. Clear it, or leave the ${place.kind} out of the file.`,
      answer: { choices: ['clear', 'leave-out'], target, targets: { 'leave-out': itemTargetOf(place) } },
    });
  }
  return out;
}
