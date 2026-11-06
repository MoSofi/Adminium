// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `instance`, the deployment-wide part, written only
 * when the person chose it (`choices.instance`): the look, the languages, the
 * wording somebody changed, the system emails somebody edited, and plain
 * settings from the allow-list. Never any part of a secret setting.
 *
 * Only what somebody set travels: a setting still at its default stays out,
 * so the target keeps its own. A system email that is still the built-in
 * (`isBuiltinCopy`) stays out; an edited one travels as its words and blocks,
 * without its sender (an "after you install" item) or its look. The logo and
 * the favicon travel as package files, with their sha256.
 */
import { createHash } from 'node:crypto';

import { LOCALES } from '@adminium/i18n';
import { INSTANCE_SETTING_KEYS, INSTANCE_SYSTEM_EMAIL_KEYS, instanceSchema, type InstancePart } from '@adminium/manifest';
import { SETTINGS_REGISTRY, emailTemplatesRepo, filesRepo, localesRepo, settingsRepo, type MetaDb, type SettingKey } from '@adminium/meta';

import { sniffLogo } from '../../routes/branding/index.js';
import type { CheckList } from './check.js';
import type { ConvertContext, ConvertPart, SaveSource } from './types.js';

/**
 * How a save reads a file of the Files library: the service hands it on the
 * source (its `FileStore`). Absent (a save with no library), the logo and the
 * favicon stay out, and Check says so.
 */
export interface SourceFiles {
  readFile(fileId: string): Promise<Uint8Array | null>;
}
export type SaveSourceWithFiles = SaveSource & { files?: SourceFiles | undefined };

const KIND = 'instance';
const SCOPE = 'workspace';

/** The settings the look reads, each into its field of `branding`. */
const BRANDING_SETTINGS = {
  appName: 'branding.appName',
  showVersion: 'branding.showVersion',
  theme: 'appearance.theme',
  accent: 'appearance.accent',
  density: 'appearance.density',
} as const satisfies Record<string, SettingKey>;

const PICTURE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

const BLOCK_FIELDS = ['block', 'id', 'label', 'data', 'showWhen', 'otherwise'] as const;
/** The most changed words one file carries (the manifest's own cap). */
const WORDS_MAX = 5000;

export const convertInstance: ConvertPart = async (ctx) => {
  if (ctx.choices.instance !== true) return {};
  const meta = ctx.source.meta;
  const check = ctx.check;
  const overrides = await settingsRepo(meta).overrides();
  const part: Record<string, unknown> = {};

  // The look: what somebody set, and the pictures as package files.
  const branding: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(BRANDING_SETTINGS)) if (overrides[key] !== undefined) branding[field] = overrides[key];
  for (const [field, key, name] of [['logo', 'branding.logoFileId', 'logo'], ['favicon', 'branding.faviconFileId', 'favicon']] as const) {
    const fileId = overrides[key];
    if (typeof fileId !== 'string' || fileId === '') continue;
    const picture = await pictureOf(ctx, meta, fileId, name);
    if (picture !== null) branding[field] = picture;
  }
  if (Object.keys(branding).length > 0) part['branding'] = branding;

  // The languages, when somebody changed which are on or which comes first.
  const rows = await localesRepo(meta).list();
  const defaultLocale = overrides['locale.default'];
  if (rows.length > 0 || defaultLocale !== undefined) {
    const byLocale = new Map(rows.map((row) => [row.locale, row]));
    const enabled = [...LOCALES.map((compiled) => compiled.id as string).filter((id) => byLocale.get(id)?.enabled ?? true), ...rows.filter((row) => !row.isBuiltin && row.enabled && !LOCALES.some((compiled) => compiled.id === row.locale)).map((row) => row.locale)];
    for (const row of rows) {
      if (!row.isBuiltin && row.enabled) check.add({ group: 'info', code: 'INSTANCE_OWN_LANGUAGE', kind: KIND, item: row.locale, message: `${row.locale} is a language made here: it is switched on where the app is installed only if that server has it too.` });
    }
    const first = typeof defaultLocale === 'string' && enabled.includes(defaultLocale) ? defaultLocale : undefined;
    if (typeof defaultLocale === 'string' && first === undefined) check.add({ group: 'info', code: 'INSTANCE_DEFAULT_OFF', kind: KIND, item: defaultLocale, field: 'locale.default', message: 'The language everybody starts in is switched off here, so which language comes first stays out.' });
    if (enabled.length > 0) part['languages'] = { enabled, ...(first === undefined ? {} : { default: first }) };
  }

  // The words somebody changed. A blank one is a word left out on purpose, and travels as one.
  const words = await meta.db.selectFrom('adminium_translations').select(['locale', 'namespace', 'key', 'value']).where('scope', '=', SCOPE).orderBy('locale').orderBy('namespace').orderBy('key').execute();
  const wording = words
    .map((word) => ({ locale: word.locale, namespace: word.namespace, key: word.key, value: word.value }))
    .filter((word) => {
      if (instanceSchema.safeParse({ wording: [word] }).success) return true;
      check.add({ group: 'info', code: 'INSTANCE_LEFT', kind: KIND, item: `${word.namespace}.${word.key} (${word.locale})`, field: 'wording', message: 'A saved app cannot carry this word as it is, so it stays out.' });
      return false;
    });
  if (wording.length > WORDS_MAX) check.add({ group: 'info', code: 'INSTANCE_WORDS_CUT', kind: KIND, item: 'wording', field: 'wording', message: `A saved app carries at most ${String(WORDS_MAX)} changed words: the rest stay out.` });
  if (wording.length > 0) part['wording'] = wording.slice(0, WORDS_MAX);

  // The system emails somebody edited, without their sender or their look.
  const emails: Record<string, unknown>[] = [];
  for (const row of await emailTemplatesRepo(meta).list({ kind: 'template' })) {
    if (!(INSTANCE_SYSTEM_EMAIL_KEYS as readonly string[]).includes(row.key) || row.isBuiltinCopy || row.managedBy !== null) continue;
    const item = `${row.key} (${row.locale})`;
    if (row.blocks.some((block) => block['block'] === 'email.html')) {
      check.add({ group: 'info', code: 'INSTANCE_EMAIL_HTML', kind: KIND, item, field: 'blocks', message: 'This system email holds an HTML block, which a saved app cannot carry: it stays out.' });
      continue;
    }
    if (row.brand !== null && row.brand.fromEmail.trim() !== '') {
      check.add({ group: 'after', code: 'INSTANCE_EMAIL_SENDER', kind: KIND, item, field: 'brand.fromEmail', afterKind: 'sender', message: 'Who this system email is sent from stays here: set it on the server it is installed on.' });
    }
    if (row.brand !== null) check.add({ group: 'info', code: 'INSTANCE_EMAIL_LOOK', kind: KIND, item, field: 'brand', message: 'The look of this system email (its name, mark and colour) stays here: it is sent with the look of the server it is installed on.' });
    if (row.blocks.some((block) => block['style'] !== undefined)) check.add({ group: 'info', code: 'INSTANCE_EMAIL_STYLE', kind: KIND, item, field: 'blocks', message: 'The block styles of this system email stay here: its blocks travel in the plain style.' });
    if (row.attachments.length > 0) check.add({ group: 'info', code: 'INSTANCE_EMAIL_FILES', kind: KIND, item, field: 'attachments', message: 'What this system email attaches stays as the server it is installed on has it.' });
    const email = {
      key: row.key,
      locale: row.locale,
      content: {
        subject: row.subject,
        ...(row.preheader === '' ? {} : { preheader: row.preheader }),
        blocks: row.blocks.map((block) => Object.fromEntries(BLOCK_FIELDS.filter((field) => block[field] !== undefined).map((field) => [field, block[field]]))),
        ...(row.footer === '' ? {} : { footer: row.footer }),
      },
    };
    if (instanceSchema.safeParse({ systemEmails: [email] }).success) emails.push(email);
    else check.add({ group: 'info', code: 'INSTANCE_LEFT', kind: KIND, item, field: 'systemEmails', message: 'A saved app cannot carry this system email as it is (a block, a subject or a footer it does not take), so it stays out.' });
  }
  if (emails.length > 0) part['systemEmails'] = emails;

  // Plain settings from the allow-list; a secret one is named and stays.
  const settings: Record<string, unknown> = {};
  for (const key of INSTANCE_SETTING_KEYS) if (overrides[key] !== undefined && overrides[key] !== null) settings[key] = overrides[key];
  if (Object.keys(settings).length > 0) part['settings'] = settings;
  for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
    if ((def as { secret?: boolean }).secret === true && overrides[key as SettingKey] !== undefined && overrides[key as SettingKey] !== null) {
      check.add({ group: 'info', code: 'INSTANCE_SECRET_SETTING', kind: KIND, item: key, message: 'A secret setting never travels: it is set again on the server the app is installed on, if it is needed there.' });
    }
  }

  const instance = keptValid(part, check);
  if (instance === undefined) {
    check.add({ group: 'info', code: 'INSTANCE_NOTHING', kind: KIND, item: 'this server', message: 'Nothing of this server\'s look, languages, wording, system emails or settings was changed, so none of it travels.' });
    return {};
  }
  check.add({ group: 'info', code: 'INSTANCE_TICKED', kind: KIND, item: 'this server', message: 'This server\'s look, languages, wording, system emails and settings travel. They are written over the server it is installed on only when the person installing ticks them.' });
  return { instance };
};

/** A picture of the Files library as a package file, or null (said in Check). */
async function pictureOf(ctx: ConvertContext, meta: MetaDb, fileId: string, name: 'logo' | 'favicon'): Promise<{ file: string; sha256: string } | null> {
  const left = (message: string): null => {
    ctx.check.add({ group: 'info', code: 'INSTANCE_PICTURE_LEFT', kind: KIND, item: name, message });
    return null;
  };
  const row = await filesRepo(meta).findById(fileId);
  if (row === null || row.deletedAt !== null) return left(`The ${name} is no longer in the Files library, so it stays out.`);
  const files = (ctx.source as SaveSourceWithFiles).files;
  if (files === undefined) return left(`The ${name} cannot be read from the Files library here, so it stays out.`);
  const read = await files.readFile(fileId).catch(() => null);
  if (read === null) return left(`The ${name}'s file could not be read, so it stays out.`);
  const bytes = Buffer.from(read);
  const mime = sniffLogo(bytes);
  if (mime === null) return left(`The ${name} is not a PNG, JPEG, WebP, GIF or SVG picture, so it stays out.`);
  const file = `instance/${name}.${PICTURE_TYPES[mime]!}`;
  ctx.files.set(file, bytes);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * The part with every piece the manifest would refuse taken out (a word whose
 * key the schema does not take, a name too long), each said in Check; or
 * undefined when nothing is left.
 */
function keptValid(part: Record<string, unknown>, check: CheckList): InstancePart | undefined {
  for (let round = 0; round < 200; round += 1) {
    if (Object.keys(part).length === 0) return undefined;
    const parsed = instanceSchema.safeParse(part);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0]!;
    const [top, second] = issue.path as (string | number)[];
    if (top === undefined) return undefined;
    const block = part[top as string];
    if (Array.isArray(block) && typeof second === 'number') {
      const one = block[second] as Record<string, unknown> | undefined;
      const named = top === 'wording' ? `${String(one?.['namespace'])}.${String(one?.['key'])} (${String(one?.['locale'])})` : `${String(one?.['key'])} (${String(one?.['locale'])})`;
      check.add({ group: 'info', code: 'INSTANCE_LEFT', kind: KIND, item: named, field: String(top), message: 'A saved app cannot carry this as it is, so it stays out.' });
      block.splice(second, 1);
      if (block.length === 0) delete part[top as string];
      continue;
    }
    if (block !== null && typeof block === 'object' && !Array.isArray(block) && typeof second === 'string') {
      check.add({ group: 'info', code: 'INSTANCE_LEFT', kind: KIND, item: second, field: String(top), message: 'A saved app cannot carry this value as it is, so it stays out.' });
      delete (block as Record<string, unknown>)[second];
      if (Object.keys(block).length === 0) delete part[top as string];
      continue;
    }
    check.add({ group: 'info', code: 'INSTANCE_LEFT', kind: KIND, item: String(top), message: 'A saved app cannot carry this as it is, so it stays out.' });
    delete part[top as string];
  }
  return undefined;
}
