// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SENDER — what turns an app's queued outbox rows into email.
 *
 * A row the producers (or the desk's "Send now") left `queued` is rendered
 * with the template its kind names, in the row's language and the venue's
 * clock, and handed to the mail queue; the row then reads `sent`, `failed`
 * or `skipped`, with a sentence saying why. It runs as a job right after a
 * row is queued and as a sweep once a minute, so a row queued by hand, or
 * left behind by a restart, goes too.
 *
 * ── WHAT A TEMPLATE READS ──────────────────────────────────────────────────
 * Every link of the outbox by its name (`appointment.*`, `patient.*`), and
 * what each linked row points at, under the link (`recall.clinician.*`) and
 * on its own when nothing else has that name (`clinician.*`, `visit_type.*`
 * through the appointment). The settings row as `practice.*`. `recipient.name`
 * and `recipient.first_name` (a first visit has no `patient.*`). A time in
 * five forms (`x`, `x.date`, `x.time`, `x.day_month`, `x.relative_day`) and a
 * row's `time_range`; money in the connection's currency; `manage_url` and
 * `booking_url` on the app's guest side — its own host when it has one, else
 * the server's public address, else no link at all: a job has no request to
 * guess an address from.
 *
 * ── WHAT IS NEVER SENT ─────────────────────────────────────────────────────
 * An address that is not one (`skipped`); an address on a reserved domain —
 * `example.*`, `.test`, `.invalid`, `.localhost`, `.example` — which is what
 * every sample address uses (`skipped`); a template with an HTML block, whose
 * values would go out unescaped with what a stranger typed in them
 * (`failed`); anything of an app that is switched off (left `queued` until
 * it is switched on).
 *
 * ── ONCE ───────────────────────────────────────────────────────────────────
 * One app's rows are sent under the producers' lock, re-read inside it and
 * changed only while still `queued`, so two instances never send a row
 * twice. `sent` means handed to the mail queue; a message that then fails
 * for good turns the row `failed` (`markUndelivered`).
 */
import { appOutboxesRepo, connectionTenantConfig, settingsRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { slotInstant, withNamedLock } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RecordWriteService, WriteContext } from '../crud/write-service.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { resolveEmailTemplate } from '../email/builtins.js';
import { enqueueEmail, type EmailSendReport } from '../email/send.js';
import { bcp47 } from '../i18n/bcp47.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import type { JobRegistry } from '../jobs/registry.js';
import { negotiateLocale } from '../plugins/surfaces.js';
import type { LiveOutbox, OutboxLogger } from './producers.js';

/** The job that sends one app's queued rows now. */
export const OUTBOX_SEND_JOB_KIND = 'app-outbox-send';
/** The once-a-minute sweep over every app's queued rows. */
export const OUTBOX_SWEEP_SCHEDULE_NAME = 'app-outbox-sweep';
/** Rows sent per app per pass; the next pass takes the rest. */
export const OUTBOX_BATCH = 50;

const DAY_MS = 86_400_000;
/** The longest `error` sentence written, so a narrow column still takes it. */
const ERROR_MAX = 120;

export interface OutboxSenderDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  writes: RecordWriteService;
  live: () => Promise<LiveOutbox[]>;
  logger?: OutboxLogger | undefined;
  /** The host an app's guest side is served on, when the operator mapped one. */
  hostFor?: ((appKey: string) => Promise<string | undefined>) | undefined;
  /** Tell the screens watching the log that a row changed. */
  announce?: ((connectionId: string, table: ResolvedTable, row: Row) => void) | undefined;
  /** The mail layer's secret; the composition's own when absent. */
  secret?: string | undefined;
}

export interface OutboxSender {
  /** Send one app's queued rows. Returns how many rows it settled. */
  sendApp(appKey: string, now?: number): Promise<number>;
  /** Every live app's queued rows. */
  sweep(now?: number): Promise<number>;
  /** A message sent for a row could not be delivered after every try. */
  markUndelivered(report: EmailSendReport, error: unknown): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Sends an installed app's queued emails; decorated by compose. */
    outboxSender: OutboxSender;
  }
}

type Outcome = { status: 'sent' | 'failed' | 'skipped'; error: string | null };

const plausible = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Whether an address is on a domain reserved for examples and tests (RFC 2606,
 * RFC 6761): `example.<anything>`, or a `.test`, `.invalid`, `.localhost` or
 * `.example` name.
 */
export function reservedAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').pop()?.replace(/\.$/, '') ?? '';
  const labels = domain.split('.');
  const top = labels[labels.length - 1] ?? '';
  return labels[0] === 'example' || ['test', 'invalid', 'localhost', 'example'].includes(top);
}

const sentence = (text: string) => (text.length <= ERROR_MAX ? text : `${text.slice(0, ERROR_MAX - 1)}…`);

/** `YYYY-MM-DD` of an instant on a clock. */
function dayOn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(instant);
}

/** A date-only value as `YYYY-MM-DD`, whatever the driver handed back. */
function dateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''));
  return match?.[1] ?? null;
}

/** How a row's values read in one language, on one clock, in one currency. */
export function valueForms(input: { locale: string; zone: string; currency: string | null; now: number }) {
  const tag = bcp47(input.locale);
  const on = (opts: Intl.DateTimeFormatOptions, zone = input.zone) => new Intl.DateTimeFormat(tag, { ...opts, timeZone: zone });
  const full = on({ dateStyle: 'full', timeStyle: 'short' });
  const date = on({ dateStyle: 'full' });
  const time = on({ timeStyle: 'short' });
  const dayMonth = on({ day: 'numeric', month: 'long' });
  const weekday = on({ weekday: 'long' });
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const today = dayOn(new Date(input.now), input.zone);

  /** Today, tomorrow, a weekday within the week, else the day and month. */
  const relativeDay = (instant: Date): string => {
    const days = Math.round((Date.parse(`${dayOn(instant, input.zone)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
    if (days === 0 || days === 1 || days === -1) return relative.format(days, 'day');
    if (days > 1 && days < 7) return weekday.format(instant);
    return dayMonth.format(instant);
  };

  return {
    /** A time: itself and its four other forms. */
    instant(prefix: string, value: unknown): Record<string, string> {
      const instant = slotInstant(value);
      if (instant === null) return {};
      return {
        [prefix]: full.format(instant),
        [`${prefix}.date`]: date.format(instant),
        [`${prefix}.time`]: time.format(instant),
        [`${prefix}.day_month`]: dayMonth.format(instant),
        [`${prefix}.relative_day`]: relativeDay(instant),
      };
    },
    /** A calendar day: no clock, so no zone moves it. */
    day(prefix: string, value: unknown): Record<string, string> {
      const day = dateOnly(value);
      if (day === null) return {};
      const noon = new Date(`${day}T12:00:00Z`);
      return { [prefix]: on({ dateStyle: 'full' }, 'UTC').format(noon), [`${prefix}.day_month`]: on({ day: 'numeric', month: 'long' }, 'UTC').format(noon) };
    },
    range(from: Date, to: Date): string {
      return time.formatRange(from, to);
    },
    money(value: unknown): string {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return String(value ?? '');
      return input.currency === null
        ? new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
        : new Intl.NumberFormat(tag, { style: 'currency', currency: input.currency }).format(amount);
    },
  };
}

export function createOutboxSender(deps: OutboxSenderDeps): OutboxSender {
  function referenced(view: SnapshotView, tableId: string, column: string): string | undefined {
    return view.model.relations.find((relation) => relation.from.tableId === tableId && relation.from.columns.length === 1 && relation.from.columns[0] === column)?.to.tableId;
  }

  async function rowOf(db: Kysely<SourceDatabase>, view: SnapshotView, tableId: string | undefined, id: unknown): Promise<Row | null> {
    if (tableId === undefined || id === null || id === undefined) return null;
    const key = view.table(tableId).primaryKey[0];
    if (key === undefined) return null;
    return ((await db.selectFrom(tableId as never).selectAll().where(key as never, '=', id as never).executeTakeFirst()) as Row | undefined) ?? null;
  }

  /** Where the app's guest side lives: its own host, else the server's public address, else nowhere. */
  async function guestBase(appKey: string): Promise<string | null> {
    const host = await deps.hostFor?.(appKey);
    if (host !== undefined) return `https://${host}`;
    const origin = await settingsRepo(deps.meta).get('system.publicOrigin');
    return typeof origin === 'string' && origin !== '' ? `${origin.replace(/\/+$/, '')}/apps/${appKey}/customer` : null;
  }

  /** Everything a template may read for one row. */
  async function variables(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable; forms: ReturnType<typeof valueForms> },
    row: Row,
  ): Promise<Record<string, string>> {
    const { db, view, forms } = ctx;
    const vars: Record<string, string> = {};
    const put = (prefix: string, table: ResolvedTable, record: Row) => {
      for (const column of table.columns.values()) {
        if (column.secret) continue;
        const value = record[column.name];
        if (value === null || value === undefined) continue;
        const name = `${prefix}.${column.name}`;
        const effective = table.table.columns.find((c) => c.name === column.name);
        if (column.logicalType === 'timestamp' || column.logicalType === 'timestamptz') Object.assign(vars, forms.instant(name, value));
        else if (column.logicalType === 'date') Object.assign(vars, forms.day(name, value));
        else if (effective?.semantics?.primary === 'money') vars[name] = forms.money(value);
        else vars[name] = value instanceof Date ? value.toISOString() : String(value);
      }
      // A visit's time as a range: to its end, or for its minutes.
      const start = slotInstant(record['starts_at']);
      const end = slotInstant(record['ends_at']) ?? (start === null || !Number.isFinite(Number(record['minutes'])) ? null : new Date(start.getTime() + Number(record['minutes']) * 60_000));
      if (start !== null && end !== null && end > start) vars[`${prefix}.time_range`] = forms.range(start, end);
    };

    const links = Object.entries(box.definition.links ?? {});
    const linked: { name: string; table: ResolvedTable; record: Row }[] = [];
    for (const [name, column] of links) {
      const tableId = referenced(view, ctx.outbox.id, column);
      const record = await rowOf(db, view, tableId, row[column]);
      if (tableId === undefined || record === null) continue;
      const table = view.table(tableId);
      put(name, table, record);
      linked.push({ name, table, record });
    }
    // One hop further: what a linked row points at, under it and — first come — on its own.
    const own = new Set(links.map(([name]) => name));
    for (const { name, table, record } of linked) {
      for (const column of table.columns.keys()) {
        if (!column.endsWith('_id') || record[column] === null || record[column] === undefined) continue;
        const targetId = referenced(view, table.id, column);
        const target = await rowOf(db, view, targetId, record[column]);
        if (targetId === undefined || target === null) continue;
        const base = column.slice(0, -'_id'.length);
        put(`${name}.${base}`, view.table(targetId), target);
        if (!own.has(base)) {
          own.add(base);
          put(base, view.table(targetId), target);
        }
      }
    }

    // Who it is for: the person on file, else the name a first visit carries.
    const recipient = box.definition.recipient;
    const person = await rowOf(db, view, recipient.table, row[recipient.via]);
    let name: unknown = person !== null && recipient.name !== undefined ? person[recipient.name] : undefined;
    if (person === null && recipient.fallback?.name !== undefined) {
      const holder = await rowOf(db, view, referenced(view, ctx.outbox.id, recipient.fallback.via), row[recipient.fallback.via]);
      name = holder?.[recipient.fallback.name];
    }
    if (typeof name === 'string' && name.trim() !== '') {
      vars['recipient.name'] = name.trim();
      vars['recipient.first_name'] = name.trim().split(/\s+/)[0] ?? name.trim();
    }

    const settings = box.definition.settings;
    let practiceName: unknown;
    if (settings !== undefined) {
      const record = (await db.selectFrom(settings.table as never).selectAll().limit(1).executeTakeFirst()) as Row | undefined;
      if (record !== undefined) {
        put('practice', view.table(settings.table), record);
        if (settings.name !== undefined) practiceName = record[settings.name];
      }
    }
    vars['appName'] =
      typeof practiceName === 'string' && practiceName.trim() !== '' ? practiceName.trim() : String((await settingsRepo(deps.meta).get('branding.appName')) ?? 'Adminium');

    // No address to link to leaves the link out, rather than printing its placeholder.
    const base = await guestBase(box.appKey);
    const pages = box.definition.pages;
    vars['manage_url'] = base === null ? '' : `${base}${pages?.manage ?? '/'}`;
    vars['booking_url'] = base === null ? '' : `${base}${pages?.booking ?? '/'}`;
    return vars;
  }

  /** One row: its message queued, or the reason it is not. */
  async function deliver(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable; zone: string; currency: string | null; now: number },
    row: Row,
  ): Promise<Outcome> {
    const cols = box.definition.columns;
    const to = row[cols.to];
    if (!plausible(to)) return { status: 'skipped', error: 'No email on file' };
    if (reservedAddress(to)) return { status: 'skipped', error: 'A reserved address (for examples and tests)' };
    const kind = String(row[cols.kind] ?? '');
    const templateKey = box.definition.kinds[kind];
    if (templateKey === undefined) return { status: 'failed', error: sentence(`No email is set for "${kind}"`) };

    const language = cols.language === undefined ? undefined : row[cols.language];
    const locale =
      (typeof language === 'string' && language !== '' ? negotiateLocale(language.replace(/_/g, '-')) : null) ?? (await recipientLocale(deps.meta, null));
    const template = await resolveEmailTemplate(deps.meta, templateKey, locale);
    if (template === null) return { status: 'failed', error: 'The email is switched off, or has no text' };
    if ((template.blocks as { block?: unknown }[]).some((block) => block.block === 'email.html')) {
      return { status: 'failed', error: 'The email has an HTML block, which cannot carry what a person typed' };
    }

    const forms = valueForms({ locale, zone: ctx.zone, currency: ctx.currency, now: ctx.now });
    const vars = await variables(box, { ...ctx, forms }, row);
    const key = ctx.outbox.primaryKey[0];
    const report: EmailSendReport | undefined =
      key === undefined
        ? undefined
        : { app: box.appKey, connectionId: box.connectionId, table: ctx.outbox.id, pk: { [key]: row[key] as string | number }, sentAt: ctx.now };
    const job = await enqueueEmail(
      { meta: deps.meta, logger: deps.logger === undefined ? undefined : { info: () => undefined, warn: deps.logger.warn.bind(deps.logger) }, secret: deps.secret },
      { to: to.trim(), templateKey, locale, vars, report },
    );
    return job === null ? { status: 'failed', error: 'Email is not set up on this server' } : { status: 'sent', error: null };
  }

  function context(appKey: string): WriteContext {
    return { origin: 'automation', hops: 1, actor: { kind: 'system', id: null, label: `${appKey} outbox` }, request: null };
  }

  async function sendBox(box: LiveOutbox, now: number): Promise<number> {
    const view = await deps.viewFor(box.connectionId);
    if (view === null) return 0;
    const handle = await deps.manager.data(box.connectionId);
    const outbox = view.table(box.definition.table);
    const key = outbox.primaryKey[0];
    if (key === undefined) return 0;
    const cols = box.definition.columns;
    const tenant = await connectionTenantConfig(deps.meta, box.connectionId);
    const settled: Row[] = [];
    await withNamedLock({ db: handle.db, dialect: handle.dialect }, `outbox|${box.connectionId}|${box.appKey}`, 'CAPACITY_BUSY', async (db) => {
      const rows = (await db
        .selectFrom(outbox.id as never)
        .selectAll()
        .where(cols.status as never, '=', 'queued' as never)
        .orderBy(key as never)
        .limit(OUTBOX_BATCH)
        .execute()) as Row[];
      for (const row of rows) {
        let outcome: Outcome;
        try {
          outcome = await deliver(box, { db, view, outbox, zone: tenant?.timezone ?? 'UTC', currency: tenant?.currency ?? null, now }, row);
        } catch (error) {
          deps.logger?.warn({ err: error, appKey: box.appKey }, 'an app email could not be prepared');
          outcome = { status: 'failed', error: 'The email could not be prepared' };
        }
        const values: Row = { [cols.status]: outcome.status };
        if (cols.error !== undefined) values[cols.error] = outcome.error;
        if (cols.sentAt !== undefined && outcome.status === 'sent') values[cols.sentAt] = new Date(now).toISOString();
        const result = await deps.writes.update({
          target: { connectionId: box.connectionId, view, table: outbox, db, dialect: handle.dialect },
          pk: { [key]: row[key] },
          values,
          context: context(box.appKey),
          // Only while it is still queued: nobody else has settled it meanwhile.
          refine: (query) => query.where(sql.ref(cols.status), '=', 'queued'),
          skipIfNone: true,
          announce: async () => {},
        });
        if (result.count > 0 && result.after !== null) settled.push(result.after);
      }
    });
    for (const row of settled) deps.announce?.(box.connectionId, outbox, row);
    return settled.length;
  }

  async function sendApp(appKey: string, now: number = Date.now()): Promise<number> {
    const box = (await deps.live()).find((candidate) => candidate.appKey === appKey);
    return box === undefined ? 0 : sendBox(box, now);
  }

  async function sweep(now: number = Date.now()): Promise<number> {
    let total = 0;
    for (const box of await deps.live()) {
      try {
        total += await sendBox(box, now);
      } catch (error) {
        deps.logger?.warn({ err: error, appKey: box.appKey }, 'app outbox sweep failed');
      }
    }
    return total;
  }

  async function markUndelivered(report: EmailSendReport, error: unknown): Promise<void> {
    const stored = await appOutboxesRepo(deps.meta).findByApp(report.app);
    if (stored === null || stored.connectionId !== report.connectionId) return;
    const definition = JSON.parse(stored.definition) as LiveOutbox['definition'];
    if (definition.table !== report.table) return;
    const view = await deps.viewFor(report.connectionId);
    if (view === null) return;
    const handle = await deps.manager.data(report.connectionId);
    const outbox = view.table(definition.table);
    const cols = definition.columns;
    const detail = error instanceof Error ? error.message : String(error);
    const values: Row = { [cols.status]: 'failed' };
    if (cols.error !== undefined) values[cols.error] = sentence(`Not delivered: ${detail}`);
    const result = await deps.writes.update({
      target: { connectionId: report.connectionId, view, table: outbox, db: handle.db, dialect: handle.dialect },
      pk: report.pk,
      values,
      context: context(report.app),
      // A row the desk has since queued again is theirs, and one sent again since is another message's.
      refine: (query) => {
        let still = query.where(sql.ref(cols.status), '=', 'sent');
        const sentAt = cols.sentAt === undefined ? undefined : outbox.columns.get(cols.sentAt);
        if (sentAt !== undefined && report.sentAt !== undefined) {
          const spelled = (ms: number) => normalizeWriteValue(sentAt, new Date(ms).toISOString());
          still = still.where(sql.ref(sentAt.name), '>', spelled(report.sentAt - 1_000)).where(sql.ref(sentAt.name), '<', spelled(report.sentAt + 1_000));
        }
        return still;
      },
      skipIfNone: true,
      announce: async () => {},
    });
    if (result.count > 0 && result.after !== null) deps.announce?.(report.connectionId, outbox, result.after);
  }

  return { sendApp, sweep, markUndelivered };
}

/**
 * The name an app's emails are signed with: its settings row's `name` column,
 * when the app declares an outbox with one. Also what a sign-in code sent
 * through the app's own key is signed with. Null otherwise, or on any doubt.
 */
export async function appSignature(meta: MetaDb, manager: ConnectionManager, appKey: string, connectionId: string): Promise<string | null> {
  try {
    const stored = await appOutboxesRepo(meta).findByApp(appKey);
    if (stored === null || stored.connectionId !== connectionId) return null;
    const settings = (JSON.parse(stored.definition) as LiveOutbox['definition']).settings;
    if (settings?.name === undefined) return null;
    const { db } = await manager.data(connectionId);
    const row = (await db.selectFrom(settings.table as never).select(settings.name as never).limit(1).executeTakeFirst()) as Row | undefined;
    const name = row?.[settings.name];
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  } catch {
    return null;
  }
}

/** The send job: one app's queued rows, now. Internal — only the producers queue it. */
export function registerOutboxSendHandler(registry: JobRegistry, sender: OutboxSender): void {
  registry.registerJobHandler(
    OUTBOX_SEND_JOB_KIND,
    z.object({ app: z.string().min(1).max(64) }).strict(),
    async (payload) => ({ settled: await sender.sendApp(payload.app) }),
    { internal: true },
  );
}
