// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A server dressed the way a person dresses theirs (a name, a colour, a logo,
 * two languages, changed words, an edited password-reset email, plain and
 * secret settings), a Files library in memory, and a snapshot of everything
 * the deployment-wide part may touch, for the save and the install suites.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { LOCALES } from '@adminium/i18n';
import { INSTANCE_SYSTEM_EMAIL_KEYS } from '@adminium/manifest';
import { emailTemplatesRepo, filesRepo, localesRepo, newId, readBool, readJson, readJsonFrom, settingsRepo, translationsRepo, type MetaDb } from '@adminium/meta';

import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import type { FileStore } from '../src/files/store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
export type Doc = Record<string, any>;

/** A logo a person uploaded: an SVG, so it travels through a text package unchanged. */
export const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1f7a4d"/></svg>';
export const LOGO_SHA = createHash('sha256').update(Buffer.from(LOGO, 'utf8')).digest('hex');
/** A secret no file may hold: never provider-shaped. */
export const ASSISTANT_KEY = 'fernhill-assistant-key-not-real-0001';
export const HELP_HOST = 'help.fernhill.example';

/** A library that keeps the bytes in memory. */
export function memoryLibrary(): FileStore & { kept: Map<string, Buffer> } {
  const kept = new Map<string, Buffer>();
  return {
    kept,
    defaultDestinationId: async () => null,
    write: async (input: { id: string; bytes: Buffer | string }) => {
      const bytes = Buffer.from(input.bytes);
      kept.set(input.id, bytes);
      return { storageKey: input.id, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destinationId: null, storage: 'memory' };
    },
    read: async (file: { storageKey: string }) => Readable.from([kept.get(file.storageKey) ?? Buffer.alloc(0)]),
    open: async (file: { storageKey: string }) => {
      const held = kept.get(file.storageKey) ?? Buffer.alloc(0);
      return { stream: Readable.from([held]), sizeBytes: held.byteLength };
    },
    remove: async (file: { storageKey: string }) => {
      kept.delete(file.storageKey);
    },
  } as unknown as FileStore & { kept: Map<string, Buffer> };
}

/** The server Fernhill runs: what a person changed, through the stores their screens write. */
export async function dressServer(meta: MetaDb, library: FileStore): Promise<{ logoFileId: string }> {
  await seedBuiltinEmailTemplates(meta, Date.now());
  const settings = settingsRepo(meta);
  await settings.set('branding.appName', 'Fernhill');
  await settings.set('branding.showVersion', false);
  await settings.set('appearance.accent', 'teal');
  await settings.set('assistant.name', 'Fern');
  await settings.set('privacy.businessName', 'Fernhill Ltd');
  await settings.set('privacy.noticeUrl', 'https://fernhill.example/privacy');
  await settings.set('llm.apiKey', ASSISTANT_KEY);

  const logoFileId = newId('file');
  const stored = await library.write({ id: logoFileId, kind: 'branding', filename: 'fernhill.svg', mime: 'image/svg+xml', bytes: Buffer.from(LOGO, 'utf8') });
  await filesRepo(meta).create({ id: logoFileId, filename: 'fernhill.svg', mime: 'image/svg+xml', sizeBytes: stored.sizeBytes, sha256: stored.sha256, kind: 'branding', storageKey: stored.storageKey, storage: stored.storage });
  await settings.set('branding.logoFileId', logoFileId);

  // Two languages on, German first.
  for (const compiled of LOCALES) if (compiled.id !== 'en_US' && compiled.id !== 'de_DE') await localesRepo(meta).upsertBuiltin(compiled.id, { enabled: false });
  await settings.set('locale.default', 'de_DE');

  // Words somebody changed, one left blank on purpose.
  await translationsRepo(meta).upsert({ locale: 'de_DE', namespace: 'common', key: 'common.save', value: 'Sichern' });
  await translationsRepo(meta).upsert({ locale: 'en_US', namespace: 'common', key: 'auth.trust', value: '' });

  // The password-reset email, edited: new words, a help link, and a sender of its own.
  const reset = (await emailTemplatesRepo(meta).findByKeyLocale('password-reset', 'en_US'))!;
  await emailTemplatesRepo(meta).upsert('password-reset', 'en_US', {
    name: reset.name,
    subject: 'Choose a new Fernhill password',
    blocks: [...reset.blocks, { id: 'help', block: 'email.text', data: { text: `Stuck? Read https://${HELP_HOST}/reset or write to us.` } }],
    footer: reset.footer,
    enabled: true,
    isBuiltinCopy: false,
    brand: { name: 'Fernhill', mark: 'leaf', accent: '#1f7a4d', fromName: 'Fernhill desk', fromEmail: 'desk@fernhill.example' },
  });
  return { logoFileId };
}

/** The tables and pages parts' blocks, spliced in: one table and its page, so the file installs. */
export function withTableAndPage(doc: Doc): Doc {
  const out = structuredClone(doc);
  out['requiredSchema'] = { tables: [{ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }] }] };
  out['pages'] = [{ ref: 'notes', template: 'page-crud', title: { key: `${String(out['key'])}.notes`, fallback: 'Notes' }, nav: { group: `manifest:${String(out['key'])}`, icon: 'list', order: 1 }, bindings: { main: 'notes' } }];
  return out;
}

/** Everything the deployment-wide part may touch, as values (no times). */
export async function snapshot(meta: MetaDb): Promise<Doc> {
  const settings = await meta.db.selectFrom('adminium_settings').select(['key', 'value']).where('key', '!=', 'i18n.version').orderBy('key').execute();
  const words = await meta.db.selectFrom('adminium_translations').select(['locale', 'namespace', 'key', 'value', 'sourceText']).orderBy('locale').orderBy('namespace').orderBy('key').execute();
  const locales = await meta.db.selectFrom('adminium_locales').select(['locale', 'enabled']).orderBy('locale').execute();
  const emails = await meta.db
    .selectFrom('adminium_email_templates')
    .select(['key', 'locale', 'subject', 'preheader', 'blocks', 'footer', 'isBuiltinCopy'])
    .where('key', 'in', [...INSTANCE_SYSTEM_EMAIL_KEYS])
    .orderBy('key')
    .orderBy('locale')
    .execute();
  return {
    settings: settings.map((row) => [row.key, readJsonFrom(meta, row.value)]),
    words: words.map((row) => [row.locale, row.namespace, row.key, row.value, row.sourceText]),
    locales: locales.map((row) => [row.locale, readBool(row.enabled)]),
    emails: emails.map((row) => [row.key, row.locale, row.subject, row.preheader, readJson(row.blocks), row.footer, readBool(row.isBuiltinCopy)]),
  };
}

/** A setting as a screen reads it. */
export const settingOf = (meta: MetaDb, key: Parameters<ReturnType<typeof settingsRepo>['get']>[0]): Promise<unknown> => settingsRepo(meta).get(key);
