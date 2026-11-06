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

import { GROUPED_FORM, clockShaped, emailRowsDataSchema, isCodeColumn, placeholderPattern, type Manifest, type Outbox } from '@adminium/manifest';
import { appOutboxesRepo, emailTemplatesRepo, filesRepo, newId, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { EMAIL_BLOCK_DATA_SCHEMAS } from '../email/document.js';
import { ValidationFailedError } from '../errors.js';
import { sniff } from '../files/sniff.js';
import type { FileStore } from '../files/store.js';
import { isEmailBlockKind } from '../email/render.js';
import { installTemplateKey, type InstallAddress } from '../installs/resolve.js';
import type { AfterInstallItem } from './after-install.js';
import { ownsBlocks } from './owns-blocks.js';
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

/**
 * What a row says beyond its text, where it says more than a plain template:
 * a campaign, a purpose, its own brand, the files it carries (by their ids,
 * which are made from the files' bytes). Left out at the defaults, so a row
 * an earlier release hashed hashes the same now.
 */
function envelopeOf(row: Partial<Pick<EmailTemplate, 'kind' | 'category' | 'brand' | 'attachments'>>): Record<string, unknown> {
  return {
    ...(row.kind === undefined || row.kind === 'template' ? {} : { kind: row.kind }),
    ...(row.category === undefined || row.category === 'transactional' ? {} : { category: row.category }),
    ...(row.brand === undefined || row.brand === null ? {} : { brand: row.brand }),
    ...(row.attachments === undefined || row.attachments.length === 0 ? {} : { attachments: row.attachments.map((attachment) => attachment.id) }),
  };
}

/** A template's text as the store keeps it, hashed the same however the JSON was ordered. */
function contentHashOf(row: Pick<EmailTemplate, 'name' | 'subject' | 'preheader' | 'footer' | 'blocks'> & Partial<Pick<EmailTemplate, 'kind' | 'category' | 'brand' | 'attachments'>>): string {
  return createHash('sha256')
    .update(canonicalJson({ name: row.name, subject: row.subject, preheader: row.preheader, footer: row.footer, blocks: row.blocks, ...envelopeOf(row) }))
    .digest('hex');
}

/** The package's files a mail carries, and the Files library they are kept in. */
export interface PackageFiles {
  /** The bytes of a file of the app's package, by its path there. */
  read: (path: string) => Promise<Buffer>;
  /** Keeps a file in the library; returns its id. */
  keep: (file: { bytes: Buffer; filename: string }) => Promise<string>;
}

/** Whether a mail may carry these bytes: a kind the library knows by its bytes, never a drawing (SVG) nobody cleaned. */
export function mailCarries(bytes: Buffer, filename: string): boolean {
  const sniffed = sniff(bytes.subarray(0, 8192), filename);
  return sniffed.ok && sniffed.type.key !== 'svg';
}

/**
 * A mail's files read from the app's own (verified) files and kept in the
 * Files library like a person's upload: only a kind the library knows by its
 * bytes, never a drawing (SVG) nobody cleaned.
 */
export function libraryFiles(
  meta: MetaDb,
  store: FileStore,
  read: (path: string) => Promise<Buffer>,
  uploadedBy: string | null,
): PackageFiles {
  return {
    read: async (path) => {
      try {
        return await read(path);
      } catch {
        throw new ValidationFailedError(`The app's emails carry "${path}", which its package does not hold.`, { reason: 'ATTACHMENT_MISSING', file: path });
      }
    },
    keep: async ({ bytes, filename }) => {
      const sniffed = sniff(bytes.subarray(0, 8192), filename);
      if (!sniffed.ok || !mailCarries(bytes, filename)) {
        throw new ValidationFailedError(`"${filename}" is not a kind of file an email carries.`, { reason: 'ATTACHMENT_KIND', file: filename });
      }
      const id = newId('file');
      const stored = await store.write({ id, kind: 'upload', filename, mime: sniffed.type.mime, bytes });
      await filesRepo(meta).create({
        id,
        filename,
        mime: sniffed.type.mime,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        storageKey: stored.storageKey,
        storage: stored.storage,
        destinationId: stored.destinationId,
        kind: 'upload',
        uploadedBy,
        // Claimed by the mail that names it, so the sweep of unclaimed uploads leaves it.
        attachedAt: Date.now(),
      });
      return id;
    },
  };
}

/** An attachment's id: made from its bytes, so the same file is the same attachment in every install and update. */
function attachmentIdOf(bytes: Buffer): string {
  return `app-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`;
}

/** Moves the library files an app's mails let go of to the bin, as a person's delete does: those no mail names any more. */
async function releaseFiles(meta: MetaDb, fileIds: Iterable<string>): Promise<void> {
  const candidates = new Set(fileIds);
  if (candidates.size === 0) return;
  const templates = emailTemplatesRepo(meta);
  const rows = [...(await templates.list({ archived: false })), ...(await templates.list({ archived: true }))];
  for (const row of rows) for (const attachment of row.attachments) if (attachment.kind === 'file') candidates.delete(attachment.fileId);
  for (const fileId of candidates) await filesRepo(meta).markDeleted(fileId);
}

/** One language's name for the template, or the US English one. */
function nameIn(name: ManifestTemplate['name'], locale: string): string {
  if (typeof name === 'string') return name;
  const names = name as Record<string, string>;
  return names[locale] ?? names['en-US'] ?? Object.values(names)[0] ?? '';
}

/**
 * The blocks as the store keeps them: each with an id, so the editor can
 * address it; a block that lists rows names its tables by their real ids.
 */
function storedBlocks(blocks: ManifestTemplate['locales'][string]['blocks'], realId: (ref: string) => string = (ref) => ref): Record<string, unknown>[] {
  return blocks.map((block, index) => ({
    ...block,
    ...(block.block === ROWS_BLOCK && block.data !== undefined ? { data: mapTableRefs(block.data, realId).value } : {}),
    id: block.id ?? `${block.block.slice('email.'.length)}-${String(index + 1)}`,
  }));
}

/**
 * The block that lists a linked row's child rows. The manifest's own check
 * proves its shape (`emailRowsDataSchema`) and what each row reads; the
 * install stores its tables by their real names, and the sender reads the
 * rows it lists.
 */
const ROWS_BLOCK = 'email.rows';

/**
 * What the renderer cannot draw, per template and language: a block kind it
 * does not know, or data of a shape that would break it. The manifest check
 * already refused the `html` block.
 */
export function templateProblems(manifest: Manifest): string[] {
  if (!ownsBlocks(manifest)) return [];
  const out: string[] = [];
  for (const template of manifest.emailTemplates ?? []) {
    for (const [locale, content] of Object.entries(template.locales)) {
      content.blocks.forEach((block, index) => {
        const where = `The email "${template.key}" (${locale}), block ${String(index + 1)}`;
        if (block.block === ROWS_BLOCK) {
          if (!emailRowsDataSchema.safeParse(block.data ?? {}).success) out.push(`${where}: its data is not the shape a "${block.block}" block takes.`);
          return;
        }
        if (!isEmailBlockKind(block.block)) {
          out.push(`${where} is "${block.block}", which no email can draw.`);
          return;
        }
        if (block.data !== undefined && !EMAIL_BLOCK_DATA_SCHEMAS[block.block].safeParse(block.data).success) {
          out.push(`${where}: its data is not the shape a "${block.block}" block takes.`);
        }
      });
      for (const variable of unfillableForms(manifest, content)) {
        out.push(
          `The email "${template.key}" (${locale}) reads {{${variable.name}}}, which nothing fills: ${variable.column} is a ${variable.type} column, ` +
            `read as ${orList([variable.bare, ...variable.allowed.map((form) => `${variable.bare}.${form}`)].map((name) => `{{${name}}}`))}.`,
        );
      }
    }
  }
  return out;
}

/**
 * The forms of a value a template may add to a column's name, by the
 * column's type, as the sender fills them: a time has its date, its time, its
 * day and month and its relative day; a calendar day has no clock, so only
 * its day and month and the days since it.
 */
const NUMBER_FORMS = ['number', 'percent', 'money'] as const;
const FORMS_OF: Readonly<Record<string, readonly string[]>> = {
  timestamptz: ['date', 'time', 'day_month', 'relative_day'],
  date: ['day_month', 'days_since'],
  // A number as a number, a percentage and money, in the message's language.
  int: NUMBER_FORMS,
  bigint: NUMBER_FORMS,
  decimal: NUMBER_FORMS,
  money: NUMBER_FORMS,
  float: NUMBER_FORMS,
  // A choice by its label; a time of day kept as text in the reader's clock.
  enum: ['label'],
  text: ['time'],
};
const EVERY_FORM = new Set([...Object.values(FORMS_OF).flat(), GROUPED_FORM]);
/** A column's forms: its type's — a text column's `time` only when it keeps a time of day (`clockShaped`), and a code's groups — as the sender fills them. */
const formsOf = (column: Parameters<typeof clockShaped>[0] & { rules?: { code?: unknown } | undefined }): readonly string[] => {
  const own = column.type === 'text' && !clockShaped(column) ? (FORMS_OF['text'] ?? []).filter((form) => form !== 'time') : (FORMS_OF[column.type] ?? []);
  return isCodeColumn(column) ? [...own, GROUPED_FORM] : own;
};
const orList = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)!}`);

/**
 * The variables of one language of a template that name a column's form the
 * column's type does not have (`{{invoice.due_on.date}}` on a date column):
 * the sender can never fill one, so every message would fail at send. Judged
 * only where the manifest says for certain which column it is: under every
 * table the name could reach, the column is declared and none has the form.
 * A name the manifest cannot place is left to the sender.
 */
function unfillableForms(
  manifest: AppManifest,
  content: unknown,
): { name: string; bare: string; column: string; type: string; allowed: readonly string[] }[] {
  const outbox = manifest.outbox;
  if (outbox === undefined) return [];
  const tables = new Map((manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  const columnOf = (table: string | undefined, name: string) => (table === undefined ? undefined : tables.get(table)?.columns.find((c) => c.ref === name));
  // What each prefix a template reads under can be: a link, a link's own link (`invoice.client`), that on its own (`client`), the settings row.
  const prefixes = new Map<string, Set<string>>();
  const add = (prefix: string, table: string | undefined) => {
    if (table === undefined || !tables.has(table)) return;
    prefixes.set(prefix, (prefixes.get(prefix) ?? new Set()).add(table));
  };
  const links = Object.entries(outbox.links ?? {});
  for (const [name, column] of links) add(name, columnOf(outbox.table, column)?.references);
  for (const [name, column] of links) {
    const linked = columnOf(outbox.table, column)?.references;
    for (const c of (linked === undefined ? undefined : tables.get(linked))?.columns ?? []) {
      if (!c.ref.endsWith('_id') || c.references === undefined) continue;
      const base = c.ref.slice(0, -'_id'.length);
      add(`${name}.${base}`, c.references);
      if (!links.some(([own]) => own === base)) add(base, c.references);
    }
  }
  if (outbox.settings !== undefined) add('practice', outbox.settings.table);

  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
  };
  walk(content);
  const out: { name: string; bare: string; column: string; type: string; allowed: readonly string[] }[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(placeholderPattern())) {
      const name = match[1] as string;
      const parts = name.split('.');
      const form = parts.at(-1) as string;
      if (parts.length < 3 || !EVERY_FORM.has(form) || seen.has(name)) continue;
      const prefix = parts.slice(0, -2).join('.');
      const column = parts.at(-2) as string;
      const candidates = [...(prefixes.get(prefix) ?? [])].map((table) => ({ table, declared: columnOf(table, column) }));
      if (candidates.length === 0 || candidates.some((c) => c.declared === undefined)) continue;
      if (candidates.some((c) => formsOf(c.declared!).includes(form))) continue;
      const first = candidates[0]!;
      seen.add(name);
      out.push({ name, bare: parts.slice(0, -1).join('.'), column: `${first.table}.${column}`, type: first.declared!.type, allowed: formsOf(first.declared!) });
    }
  }
  return out;
}

/** A file made on an Adminium (`publisher: local`). */
function isLocalFile(manifest: Manifest): boolean {
  return manifest.kind === 'app' && (manifest.publisher as { id?: string } | undefined)?.id === 'local';
}

/**
 * The senders the owner chooses after installing a file made on an Adminium:
 * one for each mail with a brand of its own, whose sender's address is
 * installed empty.
 */
export function plannedAfterInstallOfSenders(manifest: Manifest): AfterInstallItem[] {
  if (!isLocalFile(manifest) || manifest.kind !== 'app') return [];
  return (manifest.emailTemplates ?? []).flatMap((template) => (template.brand === undefined ? [] : [{ kind: 'sender' as const, item: template.key, field: 'brand.fromEmail' }]));
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
  /** The install the outbox and its templates belong to. */
  install: InstallAddress;
  connectionId: string;
  realId: (ref: string) => string;
  /**
   * Whether a real table id is in the live model. Given, a definition naming a
   * table that is not there is refused by name rather than stored.
   */
  exists?: ((id: string) => boolean) | undefined;
  /** Where a mail's files come from and go. Absent, a mail that carries files is refused. */
  packageFiles?: PackageFiles | undefined;
}): Promise<OutboxResult | undefined> {
  const { meta, manifest } = input;
  if (!ownsBlocks(manifest)) return undefined;
  const outboxes = appOutboxesRepo(meta);
  const templates = emailTemplatesRepo(meta);
  const { install } = input;
  const own = () => templates.listManagedBy(manifest.key, install.id);
  const hadAny = (await outboxes.findByInstall(install.id)) !== null || (await own()).length > 0;
  if (manifest.outbox === undefined && (manifest.emailTemplates ?? []).length === 0 && !hadAny) return undefined;
  // A later install's templates are stored under keys of their own; the outbox names them so.
  const shippedKeys = new Set((manifest.emailTemplates ?? []).map((template) => template.key));
  const storedKey = (key: string) => (shippedKeys.has(key) ? installTemplateKey(key, install) : key);

  if (manifest.outbox === undefined) await outboxes.remove(install.id);
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
      manifestId: install.id,
      connectionId: input.connectionId,
      definition: canonicalJson(withTemplateKeys(mapped.value as Outbox, storedKey)),
    });
  }

  const result: OutboxResult = { defined: manifest.outbox !== undefined, templates: { written: [], kept: [], skipped: [], removed: 0 } };
  // A file made on an Adminium never says who a mail is sent from, whatever it holds: the owner chooses after installing.
  const localFile = isLocalFile(manifest);
  const shipped = new Set<string>();
  /** Library files this run let go of: put in the bin at the end, unless a mail still names one. */
  const dropped = new Set<string>();
  for (const template of manifest.emailTemplates ?? []) {
    /** The files this template carries, read once for all its languages; each kept once, or the one its row already holds. */
    const carried: { id: string; path: string; bytes: Buffer; fileId?: string }[] = [];
    for (const { file } of template.attachments ?? []) {
      if (input.packageFiles === undefined) {
        throw new ValidationFailedError(`The email "${template.key}" carries "${file}", and this server has no Files library to keep it in.`, { reason: 'NO_FILES_LIBRARY', template: template.key });
      }
      const bytes = await input.packageFiles.read(file);
      carried.push({ id: attachmentIdOf(bytes), path: file, bytes });
    }
    for (const [tag, content] of Object.entries(template.locales)) {
      // The store keys a language the way Adminium's locales are spelled (`en_US`).
      const locale = tag.replace('-', '_');
      const key = storedKey(template.key);
      const id = `${key}/${locale}`;
      shipped.add(id);
      const existing = await templates.findByKeyLocale(key, locale);
      if (existing !== null && (existing.managedBy !== manifest.key || (existing.installId !== null && existing.installId !== install.id))) {
        result.templates.skipped.push({ key, locale, reason: 'An email template of this name and language is not this app’s.' });
        continue;
      }
      if (existing !== null && existing.contentHash !== contentHashOf(existing)) {
        result.templates.kept.push(id);
        continue;
      }
      // The same file under the same id is the one the row holds already; a new one is kept in the library now.
      const attachments: { id: string; kind: 'file'; fileId: string }[] = [];
      for (const file of carried) {
        const held = existing?.attachments.find((attachment) => attachment.id === file.id && attachment.kind === 'file');
        file.fileId ??= held !== undefined && held.kind === 'file' ? held.fileId : await input.packageFiles!.keep({ bytes: file.bytes, filename: file.path.split('/').at(-1)! });
        attachments.push({ id: file.id, kind: 'file', fileId: file.fileId });
      }
      for (const old of existing?.attachments ?? []) {
        if (old.kind === 'file' && !attachments.some((attachment) => attachment.fileId === old.fileId)) dropped.add(old.fileId);
      }
      const write = (contentHash: string | null) =>
        templates.upsert(key, locale, {
          name: nameIn(template.name, tag),
          subject: content.subject,
          blocks: storedBlocks(content.blocks, input.realId),
          enabled: existing?.enabled ?? true,
          preheader: content.preheader ?? '',
          footer: content.footer ?? '',
          category: template.category ?? 'transactional',
          kind: template.kind ?? 'template',
          // An update that stops giving a brand or files takes them away: the row is the app's while nobody edited it.
          brand: template.brand === undefined ? null : localFile ? { ...template.brand, fromEmail: '' } : template.brand,
          attachments,
          managedBy: manifest.key,
          installId: install.id,
          contentHash,
        });
      const written = await write(null);
      // Hashed as the store keeps it, so the next update compares like with like.
      await write(contentHashOf(written));
      result.templates.written.push(id);
    }
  }
  for (const row of await own()) {
    if (shipped.has(`${row.key}/${row.locale}`) || row.contentHash !== contentHashOf(row)) continue;
    if (await templates.remove(row.key, row.locale)) {
      result.templates.removed += 1;
      for (const attachment of row.attachments) if (attachment.kind === 'file') dropped.add(attachment.fileId);
    }
  }
  await releaseFiles(meta, dropped);
  return result;
}

/**
 * The outbox's template keys as this install stores them: each kind's
 * template, and any other place the definition names one by key.
 */
function withTemplateKeys(outbox: Outbox, storedKey: (key: string) => string): Outbox {
  const walk = (value: unknown, path: string[]): unknown => {
    if (typeof value === 'string') return path.includes('kinds') || path.at(-1) === 'template' ? storedKey(value) : value;
    if (Array.isArray(value)) return value.map((one) => walk(one, path));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, [...path, k])]));
    }
    return value;
  };
  return walk(outbox, []) as Outbox;
}

/**
 * Uninstall: one install's outbox definition, and its templates nobody edited,
 * with the files they carried that no mail names any more (to the bin, as a
 * person's delete does). Returns how many templates went.
 */
export async function removeOutbox(meta: MetaDb, install: Pick<InstallAddress, 'id' | 'key'>): Promise<number> {
  await appOutboxesRepo(meta).remove(install.id);
  const templates = emailTemplatesRepo(meta);
  let removed = 0;
  const dropped = new Set<string>();
  for (const row of await templates.listManagedBy(install.key, install.id)) {
    if (row.contentHash !== contentHashOf(row)) continue;
    if (await templates.remove(row.key, row.locale)) {
      removed += 1;
      for (const attachment of row.attachments) if (attachment.kind === 'file') dropped.add(attachment.fileId);
    }
  }
  await releaseFiles(meta, dropped);
  return removed;
}
