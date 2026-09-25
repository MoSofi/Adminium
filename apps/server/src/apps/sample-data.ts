// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's sample data: added in one go, remembered row by row, and taken out
 * again without touching anything the operator made or changed.
 *
 * ── THE LEDGER ─────────────────────────────────────────────────────────────
 * `<prefix>sample_data` in the operator's own database, one row per sample
 * record: its order, its table, its key (canonical JSON, as TEXT — a json
 * column reorders keys on Postgres and MySQL), its label, and hashes of the row
 * as it was read back. It is made on the first add, recorded with role
 * `sample-ledger`, excluded from CRUD and endpoints by an override, and left
 * out of page generation. Files the sample added are ledger rows too
 * (`table_ref = '@file'`).
 *
 * ── ADD ────────────────────────────────────────────────────────────────────
 * The bundle is checked first; its images go to the Files library (and to the
 * bin if anything later fails); then every row is written in ONE transaction,
 * parents first, through the same column rules a person's write goes through
 * but with no hooks and no automations — a demo booking must not send email.
 * A failure anywhere rolls the whole add back.
 *
 * ── REMOVE ─────────────────────────────────────────────────────────────────
 * A preview first: how many per table; which sample rows the operator's own
 * records still point at (kept, with the rows they point at in turn); which
 * the operator changed since (kept when they ask). Then, in ONE transaction,
 * the rest are deleted in reverse order, then the whole ledger: a row that
 * stays is the operator's from then on — their records use it, or they
 * changed it — so the app reads "not loaded" and adding sample data again
 * starts afresh. A reference the scan missed makes the database refuse, and
 * nothing is removed.
 */
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import {
  byClockSchema,
  isoDurationMs,
  prefixFor,
  ROW_DIRECTIVES,
  sampleBundleIssues,
  sampleBundleSchema,
  sampleDirective,
  shareCodeColumns,
  type Manifest,
  type SampleBundle,
} from '@adminium/manifest';
import {
  appTablesRepo,
  auditRepo,
  connectionTenantConfig,
  filesRepo,
  jobsRepo,
  newId,
  readJson,
  type Job,
  overridesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';

import type { AppStore } from './store.js';
import { applyOverrides, type EffectiveModel } from '../connections/effective-schema.js';
import { runIntrospection } from '../connections/introspect.js';
import type { ConnectionManager, DataHandle, SourceDatabase } from '../connections/manager.js';
import { SnapshotView, type ResolvedTable } from '../crud/identifiers.js';
import { tableRulesFor } from '../crud/column-rules.js';
import { isUniqueViolation } from '../crud/decided-columns.js';
import { labelColumnFor } from '../crud/labels.js';
import { renderNow } from '../crud/instants.js';
import { createWriteService, deleteRows, insertRow, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { fetchByPk } from '../crud/records.js';
import { writeStores } from '../crud/write-stores.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { FileStore } from '../files/store.js';
import type { JobHandlerContext, JobRegistry } from '../jobs/registry.js';
import type { Row } from '../crud/mask.js';

export interface SampleDataDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  store: AppStore;
  files: FileStore;
  /** Tell open dashboards their data moved; absent in a bare composition. */
  publish?: ((connectionId: string) => Promise<void>) | undefined;
}

/** The installed app a sample-data call is about. */
export interface SampleApp {
  key: string;
  version: string;
  manifestId: string;
  connectionId: string | null;
  manifest: Manifest;
}

const FILE_REF = '@file';

// ── pure helpers ──────────────────────────────────────────────────────────

/** JSON with every object's keys sorted: one spelling for one value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  return JSON.stringify(value ?? null);
}

/**
 * One value, spelled the same whatever the engine handed back: a decimal
 * without trailing zeros, a boolean as true/false, a timestamp as a UTC
 * instant, a JSON document with sorted keys.
 */
export function normaliseValue(value: unknown, logicalType: string): string | null {
  if (value === null || value === undefined) return null;
  switch (logicalType) {
    case 'integer':
    case 'bigint':
      return typeof value === 'number' ? String(Math.trunc(value)) : String(value).trim();
    case 'decimal':
    case 'float': {
      const text = typeof value === 'number' ? String(value) : String(value).trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
      const [whole, fraction = ''] = text.split('.');
      const trimmed = fraction.replace(/0+$/, '');
      return trimmed === '' ? String(BigInt(whole!)) : `${String(BigInt(whole!))}.${trimmed}`.replace(/^0\./, '0.');
    }
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 't' || value === 'true' ? 'true' : 'false';
    case 'date': {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return String(value).slice(0, 10);
    }
    case 'timestamp':
    case 'timestamptz': {
      if (value instanceof Date) return value.toISOString();
      // A zone-less spelling is the server's own wall clock, which is how the
      // write path stores a naive timestamp (`crud/write-values.ts`).
      const time = Date.parse(String(value).trim().replace(' ', 'T'));
      return Number.isNaN(time) ? String(value) : new Date(time).toISOString();
    }
    case 'json':
      return canonicalJson(typeof value === 'string' ? safeJson(value) : value);
    default:
      if (Buffer.isBuffer(value)) return value.toString('hex');
      return String(value);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The row's hash and each column's, as read back — what a later change is measured against. */
export function hashRow(row: Row, table: ResolvedTable): { rowHash: string; colHashes: Record<string, string> } {
  const normal: Record<string, string | null> = {};
  for (const column of table.table.columns) {
    if (!(column.name in row)) continue;
    normal[column.name] = normaliseValue(row[column.name], column.logicalType);
  }
  const colHashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(normal)) colHashes[name] = sha256(JSON.stringify(value)).slice(0, 16);
  return { rowHash: sha256(canonicalJson(normal)), colHashes };
}

/** The UTC instant of a wall-clock time in `timeZone`. */
export function zonedWallTime(date: { y: number; m: number; d: number }, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(date.y, date.m - 1, date.d, hh, mm);
  const offset = zoneOffsetMs(timeZone, guess);
  let utc = guess - offset;
  // Across a clock change the first guess can land an hour out; one more pass settles it.
  const again = zoneOffsetMs(timeZone, utc);
  if (again !== offset) utc = guess - again;
  return new Date(utc);
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((local - instant) / 60_000) * 60_000;
}

/** Today's date in `timeZone`, moved by `days`. */
function zonedDay(now: number, timeZone: string, days: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(now),
  );
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const shifted = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** The text for the adding person's language: theirs, their language, US English, any. */
export function pickText(texts: Readonly<Record<string, string>>, locale: string): string {
  const tag = locale.replace('_', '-');
  if (texts[tag] !== undefined) return texts[tag]!;
  const language = tag.split('-')[0];
  const near = Object.entries(texts).find(([key]) => key.split('-')[0] === language);
  if (near !== undefined) return near[1];
  return texts['en-US'] ?? Object.values(texts)[0] ?? '';
}

export interface ResolveContext {
  now: number;
  timeZone: string;
  locale: string;
  /** Label → the row's key value. */
  labels: ReadonlyMap<string, unknown>;
  /** Asset label → Files library id. */
  assets: ReadonlyMap<string, string>;
}

/**
 * The day `n` working days (Monday to Friday) from today in `timeZone`; day 0
 * on a weekend is the Monday after, so a sample's "today" is a working day.
 */
function zonedWorkday(now: number, timeZone: string, n: number): { y: number; m: number; d: number } {
  const today = zonedDay(now, timeZone, 0);
  const at = new Date(Date.UTC(today.y, today.m - 1, today.d));
  const weekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;
  while (weekend(at)) at.setUTCDate(at.getUTCDate() + 1);
  for (let left = Math.abs(n); left > 0; ) {
    at.setUTCDate(at.getUTCDate() + Math.sign(n));
    if (!weekend(at)) left -= 1;
  }
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

/**
 * Day `dom` of the month `months` from this one in `timeZone`: the month's
 * last day when it has fewer, and today when that day has not come yet.
 */
export function zonedMonthDay(now: number, timeZone: string, months: number, dom: number): { y: number; m: number; d: number; today: boolean } {
  const today = zonedDay(now, timeZone, 0);
  const first = new Date(Date.UTC(today.y, today.m - 1 + months, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = { y, m, d: Math.min(dom, last) };
  const later = day.y * 10_000 + day.m * 100 + day.d >= today.y * 10_000 + today.m * 100 + today.d;
  return later ? { ...today, today: true } : { ...day, today: false };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Half an hour either side of the adding moment is "around" it. */
const AROUND_MS = 30 * 60_000;

/**
 * One sample row, with every directive replaced by its value — or null when
 * its `@byClock` set says to leave it out.
 */
export function resolveSampleRow(row: Readonly<Record<string, unknown>>, ctx: ResolveContext): Row | null {
  const clock = row['@byClock'] === undefined ? null : byClockSchema.parse(row['@byClock']);
  let values: Readonly<Record<string, unknown>> = row;
  if (clock !== null) {
    // The row's own time, against the adding moment.
    const when = resolveValues({ at: typeof clock.at === 'string' ? row[clock.at] : clock.at }, ctx)['at'];
    const instant = when instanceof Date ? when.getTime() : Number.NaN;
    const branch = Number.isNaN(instant)
      ? undefined
      : instant < ctx.now - AROUND_MS
        ? clock.before
        : instant <= ctx.now + AROUND_MS
          ? clock.around
          : clock.after;
    if (branch?.['@skip'] === true) return null;
    const { ['@skip']: _skip, ...columns } = branch ?? {};
    values = { ...row, ...columns };
  }
  return resolveValues(values, ctx);
}

function resolveValues(row: Readonly<Record<string, unknown>>, ctx: ResolveContext): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (ROW_DIRECTIVES.has(column)) continue;
    const found = sampleDirective(value);
    if (found === null) {
      out[column] = value;
      continue;
    }
    switch (found.kind) {
      case 'ref': {
        if (!ctx.labels.has(found.label)) throw new ValidationFailedError(`The sample row "${found.label}" was not written.`);
        out[column] = ctx.labels.get(found.label);
        break;
      }
      // An instant: spelled for its column and engine by the caller.
      case 'ago':
        out[column] = new Date(ctx.now - isoDurationMs(found.duration));
        break;
      case 'wall': {
        const day = found.workdays ? zonedWorkday(ctx.now, ctx.timeZone, found.day) : zonedDay(ctx.now, ctx.timeZone, found.day);
        out[column] = zonedWallTime(day, found.time, ctx.timeZone);
        break;
      }
      // A date is the venue's day, spelled as the day — never the server's.
      case 'date': {
        const day = found.workdays ? zonedWorkday(ctx.now, ctx.timeZone, found.day) : zonedDay(ctx.now, ctx.timeZone, found.day);
        out[column] = `${String(day.y).padStart(4, '0')}-${pad2(day.m)}-${pad2(day.d)}`;
        break;
      }
      // History in calendar months: never later than the adding moment.
      case 'month': {
        const day = zonedMonthDay(ctx.now, ctx.timeZone, found.months, found.dom);
        if (found.time === null) {
          out[column] = `${String(day.y).padStart(4, '0')}-${pad2(day.m)}-${pad2(day.d)}`;
        } else {
          const at = zonedWallTime(day, found.time, ctx.timeZone);
          out[column] = day.today && at.getTime() > ctx.now ? new Date(ctx.now) : at;
        }
        break;
      }
      case 't':
        out[column] = pickText(found.texts, ctx.locale);
        break;
      case 'asset': {
        const id = ctx.assets.get(found.label);
        if (id === undefined) throw new ValidationFailedError(`The sample asset "${found.label}" was not added.`);
        out[column] = id;
        break;
      }
    }
  }
  return out;
}

/**
 * A resolved instant, spelled the way the ordinary write path spells "now"
 * for that column and engine — a zoned instant, a naive local timestamp, a
 * date — so a sample row stores exactly what a person's would.
 */
function spellInstants(values: Row, table: ResolvedTable): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(values)) {
    if (!(value instanceof Date)) {
      out[column] = value;
      continue;
    }
    const shape = table.table.columns.find((candidate) => candidate.name === column);
    // A venue-local column reads a zone-less time as the VENUE's wall clock;
    // the server's would be off by the difference. The instant goes as it is.
    if (shape?.venueLocal === true) {
      out[column] = value.toISOString();
      continue;
    }
    out[column] = (shape === undefined ? null : renderNow(shape, value)) ?? value.toISOString();
  }
  return out;
}

/** Key types an identity sequence counts in. */
const INTEGER_TYPES = new Set(['integer', 'bigint', 'smallint']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// ── the service ───────────────────────────────────────────────────────────

/** The bundle file the app's manifest names, if it ships one. */
export function sampleFileOf(manifest: Manifest): string | undefined {
  return 'sampleData' in manifest ? manifest.sampleData?.file : undefined;
}

/** The ledger table's name for an app: in its prefix, or its key when it has none. */
export function ledgerNameFor(manifest: Manifest): string {
  const prefix = manifest.requiredSchema?.prefixed === true ? prefixFor(manifest.key) : `${manifest.key.replace(/-/g, '_')}_`;
  return `${prefix}sample_data`;
}

interface LedgerRow {
  seq: number;
  table_ref: string;
  pk: string;
  label: string | null;
  row_hash: string;
  col_hashes: string;
  created_at: number | string;
}

function asDb(db: unknown): Kysely<SourceDatabase> {
  return db as Kysely<SourceDatabase>;
}

export function createSampleDataService(deps: SampleDataDeps) {
  const records = appTablesRepo(deps.meta);

  async function connectionOf(app: SampleApp): Promise<string> {
    if (app.connectionId === null) {
      throw new ValidationFailedError(`"${app.key}" is installed without a database, so it has no sample data.`);
    }
    return app.connectionId;
  }

  async function ledgerRecord(app: SampleApp, connectionId: string) {
    return (await records.forInstall(connectionId, app.key)).find(
      (record) => record.role === 'sample-ledger' && record.state === 'created',
    );
  }

  async function loadBundle(app: SampleApp): Promise<SampleBundle> {
    const file = sampleFileOf(app.manifest);
    if (file === undefined) {
      throw new NotFoundError(`"${app.key}" ships no sample data.`, { reason: 'NO_SAMPLE_DATA' });
    }
    const { bytes } = await deps.store.readVerifiedFile(app.key, app.version, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new ValidationFailedError(`"${file}" is not JSON.`, { reason: 'SAMPLE_INVALID' });
    }
    const bundle = sampleBundleSchema.safeParse(parsed);
    if (!bundle.success) {
      throw new ValidationFailedError(`"${file}" is not an adminium.sample/1 bundle.`, {
        reason: 'SAMPLE_INVALID',
        issues: bundle.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const issues = sampleBundleIssues(bundle.data, app.manifest);
    if (issues.length > 0) {
      throw new ValidationFailedError(`"${file}" does not fit this app.`, { reason: 'SAMPLE_INVALID', issues });
    }
    return bundle.data;
  }

  async function viewFor(connectionId: string): Promise<SnapshotView> {
    const snapshot = await snapshotsRepo(deps.meta).latest(connectionId);
    if (snapshot === null) throw new NotFoundError('No schema snapshot yet — run introspection first.');
    const active = await overridesRepo(deps.meta).listForConnection(connectionId, { status: 'active' });
    return new SnapshotView(connectionId, applyOverrides(snapshot.schema as never, active));
  }

  async function modelFor(connectionId: string): Promise<EffectiveModel> {
    return (await viewFor(connectionId)).model;
  }

  /** Make the ledger on the first add, record it, and keep it out of CRUD and endpoints. */
  async function ensureLedger(app: SampleApp, connectionId: string, handle: DataHandle): Promise<string> {
    const existing = await ledgerRecord(app, connectionId);
    if (existing !== undefined) return existing.tableName;
    const name = ledgerNameFor(app.manifest);
    await asDb(handle.db)
      .schema.createTable(name)
      .ifNotExists()
      .addColumn('seq', 'integer', (col) => col.primaryKey())
      .addColumn('table_ref', 'varchar(64)', (col) => col.notNull())
      .addColumn('pk', 'text', (col) => col.notNull())
      .addColumn('label', 'varchar(96)')
      .addColumn('row_hash', 'varchar(64)', (col) => col.notNull())
      .addColumn('col_hashes', 'text', (col) => col.notNull())
      .addColumn('created_at', 'bigint', (col) => col.notNull())
      .execute();
    await records.record({
      appKey: app.key,
      manifestId: app.manifestId,
      connectionId,
      ref: 'sample_data',
      tableName: name,
      owned: true,
      state: 'created',
      role: 'sample-ledger',
    });
    await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
    const model = await modelFor(connectionId);
    const table = model.tables.find((candidate) => candidate.name === name);
    if (table !== undefined) {
      await overridesRepo(deps.meta).create({
        connectionId,
        op: 'table.exclude',
        tableName: table.id,
        value: { excluded: true },
        origin: 'app',
      });
    }
    return name;
  }

  async function ledgerRows(handle: DataHandle, ledger: string): Promise<LedgerRow[]> {
    const rows = await sql<LedgerRow>`SELECT * FROM ${sql.table(ledger)} ORDER BY seq`.execute(asDb(handle.db));
    return rows.rows.map((row) => ({ ...row, seq: Number(row.seq) }));
  }

  return {
    /** What is loaded now: counts per table and when it was added. */
    async status(app: SampleApp) {
      const offered = sampleFileOf(app.manifest) !== undefined;
      if (app.connectionId === null) return { offered, loaded: false, total: 0, addedAt: null, tables: [] };
      const ledger = await ledgerRecord(app, app.connectionId);
      if (ledger === undefined) return { offered, loaded: false, total: 0, addedAt: null, tables: [] };
      const handle = await deps.manager.data(app.connectionId);
      const rows = (await ledgerRows(handle, ledger.tableName)).filter((row) => row.table_ref !== FILE_REF);
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.table_ref, (counts.get(row.table_ref) ?? 0) + 1);
      const first = rows.reduce<number | null>((min, row) => {
        const at = Number(row.created_at);
        return min === null || at < min ? at : min;
      }, null);
      return {
        offered,
        loaded: rows.length > 0,
        total: rows.length,
        addedAt: first,
        tables: [...counts.entries()].map(([ref, count]) => ({ ref, count })),
      };
    },

    /** What an add would write, per table, without writing it. */
    async addPreview(app: SampleApp) {
      const bundle = await loadBundle(app);
      return {
        tables: bundle.tables.map((table) => ({ ref: table.ref, count: table.rows.length })),
        total: bundle.tables.reduce((sum, table) => sum + table.rows.length, 0),
        assets: Object.keys(bundle.assets).length,
      };
    },

    async add(
      app: SampleApp,
      opts: {
        locale: string;
        userId: string | null;
        userLabel: string;
        progress?: (pct: number, message: string) => void;
        now?: number;
      },
    ): Promise<{ counts: Record<string, number>; files: number }> {
      const connectionId = await connectionOf(app);
      const bundle = await loadBundle(app);
      const status = await this.status(app);
      if (status.loaded) {
        throw new ConflictError(`"${app.key}" already has its sample data. Remove it first to add it again.`, 'CONFLICT');
      }
      const now = opts.now ?? Date.now();
      const handle = await deps.manager.data(connectionId);
      const names = await records.realNames(connectionId, app.key);
      const timeZone = (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC';
      opts.progress?.(5, 'Checked the sample data');

      // Images first, into the Files library; to the bin if anything later fails.
      const fileIds = new Map<string, string>();
      const files = filesRepo(deps.meta);
      try {
        for (const [label, asset] of Object.entries(bundle.assets)) {
          const { bytes, sha256: actual } = await deps.store.readVerifiedFile(app.key, app.version, asset.file);
          if (actual !== asset.sha256) {
            throw new ValidationFailedError(`The sample image "${asset.file}" is not the file the bundle names.`, {
              reason: 'SAMPLE_INVALID',
            });
          }
          const id = newId('file');
          const filename = basename(asset.file);
          const mime = MIME_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'application/octet-stream';
          const stored = await deps.files.write({ id, kind: 'upload', filename, mime, bytes });
          await files.create({
            id,
            filename,
            mime,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            storageKey: stored.storageKey,
            storage: stored.storage,
            destinationId: stored.destinationId,
            kind: 'upload',
            entityConnectionId: connectionId,
            uploadedBy: opts.userId,
            attachedAt: now,
          });
          fileIds.set(label, id);
        }
        opts.progress?.(20, 'Added the images');

        const ledger = await ensureLedger(app, connectionId, handle);
        const view = await viewFor(connectionId);
        const writes = createWriteService(writeStores(deps.meta));
        const context: WriteContext = {
          origin: 'import',
          hops: 0,
          actor: { kind: 'user', id: opts.userId, label: opts.userLabel },
          request: null,
        };
        const total = bundle.tables.reduce((sum, table) => sum + table.rows.length, 0);
        const counts: Record<string, number> = {};
        const explicitKeys = new Set<string>();

        await handle.db.transaction().execute(async (trx) => {
          const db = asDb(trx);
          const labels = new Map<string, unknown>();
          /** The rows of tables that keep totals, settled once every row is in. */
          const totals = new Map<string, { target: WriteTarget; rows: { seq: number; key: Row; record: Row }[] }>();
          let seq = 0;
          let done = 0;
          for (const table of bundle.tables) {
            /*
             * The totals so far, before the next table: its rows may copy one
             * (a stage of a quote copies the quote's subtotal), and a copy
             * reads the row as it stands. Settled again at the end, once
             * every child row is in.
             */
            for (const { target: parent, rows } of totals.values()) {
              await writes.settle('create', parent, rows.map((row) => ({ record: row.record, before: null })));
            }
            const resolved = view.table(names[table.ref] ?? table.ref);
            const target = { connectionId, view, table: resolved, db, dialect: handle.dialect };
            for (const row of table.rows) {
              const resolvedRow = resolveSampleRow(row, { now, timeZone, locale: opts.locale, labels, assets: fileIds });
              // Its `@byClock` set left it out: a payment for a visit that has not happened yet.
              if (resolvedRow === null) {
                done += 1;
                continue;
              }
              const values = spellInstants(resolvedRow, resolved);
              /*
               * A row only for an empty table — the app's one settings row — is
               * left out when the operator already has one; the rows after it
               * point at theirs, which the sample never takes as its own.
               */
              if (row['@onlyIfEmpty'] === true) {
                const existing = (await db.selectFrom(resolved.id as never).selectAll().limit(1).executeTakeFirst()) as Row | undefined;
                if (existing !== undefined) {
                  const key = Object.fromEntries(resolved.primaryKey.map((column) => [column, existing[column]]));
                  const named = row['@label'];
                  if (typeof named === 'string') labels.set(named, resolved.primaryKey.length === 1 ? existing[resolved.primaryKey[0]!] : key);
                  done += 1;
                  continue;
                }
              }
              if (resolved.primaryKey.some((column) => values[column] !== undefined)) explicitKeys.add(resolved.name);
              // A shared link's code the sample gives is printed in the app's package for anyone to
              // read: every sample row's link is made here, like a person's create (`empty-code`).
              for (const column of shareCodeColumns(app.manifest.kind === 'app' ? (app.manifest.publicAccess ?? []) : [], table.ref)) delete values[column];
              /*
               * A code or a running number the table already holds — a row
               * kept from an earlier add, or one of the operator's own — is
               * left for Adminium to decide, as it would be on a person's
               * create: the sample's own spelling is a nicety, a clash a refusal.
               */
              const rules = tableRulesFor({ view, table: resolved });
              for (const decided of [...(rules?.codes ?? []), ...(rules?.sequences ?? [])]) {
                const value = values[decided.column];
                if (value === undefined || value === null) continue;
                const taken = await db
                  .selectFrom(resolved.id as never)
                  .select(sql`1`.as('taken'))
                  .where(sql.ref(decided.column), '=', value as never)
                  .executeTakeFirst();
                if (taken !== undefined) delete values[decided.column];
              }
              /*
               * Any other one-of-a-kind value the table already holds is one of
               * the operator's own records (their Monday opening hours, a day
               * they already closed): the sample never overwrites it and never
               * guesses around it, it stops — with the table, the column and
               * the value named, not the database's own words. Nothing of the
               * add is kept (it is one transaction).
               */
              for (const column of resolved.table.columns) {
                const value = values[column.name];
                if (!column.isUnique || column.isPrimaryKey || value === undefined || value === null) continue;
                const taken = await db
                  .selectFrom(resolved.id as never)
                  .select(sql`1`.as('taken'))
                  .where(sql.ref(column.name), '=', value as never)
                  .executeTakeFirst();
                if (taken !== undefined) throw sampleClash(table.ref, column.name, value);
              }
              // Sample data is history the operator asked for, not bookings to judge.
              const checked = await writes.check('create', target, context, [values], { capacity: 'unchecked' });
              const good = checked.rows[0];
              if (good === null || good === undefined) {
                throw new ValidationFailedError(`A sample row for "${table.ref}" was refused.`, {
                  reason: 'SAMPLE_ROW_REFUSED',
                  table: table.ref,
                  issues: checked.issues[0],
                });
              }
              let stored: Row;
              try {
                stored = await insertRow(db, handle.dialect, resolved, good);
              } catch (error) {
                // A unique rule over several columns, which the check above cannot see.
                if (isUniqueViolation(error)) throw sampleClash(table.ref, null, null);
                throw error;
              }
              const key = Object.fromEntries(resolved.primaryKey.map((column) => [column, stored[column]]));
              const label = typeof row['@label'] === 'string' ? row['@label'] : null;
              if (label !== null) {
                labels.set(label, resolved.primaryKey.length === 1 ? stored[resolved.primaryKey[0]!] : key);
              }
              const { rowHash, colHashes } = hashRow(stored, resolved);
              seq += 1;
              if ((tableRulesFor({ view, table: resolved })?.ownRollups?.length ?? 0) > 0) {
                const bucket = totals.get(table.ref) ?? { target, rows: [] as { seq: number; key: Row; record: Row }[] };
                bucket.rows.push({ seq, key, record: stored });
                totals.set(table.ref, bucket);
              }
              await db
                .insertInto(ledger as never)
                .values({
                  seq,
                  table_ref: table.ref,
                  pk: canonicalJson(key),
                  label,
                  row_hash: rowHash,
                  col_hashes: JSON.stringify(colHashes),
                  created_at: now,
                } as never)
                .execute();
              counts[table.ref] = (counts[table.ref] ?? 0) + 1;
              done += 1;
              if (done % 25 === 0) opts.progress?.(20 + Math.round((done / total) * 70), `Wrote ${String(done)} of ${String(total)}`);
            }
          }
          /*
           * Totals last, from every child row: the rows went in one at a time
           * and nothing settled them (a payment's visit, a visit's balance).
           * Each settled row is hashed again as it now stands, or its removal
           * would take the new total for an edit and keep the row.
           */
          for (const [ref, { target, rows }] of totals) {
            await writes.settle('create', target, rows.map((row) => ({ record: row.record, before: null })));
            for (const row of rows) {
              const now = (await fetchByPk(db, target.table, row.key)) ?? row.record;
              const { rowHash, colHashes } = hashRow(now, target.table);
              await db
                .updateTable(ledger as never)
                .set({ row_hash: rowHash, col_hashes: JSON.stringify(colHashes) } as never)
                .where('seq' as never, '=', row.seq as never)
                .where('table_ref' as never, '=', ref as never)
                .execute();
            }
          }
          for (const [label, id] of fileIds) {
            seq += 1;
            await db
              .insertInto(ledger as never)
              .values({
                seq,
                table_ref: FILE_REF,
                pk: canonicalJson({ id }),
                label,
                row_hash: '',
                col_hashes: '{}',
                created_at: now,
              } as never)
              .execute();
          }
        });

        // A row that named its own key leaves an identity sequence behind it.
        if (handle.dialect === 'postgres') {
          for (const tableName of explicitKeys) {
            const resolved = view.table(tableName);
            // Only a counting key has a sequence; a uuid key has none (and no MAX).
            for (const column of resolved.primaryKey.filter((name) => INTEGER_TYPES.has(resolved.columns.get(name)?.logicalType ?? ''))) {
              await sql`SELECT setval(pg_get_serial_sequence(${`${resolved.schema}.${resolved.name}`}, ${column}), COALESCE((SELECT MAX(${sql.ref(column)}) FROM ${sql.table(`${resolved.schema}.${resolved.name}`)}), 0) + 1, false) WHERE pg_get_serial_sequence(${`${resolved.schema}.${resolved.name}`}, ${column}) IS NOT NULL`.execute(
                asDb(handle.db),
              );
            }
          }
        }
        opts.progress?.(95, 'Written');

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: opts.userId,
          actorLabel: opts.userLabel,
          category: 'app',
          action: 'app.sample-data.add',
          connectionId,
          changes: { after: { key: app.key, counts, files: fileIds.size } },
        });
        await deps.publish?.(connectionId);
        return { counts, files: fileIds.size };
      } catch (error) {
        for (const id of fileIds.values()) await files.markDeleted(id).catch(() => undefined);
        throw error;
      }
    },

    /**
     * What a removal would take and keep. Re-reads the database first: a
     * record made since the add may now point at a sample row.
     */
    async removePreview(app: SampleApp) {
      const connectionId = await connectionOf(app);
      const ledger = await ledgerRecord(app, connectionId);
      if (ledger === undefined) return { tables: [], kept: [], changed: [], total: 0 };
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      const handle = await deps.manager.data(connectionId);
      const view = await viewFor(connectionId);
      const names = await records.realNames(connectionId, app.key);
      const rows = (await ledgerRows(handle, ledger.tableName)).filter((row) => row.table_ref !== FILE_REF);
      const analysis = await analyse(handle, view, names, rows);
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.table_ref, (counts.get(row.table_ref) ?? 0) + 1);
      // What the record is called now, as the rest of the console names it:
      // the dialog says "Flat white", not the bundle's own label.
      const titleOf = (row: LedgerRow): string | null => {
        const table = view.table(names[row.table_ref] ?? row.table_ref);
        const column = labelColumnFor(view, table);
        const value = column === null ? undefined : analysis.current.get(row.seq)?.[column];
        return value === undefined || value === null || value === '' ? null : String(value);
      };
      return {
        tables: [...counts.entries()].map(([ref, count]) => ({ ref, count })),
        kept: rows
          .filter((row) => analysis.used.has(row.seq))
          .map((row) => ({ ref: row.table_ref, label: row.label, title: titleOf(row), usedBy: analysis.used.get(row.seq)! })),
        changed: rows
          .filter((row) => analysis.changed.has(row.seq))
          .map((row) => ({
            ref: row.table_ref,
            label: row.label,
            title: titleOf(row),
            columns: analysis.changed.get(row.seq)!,
          })),
        total: rows.length,
      };
    },

    async remove(
      app: SampleApp,
      opts: { keepChanged: boolean; userId: string | null; userLabel: string },
    ): Promise<{ removed: number; kept: number; byTable: Record<string, number> }> {
      const connectionId = await connectionOf(app);
      const ledger = await ledgerRecord(app, connectionId);
      if (ledger === undefined) return { removed: 0, kept: 0, byTable: {} };
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      const handle = await deps.manager.data(connectionId);
      const view = await viewFor(connectionId);
      const names = await records.realNames(connectionId, app.key);
      const all = await ledgerRows(handle, ledger.tableName);
      const rows = all.filter((row) => row.table_ref !== FILE_REF);
      const analysis = await analyse(handle, view, names, rows, opts.keepChanged);
      const byTable: Record<string, number> = {};
      const removedSeqs: number[] = [];

      await handle.db.transaction().execute(async (trx) => {
        const db = asDb(trx);
        for (const row of [...rows].reverse()) {
          // Kept: it leaves the ledger below, and is the operator's.
          removedSeqs.push(row.seq);
          if (analysis.keep.has(row.seq)) continue;
          if (!analysis.gone.has(row.seq)) {
            const table = view.table(names[row.table_ref] ?? row.table_ref);
            const pk = JSON.parse(row.pk) as Row;
            /*
             * The sample's own rows go as they came: they were never real, a
             * numbered or sent sample document included. A row the operator
             * has changed since is theirs, and its delete is judged like any
             * other — a sent invoice they moved on stays.
             */
            const judged = analysis.changed.has(row.seq)
              ? await (async () => {
                  const target = { connectionId, view, table, db, dialect: handle.dialect };
                  const person: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: opts.userId, label: opts.userLabel }, request: null };
                  const [prepared] = await createWriteService(writeStores(deps.meta)).beforeEach('delete', target, person, [{ match: pk, values: {} }]);
                  return prepared === undefined ? undefined : { dialect: handle.dialect, prepared: prepared.values };
                })()
              : undefined;
            try {
              await deleteRows(db, table, pk, undefined, judged);
            } catch (error) {
              const code = (error as { code?: unknown }).code;
              if (code === 'DELETE_REFUSED' || code === 'RECORD_LOCKED') throw error;
              throw new ConflictError(
                `A record of yours still uses a sample row in "${row.table_ref}", so nothing was removed.`,
                'CONFLICT',
                { table: row.table_ref, cause: error instanceof Error ? error.message : String(error) },
              );
            }
            byTable[row.table_ref] = (byTable[row.table_ref] ?? 0) + 1;
          }
        }
        // The files' entries go too; a file a kept row still names stays in the library.
        for (const row of all.filter((entry) => entry.table_ref === FILE_REF)) removedSeqs.push(row.seq);
        for (let i = 0; i < removedSeqs.length; i += 500) {
          await db
            .deleteFrom(ledger.tableName as never)
            .where('seq' as never, 'in', removedSeqs.slice(i, i + 500) as never)
            .execute();
        }
      });

      const files = filesRepo(deps.meta);
      const keptValues = new Set(analysis.keptValues);
      for (const row of all.filter((entry) => entry.table_ref === FILE_REF)) {
        const id = (JSON.parse(row.pk) as { id: string }).id;
        if (!keptValues.has(id)) await files.markDeleted(id).catch(() => undefined);
      }
      const removed = Object.values(byTable).reduce((sum, n) => sum + n, 0);
      await auditRepo(deps.meta).append({
        actorKind: 'user',
        actorId: opts.userId,
        actorLabel: opts.userLabel,
        category: 'app',
        action: 'app.sample-data.remove',
        connectionId,
        changes: { after: { key: app.key, removed: byTable, kept: analysis.keep.size, keepChanged: opts.keepChanged } },
      });
      await deps.publish?.(connectionId);
      return { removed, kept: analysis.keep.size, byTable };
    },
  };
}

/**
 * Which sample rows the operator's own records use, which they changed, and
 * which are already gone — and so which must stay: the used ones, the changed
 * ones when asked, and every sample row those point at in turn.
 */
async function analyse(
  handle: DataHandle,
  view: SnapshotView,
  names: Readonly<Record<string, string>>,
  rows: readonly LedgerRow[],
  keepChanged = true,
): Promise<{
  used: Map<number, number>;
  changed: Map<number, string[]>;
  gone: Set<number>;
  keep: Set<number>;
  keptValues: string[];
  /** Each sample row as it reads now; null once it is gone. */
  current: Map<number, Row | null>;
}> {
  const db = asDb(handle.db);
  // Sample rows by table and by key value (single-column keys, which is what a
  // reference can point at).
  const byTable = new Map<string, Map<string, LedgerRow>>();
  const tableOf = (row: LedgerRow): ResolvedTable => view.table(names[row.table_ref] ?? row.table_ref);
  const current = new Map<number, Row | null>();
  for (const row of rows) {
    const table = tableOf(row);
    const match = JSON.parse(row.pk) as Row;
    let query = db.selectFrom(`${table.schema}.${table.name}` as never).selectAll();
    for (const [column, value] of Object.entries(match)) query = query.where(column as never, '=', value as never);
    const found = (await query.executeTakeFirst()) as Row | undefined;
    current.set(row.seq, found ?? null);
    const keyValue = table.primaryKey.length === 1 ? String(match[table.primaryKey[0]!]) : null;
    if (keyValue !== null) {
      const map = byTable.get(table.id) ?? new Map<string, LedgerRow>();
      map.set(keyValue, row);
      byTable.set(table.id, map);
    }
  }

  const gone = new Set(rows.filter((row) => current.get(row.seq) === null).map((row) => row.seq));
  const changed = new Map<number, string[]>();
  for (const row of rows) {
    const now = current.get(row.seq);
    if (now === null || now === undefined) continue;
    const { rowHash, colHashes } = hashRow(now, tableOf(row));
    if (rowHash === row.row_hash) continue;
    const before = JSON.parse(row.col_hashes) as Record<string, string>;
    changed.set(
      row.seq,
      Object.keys(colHashes).filter((column) => before[column] !== colHashes[column]),
    );
  }

  // Referrers that are not sample rows keep what they point at.
  const sampleSeqs = new Set(rows.map((row) => row.seq));
  const isSample = (tableId: string, pkRow: Row, table: ResolvedTable): boolean => {
    if (table.primaryKey.length !== 1) return false;
    const found = byTable.get(tableId)?.get(String(pkRow[table.primaryKey[0]!]));
    return found !== undefined && sampleSeqs.has(found.seq);
  };
  const used = new Map<number, number>();
  for (const table of view.model.tables) {
    if (table.system || table.excluded === true) continue;
    for (const column of table.columns) {
      const ref = column.references;
      if (ref === null) continue;
      const targets = byTable.get(ref.tableId);
      if (targets === undefined || targets.size === 0) continue;
      const resolved = safeTable(view, table.id);
      if (resolved === null) continue;
      const values = [...targets.keys()];
      for (let i = 0; i < values.length; i += 500) {
        const found = (await db
          .selectFrom(`${table.schema}.${table.name}` as never)
          .select([...resolved.primaryKey, column.name] as never)
          .where(column.name as never, 'in', values.slice(i, i + 500) as never)
          .execute()) as Row[];
        for (const referrer of found) {
          if (isSample(table.id, referrer, resolved)) continue;
          const target = targets.get(String(referrer[column.name]));
          if (target !== undefined) used.set(target.seq, (used.get(target.seq) ?? 0) + 1);
        }
      }
    }
  }

  // Kept: used ones, changed ones when asked, then what those point at.
  const keep = new Set<number>(used.keys());
  if (keepChanged) for (const seq of changed.keys()) keep.add(seq);
  const queue = [...keep];
  const bySeq = new Map(rows.map((row) => [row.seq, row]));
  while (queue.length > 0) {
    const seq = queue.pop()!;
    const row = bySeq.get(seq);
    const values = current.get(seq);
    if (row === undefined || values === null || values === undefined) continue;
    const table = tableOf(row);
    for (const column of table.table.columns) {
      const ref = column.references;
      if (ref === null) continue;
      const parent = byTable.get(ref.tableId)?.get(String(values[column.name]));
      if (parent !== undefined && !keep.has(parent.seq)) {
        keep.add(parent.seq);
        queue.push(parent.seq);
      }
    }
  }
  const keptValues: string[] = [];
  for (const seq of keep) {
    for (const value of Object.values(current.get(seq) ?? {})) if (typeof value === 'string') keptValues.push(value);
  }
  return { used, changed, gone, keep, keptValues, current };
}

function safeTable(view: SnapshotView, id: string): ResolvedTable | null {
  try {
    return view.table(id);
  } catch {
    return null;
  }
}

// ── the job ─────────────────────────────────────────────────────────────────

/** A sample row that would repeat a value one of the operator's own records already holds. */
function sampleClash(ref: string, column: string | null, value: unknown): ValidationFailedError {
  const what = column === null ? 'a record already there' : `a record already there with ${column} "${String(value)}"`;
  return new ValidationFailedError(
    `The sample data was not added: a sample row for "${ref}" clashes with ${what}. Sample data is for tables that hold none of your own records of that kind yet.`,
    { reason: 'SAMPLE_ROW_CLASH', table: ref, column },
  );
}

export const SAMPLE_ADD_KIND = 'app-sample-add';

const sampleAddPayloadSchema = z.object({
  key: z.string().min(1),
  locale: z.string().min(2),
  userId: z.string().nullable(),
  userLabel: z.string(),
});
export type SampleAddPayload = z.infer<typeof sampleAddPayloadSchema>;

/** The installed app a key names, read straight off its row; null when not installed. */
export async function findSampleApp(meta: MetaDb, key: string): Promise<SampleApp | null> {
  const row = await meta.db
    .selectFrom('adminium_manifests')
    .select(['id', 'manifestKey', 'version', 'connectionId', 'manifest'])
    .where('manifestKey', '=', key)
    .where('kind', '=', 'app')
    .executeTakeFirst();
  if (row === undefined) return null;
  return {
    key: row.manifestKey,
    version: row.version,
    manifestId: row.id,
    connectionId: row.connectionId,
    manifest: readJson<Manifest>(row.manifest),
  };
}

/**
 * Add runs as a job, with progress on `jobs:<id>`: a café's worth of rows and
 * images is more than a request should hold open. Internal — only the app
 * route enqueues it, after its own permission check.
 */
export function registerSampleDataHandler(registry: JobRegistry, deps: SampleDataDeps): void {
  const service = createSampleDataService(deps);
  registry.registerJobHandler(
    SAMPLE_ADD_KIND,
    sampleAddPayloadSchema,
    async (payload: SampleAddPayload, ctx: JobHandlerContext) => {
      const app = await findSampleApp(deps.meta, payload.key);
      if (app === null) throw new NotFoundError(`"${payload.key}" is not installed.`);
      return service.add(app, {
        locale: payload.locale,
        userId: payload.userId,
        userLabel: payload.userLabel,
        progress: (pct, message) => ctx.progress(pct, { step: 'sample', message }),
      });
    },
    { internal: true },
  );
}

export async function enqueueSampleAdd(meta: MetaDb, payload: SampleAddPayload): Promise<Job> {
  return jobsRepo(meta).enqueue({
    kind: SAMPLE_ADD_KIND,
    payload,
    // One add per app at a time: a double click must not write the café twice.
    dedupeKey: `${SAMPLE_ADD_KIND}:${payload.key}`,
    maxAttempts: 1,
  });
}
