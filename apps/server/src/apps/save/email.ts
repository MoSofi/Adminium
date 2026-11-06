// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, the last part: `emailTemplates`.
 *
 * It writes every template another part used (a rule's mail, a summary) and
 * every campaign the person chose, each under the key the install will give
 * it (`<appkey>-<name>`), its languages grouped into `locales`. A block that
 * lists rows names its tables by their refs; a file the mail carries becomes
 * a package file under `emails/`, with the bytes the Files library holds.
 *
 * A sender's address never travels: the brand is written with an empty
 * `fromEmail`, and the owner chooses the sender after installing. Built-in
 * templates never travel here; an edited one belongs to the deployment-wide
 * part. No outbox is written: a database saved here has none of its own (an
 * outbox is an installed app's), and a rule sends its mail without one.
 */
import { emailTemplatesRepo, filesRepo, type EmailTemplate } from '@adminium/meta';

import { BUILTIN_EMAIL_TEMPLATE_KEYS } from '../../email/builtins.js';
import { mailCarries } from '../manifest-outbox.js';
import { mapTableRefs } from '../real-refs.js';
import type { ConvertContext, ConvertPart, ManifestPart } from './types.js';


const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUILTIN_EMAIL_TEMPLATE_KEYS);
const ENGLISH = 'en_US';
const NAME_MAX = 120;
const ROWS_BLOCK = 'email.rows';

/** Why a template cannot travel, or null when it can. */
export type TemplateStays = 'builtin' | 'missing' | 'no-english';

/**
 * Whether a template may travel, read from its live rows: never a built-in
 * one, never one with no rows, and only with US English among its languages.
 * (An app's template has `managedBy`; `refs.useTemplate` refuses those.)
 */
export function whyTemplateStays(key: string, rows: readonly EmailTemplate[]): TemplateStays | null {
  if (BUILTIN_KEYS.has(key)) return 'builtin';
  const own = rows.filter((row) => row.key === key && row.archivedAt === null);
  if (own.length === 0) return 'missing';
  if (!own.some((row) => row.locale === ENGLISH)) return 'no-english';
  return null;
}

/** A mail's live rows, read once per save. */
export async function liveTemplates(ctx: ConvertContext): Promise<EmailTemplate[]> {
  return emailTemplatesRepo(ctx.source.meta).list();
}

/** The Check target that leaves a template out. */
export const emailTarget = (key: string) => `email:${key}`;

const tagOf = (locale: string) => locale.replace('_', '-');


/** A file name a package path may hold. */
function safeName(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  return cleaned === '' ? 'file' : cleaned.slice(0, 120);
}

export const convertEmail: ConvertPart = async (ctx) => {
  const { refs, check, choices } = ctx;
  const rows = await liveTemplates(ctx);
  const leaveOut = new Set(choices.leaveOut ?? []);
  const sentByRules = new Set(refs.usedTemplates().map((used) => used.key));

  // The campaigns (and other templates) the person chose.
  for (const key of choices.emailTemplates ?? []) {
    const first = rows.find((row) => row.key === key);
    const item = first?.name ?? key;
    if (leaveOut.has(emailTarget(key))) continue;
    const why = whyTemplateStays(key, rows);
    if (why === 'no-english') {
      check.add({ group: 'choice', code: 'EMAIL_NO_ENGLISH', kind: 'email', item, message: 'An app\'s mail needs a US English text, and this one has none.', answer: { choices: ['leave-out'], target: emailTarget(key) } });
      continue;
    }
    if (why !== null) {
      check.add({ group: 'info', code: why === 'builtin' ? 'BUILTIN_EMAIL' : 'EMAIL_MISSING', kind: 'email', item, message: why === 'builtin' ? 'A built-in mail is not saved in an app.' : 'This mail has no live text, so it is left out.' });
      continue;
    }
    // With no outbox, a template nothing sends must be a campaign.
    if (!sentByRules.has(key) && first?.kind !== 'campaign') {
      check.add({ group: 'info', code: 'EMAIL_NOT_SENT', kind: 'email', item, message: 'No rule of the app sends this mail and it is not a campaign, so it is left out.' });
      continue;
    }
    if (refs.useTemplate(key) === null) check.add({ group: 'info', code: 'EMAIL_NOT_OURS', kind: 'email', item, message: 'This mail belongs to an installed app, so it is left out.' });
  }

  // An edited built-in mail is the deployment's, carried with its settings, never here.
  const editedBuiltins = new Set(rows.filter((row) => BUILTIN_KEYS.has(row.key) && !row.isBuiltinCopy).map((row) => row.key));
  for (const key of editedBuiltins) {
    const row = rows.find((one) => one.key === key && one.locale === ENGLISH) ?? rows.find((one) => one.key === key);
    check.add({ group: 'info', code: 'BUILTIN_EMAIL_EDITED', kind: 'email', item: row?.name ?? key, message: 'An edited built-in mail travels with the deployment\'s settings, not in this app.' });
  }

  const read = ctx.source.readFile;
  /** Package path per library file id, so a file two mails carry is packed once. */
  const packed = new Map<string, string>();
  const takenPaths = new Set<string>();
  const packFile = async (fileId: string, item: string): Promise<string | null> => {
    const known = packed.get(fileId);
    if (known !== undefined) return known;
    const file = await filesRepo(ctx.source.meta).findById(fileId);
    const read8 = read === undefined || file === null || file.deletedAt !== null ? null : await read(fileId);
    const bytes = read8 === null ? null : Buffer.from(read8);
    if (file === null || bytes === null) {
      check.add({ group: 'info', code: 'EMAIL_FILE_MISSING', kind: 'email', item, field: 'attachments', message: 'A file this mail carries could not be read, so it is left out.' });
      return null;
    }
    if (!mailCarries(bytes, file.filename)) {
      check.add({ group: 'info', code: 'EMAIL_FILE_KIND', kind: 'email', item, field: 'attachments', message: 'A file this mail carries is not a kind an app\'s mail may carry, so it is left out.' });
      return null;
    }
    const base = safeName(file.filename);
    let path = `emails/${base}`;
    for (let n = 2; takenPaths.has(path); n += 1) path = `emails/${String(n)}-${base}`;
    takenPaths.add(path);
    packed.set(fileId, path);
    ctx.files.set(path, new Uint8Array(bytes));
    return path;
  };

  const templates: Record<string, unknown>[] = [];
  for (const { key, name } of refs.usedTemplates()) {
    const own = rows.filter((row) => row.key === key && row.archivedAt === null).sort((a, b) => (a.locale === ENGLISH ? -1 : b.locale === ENGLISH ? 1 : a.locale.localeCompare(b.locale)));
    const english = own.find((row) => row.locale === ENGLISH);
    if (english === undefined) continue;
    const item = english.name || key;
    const info = (code: string, message: string, field?: string) => check.add({ group: 'info', code, kind: 'email', item, ...(field === undefined ? {} : { field }), message });

    const locales: Record<string, Record<string, unknown>> = {};
    const names: Record<string, string> = {};
    let styled = false;
    for (const row of own) {
      const tag = tagOf(row.locale);
      if (row.subject.trim() === '') {
        info('EMAIL_LANGUAGE_EMPTY', 'A language of this mail has no subject, so that language is left out.', tag);
        continue;
      }
      const blocks: Record<string, unknown>[] = [];
      for (const stored of row.blocks) {
        const kind = typeof stored['block'] === 'string' ? stored['block'] : '';
        if (kind === 'email.html') {
          info('EMAIL_HTML_BLOCK', 'An app\'s mail may not hold an HTML block, so that block is left out.', tag);
          continue;
        }
        let data = typeof stored['data'] === 'object' && stored['data'] !== null ? (stored['data'] as Record<string, unknown>) : undefined;
        if (kind === 'email.image' && typeof data?.['fileId'] === 'string' && data['fileId'] !== '' && !data['fileId'].includes('{{')) {
          info('EMAIL_LIBRARY_PICTURE', 'A picture from the Files library does not travel in a mail\'s text, so that block is left out.', tag);
          continue;
        }
        if (kind === ROWS_BLOCK && data !== undefined) {
          const mapped = mapTableRefs(data, (id) => refs.table(id) ?? refs.tableByName(id) ?? undefined);
          if (mapped.missing.length > 0) {
            info('EMAIL_ROWS_TABLE', 'A block lists the rows of a table that is not in the app, so that block is left out.', tag);
            continue;
          }
          data = mapped.value;
        }
        const style = stored['style'];
        if (typeof style === 'object' && style !== null && Object.keys(style).length > 0) styled = true;
        const showWhen = stored['showWhen'] as { var?: unknown } | undefined;
        blocks.push({
          block: kind,
          ...(typeof stored['id'] === 'string' && stored['id'].length > 0 && stored['id'].length <= 60 ? { id: stored['id'] } : {}),
          ...(typeof stored['label'] === 'string' && stored['label'].length > 0 ? { label: stored['label'].slice(0, 120) } : {}),
          ...(data === undefined || Object.keys(data).length === 0 ? {} : { data }),
          ...(typeof showWhen?.var === 'string' ? { showWhen: { var: showWhen.var } } : {}),
          ...(typeof stored['otherwise'] === 'string' && stored['otherwise'].length > 0 ? { otherwise: stored['otherwise'] } : {}),
        });
      }
      if (blocks.length === 0) {
        info('EMAIL_LANGUAGE_EMPTY', 'A language of this mail has nothing left to send, so that language is left out.', tag);
        continue;
      }
      locales[tag] = {
        subject: row.subject.slice(0, 200),
        ...(row.preheader.trim() === '' ? {} : { preheader: row.preheader.slice(0, 200) }),
        blocks: blocks.slice(0, 40),
        ...(row.footer.trim() === '' ? {} : { footer: row.footer.slice(0, 1000) }),
      };
      if (row.name.trim() !== '') names[tag] = row.name.slice(0, NAME_MAX);
    }
    if (styled) info('EMAIL_BLOCK_STYLE', 'How some blocks look (their padding, colours and borders) is not saved in an app.');
    if (locales['en-US'] === undefined) {
      check.add({ group: 'choice', code: 'EMAIL_NO_ENGLISH', kind: 'email', item, message: 'An app\'s mail needs a US English text, and this one has nothing left in it.', answer: { choices: ['leave-out'], target: emailTarget(key) } });
      continue;
    }

    // A sender's address never travels: the owner chooses one after installing.
    const brand = english.brand === null ? undefined : { name: english.brand.name, mark: english.brand.mark, accent: english.brand.accent, fromName: english.brand.fromName, fromEmail: '' };
    // Listed for every brand, as the install lists it: the sender is the owner's to choose there.
    if (english.brand !== null) {
      check.add({ group: 'after', code: 'SENDER', kind: 'email', item, field: 'brand.fromEmail', afterKind: 'sender', message: 'The address a mail is sent from is chosen after installing.' });
    }

    const attachments: { file: string }[] = [];
    for (const attachment of english.attachments) {
      if (attachment.kind !== 'file') {
        info('EMAIL_DOCUMENT_ATTACHMENT', 'A document drawn for each mail is not carried; only files are.', 'attachments');
        continue;
      }
      const path = await packFile(attachment.fileId, item);
      if (path !== null && !attachments.some((one) => one.file === path)) attachments.push({ file: path });
    }

    const labelSet = new Set(Object.values(names));
    const fileName = names['en-US'] ?? english.name.slice(0, NAME_MAX);
    templates.push({
      key: refs.installedTemplateKey(name),
      name: labelSet.size <= 1 || names['en-US'] === undefined ? (fileName === '' ? name : fileName) : names,
      ...(english.kind === 'campaign' ? { kind: 'campaign' } : {}),
      ...(english.category === 'transactional' ? {} : { category: english.category }),
      ...(brand === undefined ? {} : { brand }),
      ...(attachments.length === 0 ? {} : { attachments: attachments.slice(0, 20) }),
      locales,
    });
  }
  return (templates.length === 0 ? {} : { emailTemplates: templates }) as unknown as ManifestPart;
};
