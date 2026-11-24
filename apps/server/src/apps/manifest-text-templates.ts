// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text messages an app ships, written to their own store beside its
 * emails and by the same rules: one row per language, marked as the app's with
 * a hash of what it wrote. An operator's edit survives the app's updates and
 * its removal, and a row of the same key that is not the app's is never
 * touched. Nothing here reads or writes an email template.
 */
import { createHash } from 'node:crypto';

import { checkTextTemplate, codeNamesIn, type AppManifest, type TextTemplateVerdict } from '@adminium/manifest';
import { textTemplatesRepo, type MetaDb, type StoredTextTemplate } from '@adminium/meta';

import type { InstallAddress } from '../installs/resolve.js';
import { canonicalJson } from './sample-data.js';

export interface TextTemplatesResult {
  written: string[];
  kept: string[];
  skipped: { key: string; locale: string; reason: string }[];
  removed: number;
}

/** What a row says, hashed the same however it was written. */
export function hashOf(row: Pick<StoredTextTemplate, 'name' | 'body'>): string {
  return createHash('sha256').update(canonicalJson({ name: row.name, body: row.body })).digest('hex');
}

function nameIn(name: NonNullable<AppManifest['textTemplates']>[number]['name'], locale: string): string {
  if (typeof name === 'string') return name;
  const names = name as Record<string, string>;
  return names[locale] ?? names['en-US'] ?? Object.values(names)[0] ?? '';
}

/** Every text the app ships now, and the app's unedited rows of texts it no longer ships taken away. */
export async function installTextTemplates(input: {
  meta: MetaDb;
  manifest: AppManifest;
  install: Pick<InstallAddress, 'id'>;
  storedKey: (key: string) => string;
}): Promise<TextTemplatesResult> {
  const { manifest, install, storedKey } = input;
  const repo = textTemplatesRepo(input.meta);
  const result: TextTemplatesResult = { written: [], kept: [], skipped: [], removed: 0 };
  const shipped = new Set<string>();
  for (const template of manifest.textTemplates ?? []) {
    for (const [tag, content] of Object.entries(template.locales)) {
      // The store keys a language the way Adminium's locales are spelled (`en_US`).
      const locale = tag.replace('-', '_');
      const key = storedKey(template.key);
      const id = `${key}/${locale}`;
      shipped.add(id);
      const existing = await repo.findByKeyLocale(key, locale);
      if (existing !== null && (existing.managedBy !== manifest.key || (existing.installId !== null && existing.installId !== install.id))) {
        result.skipped.push({ key, locale, reason: 'A text template of this name and language is not this app’s.' });
        continue;
      }
      if (existing !== null && existing.contentHash !== hashOf(existing)) {
        result.kept.push(id);
        continue;
      }
      const name = nameIn(template.name, tag);
      await repo.upsert(key, locale, { name, body: content.body, enabled: existing?.enabled ?? true, managedBy: manifest.key, installId: install.id, contentHash: hashOf({ name, body: content.body }) });
      result.written.push(id);
    }
  }
  for (const row of await repo.listManagedBy(manifest.key, install.id)) {
    if (shipped.has(`${row.key}/${row.locale}`) || row.contentHash !== hashOf(row)) continue;
    if (await repo.remove(row.key, row.locale)) result.removed += 1;
  }
  return result;
}

/** Uninstall: one install's text templates nobody edited. Returns how many went. */
export async function removeTextTemplates(meta: MetaDb, install: Pick<InstallAddress, 'id' | 'key'>): Promise<number> {
  const repo = textTemplatesRepo(meta);
  let removed = 0;
  for (const row of await repo.listManagedBy(install.key, install.id)) {
    if (row.contentHash === hashOf(row) && (await repo.remove(row.key, row.locale))) removed += 1;
  }
  return removed;
}

/**
 * An operator's new words for one language, held to the same check as an
 * app's. The row keeps the hash of what the app shipped, so it now reads as
 * edited and an update leaves it alone.
 */
export async function saveTextTemplateWords(
  meta: MetaDb,
  input: { key: string; locale: string; body: string; name?: string | undefined; codeColumns: ReadonlySet<string>; updatedBy: string | null },
): Promise<{ saved: StoredTextTemplate } | { refused: Exclude<TextTemplateVerdict, { ok: true }> } | { missing: true }> {
  const verdict = checkTextTemplate(input.body, codeNamesIn(input.body, input.codeColumns));
  if (!verdict.ok) return { refused: verdict };
  const repo = textTemplatesRepo(meta);
  const existing = await repo.findByKeyLocale(input.key, input.locale);
  if (existing === null) return { missing: true };
  const saved = await repo.upsert(input.key, input.locale, { name: input.name ?? existing.name, body: input.body, enabled: existing.enabled, updatedBy: input.updatedBy });
  return { saved };
}
