// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The emails an app sends, as its manifest declares them: the outbox (which
 * table is the log, who a row goes to, what queues one) and the templates
 * each kind is sent with.
 *
 * The outbox definition is stored once per app with every table it names
 * already real, so the producers and the sender read exactly what the install
 * wrote and never a short name. It is replaced on each update and removed at
 * uninstall; the app's own table — the log a person reads — stays with the
 * data.
 *
 * Templates become rows of the template store, one per language the app
 * ships, marked as the app's with a hash of what it wrote. The operator may
 * edit one like any other: an update then leaves it alone, and so does the
 * uninstall. A row of the same key and language that is not the app's is
 * never touched.
 */
import { createHash } from 'node:crypto';

import type { Manifest, Outbox } from '@adminium/manifest';
import { appOutboxesRepo, emailTemplatesRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { EMAIL_BLOCK_DATA_SCHEMAS } from '../email/document.js';
import { isEmailBlockKind } from '../email/render.js';
import { mapTableRefs } from './real-refs.js';
import { canonicalJson } from './sample-data.js';

type AppManifest = Extract<Manifest, { kind: 'app' }>;
type ManifestTemplate = NonNullable<AppManifest['emailTemplates']>[number];

export interface OutboxResult {
  /** Whether the app has an outbox definition now. */
  defined: boolean;
  templates: {
    /** `key/locale` written now (made, or brought up to date). */
    written: string[];
    /** Rows the operator edited, left as they are. */
    kept: string[];
    /** Rows of the same key that are not the app's. */
    skipped: { key: string; locale: string; reason: string }[];
    /** The app's unedited rows of templates it no longer ships. */
    removed: number;
  };
}

/** A template's text as the store keeps it, hashed the same however the JSON was ordered. */
function contentHashOf(row: Pick<EmailTemplate, 'name' | 'subject' | 'preheader' | 'footer' | 'blocks'>): string {
  return createHash('sha256')
    .update(canonicalJson({ name: row.name, subject: row.subject, preheader: row.preheader, footer: row.footer, blocks: row.blocks }))
    .digest('hex');
}

/** One language's name for the template, or the US English one. */
function nameIn(name: ManifestTemplate['name'], locale: string): string {
  if (typeof name === 'string') return name;
  const names = name as Record<string, string>;
  return names[locale] ?? names['en-US'] ?? Object.values(names)[0] ?? '';
}

/** The blocks as the store keeps them: each with an id, so the editor can address it. */
function storedBlocks(blocks: ManifestTemplate['locales'][string]['blocks']): Record<string, unknown>[] {
  return blocks.map((block, index) => ({ ...block, id: block.id ?? `${block.block.slice('email.'.length)}-${String(index + 1)}` }));
}

/**
 * What the renderer cannot draw, per template and language: a block kind it
 * does not know, or data of a shape that would break it. The manifest check
 * already refused the `html` block.
 */
export function templateProblems(manifest: Manifest): string[] {
  if (manifest.kind !== 'app') return [];
  const out: string[] = [];
  for (const template of manifest.emailTemplates ?? []) {
    for (const [locale, content] of Object.entries(template.locales)) {
      content.blocks.forEach((block, index) => {
        const where = `The email "${template.key}" (${locale}), block ${String(index + 1)}`;
        if (!isEmailBlockKind(block.block)) {
          out.push(`${where} is "${block.block}", which no email can draw.`);
          return;
        }
        if (block.data !== undefined && !EMAIL_BLOCK_DATA_SCHEMAS[block.block].safeParse(block.data).success) {
          out.push(`${where}: its data is not the shape a "${block.block}" block takes.`);
        }
      });
    }
  }
  return out;
}

/**
 * The outbox as it is stored: every table it names — the log, the person's,
 * the settings row, each producer's and each lead's, a gate's and a due date's
 * setting, the row a sent message changes — replaced by the real table's id.
 * The one mapper (`real-refs.ts`), which also says what it could not find.
 */
export function outboxRefs(
  outbox: NonNullable<AppManifest['outbox']>,
  realId: (ref: string) => string | undefined,
): { value: Record<string, unknown>; missing: string[] } {
  return mapTableRefs({ ...outbox } as Record<string, unknown>, realId);
}

/** {@link outboxRefs}, the value alone. */
export function outboxDefinition(outbox: NonNullable<AppManifest['outbox']>, realId: (ref: string) => string): Record<string, unknown> {
  return outboxRefs(outbox, realId).value;
}

/**
 * Install or update: the outbox definition (removed when the new version has
 * none) and every template the app ships, in every language it ships.
 */
export async function installOutbox(input: {
  meta: MetaDb;
  manifest: Manifest;
  manifestId: string;
  connectionId: string;
  realId: (ref: string) => string;
  /**
   * Whether a real table id is in the live model. Given, a definition naming a
   * table that is not there is refused by name rather than stored.
   */
  exists?: ((id: string) => boolean) | undefined;
}): Promise<OutboxResult | undefined> {
  const { meta, manifest } = input;
  if (manifest.kind !== 'app') return undefined;
  const outboxes = appOutboxesRepo(meta);
  const templates = emailTemplatesRepo(meta);
  const hadAny = (await outboxes.findByApp(manifest.key)) !== null || (await templates.listManagedBy(manifest.key)).length > 0;
  if (manifest.outbox === undefined && (manifest.emailTemplates ?? []).length === 0 && !hadAny) return undefined;

  if (manifest.outbox === undefined) await outboxes.remove(manifest.key);
  else {
    const exists = input.exists;
    const mapped = outboxRefs(manifest.outbox, (ref) => {
      const real = input.realId(ref);
      return exists === undefined || exists(real) ? real : undefined;
    });
    if (mapped.missing.length > 0) {
      throw new Error(
        `The app's outbox names ${mapped.missing.map((ref) => `"${ref}"`).join(', ')}, which this app does not have here.`,
      );
    }
    await outboxes.put({
      appKey: manifest.key,
      manifestId: input.manifestId,
      connectionId: input.connectionId,
      definition: canonicalJson(mapped.value as Outbox),
    });
  }

  const result: OutboxResult = { defined: manifest.outbox !== undefined, templates: { written: [], kept: [], skipped: [], removed: 0 } };
  const shipped = new Set<string>();
  for (const template of manifest.emailTemplates ?? []) {
    for (const [tag, content] of Object.entries(template.locales)) {
      // The store keys a language the way Adminium's locales are spelled (`en_US`).
      const locale = tag.replace('-', '_');
      const id = `${template.key}/${locale}`;
      shipped.add(id);
      const existing = await templates.findByKeyLocale(template.key, locale);
      if (existing !== null && existing.managedBy !== manifest.key) {
        result.templates.skipped.push({ key: template.key, locale, reason: 'An email template of this name and language is not this app’s.' });
        continue;
      }
      if (existing !== null && existing.contentHash !== contentHashOf(existing)) {
        result.templates.kept.push(id);
        continue;
      }
      const write = (contentHash: string | null) =>
        templates.upsert(template.key, locale, {
          name: nameIn(template.name, tag),
          subject: content.subject,
          blocks: storedBlocks(content.blocks),
          enabled: existing?.enabled ?? true,
          preheader: content.preheader ?? '',
          footer: content.footer ?? '',
          category: 'transactional',
          managedBy: manifest.key,
          contentHash,
        });
      const written = await write(null);
      // Hashed as the store keeps it, so the next update compares like with like.
      await write(contentHashOf(written));
      result.templates.written.push(id);
    }
  }
  for (const row of await templates.listManagedBy(manifest.key)) {
    if (shipped.has(`${row.key}/${row.locale}`) || row.contentHash !== contentHashOf(row)) continue;
    if (await templates.remove(row.key, row.locale)) result.templates.removed += 1;
  }
  return result;
}

/** Uninstall: the outbox definition, and the app's templates nobody edited. Returns how many templates went. */
export async function removeOutbox(meta: MetaDb, appKey: string): Promise<number> {
  await appOutboxesRepo(meta).remove(appKey);
  const templates = emailTemplatesRepo(meta);
  let removed = 0;
  for (const row of await templates.listManagedBy(appKey)) {
    if (row.contentHash !== contentHashOf(row)) continue;
    if (await templates.remove(row.key, row.locale)) removed += 1;
  }
  return removed;
}
