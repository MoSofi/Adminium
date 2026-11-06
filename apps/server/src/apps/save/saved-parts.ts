// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `reports`, `invoiceLayouts`, `scheduledReports`.
 *
 * The inverse of `installSavedParts` (`apps/saved-parts.ts`).
 *
 * WHICH. Report documents and invoice layouts belong to no database: their
 * bodies name no table. By default every one travels that no install made
 * and that is shown in a workspace this database is in (or in all of them);
 * the person's choice narrows that. Of invoices, only layouts (`template`):
 * an issued invoice never travels. A scheduled report belongs to the
 * database of the page it reports on, and travels only with that page.
 *
 * WHAT NEVER TRAVELS. Who a schedule goes to, its switch, its zone and its
 * run times. On a layout, the contact lines and the payment lines (an email
 * address, a phone, a bank account): emptied, and named in Check. A picture
 * linked from somewhere else: emptied. A picture kept in this Adminium's
 * Files library becomes a file of the package, which the install puts back
 * in the body.
 */
import { createHash } from 'node:crypto';

import { slugify } from '@adminium/engine';
import { INVOICE_LAYOUT_LANGS, INVOICE_LAYOUT_TOPICS, type SavedInvoiceLayout, type SavedReport, type SavedScheduledReport } from '@adminium/manifest';
import { filesRepo, invoiceDocumentsRepo, reportDocumentsRepo, scheduledReportsRepo, workspacesRepo, type ShownInKind } from '@adminium/meta';

import { PACKAGE_IMAGE_PREFIX } from '../saved-parts.js';
import type { ConvertContext, ConvertPart } from './types.js';

/** A Files library link, relative or with any host: `/api/v1/files/<id>/content`. */
const LIBRARY_LINK = /^(?:https?:\/\/[^/]+)?\/api\/v1\/files\/([A-Za-z0-9_-]{1,64})\/content(?:[?#].*)?$/;

const IMAGE_TYPES: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** The seam a save reads a library file's bytes through, when the source gives one. */
type FileReader = (fileId: string) => Promise<Uint8Array | null>;

function readerOf(ctx: ConvertContext): FileReader | null {
  const read = (ctx.source as { readFile?: FileReader }).readFile;
  return typeof read === 'function' ? read : null;
}

/** A unique key from a name: `weekly-sales`, `weekly-sales-2`… */
function keyMaker() {
  const taken = new Set<string>();
  return (name: string, fallback: string): string => {
    const base = (slugify(name).replace(/^[^a-z]+/, '').slice(0, 72).replace(/-+$/, '') || fallback).slice(0, 72);
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}-${String(n)}`;
    taken.add(key);
    return key;
  };
}

const partName = (name: string, fallback: string): string => (name.trim() === '' ? fallback : name.trim().slice(0, 120));

/** Whether an item is shown where this database is: in every workspace, or in one it is in. */
async function shownHere(ctx: ConvertContext, kind: ShownInKind, id: string, here: ReadonlySet<string>): Promise<boolean> {
  const shown = await workspacesRepo(ctx.source.meta).shownIn(kind, id);
  if (shown === null || shown.mode === 'all') return true;
  return shown.workspaceIds.some((workspace) => here.has(workspace));
}

/** The rows an install made: they are that install's. */
async function madeByInstalls(ctx: ConvertContext): Promise<Set<string>> {
  const rows = await ctx.source.meta.db.selectFrom('adminium_app_parts').select(['kind', 'targetId']).execute();
  return new Set(rows.map((row) => `${row.kind}:${row.targetId}`));
}

/**
 * One picture of a body: inline stays, a library file becomes a package file
 * (`package:parts/<sha256>.<ext>`), anything else is emptied and said.
 */
async function pictureOf(ctx: ConvertContext, url: unknown, item: { kind: string; name: string; field: string }): Promise<string> {
  if (typeof url !== 'string' || url === '' || url.startsWith('data:image/')) return typeof url === 'string' ? url : '';
  const library = LIBRARY_LINK.exec(url);
  const read = readerOf(ctx);
  if (library !== null && read !== null) {
    const file = await filesRepo(ctx.source.meta).findById(library[1]!);
    const ext = file === null ? undefined : IMAGE_TYPES[file.mime];
    const bytes = ext === undefined ? null : await read(library[1]!);
    if (bytes !== null && ext !== undefined) {
      const path = `parts/${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
      ctx.files.set(path, bytes);
      return `${PACKAGE_IMAGE_PREFIX}${path}`;
    }
  }
  ctx.check.add({ group: 'info', code: 'PICTURE_LEFT_OUT', kind: item.kind, item: item.name, field: item.field, message: 'A picture linked from elsewhere is not saved: put it in again after installing.' });
  return '';
}

/** A report body: its pictures as above, and a contact block's address and phone emptied. */
async function reportBody(ctx: ConvertContext, body: Record<string, unknown>, name: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...body, bgImage: await pictureOf(ctx, body['bgImage'], { kind: 'report', name, field: 'bgImage' }) };
  const blocks = Array.isArray(body['blocks']) ? (body['blocks'] as Record<string, unknown>[]) : [];
  out['blocks'] = await Promise.all(
    blocks.map(async (block) => {
      if (block['kind'] === 'image') return { ...block, url: await pictureOf(ctx, block['url'], { kind: 'report', name, field: `blocks.${String(block['id'])}.url` }) };
      if (block['kind'] === 'contact' && (block['conEmail'] !== '' || block['conPhone'] !== '')) {
        ctx.check.add({ group: 'after', code: 'CONTACT_LEFT_OUT', kind: 'report', item: name, field: 'contact', message: 'Its contact address and phone are not saved: fill them in after installing.' });
        return { ...block, conEmail: '', conPhone: '' };
      }
      return block;
    }),
  );
  return out;
}

const filled = (value: unknown): boolean => (typeof value === 'string' ? value.trim() !== '' : Array.isArray(value) && value.some((line) => typeof line === 'string' && line.trim() !== ''));

/** A layout body: its pictures as above, its contact and payment lines emptied. */
async function invoiceBody(ctx: ConvertContext, body: Record<string, unknown>, name: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...body };
  for (const field of ['logoImage', 'bgImage', 'qrImage', 'sigImage', 'stampImage']) out[field] = await pictureOf(ctx, body[field], { kind: 'invoice', name, field });
  const custom = Array.isArray(body['custom']) ? (body['custom'] as Record<string, unknown>[]) : [];
  out['custom'] = await Promise.all(
    custom.map(async (section) => {
      if (section['type'] === 'image') return { ...section, url: await pictureOf(ctx, section['url'], { kind: 'invoice', name, field: `custom.${String(section['id'])}.url` }) };
      if (section['type'] === 'gallery' && Array.isArray(section['images'])) {
        const images = await Promise.all((section['images'] as Record<string, unknown>[]).map(async (image) => ({ ...image, url: await pictureOf(ctx, image['url'], { kind: 'invoice', name, field: `custom.${String(section['id'])}.images` }) })));
        return { ...section, images };
      }
      return section;
    }),
  );
  if (filled(body['conEmail']) || filled(body['conPhone'])) {
    ctx.check.add({ group: 'after', code: 'CONTACT_LEFT_OUT', kind: 'invoice', item: name, field: 'conEmail, conPhone', message: 'Its contact address and phone are not saved: fill them in after installing.' });
  }
  if (filled(body['payment'])) {
    ctx.check.add({ group: 'after', code: 'PAYMENT_LINES_LEFT_OUT', kind: 'invoice', item: name, field: 'payment', afterKind: 'bank-account', message: 'Its payment lines (where to pay) are not saved: fill them in after installing.' });
  }
  out['conEmail'] = '';
  out['conPhone'] = '';
  out['payment'] = [];
  return out;
}

export const convertSavedParts: ConvertPart = async (ctx) => {
  const { meta, connectionId } = ctx.source;
  const made = await madeByInstalls(ctx);
  const here = new Set(await workspacesRepo(meta).forConnection(connectionId));

  const reportKey = keyMaker();
  const reports: SavedReport[] = [];
  const chosenReports = ctx.choices.reports === undefined ? null : new Set(ctx.choices.reports);
  for (const row of await reportDocumentsRepo(meta).list()) {
    if (made.has(`report:${row.id}`)) continue;
    if (chosenReports === null ? !(await shownHere(ctx, 'report', row.id, here)) : !chosenReports.has(row.id)) continue;
    const name = partName(row.name, 'Report');
    reports.push({ key: reportKey(name, 'report'), kind: row.kind, name, status: row.status, body: await reportBody(ctx, row.body as Record<string, unknown>, name) });
  }

  const layoutKey = keyMaker();
  const invoiceLayouts: SavedInvoiceLayout[] = [];
  const chosenLayouts = ctx.choices.invoiceLayouts === undefined ? null : new Set(ctx.choices.invoiceLayouts);
  for (const row of await invoiceDocumentsRepo(meta).list({ kind: 'template' })) {
    if (made.has(`invoice-layout:${row.id}`)) continue;
    if (chosenLayouts === null ? !(await shownHere(ctx, 'invoice', row.id, here)) : !chosenLayouts.has(row.id)) continue;
    const name = partName(row.name, 'Invoice');
    invoiceLayouts.push({
      key: layoutKey(name, 'invoice'),
      name,
      ...((INVOICE_LAYOUT_TOPICS as readonly string[]).includes(row.topic) ? { topic: row.topic as SavedInvoiceLayout['topic'] } : {}),
      ...((INVOICE_LAYOUT_LANGS as readonly string[]).includes(row.lang) ? { lang: row.lang as SavedInvoiceLayout['lang'] } : {}),
      body: await invoiceBody(ctx, row.body as Record<string, unknown>, name),
    });
  }

  const scheduleKey = keyMaker();
  const scheduledReports: SavedScheduledReport[] = [];
  const chosenSchedules = ctx.choices.scheduledReports === undefined ? null : new Set(ctx.choices.scheduledReports);
  for (const row of await scheduledReportsRepo(meta).list()) {
    if (made.has(`scheduled-report:${row.id}`)) continue;
    if (chosenSchedules !== null && !chosenSchedules.has(row.id)) continue;
    const page = ctx.refs.page(row.pageId);
    const name = partName(row.name, 'Scheduled report');
    if (page === null) {
      // Another database's page, or one left out of this save.
      const ours = await meta.db.selectFrom('adminium_pages').select('id').where('id', '=', row.pageId).where('connectionId', '=', connectionId).executeTakeFirst();
      if (ours !== undefined) ctx.check.add({ group: 'info', code: 'SCHEDULE_LEFT_OUT', kind: 'schedule', item: name, message: 'The page it reports on is not saved, so it is not saved either.' });
      continue;
    }
    const { frequency, time } = row.schedule;
    scheduledReports.push({
      key: scheduleKey(name, 'schedule'),
      name,
      page,
      schedule: {
        frequency,
        ...(frequency === 'weekly' && typeof row.schedule.dayOfWeek === 'number' ? { dayOfWeek: row.schedule.dayOfWeek } : {}),
        ...(frequency === 'monthly' && typeof row.schedule.dayOfMonth === 'number' ? { dayOfMonth: row.schedule.dayOfMonth } : {}),
        time,
      },
      format: row.format,
    });
    ctx.check.add({ group: 'after', code: 'SCHEDULE_RECIPIENTS', kind: 'schedule', item: name, field: 'recipients', afterKind: 'recipients', message: 'Who it goes to is chosen after installing; it arrives switched off.' });
  }

  return {
    ...(reports.length === 0 ? {} : { reports }),
    ...(invoiceLayouts.length === 0 ? {} : { invoiceLayouts }),
    ...(scheduledReports.length === 0 ? {} : { scheduledReports }),
  };
};
