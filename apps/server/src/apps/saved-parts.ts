// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PARTS ONLY A FILE MADE ON AN ADMINIUM CARRIES, INSTALLED.
 *
 * A dashboard saved as an app brings its report documents, invoice layouts,
 * scheduled reports and payments set-up (`saved-parts.ts` in
 * `@adminium/manifest`). Each is written with the writer its own screen uses
 * (the report and invoice repos, the scheduled reports repo, the payable
 * profiles and ways to pay), so the target holds them exactly as if somebody
 * had made them there by hand. Nothing in the file does more than the person
 * installing it could: each part needs the permission its own screen needs
 * ({@link savedPartsRefusal}), asked before anything is made.
 *
 * WHOSE A MADE ROW IS. The app's, until somebody changes it. An install
 * records each report, layout and schedule it made with a fingerprint of what
 * it wrote (`adminium_app_parts`). An update rewrites a row whose fingerprint
 * still matches, leaves one somebody changed, and takes away an unchanged one
 * the new version no longer carries; the uninstall takes away every unchanged
 * one. What the owner fills in after the install — who a schedule goes to,
 * its switch — is kept out of the fingerprint.
 *
 * PAYMENTS. A payable table is the app's (`owner_app`) and goes with it. The
 * ways to pay and the pay page are the deployment's: written only where none
 * is set yet, never changed by an update, never taken away. A bank account,
 * a service's keys and a contact never travel: they are on the "After you
 * install" list. Adminium is never a party to a payment.
 *
 * Meta store only.
 */
import { createHash } from 'node:crypto';

import type { Manifest, SavedPayable, SavedPayments } from '@adminium/manifest';
import {
  appPartsRepo,
  invoiceDocumentsRepo,
  manifestsRepo,
  NO_RULES,
  pagesRepo,
  payableProfilesRepo,
  paymentMethodsRepo,
  paymentSettingsRepo,
  reportDocumentsRepo,
  scheduledReportsRepo,
  settingsRepo,
  type AppPart,
  type AppPartKind,
  type DocumentProfile,
  type MetaDb,
  type PayableMapping,
} from '@adminium/meta';

import { ForbiddenError, ValidationFailedError } from '../errors.js';
import { acceptInvoiceBody, bodyColumn as invoiceBodyColumn, withInferredCode } from '../invoices/document.js';
import { summaryOf as invoiceSummaryOf } from '../invoices/summary.js';
import { paymentAddOnKeys } from '../payments/ready.js';
import { MANUAL_SOURCE } from '../payments/ways.js';
import { businessName } from '../privacy/business.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { acceptReportBody, bodyColumn as reportBodyColumn } from '../report-documents/document.js';
import { BLANK_ICON } from '../report-documents/starters.js';
import { summaryOf as reportSummaryOf } from '../report-documents/summary.js';
import { PAY_PAGE_DOC, payPageSchema } from '../routes/payments/ways.js';
import { nextRunAtOf } from '../schedule/next-run.js';
import type { AfterInstallItem } from './after-install.js';
import { canonicalJson } from './sample-data.js';

type SavedParts = Pick<Extract<Manifest, { kind: 'app' }>, 'reports' | 'invoiceLayouts' | 'scheduledReports' | 'payments'>;
const partsOf = (manifest: Manifest): SavedParts => (manifest.kind === 'app' ? manifest : {});

const NO_SECRETS = { encrypt: (value: string) => value, decrypt: (value: string) => value };

/**
 * Why this person may not install what the file carries, or null. Each part
 * needs what its own screen needs: report documents and invoice layouts the
 * settings permission, scheduled reports the reports permission, payments
 * the payments permission.
 */
export async function savedPartsRefusal(manifest: Manifest, can: (permission: string) => Promise<boolean>): Promise<ForbiddenError | null> {
  const parts = partsOf(manifest);
  const asks: [unknown, string, string][] = [
    [parts.reports, PERMISSIONS.settingsManage, 'report documents'],
    [parts.invoiceLayouts, PERMISSIONS.settingsManage, 'invoice layouts'],
    [parts.scheduledReports, PERMISSIONS.reportsManage, 'scheduled reports'],
    [parts.payments, PERMISSIONS.paymentsManage, 'payments'],
  ];
  for (const [part, permission, what] of asks) {
    if (part === undefined || (await can(permission))) continue;
    return new ForbiddenError(`"${manifest.name}" brings ${what}, which you may not make here: installing it needs ${permission}.`, 'FORBIDDEN', { permission, reason: 'SAVED_PART_PERMISSION' });
  }
  return null;
}

const hashOf = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

export interface SavedPartsResult {
  /** Entries made, or rewritten because nobody had changed them: `<kind>:<key>`. */
  written: string[];
  /** Entries somebody changed: left as they are. */
  kept: string[];
  /** Unchanged entries the file no longer carries, taken away. */
  removed: string[];
  /** Entries that could not be made here, with why. */
  skipped: { entry: string; reason: string }[];
  afterInstall: AfterInstallItem[];
}

export interface InstallSavedPartsInput {
  meta: MetaDb;
  manifest: Manifest;
  /** The install's own row. */
  manifestId: string;
  connectionId: string;
  /** One of the app's tables → its id here, or null. */
  realId: (ref: string) => string | null;
  /** The database's zone, for a schedule. */
  timezone: string;
  createdBy: string | null;
  at?: number | undefined;
}

/** One kind of part: what a row of it holds that the fingerprint reads, and how a row is made, read and rewritten. */
interface PartWriter<E extends { key: string }> {
  kind: AppPartKind;
  /** What the entry writes, as the fingerprint reads it. */
  content: (entry: E) => Promise<unknown> | unknown;
  /** What a stored row holds, as the fingerprint reads it; null when the row is gone. */
  stored: (id: string) => Promise<unknown>;
  create: (entry: E, content: unknown) => Promise<string>;
  rewrite: (id: string, entry: E, content: unknown) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

async function syncParts<E extends { key: string }>(entries: readonly E[], writer: PartWriter<E>, records: readonly AppPart[], input: InstallSavedPartsInput, result: SavedPartsResult): Promise<void> {
  const parts = appPartsRepo(input.meta);
  const mine = records.filter((record) => record.kind === writer.kind);
  for (const entry of entries) {
    const name = `${writer.kind}:${entry.key}`;
    const content = await writer.content(entry);
    const hash = hashOf(content);
    const record = mine.find((one) => one.partKey === entry.key);
    const now = record === undefined ? null : await writer.stored(record.targetId);
    // Somebody changed what the app made: it is theirs now.
    if (record !== undefined && now !== null && hashOf(now) !== record.contentHash) {
      result.kept.push(name);
      continue;
    }
    if (record !== undefined && now !== null) {
      if (record.contentHash !== hash) await writer.rewrite(record.targetId, entry, content);
      await parts.put({ manifestId: input.manifestId, kind: writer.kind, partKey: entry.key, targetId: record.targetId, contentHash: hashOf((await writer.stored(record.targetId)) ?? content) }, input.at);
      result.written.push(name);
      continue;
    }
    // Never made, or taken away by somebody since: made (again).
    const id = await writer.create(entry, content);
    await parts.put({ manifestId: input.manifestId, kind: writer.kind, partKey: entry.key, targetId: id, contentHash: hashOf((await writer.stored(id)) ?? content) }, input.at);
    result.written.push(name);
  }
  const shipped = new Set(entries.map((entry) => entry.key));
  for (const record of mine) {
    if (shipped.has(record.partKey)) continue;
    await letGo(record, writer, input.meta, result);
  }
}

/** A part the app no longer carries: its row goes if nobody changed it; the record goes either way. */
async function letGo<E extends { key: string }>(record: AppPart, writer: PartWriter<E>, meta: MetaDb, result: SavedPartsResult): Promise<void> {
  const now = await writer.stored(record.targetId);
  if (now !== null && hashOf(now) === record.contentHash) {
    await writer.remove(record.targetId);
    result.removed.push(`${record.kind}:${record.partKey}`);
  }
  await appPartsRepo(meta).remove(record.id);
}

function writers(input: InstallSavedPartsInput, pageIds: ReadonlyMap<string, string>) {
  const { meta, at, createdBy } = input;
  const reports = reportDocumentsRepo(meta);
  const invoices = invoiceDocumentsRepo(meta);
  const schedules = scheduledReportsRepo(meta);
  type Report = NonNullable<SavedParts['reports']>[number];
  type Layout = NonNullable<SavedParts['invoiceLayouts']>[number];
  type Schedule = NonNullable<SavedParts['scheduledReports']>[number];

  const report: PartWriter<Report> = {
    kind: 'report',
    content: (entry) => {
      let body;
      try {
        body = acceptReportBody(entry.body);
      } catch (error) {
        throw new ValidationFailedError(`The report "${entry.key}" cannot be installed: ${error instanceof Error ? error.message : String(error)}`, { report: entry.key });
      }
      return { kind: entry.kind ?? 'report', name: entry.name, status: entry.status ?? 'draft', body: reportBodyColumn(body) };
    },
    stored: async (id) => {
      const row = await reports.findById(id);
      return row === null ? null : { kind: row.kind, name: row.name, status: row.status, body: row.body };
    },
    create: async (_entry, content) => {
      const c = content as { kind: 'report' | 'template'; name: string; status: 'draft' | 'sent' | 'live'; body: Record<string, unknown> };
      const body = acceptReportBody(c.body);
      const row = await reports.create({ kind: c.kind, name: c.name, status: c.status, starter: null, originId: null, body: c.body, summary: reportSummaryOf(body, { starterIcon: BLANK_ICON }), createdBy }, at);
      return row.id;
    },
    rewrite: async (id, _entry, content) => {
      const c = content as { name: string; status: 'draft' | 'sent' | 'live'; body: Record<string, unknown> };
      const before = await reports.findById(id);
      await reports.patch(id, { name: c.name, status: c.status, body: c.body, summary: reportSummaryOf(acceptReportBody(c.body), { starterIcon: before?.summary.starterIcon ?? BLANK_ICON }) }, at);
    },
    remove: async (id) => void (await reports.removeById(id)),
  };

  const layout: PartWriter<Layout> = {
    kind: 'invoice-layout',
    content: (entry) => {
      let body;
      try {
        body = withInferredCode(acceptInvoiceBody(entry.body));
      } catch (error) {
        throw new ValidationFailedError(`The invoice layout "${entry.key}" cannot be installed: ${error instanceof Error ? error.message : String(error)}`, { invoiceLayout: entry.key });
      }
      return { name: entry.name, topic: entry.topic ?? 'other', lang: entry.lang ?? 'en', body: invoiceBodyColumn(body) };
    },
    stored: async (id) => {
      const row = await invoices.findById(id);
      return row === null ? null : { name: row.name, topic: row.topic, lang: row.lang, body: row.body };
    },
    create: async (_entry, content) => {
      const c = content as { name: string; topic: 'other'; lang: 'en'; body: Record<string, unknown> };
      const body = acceptInvoiceBody(c.body);
      // A layout is a template: its number is an example on a design, never one minted.
      const row = await invoices.create({ kind: 'template', name: c.name, status: 'draft', topic: c.topic, lang: c.lang, number: body.number, starter: null, originId: null, body: c.body, summary: invoiceSummaryOf(body), createdBy }, at);
      return row.id;
    },
    rewrite: async (id, _entry, content) => {
      const c = content as { name: string; topic: 'other'; lang: 'en'; body: Record<string, unknown> };
      const body = acceptInvoiceBody(c.body);
      await invoices.patch(id, { name: c.name, topic: c.topic, lang: c.lang, body: c.body, summary: invoiceSummaryOf(body), number: body.number }, at);
    },
    remove: async (id) => void (await invoices.removeById(id)),
  };

  /** A schedule as the fingerprint reads it: who it goes to, its switch and its zone are the owner's. */
  const scheduleContent = (row: { name: string; pageId: string; format: string; schedule: { frequency: 'daily' | 'weekly' | 'monthly'; dayOfWeek?: number | null | undefined; dayOfMonth?: number | null | undefined; time: string } }) => ({
    name: row.name,
    pageId: row.pageId,
    format: row.format,
    schedule: { frequency: row.schedule.frequency, dayOfWeek: row.schedule.dayOfWeek ?? null, dayOfMonth: row.schedule.dayOfMonth ?? null, time: row.schedule.time },
  });
  const schedule: PartWriter<Schedule> = {
    kind: 'scheduled-report',
    content: (entry) => {
      const pageId = pageIds.get(entry.page);
      if (pageId === undefined) throw new ValidationFailedError(`The scheduled report "${entry.key}" reports on the page "${entry.page}", which the install did not make.`, { scheduledReport: entry.key });
      return scheduleContent({ name: entry.name, pageId, format: entry.format ?? 'pdf', schedule: entry.schedule });
    },
    stored: async (id) => {
      const row = await schedules.findById(id);
      return row === null ? null : scheduleContent(row);
    },
    create: async (_entry, content) => {
      const c = content as ReturnType<typeof scheduleContent>;
      // Nobody on it, and switched off: who it goes to is chosen here.
      const row = await schedules.create(
        { pageId: c.pageId, name: c.name, schedule: { ...c.schedule, timezone: input.timezone }, recipients: [], format: c.format as 'pdf' | 'png', enabled: false, nextRunAt: null, createdBy },
        at,
      );
      return row.id;
    },
    rewrite: async (id, _entry, content) => {
      const c = content as ReturnType<typeof scheduleContent>;
      const before = await schedules.findById(id);
      if (before === null) return;
      // Its zone and its switch stay; a schedule switched on runs by the new times.
      const next = { ...c.schedule, timezone: before.schedule.timezone };
      await schedules.update(id, { name: c.name, pageId: c.pageId, format: c.format as 'pdf' | 'png', schedule: next, nextRunAt: before.enabled ? nextRunAtOf(next, at ?? Date.now()) : null }, at);
    },
    remove: async (id) => void (await schedules.remove(id)),
  };
  return { report, layout, schedule };
}

/** A payable table's mapping in the payments screen's words: every column by its name here. */
function storedMapping(payable: SavedPayable, realId: (ref: string) => string | null): PayableMapping | { reason: string } {
  const payments = payable.payments;
  let kept: PayableMapping['payments'] = { kind: 'kept' };
  if (payments.kind === 'table') {
    const table = realId(payments.table);
    if (table === null) return { reason: `"${payments.table}" is not a table the install made` };
    kept = {
      kind: 'table',
      table,
      link: payments.link,
      amount: payments.amount,
      date: payments.date,
      method: { column: payments.method.column, values: { ...payments.method.values } },
      note: payments.note ?? null,
      voided: payments.voided ?? null,
      reference: payments.reference,
      refunded: payments.refunded ?? null,
      amountUnit: payments.amountUnit ?? 'units',
    };
  }
  return {
    label: payable.label ?? null,
    amount: { column: payable.amount.column, unit: payable.amount.unit ?? null },
    currency: { ...payable.currency },
    due: payable.due === undefined ? null : { column: payable.due.column },
    payments: kept,
    status: payable.status === undefined ? null : { column: payable.status.column, paid: payable.status.paid, refunded: payable.status.refunded ?? null },
    customerEmail: payable.customerEmail ?? null,
    customerCountry: payable.customerCountry ?? null,
    pageFields: [...(payable.pageFields ?? [])],
  };
}

async function installPayments(payments: SavedPayments | undefined, input: InstallSavedPartsInput, result: SavedPartsResult): Promise<void> {
  const { meta, connectionId } = input;
  const profiles = payableProfilesRepo(meta);
  const owned = (await profiles.list(connectionId)).filter((profile) => profile.ownerApp === input.manifest.key);
  const keep = new Set<string>();
  for (const payable of payments?.payables ?? []) {
    const name = `payable:${payable.table}`;
    const table = input.realId(payable.table);
    if (table === null) {
      result.skipped.push({ entry: name, reason: `"${payable.table}" is not a table the install made` });
      continue;
    }
    const mapping = storedMapping(payable, input.realId);
    if ('reason' in mapping) {
      result.skipped.push({ entry: name, reason: mapping.reason });
      continue;
    }
    const here = await profiles.byTable(connectionId, table);
    if (here !== null && here.ownerApp !== input.manifest.key) {
      result.skipped.push({ entry: name, reason: `"${payable.table}" is payable already, set up here by hand: it is left as it is` });
      continue;
    }
    if (here === null) {
      const made = await profiles.create({ connectionId, tableName: table, mapping, ownerApp: input.manifest.key, createdBy: input.createdBy }, input.at);
      if (made !== null) keep.add(made.id);
      result.written.push(name);
      continue;
    }
    keep.add(here.id);
    // The mapping is the app's; whether the table takes payments is the owner's switch.
    if (hashOf(here.mapping) !== hashOf(mapping)) await profiles.update(here.id, { mapping }, input.at);
    result.written.push(name);
  }
  for (const profile of owned) {
    if (keep.has(profile.id)) continue;
    await profiles.remove(profile.id);
    result.removed.push(`payable:${profile.tableName}`);
  }

  // The ways to pay and the pay page are the deployment's: only where none is set yet.
  const ways = paymentMethodsRepo(meta);
  const services = new Set(await paymentAddOnKeys({ manifests: manifestsRepo(meta, NO_SECRETS) }));
  for (const way of payments?.ways ?? []) {
    const name = `way:${way.source}/${way.method}`;
    if (way.source !== MANUAL_SOURCE && !services.has(way.source)) {
      result.skipped.push({ entry: name, reason: `"${way.source}" is not a payment service installed here` });
      continue;
    }
    if ((await ways.find(way.source, way.method)) !== null) continue;
    // A bank transfer with no account says nothing to pay into: it waits, switched off, for the owner's account.
    const enabled = way.source === MANUAL_SOURCE && way.method === 'bank-transfer' ? false : (way.enabled ?? true);
    await ways.put(
      {
        source: way.source,
        method: way.method,
        label: way.label === undefined ? null : { ...way.label },
        enabled,
        rules: { ...NO_RULES, countries: [...(way.rules?.countries ?? [])], currencies: [...(way.rules?.currencies ?? [])], min: way.rules?.min ?? null, max: way.rules?.max ?? null },
        details: null,
        position: way.position ?? 0,
      },
      input.at,
    );
    result.written.push(name);
  }
  const page = payments?.payPage;
  if (page !== undefined) {
    const docs = paymentSettingsRepo(meta);
    if ((await docs.get(PAY_PAGE_DOC, payPageSchema)) === null) {
      const appName = await settingsRepo(meta).get('branding.appName');
      const shopName = page.shopName ?? ((await businessName(meta)) || (typeof appName === 'string' ? appName : 'Adminium'));
      await docs.set(PAY_PAGE_DOC, payPageSchema, { shopName, logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: page.shopCountry ?? null, showLines: page.showLines ?? false }, input.at);
      result.written.push('pay-page');
    }
  }
}

/** What the owner gives the payments after the install: each service's keys, the bank account a transfer pays into. */
function paymentItems(payments: SavedPayments | undefined): AfterInstallItem[] {
  const out: AfterInstallItem[] = [];
  const services = new Set((payments?.ways ?? []).filter((way) => way.source !== MANUAL_SOURCE).map((way) => way.source));
  for (const source of [...services].sort()) out.push({ kind: 'payment-key', item: source, field: 'keys' });
  if ((payments?.ways ?? []).some((way) => way.source === MANUAL_SOURCE && way.method === 'bank-transfer')) out.push({ kind: 'bank-account', item: `${MANUAL_SOURCE}/bank-transfer`, field: 'details.accounts' });
  return out;
}

/**
 * What the owner will fill in after an install of the file's parts, read
 * from the file alone, for the review: who each schedule goes to (a file
 * names nobody), the keys of each payment service, a bank account, and the
 * slot each document is mailed to.
 */
export function plannedAfterInstallOfParts(manifest: Manifest): AfterInstallItem[] {
  const parts = partsOf(manifest);
  const out: AfterInstallItem[] = (parts.scheduledReports ?? []).map((entry) => ({ kind: 'recipients' as const, item: entry.key, field: 'recipients' }));
  out.push(...paymentItems(parts.payments));
  for (const entry of manifest.kind === 'app' ? (manifest.documents ?? []) : []) {
    if (entry.deliver !== undefined && 'emailSlot' in entry.deliver && (entry.deliver.emailSlot ?? null) === null) out.push({ kind: 'delivery', item: `${entry.table}/${entry.kind}`, field: 'deliver.emailSlot' });
  }
  return out;
}

/**
 * Makes (install) or brings up to date (update) what the file carries of
 * these parts, on the install's connection. Idempotent.
 */
export async function installSavedParts(input: InstallSavedPartsInput): Promise<SavedPartsResult | undefined> {
  const parts = partsOf(input.manifest);
  const records = await appPartsRepo(input.meta).list(input.manifestId);
  const owned = (await payableProfilesRepo(input.meta).list(input.connectionId)).some((profile) => profile.ownerApp === input.manifest.key);
  if (parts.reports === undefined && parts.invoiceLayouts === undefined && parts.scheduledReports === undefined && parts.payments === undefined && records.length === 0 && !owned) return undefined;

  const result: SavedPartsResult = { written: [], kept: [], removed: [], skipped: [], afterInstall: [] };
  const pageIds = new Map((await pagesRepo(input.meta).listByManifest(input.manifestId)).map((page) => [page.slug, page.id]));
  const write = writers(input, pageIds);
  await syncParts(parts.reports ?? [], write.report, records, input, result);
  await syncParts(parts.invoiceLayouts ?? [], write.layout, records, input, result);
  await syncParts(parts.scheduledReports ?? [], write.schedule, records, input, result);
  await installPayments(parts.payments, input, result);

  // Who each schedule goes to is chosen here.
  for (const record of await appPartsRepo(input.meta).list(input.manifestId, 'scheduled-report')) {
    const row = await scheduledReportsRepo(input.meta).findById(record.targetId);
    if (row !== null && row.recipients.length === 0) result.afterInstall.push({ kind: 'recipients', item: record.partKey, field: 'recipients' });
  }
  result.afterInstall.push(...paymentItems(parts.payments));
  return result;
}

/** The uninstall's half: every unchanged report, layout and schedule the install made, and its payable tables. Ways to pay and the pay page stay. */
export async function removeSavedParts(meta: MetaDb, manifestId: string, connectionId: string | null, appKey: string): Promise<SavedPartsResult> {
  const result: SavedPartsResult = { written: [], kept: [], removed: [], skipped: [], afterInstall: [] };
  const write = writers({ meta, manifest: { kind: 'app' } as Manifest, manifestId, connectionId: connectionId ?? '', realId: () => null, timezone: 'UTC', createdBy: null }, new Map());
  const byKind = { report: write.report, 'invoice-layout': write.layout, 'scheduled-report': write.schedule } as const;
  for (const record of await appPartsRepo(meta).list(manifestId)) {
    await letGo(record, byKind[record.kind] as PartWriter<{ key: string }>, meta, result);
  }
  if (connectionId !== null) {
    const profiles = payableProfilesRepo(meta);
    for (const profile of (await profiles.list(connectionId)).filter((one) => one.ownerApp === appKey)) {
      await profiles.remove(profile.id);
      result.removed.push(`payable:${profile.tableName}`);
    }
  }
  return result;
}

/** What the owner chooses of the app's documents after the install: the slot a document is mailed to. */
export function deliveryItems(manifest: Manifest, profiles: readonly DocumentProfile[], realId: (ref: string) => string | null): AfterInstallItem[] {
  const out: AfterInstallItem[] = [];
  for (const entry of manifest.kind === 'app' ? (manifest.documents ?? []) : []) {
    if (entry.deliver?.emailSlot === undefined) continue;
    const table = realId(entry.table);
    const profile = profiles.find((one) => one.table === table && one.kind === entry.kind && one.addOnKey === entry.addOn);
    if (profile === undefined) continue;
    const slot = (profile.deliver as { emailSlot?: string | null }).emailSlot;
    if (slot === null || slot === undefined || slot === '') out.push({ kind: 'delivery', item: `${entry.table}/${entry.kind}`, field: 'deliver.emailSlot' });
  }
  return out;
}
