// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DEPLOYMENT-WIDE PART OF A SELF-MADE APP, APPLIED AND UNDONE.
 *
 * A dashboard saved as an app may carry its server's look (the menu's name
 * and mark, the colours), which languages are on, wording somebody changed,
 * system emails somebody edited and a few plain settings (`instance` in
 * `@adminium/manifest`). None of it is the app's: it is written over this
 * whole server. So:
 *
 *  - it is applied only when the person installing ticks it (off by
 *    default), and only by someone who may change the server's settings
 *    ({@link instanceRefusal});
 *  - the review shows every value it would change, and each edited email as a
 *    diff with every link host it holds; an email whose hosts are not all
 *    ticked is left out, and says so ({@link reviewInstance});
 *  - everything is written in ONE meta transaction, with what each value
 *    replaced (`adminium_app_instance_undo`), so a failure part way changes
 *    nothing, an uninstall puts back exactly what was there (nothing, when
 *    nothing was set) and an update writes again and keeps the first undo
 *    ({@link applyInstance}, {@link undoInstance});
 *  - it never writes any part of a secret setting, whatever a file says: the
 *    manifest's schema refuses any setting off its allow-list, and this
 *    module refuses a secret one again by the registry.
 *
 * A value somebody changed after the install is theirs: the uninstall leaves
 * it, and forgets the undo.
 */
import { createHash } from 'node:crypto';

import { LOCALES, NAMESPACES } from '@adminium/i18n';
import { isA11yCriticalKey, sourceMessage, validateMessage } from '@adminium/i18n/editing';
import type { InstancePart, Manifest } from '@adminium/manifest';
import {
  SETTINGS_REGISTRY,
  appInstanceUndoRepo,
  bumpI18nVersion,
  filesRepo,
  isSettingKey,
  newId,
  packJson,
  readBool,
  readJson,
  readJsonFrom,
  settingsRepo,
  writeBool,
  type AppInstanceValueKind,
  type HeldValue,
  type MetaDb,
} from '@adminium/meta';

import { EMAIL_BLOCK_DATA_SCHEMAS } from '../email/document.js';
import { isEmailBlockKind } from '../email/render.js';
import { ForbiddenError } from '../errors.js';
import type { FileStore } from '../files/store.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { sniffLogo } from '../routes/branding/index.js';
import { canonicalJson } from './sample-data.js';

/** The realtime events the screens repaint on (`branding/service.ts` BRANDING_UPDATED, `routes/i18n` I18N_CHANGED). */
export const INSTANCE_EVENTS = { branding: 'settings.branding.updated', i18n: 'i18n.changed' } as const;

/** The answers of the review: ticked, and the link hosts ticked per edited email (`<key>/<locale>`). */
export interface InstanceAnswers {
  instance?: boolean | undefined;
  instanceHosts?: Readonly<Record<string, readonly string[]>> | undefined;
}

const instanceOf = (manifest: Manifest): InstancePart | undefined => (manifest.kind === 'app' ? (manifest as { instance?: InstancePart }).instance : undefined);

/** Whether the file carries a deployment-wide part. */
export function carriesInstance(manifest: Manifest): boolean {
  return instanceOf(manifest) !== undefined;
}

/** Why this person may not apply the part they ticked, or null. Unticked, nothing is asked. */
export async function instanceRefusal(manifest: Manifest, ticked: boolean | undefined, can: (permission: string) => Promise<boolean>): Promise<ForbiddenError | null> {
  if (ticked !== true || !carriesInstance(manifest)) return null;
  if (await can(PERMISSIONS.settingsManage)) return null;
  return new ForbiddenError(
    `"${manifest.name}" brings this server's look, languages, wording and system emails, which only someone who may change the server's settings can apply. Install it without them, or ask someone who can.`,
    'FORBIDDEN',
    { permission: PERMISSIONS.settingsManage, reason: 'INSTANCE_PERMISSION' },
  );
}

// ── The stores a value lives in ─────────────────────────────────────────────

const SCOPE = 'workspace';

interface EmailHeld {
  subject: string;
  preheader: string;
  blocks: Record<string, unknown>[];
  footer: string | null;
  isBuiltinCopy: boolean;
}

interface WordHeld {
  text: string;
  source: string | null;
}

const wordItem = (locale: string, namespace: string, key: string): string => `${locale}:${namespace}:${key}`;
function wordParts(item: string): { locale: string; namespace: string; key: string } {
  const [locale = '', namespace = '', ...rest] = item.split(':');
  return { locale, namespace, key: rest.join(':') };
}
const emailItem = (key: string, locale: string): string => `${key}/${locale}`;
function emailParts(item: string): { key: string; locale: string } {
  const slash = item.indexOf('/');
  return { key: item.slice(0, slash), locale: item.slice(slash + 1) };
}

/** What is in the store now: the value, or null when nothing is set. */
async function readHeld(m: MetaDb, kind: AppInstanceValueKind, item: string): Promise<HeldValue> {
  switch (kind) {
    case 'setting': {
      const row = await m.db.selectFrom('adminium_settings').select(['value']).where('key', '=', item).executeTakeFirst();
      return row === undefined ? null : { value: readJsonFrom(m, row.value) };
    }
    case 'locale': {
      const row = await m.db.selectFrom('adminium_locales').select(['enabled']).where('locale', '=', item).executeTakeFirst();
      return row === undefined ? null : { value: readBool(row.enabled) };
    }
    case 'word': {
      const { locale, namespace, key } = wordParts(item);
      const row = await m.db
        .selectFrom('adminium_translations')
        .select(['value', 'sourceText'])
        .where('scope', '=', SCOPE)
        .where('locale', '=', locale)
        .where('namespace', '=', namespace)
        .where('key', '=', key)
        .executeTakeFirst();
      return row === undefined ? null : { value: { text: row.value, source: row.sourceText } satisfies WordHeld };
    }
    case 'email': {
      const { key, locale } = emailParts(item);
      const row = await m.db
        .selectFrom('adminium_email_templates')
        .select(['subject', 'preheader', 'blocks', 'footer', 'isBuiltinCopy'])
        .where('key', '=', key)
        .where('locale', '=', locale)
        .executeTakeFirst();
      if (row === undefined) return null;
      return { value: { subject: row.subject, preheader: row.preheader, blocks: readJson<Record<string, unknown>[]>(row.blocks), footer: row.footer, isBuiltinCopy: readBool(row.isBuiltinCopy) } satisfies EmailHeld };
    }
  }
}

/** Writes a value into its store; `null` takes it out (nothing set). */
async function writeHeld(m: MetaDb, kind: AppInstanceValueKind, item: string, held: HeldValue, userId: string | null, at: number): Promise<void> {
  switch (kind) {
    case 'setting': {
      if (!isSettingKey(item) || SETTINGS_REGISTRY[item].secret === true) throw new Error(`"${item}" is not a setting an app may write.`);
      if (held === null) await settingsRepo(m).unset(item);
      else await settingsRepo(m).set(item, held.value as never, { updatedBy: userId, at });
      return;
    }
    case 'locale': {
      if (held === null) {
        await m.db.deleteFrom('adminium_locales').where('locale', '=', item).execute();
        return;
      }
      const enabled = writeBool(m, held.value === true);
      const res = await m.db.updateTable('adminium_locales').set({ enabled, updatedBy: userId, updatedAt: at }).where('locale', '=', item).executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        await m.db
          .insertInto('adminium_locales')
          .values({ id: newId('loc'), locale: item, isBuiltin: writeBool(m, true), enabled, sortOrder: 0, english: null, native: null, dir: null, fontHint: null, intlTag: null, pluralCategories: null, updatedBy: userId, createdAt: at, updatedAt: at })
          .execute();
      }
      return;
    }
    case 'word': {
      const { locale, namespace, key } = wordParts(item);
      const where = m.db.deleteFrom('adminium_translations').where('scope', '=', SCOPE).where('locale', '=', locale).where('namespace', '=', namespace).where('key', '=', key);
      if (held === null) {
        await where.execute();
        return;
      }
      const word = held.value as WordHeld;
      const res = await m.db
        .updateTable('adminium_translations')
        .set({ value: word.text, sourceText: word.source, updatedBy: userId, updatedAt: at })
        .where('scope', '=', SCOPE)
        .where('locale', '=', locale)
        .where('namespace', '=', namespace)
        .where('key', '=', key)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        await m.db
          .insertInto('adminium_translations')
          .values({ id: newId('trn'), scope: SCOPE, locale, namespace, key, value: word.text, sourceText: word.source, updatedBy: userId, createdAt: at, updatedAt: at })
          .execute();
      }
      return;
    }
    case 'email': {
      // An email is only ever written over a row that is there (a system email in that language).
      if (held === null) return;
      const { key, locale } = emailParts(item);
      const email = held.value as EmailHeld;
      await m.db
        .updateTable('adminium_email_templates')
        .set({ subject: email.subject, preheader: email.preheader, blocks: packJson(email.blocks), footer: email.footer, isBuiltinCopy: writeBool(m, email.isBuiltinCopy), updatedBy: userId, updatedAt: at })
        .where('key', '=', key)
        .where('locale', '=', locale)
        .execute();
      return;
    }
  }
}

/** Whether the store still holds what the install wrote (a word by its text alone). */
function sameValue(kind: AppInstanceValueKind, now: HeldValue, applied: unknown): boolean {
  // A built-in language with no row of its own is on.
  if (kind === 'locale' && now === null) return applied === true;
  if (now === null) return false;
  if (kind === 'word') return (now.value as WordHeld).text === (applied as WordHeld | null)?.text;
  return canonicalJson(now.value ?? null) === canonicalJson(applied ?? null);
}

// ── What the part would write here ──────────────────────────────────────────

/** One value the part writes: where, and what. */
interface PlannedValue {
  kind: AppInstanceValueKind;
  item: string;
  to: unknown;
}

/** A part of the file this server does not take, and why. */
export interface InstanceLeft {
  item: string;
  reason: string;
}

/** A logo or a favicon the part brings, as its package holds it. */
interface PlannedFile {
  setting: 'branding.logoFileId' | 'branding.faviconFileId';
  file: string;
  sha256: string;
}

interface InstancePlan {
  values: PlannedValue[];
  files: PlannedFile[];
  left: InstanceLeft[];
  emails: { item: string; key: string; locale: string; held: EmailHeld; hosts: string[] }[];
}

/** The settings that name a picture of the Files library. */
const PICTURE_SETTINGS: readonly string[] = ['branding.logoFileId', 'branding.faviconFileId'];

/** The settings the look writes, each from its field of `branding`. */
const BRANDING_SETTINGS = {
  appName: 'branding.appName',
  showVersion: 'branding.showVersion',
  theme: 'appearance.theme',
  accent: 'appearance.accent',
  density: 'appearance.density',
} as const;

/** Every link host in an email's words: a link to anywhere a person may be sent. */
export function linkHosts(content: unknown): string[] {
  const hosts = new Set<string>();
  const visit = (value: unknown, field: string | null): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bhttps?:\/\/([^\s"'<>()/?#\\]+)/gi)) hosts.add(hostOf(match[1]!));
      // A link with no scheme in a field that is a link (`//evil.example`).
      if (field !== null && /^(?:url|href|src|link)$/i.test(field)) {
        const bare = /^\/\/([^\s"'<>()/?#\\]+)/.exec(value.trim());
        if (bare !== null) hosts.add(hostOf(bare[1]!));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const one of value) visit(one, field);
      return;
    }
    if (value !== null && typeof value === 'object') for (const [key, one] of Object.entries(value)) visit(one, key);
  };
  visit(content, null);
  hosts.delete('');
  return [...hosts].sort();
}

function hostOf(authority: string): string {
  const afterUser = authority.slice(authority.lastIndexOf('@') + 1);
  return afterUser.replace(/:\d*$/, '').replace(/\.$/, '').toLowerCase();
}

/** A file's blocks as the store keeps them: each with an id the editor addresses. */
function storedBlocks(blocks: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return blocks.map((block, index) => ({ ...block, id: (block['id'] as string | undefined) ?? `${String(block['block']).slice('email.'.length)}-${String(index + 1)}` }));
}

/** Why an email's blocks cannot be drawn here, or null. */
function blocksProblem(blocks: readonly Record<string, unknown>[]): string | null {
  for (const [index, block] of blocks.entries()) {
    const kind = block['block'];
    if (kind === 'email.rows' || !isEmailBlockKind(kind)) return `block ${String(index + 1)} is "${String(kind)}", which a system email cannot draw`;
    const data = block['data'];
    if (data !== undefined && !EMAIL_BLOCK_DATA_SCHEMAS[kind].safeParse(data).success) return `block ${String(index + 1)} is not the shape a "${kind}" block takes`;
  }
  return null;
}

/** The languages this server has: every built-in, and its own. */
async function languagesHere(m: MetaDb): Promise<Map<string, boolean>> {
  const rows = await m.db.selectFrom('adminium_locales').select(['locale', 'enabled']).execute();
  const byLocale = new Map(rows.map((row) => [row.locale, readBool(row.enabled)]));
  const out = new Map<string, boolean>();
  for (const compiled of LOCALES) out.set(compiled.id, byLocale.get(compiled.id) ?? true);
  for (const [locale, enabled] of byLocale) if (!out.has(locale)) out.set(locale, enabled);
  return out;
}

/** What the part would write on this store, read through `m` (the install's transaction, or the store itself for the review). */
async function planInstance(m: MetaDb, part: InstancePart): Promise<InstancePlan> {
  const values: PlannedValue[] = [];
  const left: InstanceLeft[] = [];
  const files: PlannedFile[] = [];
  const setting = (key: string, to: unknown): void => {
    // The schema allows none, and a secret setting is refused again by the registry.
    if (!isSettingKey(key) || SETTINGS_REGISTRY[key].secret === true) {
      left.push({ item: key, reason: 'it is not a setting an app may write' });
      return;
    }
    if (!SETTINGS_REGISTRY[key].schema.safeParse(to).success) {
      left.push({ item: key, reason: 'this Adminium does not take that value' });
      return;
    }
    values.push({ kind: 'setting', item: key, to });
  };

  const branding = part.branding ?? {};
  for (const [field, key] of Object.entries(BRANDING_SETTINGS)) {
    const to = (branding as Record<string, unknown>)[field];
    if (to !== undefined) setting(key, to);
  }
  if (branding.logo !== undefined) files.push({ setting: 'branding.logoFileId', ...branding.logo });
  if (branding.favicon !== undefined) files.push({ setting: 'branding.faviconFileId', ...branding.favicon });
  for (const [key, to] of Object.entries(part.settings ?? {})) if (to !== undefined) setting(key, to);

  const here = await languagesHere(m);
  if (part.languages !== undefined) {
    const known = part.languages.enabled.filter((locale) => here.has(locale));
    for (const locale of part.languages.enabled) if (!here.has(locale)) left.push({ item: `language ${locale}`, reason: 'this server has no such language' });
    if (known.length === 0) {
      left.push({ item: 'languages', reason: 'none of its languages is on this server' });
    } else {
      // Every language, switched as the file says: the apply skips one already so.
      for (const locale of here.keys()) values.push({ kind: 'locale', item: locale, to: known.includes(locale) });
      const fallback = part.languages.default;
      if (fallback !== undefined) {
        if (known.includes(fallback)) setting('locale.default', fallback);
        else left.push({ item: 'locale.default', reason: `"${fallback}" is not a language this server has` });
      }
    }
  }

  const live = (locale: string): boolean => here.has(locale);
  for (const word of part.wording ?? []) {
    const item = wordItem(word.locale, word.namespace, word.key);
    const reason = !live(word.locale)
      ? 'this server has no such language'
      : !(NAMESPACES as readonly string[]).includes(word.namespace)
        ? 'this Adminium has no such group of words'
        : wordRefusal(word);
    if (reason !== null) {
      left.push({ item, reason });
      continue;
    }
    values.push({ kind: 'word', item, to: { text: word.value, source: sourceMessage(word.namespace, word.key) } satisfies WordHeld });
  }

  const emails: InstancePlan['emails'] = [];
  for (const email of part.systemEmails ?? []) {
    const item = emailItem(email.key, email.locale);
    const now = await readHeld(m, 'email', item);
    if (now === null) {
      left.push({ item, reason: 'this server has no such system email in that language' });
      continue;
    }
    const blocks = storedBlocks(email.content.blocks as Record<string, unknown>[]);
    const problem = blocksProblem(blocks);
    if (problem !== null) {
      left.push({ item, reason: problem });
      continue;
    }
    const held: EmailHeld = { subject: email.content.subject, preheader: email.content.preheader ?? '', blocks, footer: email.content.footer ?? '', isBuiltinCopy: false };
    emails.push({ item, key: email.key, locale: email.locale, held, hosts: linkHosts(email.content) });
  }
  return { values, files, left, emails };
}

function wordRefusal(word: { locale: string; namespace: string; key: string; value: string }): string | null {
  const source = sourceMessage(word.namespace, word.key);
  if (source === null) return 'this Adminium has no such word';
  if (word.value === '' && isA11yCriticalKey(word.namespace, word.key)) return 'it names something for a screen reader, and cannot be left blank';
  const checked = validateMessage({ candidate: word.value, source, locale: word.locale, allowEmpty: true });
  return checked.ok ? null : checked.errors.map((error) => error.message).join(' ');
}

/** Whether every link host of an email is ticked. */
function hostsTicked(email: { item: string; hosts: readonly string[] }, answers: InstanceAnswers['instanceHosts']): boolean {
  const ticked = new Set((answers?.[email.item] ?? []).map((host) => host.toLowerCase()));
  return email.hosts.every((host) => ticked.has(host));
}

// ── The review ──────────────────────────────────────────────────────────────

export interface InstanceReview {
  /** The permission applying it needs. */
  needs: string;
  settings: { key: string; from: unknown; to: unknown }[];
  files: { setting: string; file: string; replaces: boolean }[];
  languages: { on: string[]; off: string[] };
  wording: { changed: number; same: number };
  systemEmails: {
    id: string;
    key: string;
    locale: string;
    subject: { from: string; to: string } | null;
    preheaderChanged: boolean;
    footerChanged: boolean;
    blocks: { added: string[]; removed: string[]; changed: string[] };
    /** Every link host it holds: each is ticked on its own, and an email with one unticked is left out. */
    hosts: string[];
  }[];
  left: InstanceLeft[];
}

/** What the part would change here, for the review. Undefined for a file that carries none. */
export async function reviewInstance(meta: MetaDb, manifest: Manifest): Promise<InstanceReview | undefined> {
  const part = instanceOf(manifest);
  if (part === undefined) return undefined;
  const plan = await planInstance(meta, part);
  const settings: InstanceReview['settings'] = [];
  const languages = { on: [] as string[], off: [] as string[] };
  let changed = 0;
  let same = 0;
  for (const value of plan.values) {
    const now = await readHeld(meta, value.kind, value.item);
    if (value.kind === 'setting') {
      const from = isSettingKey(value.item) ? await settingsRepo(meta).get(value.item) : null;
      if (canonicalJson(from ?? null) !== canonicalJson(value.to ?? null)) settings.push({ key: value.item, from, to: value.to });
    } else if (value.kind === 'locale') {
      if (!sameValue('locale', now, value.to)) (value.to === true ? languages.on : languages.off).push(value.item);
    } else if (value.kind === 'word') {
      if (sameValue('word', now, value.to)) same += 1;
      else changed += 1;
    }
  }
  const current = await settingsRepo(meta).overrides();
  const files = plan.files.map((file) => ({ setting: file.setting, file: file.file, replaces: typeof current[file.setting] === 'string' }));
  const systemEmails = await Promise.all(
    plan.emails.map(async (email) => {
      const now = (await readHeld(meta, 'email', email.item))!.value as EmailHeld;
      const before = new Map(now.blocks.map((block) => [String(block['id']), canonicalJson(block)]));
      const after = new Map(email.held.blocks.map((block) => [String(block['id']), canonicalJson(block)]));
      return {
        id: email.item,
        key: email.key,
        locale: email.locale,
        subject: now.subject === email.held.subject ? null : { from: now.subject, to: email.held.subject },
        preheaderChanged: now.preheader !== email.held.preheader,
        footerChanged: (now.footer ?? '') !== (email.held.footer ?? ''),
        blocks: {
          added: [...after.keys()].filter((id) => !before.has(id)),
          removed: [...before.keys()].filter((id) => !after.has(id)),
          changed: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
        },
        hosts: email.hosts,
      };
    }),
  );
  return { needs: PERMISSIONS.settingsManage, settings, files, languages, wording: { changed, same }, systemEmails, left: plan.left };
}

/**
 * Why the part's logo or favicon cannot be used, per file: not in its
 * package, not the bytes its sha256 says, or not a picture. A plan problem:
 * the file is broken, whatever is ticked.
 */
export async function instanceFileProblems(manifest: Manifest, readFile: (path: string) => Promise<Uint8Array>, library: FileStore | undefined): Promise<string[]> {
  const part = instanceOf(manifest);
  const out: string[] = [];
  for (const file of [part?.branding?.logo, part?.branding?.favicon]) {
    if (file === undefined) continue;
    const where = `The look carries "${file.file}"`;
    if (library === undefined) {
      out.push(`${where}, and this server has no Files library to keep it in.`);
      continue;
    }
    const bytes = await readFile(file.file).then((read) => Buffer.from(read), () => null);
    if (bytes === null) out.push(`${where}, which its package does not hold.`);
    else if (sha256Hex(bytes) !== file.sha256) out.push(`${where}, whose bytes are not the ones the file names.`);
    else if (sniffLogo(bytes) === null) out.push(`${where}, which is not a PNG, JPEG, WebP, GIF or SVG picture.`);
  }
  return out;
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ── Applying it ─────────────────────────────────────────────────────────────

export interface ApplyInstanceInput {
  meta: MetaDb;
  manifest: Manifest;
  /** The install's own row: the undo is kept under it. */
  manifestId: string;
  answers: InstanceAnswers;
  /** The package's verified files. */
  readFile: (path: string) => Promise<Uint8Array>;
  /** Where the logo and the favicon are kept. */
  library: FileStore | undefined;
  userId: string | null;
  at?: number | undefined;
  /** Called after each value is written, inside the transaction (a test makes one fail). */
  afterWrite?: ((item: string) => void | Promise<void>) | undefined;
}

export interface InstanceResult {
  /** Values written: `<kind>:<item>`. */
  written: string[];
  /** Values a version before wrote and this one does not carry, put back. */
  restored: string[];
  /** What this server did not take, and why: an email with an unticked host among them. */
  left: InstanceLeft[];
  /** Whether the menu's look or the words changed: the screens repaint. */
  branding: boolean;
  words: boolean;
}

/** A picture kept in the Files library for a setting, before the transaction: the bytes first, the row inside it. */
interface KeptPicture {
  setting: PlannedFile['setting'];
  fileId: string;
  /** A row to make inside the transaction; absent when the install's own earlier copy is the same bytes. */
  row?: Parameters<ReturnType<typeof filesRepo>['create']>[0];
}

/**
 * Applies the part in one meta transaction, keeping what each value replaced.
 * Run again (an update, or an install resumed), it writes again and keeps the
 * first undo; a value an earlier version wrote and this one no longer carries
 * is put back.
 */
export async function applyInstance(input: ApplyInstanceInput): Promise<InstanceResult | undefined> {
  const part = instanceOf(input.manifest);
  if (part === undefined) return undefined;
  const at = input.at ?? Date.now();
  const undo = appInstanceUndoRepo(input.meta);
  const records = new Map((await undo.list(input.manifestId)).map((record) => [`${record.kind}:${record.item}`, record]));

  // The pictures' bytes, kept before anything is written: the store is no transaction.
  const pictures: KeptPicture[] = [];
  const wroteBytes: { destinationId: string | null; storageKey: string }[] = [];
  const planned = [part.branding?.logo === undefined ? null : { setting: 'branding.logoFileId' as const, ...part.branding.logo }, part.branding?.favicon === undefined ? null : { setting: 'branding.faviconFileId' as const, ...part.branding.favicon }];
  for (const file of planned) {
    if (file === null) continue;
    if (input.library === undefined) throw new Error(`The look carries "${file.file}", and this server has no Files library to keep it in.`);
    const earlier = records.get(`setting:${file.setting}`)?.applied;
    const earlierRow = typeof earlier === 'string' ? await filesRepo(input.meta).findById(earlier) : null;
    if (earlierRow !== null && earlierRow.deletedAt === null && earlierRow.sha256 === file.sha256) {
      pictures.push({ setting: file.setting, fileId: earlierRow.id });
      continue;
    }
    const bytes = Buffer.from(await input.readFile(file.file));
    if (sha256Hex(bytes) !== file.sha256) throw new Error(`"${file.file}" is not the bytes the file names.`);
    const mime = sniffLogo(bytes);
    if (mime === null) throw new Error(`"${file.file}" is not a PNG, JPEG, WebP, GIF or SVG picture.`);
    const fileId = newId('file');
    const filename = file.file.slice(file.file.lastIndexOf('/') + 1);
    const stored = await input.library.write({ id: fileId, kind: 'branding', filename, mime, bytes });
    wroteBytes.push({ destinationId: stored.destinationId, storageKey: stored.storageKey });
    pictures.push({
      setting: file.setting,
      fileId,
      row: { id: fileId, filename, mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, kind: 'branding', uploadedBy: input.userId, storageKey: stored.storageKey, destinationId: stored.destinationId, storage: stored.storage },
    });
  }

  try {
    return await input.meta.db.transaction().execute(async (trx) => {
      const m: MetaDb = { db: trx, dialect: input.meta.dialect };
      const plan = await planInstance(m, part);
      const left = [...plan.left];
      const values: PlannedValue[] = [...plan.values];
      for (const email of plan.emails) {
        if (hostsTicked(email, input.answers.instanceHosts)) values.push({ kind: 'email', item: email.item, to: email.held });
        else left.push({ item: email.item, reason: `it links to ${email.hosts.filter((host) => !(input.answers.instanceHosts?.[email.item] ?? []).map((h) => h.toLowerCase()).includes(host)).map((host) => `"${host}"`).join(', ')}, which was not ticked` });
      }
      for (const picture of pictures) {
        if (picture.row !== undefined) await filesRepo(m).create(picture.row, at);
        values.push({ kind: 'setting', item: picture.setting, to: picture.fileId });
      }

      const result: InstanceResult = { written: [], restored: [], left, branding: false, words: false };
      const touched = (kind: AppInstanceValueKind, item: string): void => {
        if (kind === 'word' || kind === 'locale') result.words = true;
        if (kind === 'setting' && (item.startsWith('branding.') || item.startsWith('appearance.'))) result.branding = true;
      };
      const carried = new Set<string>();
      for (const value of values) {
        const id = `${value.kind}:${value.item}`;
        carried.add(id);
        const now = await readHeld(m, value.kind, value.item);
        const recorded = records.get(id);
        // Already as the file says, and never written by this install: nothing is replaced, nothing to undo.
        if (recorded === undefined && sameValue(value.kind, now, value.to)) continue;
        if (!sameValue(value.kind, now, value.to)) {
          await writeHeld(m, value.kind, value.item, { value: value.to }, input.userId, at);
          touched(value.kind, value.item);
          result.written.push(id);
        }
        await appInstanceUndoRepo(m).put({ manifestId: input.manifestId, kind: value.kind, item: value.item, before: now, applied: value.to }, at);
        // The install's own earlier picture, replaced: let go (the storage sweep removes its bytes).
        if (value.kind === 'setting' && PICTURE_SETTINGS.includes(value.item) && typeof recorded?.applied === 'string' && recorded.applied !== value.to) {
          await filesRepo(m).markDeleted(recorded.applied, at);
        }
        await input.afterWrite?.(id);
      }
      // What an earlier version wrote and this one no longer carries: put back.
      for (const [id, record] of records) {
        if (carried.has(id)) continue;
        if (await restoreOne(m, record, input.userId, at)) {
          touched(record.kind, record.item);
          result.restored.push(id);
        }
      }
      if (result.words) await bumpI18nVersion(trx, at, input.userId);
      return result;
    });
  } catch (error) {
    // Nothing was written: the bytes kept for it go too.
    for (const bytes of wroteBytes) await input.library?.remove(bytes).catch(() => undefined);
    throw error;
  }
}

/** Puts one value back as it was, when it still holds what the install wrote; forgets the undo either way. */
async function restoreOne(m: MetaDb, record: { manifestId: string; kind: AppInstanceValueKind; item: string; before: HeldValue; applied: unknown }, userId: string | null, at: number): Promise<boolean> {
  const now = await readHeld(m, record.kind, record.item);
  const untouched = sameValue(record.kind, now, record.applied);
  if (untouched) await writeHeld(m, record.kind, record.item, record.before, userId, at);
  // A picture the install kept is let go once no setting names it.
  if (record.kind === 'setting' && PICTURE_SETTINGS.includes(record.item) && typeof record.applied === 'string') {
    let named = false;
    for (const key of PICTURE_SETTINGS) if ((await readHeld(m, 'setting', key))?.value === record.applied) named = true;
    if (!named) await filesRepo(m).markDeleted(record.applied, at);
  }
  await appInstanceUndoRepo(m).remove(record.manifestId, record.kind, record.item);
  return untouched;
}

export interface UndoResult {
  /** Values put back: `<kind>:<item>`. */
  restored: string[];
  /** Values somebody changed since the install: theirs now, left as they are. */
  kept: string[];
  branding: boolean;
  words: boolean;
}

/** The uninstall: every value the install wrote, put back as it was, in one transaction. */
export async function undoInstance(meta: MetaDb, manifestId: string, userId: string | null = null, at: number = Date.now()): Promise<UndoResult> {
  return meta.db.transaction().execute(async (trx) => {
    const m: MetaDb = { db: trx, dialect: meta.dialect };
    const result: UndoResult = { restored: [], kept: [], branding: false, words: false };
    for (const record of await appInstanceUndoRepo(m).list(manifestId)) {
      const id = `${record.kind}:${record.item}`;
      if (await restoreOne(m, record, userId, at)) {
        result.restored.push(id);
        if (record.kind === 'word' || record.kind === 'locale') result.words = true;
        if (record.kind === 'setting' && (record.item.startsWith('branding.') || record.item.startsWith('appearance.'))) result.branding = true;
      } else {
        result.kept.push(id);
      }
    }
    if (result.words) await bumpI18nVersion(trx, at, userId);
    return result;
  });
}
