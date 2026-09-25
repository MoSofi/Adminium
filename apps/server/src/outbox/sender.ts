// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SENDER — what turns an app's queued outbox rows into email.
 *
 * A row the producers (or the desk's "Send now") left `queued` is rendered
 * with the template its kind names, in the row's language and the venue's
 * clock — the nearest of Adminium's languages for the words, the row's own
 * tag for its dates, times and money (`en-GB` reads "09:30") — and handed to
 * the mail queue; the row then reads `sent`, `failed`
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
 * A column that holds nothing reads as an empty value, not an unknown one: a
 * paragraph (or a list item) holding only a visit's optional reason is then
 * left out of the email, where it would otherwise print `{{…}}` to a patient.
 * A name no row has is still printed as it was written — that is a mistake in
 * the template, and a loud one gets fixed.
 *
 * ── WHERE IT GOES ─────────────────────────────────────────────────────────
 * The row's own address. A row that names none — one a desk queued by hand,
 * linking the patient whose email it may not read — goes where its
 * recipient link says, as the producers would have addressed it, and the
 * address is written into the row when it is sent. Still none: `skipped`,
 * "No email on file".
 *
 * ── WHAT IS NEVER SENT ─────────────────────────────────────────────────────
 * An address that is not one (`skipped`); an address on a reserved domain —
 * `example.*`, `.test`, `.invalid`, `.localhost`, `.example` — which is what
 * every sample address uses (`skipped`); a template with an HTML block, whose
 * values would go out unescaped with what a stranger typed in them
 * (`failed`); anything of an app that is switched off (left `queued` until
 * it is switched on).
 *
 * ── WHEN ───────────────────────────────────────────────────────────────────
 * A `queued` row goes once its due moment has come (a row with none goes at
 * once): a batched message waits for its window to close, and a message a
 * producer queued for later waits for its day. A `held` row never goes until
 * a person approves it — and approving one whose day is still ahead sends it
 * now. Just before a row goes it is judged again, as the minute scan judges
 * it: skipped when the row it is about no longer needs it (paid, void),
 * skipped as overtaken when a later message of its group has come due, and
 * kept back when its due has moved ahead.
 *
 * ── THE WORDING ────────────────────────────────────────────────────────────
 * A person approving a held message may rewrite it: `body_override` is sent
 * in place of the template's blocks as plain paragraphs (never an HTML block),
 * `subject_override` in place of its subject, on one line.
 *
 * ── A SIGN-IN LINK ─────────────────────────────────────────────────────────
 * `{{signInLink}}` is minted here, at send time, for the person the outbox's
 * recipient names — and only when the address the message goes to is that
 * person's own address as it is now. Otherwise it is empty
 * (`sign-in-link.ts`).
 *
 * ── ONCE ───────────────────────────────────────────────────────────────────
 * One app's rows are sent under the producers' lock, re-read inside it and
 * changed only while still `queued`, so two instances never send a row
 * twice. `sent` means handed to the mail queue; a message that then fails
 * for good turns the row `failed` (`markUndelivered`), with the reason. So a
 * queued row that says when it was sent and records no failure was sent
 * already — queued again by a door that skipped the moves' check — and is
 * put back to `sent`, never sent twice.
 *
 * ── AFTER IT IS SENT ───────────────────────────────────────────────────────
 * A producer's `onSent` change (the third reminder pauses the project) is made
 * AFTER the message's status is committed, through the ordinary write, and
 * announced like any write — never inside the send: a refusal there would
 * roll the status back and the next sweep would send the reminder again. It
 * is recorded on the message (`effect_at`, or `effect_error` with the
 * refusal), and the sweep tries again a change that failed for another
 * reason, for a day after the send.
 */
import type { OutboxProducer } from '@adminium/manifest';
import { addOnSettingsRepo, appOutboxesRepo, connectionTenantConfig, settingsRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { slotInstant, withNamedLock } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RecordWriteService } from '../crud/write-service.js';
import { normalizeWriteValue } from '../crud/write-values.js';
import { resolveEmailTemplate } from '../email/builtins.js';
import { enqueueEmail, type EmailSendReport } from '../email/send.js';
import { AppError } from '../errors.js';
import { bcp47, formatTag } from '../i18n/bcp47.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import type { JobRegistry } from '../jobs/registry.js';
import { negotiateLocale } from '../plugins/surfaces.js';
import { outboxContext } from './context.js';
import { verdictsFor, type LiveOutbox, type OutboxLogger } from './producers.js';
import { addressFor, normalAddress, plausibleAddress, referenced, rowOf, type Addressed } from './recipient.js';
import type { SignInLinkMinter } from './sign-in-link.js';
import { producerOf, settingReader, skipSentence } from './timing.js';

/** The job that sends one app's queued rows now. */
export const OUTBOX_SEND_JOB_KIND = 'app-outbox-send';
/** The once-a-minute sweep over every app's queued rows. */
export const OUTBOX_SWEEP_SCHEDULE_NAME = 'app-outbox-sweep';
/** Rows sent per app per pass; the next pass takes the rest. */
export const OUTBOX_BATCH = 50;

const DAY_MS = 86_400_000;
/** How long an app's manifest facts are trusted: an update shows up within it. */
const FACTS_TTL_MS = 5_000;

/** What a template needs of the installed app's manifest. */
interface AppFacts {
  /** The add-ons it requires. */
  requires: string[];
  /** Its client side's routes, by name: where a sign-in link may lead. */
  routes: Record<string, string>;
}
/** The longest `error` sentence written, so a narrow column still takes it. */
const ERROR_MAX = 120;
/**
 * How long after a send its `onSent` change is still tried: the sweep's
 * retries, and no further — an app update that adds an effect never applies
 * it to messages sent long before.
 */
export const EFFECT_RETRY_MS = DAY_MS;

export interface OutboxSenderDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  writes: RecordWriteService;
  live: () => Promise<LiveOutbox[]>;
  logger?: OutboxLogger | undefined;
  /** The host an app's guest side is served on, when the operator mapped one. */
  hostFor?: ((appKey: string) => Promise<string | undefined>) | undefined;
  /** The host an app's staff side is served on, when the operator mapped one (`{{staff_url}}`). */
  staffHostFor?: ((appKey: string) => Promise<string | undefined>) | undefined;
  /** Tell the screens watching the log that a row changed. */
  announce?: ((connectionId: string, table: ResolvedTable, row: Row) => void) | undefined;
  /**
   * A row an `onSent` change wrote, as every write is announced: the rules,
   * the other producers (a paused project's notice) and the screens hear it.
   */
  emit?: ((event: RecordWriteEvent) => Promise<void>) | undefined;
  /** Mints `{{signInLink}}`; with none, the variable is empty. */
  signInLinks?: SignInLinkMinter | undefined;
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

/**
 * What became of a row. `to` and `language` are what the sender looked up for
 * a row that named no address — written back with a `sent`, so the log says
 * where it went.
 */
type Outcome = { status: 'sent' | 'failed' | 'skipped'; error: string | null; to?: string; language?: string };

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

/** Whole days from one `YYYY-MM-DD` to another. */
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

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
      return {
        [prefix]: on({ dateStyle: 'full' }, 'UTC').format(noon),
        [`${prefix}.day_month`]: on({ day: 'numeric', month: 'long' }, 'UTC').format(noon),
        // Whole days from it to today on the venue's calendar: "47 days past due".
        [`${prefix}.days_since`]: String(daysBetween(day, today)),
      };
    },
    range(from: Date, to: Date): string {
      return time.formatRange(from, to);
    },
    /** An amount in the row's own currency when it names one, else the connection's. */
    money(value: unknown, own: string | null = null): string {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return String(value ?? '');
      const currency = own ?? input.currency;
      return currency === null
        ? new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
        : new Intl.NumberFormat(tag, { style: 'currency', currency }).format(amount);
    },
  };
}

/**
 * Where a sign-in link leads once the reader is in: the client-side route
 * named like the link the message is about (`invoice` → `/invoices/:id`,
 * filled with that row's id), else like any other link it names. Only a path
 * of the app's own manifest — starting with one `/`, with at most one
 * parameter — ever; never a URL. Undefined for none.
 */
export function routeFor(box: LiveOutbox, routes: Readonly<Record<string, string>>, row: Row, producer: OutboxProducer | undefined): string | undefined {
  const links = Object.entries(box.definition.links ?? {});
  const ordered = [...links.filter(([, column]) => column === producer?.link), ...links.filter(([, column]) => column !== producer?.link)];
  for (const [name, column] of ordered) {
    const path = routes[name];
    const id = row[column];
    if (path === undefined || id === null || id === undefined) continue;
    const params = path.match(/:[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    if (!/^\/(?!\/)/.test(path) || path.includes('://') || path.includes('\\') || params.length > 1) continue;
    return params.length === 0 ? path : path.replace(params[0]!, encodeURIComponent(String(id)));
  }
  return undefined;
}

export function createOutboxSender(deps: OutboxSenderDeps): OutboxSender {
  /** Where the app's guest side lives: its own host, else the server's public address, else nowhere. */
  async function guestBase(appKey: string): Promise<string | null> {
    const host = await deps.hostFor?.(appKey);
    if (host !== undefined) return `https://${host}`;
    const origin = await settingsRepo(deps.meta).get('system.publicOrigin');
    return typeof origin === 'string' && origin !== '' ? `${origin.replace(/\/+$/, '')}/apps/${appKey}/customer` : null;
  }

  /** Where the app's staff side lives, ending in `/` so a route follows: its own host, else the server's public address, else nowhere. */
  async function staffBase(appKey: string): Promise<string | null> {
    const host = await deps.staffHostFor?.(appKey);
    if (host !== undefined) return `https://${host}/`;
    const origin = await settingsRepo(deps.meta).get('system.publicOrigin');
    return typeof origin === 'string' && origin !== '' ? `${origin.replace(/\/+$/, '')}/apps/${appKey}/staff/` : null;
  }

  /**
   * What the installed app's manifest says that a template needs: the
   * add-ons it requires, and the routes of its client side (where a sign-in
   * link may lead). Read from the stored manifest, a few seconds at a time.
   */
  const factsCache = new Map<string, { at: number; facts: AppFacts }>();
  async function appFacts(manifestId: string): Promise<AppFacts> {
    const hit = factsCache.get(manifestId);
    if (hit !== undefined && Date.now() - hit.at < FACTS_TTL_MS) return hit.facts;
    const parse = (value: unknown): Record<string, unknown> | null => {
      try {
        const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    const row = await deps.meta.db.selectFrom('adminium_manifests').select(['manifest']).where('id', '=', manifestId).executeTakeFirst();
    const manifest = parse(row?.manifest);
    const needs = (manifest?.['addOns'] as { requires?: { key?: unknown }[] } | undefined)?.requires ?? [];
    const customer = ((manifest?.['frontends'] as { side?: unknown; routes?: unknown }[] | undefined) ?? []).find((frontend) => frontend.side === 'customer');
    const routes = typeof customer?.routes === 'object' && customer.routes !== null ? (customer.routes as Record<string, unknown>) : {};
    const facts: AppFacts = {
      requires: needs.flatMap((need) => (typeof need.key === 'string' ? [need.key] : [])),
      routes: Object.fromEntries(Object.entries(routes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    };
    factsCache.set(manifestId, { at: Date.now(), facts });
    return facts;
  }

  /**
   * `addOn.<key>.<setting>`: the settings an add-on the app requires lists
   * as public (the invoice's "how to pay"), and nothing else of an add-on's
   * — never one it marks secret, never one of an add-on the app does not
   * require.
   */
  async function addOnVariables(requires: readonly string[]): Promise<Record<string, string>> {
    const vars: Record<string, string> = {};
    for (const key of requires) {
      const row = await deps.meta.db
        .selectFrom('adminium_manifests')
        .select(['manifest'])
        .where('kind', '=', 'add-on')
        .where('manifestKey', '=', key)
        .where('status', '=', 'installed')
        .executeTakeFirst();
      type AddOnManifest = { addOn?: { publicSettings?: unknown }; settings?: { key?: unknown; secret?: unknown }[] };
      const manifest = ((): AddOnManifest | null => {
        try {
          return (typeof row?.manifest === 'string' ? JSON.parse(row.manifest) : (row?.manifest ?? null)) as AddOnManifest | null;
        } catch {
          return null;
        }
      })();
      const listed = Array.isArray(manifest?.addOn?.publicSettings) ? (manifest.addOn.publicSettings as unknown[]).filter((name): name is string => typeof name === 'string') : [];
      const secret = new Set((manifest?.settings ?? []).filter((setting) => setting.secret === true).map((setting) => setting.key));
      if (listed.length === 0) continue;
      const values = await addOnSettingsRepo(deps.meta).valuesFor(key);
      for (const name of listed) {
        if (secret.has(name)) continue;
        const value = values[name];
        vars[`addOn.${key}.${name}`] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
      }
    }
    return vars;
  }

  /** Everything a template may read for one row. */
  async function variables(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable; forms: ReturnType<typeof valueForms> },
    row: Row,
    addressed: Addressed | null,
  ): Promise<Record<string, string>> {
    const { db, view, forms } = ctx;
    const vars: Record<string, string> = {};
    const put = (prefix: string, table: ResolvedTable, record: Row) => {
      // A row that keeps its own currency (an invoice in euros on a pound connection) prints its money in it.
      const own = table.columns.has('currency') ? record['currency'] : null;
      const currency = typeof own === 'string' && /^[A-Za-z]{3}$/.test(own.trim()) ? own.trim().toUpperCase() : null;
      for (const column of table.columns.values()) {
        if (column.secret) continue;
        const value = record[column.name];
        const name = `${prefix}.${column.name}`;
        if (value === null || value === undefined) {
          vars[name] = '';
          const forms =
            column.logicalType === 'timestamp' || column.logicalType === 'timestamptz'
              ? ['date', 'time', 'day_month', 'relative_day']
              : column.logicalType === 'date'
                ? ['day_month', 'days_since']
                : [];
          for (const form of forms) vars[`${name}.${form}`] = '';
          continue;
        }
        const effective = table.table.columns.find((c) => c.name === column.name);
        if (column.logicalType === 'timestamp' || column.logicalType === 'timestamptz') Object.assign(vars, forms.instant(name, value));
        else if (column.logicalType === 'date') Object.assign(vars, forms.day(name, value));
        else if (effective?.semantics?.primary === 'money') vars[name] = forms.money(value, currency);
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
    // A notice sent to a setting's address is the studio's own: no person's name.
    if (addressed?.bySetting !== true) {
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
    // The desk: a studio notice's button opens `{{staff_url}}proposals/42`.
    vars['staff_url'] = (await staffBase(box.appKey)) ?? '';
    Object.assign(vars, await addOnVariables((await appFacts(box.row.manifestId)).requires));
    return vars;
  }

  /**
   * Where a row goes. A row a producer made that HOLDS, or one addressed to a
   * setting, is addressed again now — a held reminder may go weeks after it
   * was made, to a person who has changed their address since, and a studio
   * notice goes to the studio's address as it is today, never to the person
   * the row links. Any other row that names its own address keeps it; one
   * that names none is sent where its recipient link says, as the producers
   * would have addressed it — a desk that queues a row by hand may not read
   * a patient's email (personal columns are masked for an app's roles), so it
   * links the person and leaves the address to this. No opt-in is asked
   * here: that is a reminder's question, and the producers ask it; a row
   * somebody queued by hand was sent on purpose.
   */
  async function addressOf(
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable },
    box: LiveOutbox,
    producer: OutboxProducer | undefined,
    row: Row,
  ): Promise<{ addressed: Addressed | null; to: unknown; lookedUp: boolean }> {
    const cols = box.definition.columns;
    const named = row[cols.to];
    const blank = named === null || named === undefined || (typeof named === 'string' && named.trim() === '');
    const again = producer !== undefined && (producer.hold === true || producer.recipient !== undefined);
    if (!again && !blank) return { addressed: null, to: named, lookedUp: false };
    const addressed = await addressFor({ db: ctx.db, view: ctx.view, outboxId: ctx.outbox.id, read: settingReader(deps.meta, ctx.db) }, box.definition, producer, row);
    return { addressed, to: addressed.address, lookedUp: true };
  }

  /**
   * `{{signInLink}}`: only for the person the outbox's recipient names, found
   * through the row's own recipient link, when the address the message goes
   * to is that person's current one — and only when the email reads it, so
   * no live link is made for nothing. Empty otherwise.
   */
  async function signInLink(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; now: number },
    row: Row,
    to: string,
    addressed: Addressed | null,
    producer: OutboxProducer | undefined,
  ): Promise<string> {
    if (deps.signInLinks === undefined || addressed?.bySetting === true) return '';
    const recipient = box.definition.recipient;
    const identity = addressed?.identity ?? (await rowOf(ctx.db, ctx.view, recipient.table, row[recipient.via]));
    if (identity === null) return '';
    const current = normalAddress(identity[recipient.email]);
    if (current === '' || current !== normalAddress(to)) return '';
    const key = ctx.view.table(recipient.table).primaryKey[0];
    const id = key === undefined ? undefined : identity[key];
    if (key === undefined || (typeof id !== 'string' && typeof id !== 'number')) return '';
    const base = await guestBase(box.appKey);
    if (base === null) return '';
    const target = routeFor(box, (await appFacts(box.row.manifestId)).routes, row, producer);
    try {
      return (
        (await deps.signInLinks.mint({
          appKey: box.appKey,
          connectionId: box.connectionId,
          table: recipient.table,
          pk: { [key]: id },
          email: current,
          base,
          now: ctx.now,
          ...(target === undefined ? {} : { to: target }),
        })) ?? ''
      );
    } catch (error) {
      deps.logger?.warn({ err: error, appKey: box.appKey }, 'a sign-in link could not be made; the email goes without one');
      return '';
    }
  }

  /** One row: its message queued, or the reason it is not. */
  async function deliver(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable; zone: string; currency: string | null; now: number },
    row: Row,
  ): Promise<Outcome> {
    const cols = box.definition.columns;
    const kind = String(row[cols.kind] ?? '');
    const producer = producerOf(box.definition, kind);
    const { addressed, to, lookedUp } = await addressOf(ctx, box, producer, row);
    if (!plausibleAddress(to)) return { status: 'skipped', error: 'No email on file' };
    if (reservedAddress(to)) return { status: 'skipped', error: 'A reserved address (for examples and tests)' };
    const templateKey = box.definition.kinds[kind];
    if (templateKey === undefined) return { status: 'failed', error: sentence(`No email is set for "${kind}"`) };

    const own = cols.language === undefined ? undefined : row[cols.language];
    // The row's own language first; for a row addressed now, the one looked up with the address.
    const language = typeof own === 'string' && own !== '' ? own : (addressed?.language ?? undefined);
    const locale =
      (typeof language === 'string' && language !== '' ? negotiateLocale(language.replace(/_/g, '-')) : null) ?? (await recipientLocale(deps.meta, null));
    const template = await resolveEmailTemplate(deps.meta, templateKey, locale);
    if (template === null) return { status: 'failed', error: 'The email is switched off, or has no text' };
    const text = (column: string | undefined) => {
      const value = column === undefined ? undefined : row[column];
      return typeof value === 'string' && value.trim() !== '' ? value : undefined;
    };
    const override = { subject: text(cols.subjectOverride), body: text(cols.bodyOverride) };
    // A person's wording replaces the blocks; the template's own are sent only without it.
    if (override.body === undefined && (template.blocks as { block?: unknown }[]).some((block) => block.block === 'email.html')) {
      return { status: 'failed', error: 'The email has an HTML block, which cannot carry what a person typed' };
    }

    // The nearest template language writes the words; the recipient's own tag the clock.
    const forms = valueForms({ locale: formatTag(typeof language === 'string' ? language : null, locale), zone: ctx.zone, currency: ctx.currency, now: ctx.now });
    const vars = await variables(box, { ...ctx, forms }, row, addressed);
    const reads = JSON.stringify([template.subject, template.blocks, template.footer, override]).includes('signInLink');
    vars['signInLink'] = reads ? await signInLink(box, ctx, row, to.trim(), addressed, producer) : '';
    const key = ctx.outbox.primaryKey[0];
    const report: EmailSendReport | undefined =
      key === undefined
        ? undefined
        : { app: box.appKey, connectionId: box.connectionId, table: ctx.outbox.id, pk: { [key]: row[key] as string | number }, sentAt: ctx.now };
    const job = await enqueueEmail(
      { meta: deps.meta, logger: deps.logger === undefined ? undefined : { info: () => undefined, warn: deps.logger.warn.bind(deps.logger) }, secret: deps.secret },
      { to: to.trim(), templateKey, locale, vars, report, ...(override.subject === undefined && override.body === undefined ? {} : { override }) },
    );
    if (job === null) return { status: 'failed', error: 'Email is not set up on this server' };
    if (!lookedUp || (typeof row[cols.to] === 'string' && (row[cols.to] as string).trim() === to.trim())) return { status: 'sent', error: null };
    return { status: 'sent', error: null, to: to.trim(), ...(typeof language === 'string' && language !== '' && language !== own ? { language } : {}) };
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
    const zone = tenant?.timezone ?? 'UTC';
    const due = cols.due === undefined ? undefined : outbox.columns.get(cols.due);
    /**
     * Sent already: it says when it went and records no failure. (A message
     * that failed for good keeps when it was tried, with the reason, and a
     * person may queue it again.)
     */
    const sentBefore = (row: Row): boolean =>
      cols.sentAt !== undefined &&
      row[cols.sentAt] !== null &&
      row[cols.sentAt] !== undefined &&
      (cols.error === undefined || row[cols.error] === null || row[cols.error] === undefined || row[cols.error] === '');
    const settled: Row[] = [];
    await withNamedLock({ db: handle.db, dialect: handle.dialect }, `outbox|${box.connectionId}|${box.appKey}`, 'CAPACITY_BUSY', async (db) => {
      let query = db.selectFrom(outbox.id as never).selectAll().where(cols.status as never, '=', 'queued' as never);
      // Only what has come due: a batch whose window is open, a message for a later day, wait.
      if (due !== undefined) {
        const spelled = normalizeWriteValue(due, new Date(now).toISOString());
        query = query.where((eb) => eb.or([eb(sql.ref(due.name), 'is', null), eb(sql.ref(due.name), '<=', spelled)]));
      }
      const rows = (await query.orderBy(key as never).limit(OUTBOX_BATCH).execute()) as Row[];
      // Judged again, all together, just before they go.
      const verdicts = await verdictsFor({ db, view, outbox, definition: box.definition, zone, read: settingReader(deps.meta, db), now }, rows, 'send');
      for (const row of rows) {
        const values: Row = {};
        const verdict = verdicts.get(row);
        if (sentBefore(row)) {
          // Sent already, and put back to queued by a door that skipped the moves' check.
          deps.logger?.warn({ appKey: box.appKey, pk: row[key] }, 'a sent app email was queued again; it is not sent twice');
          values[cols.status] = 'sent';
        } else if (verdict?.skip !== undefined) {
          values[cols.status] = 'skipped';
          if (cols.skipReason !== undefined) values[cols.skipReason] = verdict.skip;
          else if (cols.error !== undefined) values[cols.error] = skipSentence(verdict.skip);
        } else if (verdict?.due !== undefined && verdict.due !== null && due !== undefined) {
          values[due.name] = normalizeWriteValue(due, new Date(verdict.due).toISOString());
        } else {
          let outcome: Outcome;
          try {
            outcome = await deliver(box, { db, view, outbox, zone, currency: tenant?.currency ?? null, now }, row);
          } catch (error) {
            deps.logger?.warn({ err: error, appKey: box.appKey }, 'an app email could not be prepared');
            outcome = { status: 'failed', error: 'The email could not be prepared' };
          }
          values[cols.status] = outcome.status;
          if (cols.error !== undefined) values[cols.error] = outcome.error;
          if (cols.sentAt !== undefined && outcome.status === 'sent') values[cols.sentAt] = new Date(now).toISOString();
          if (outcome.to !== undefined) values[cols.to] = outcome.to;
          if (outcome.language !== undefined && cols.language !== undefined) values[cols.language] = outcome.language;
        }
        const result = await deps.writes.update({
          target: { connectionId: box.connectionId, view, table: outbox, db, dialect: handle.dialect },
          pk: { [key]: row[key] },
          values,
          context: outboxContext(box.appKey),
          // Only while it is still queued: nobody else has settled it meanwhile.
          refine: (query) => query.where(sql.ref(cols.status), '=', 'queued'),
          skipIfNone: true,
          announce: async () => {},
        });
        if (result.count > 0 && result.after !== null) settled.push(result.after);
      }
    });
    for (const row of settled) deps.announce?.(box.connectionId, outbox, row);
    // The status is committed: now the changes a sent message makes.
    await effects(box, view, now, settled);
    return settled.length;
  }

  /**
   * The `onSent` changes of sent messages: the ones just sent, and — where
   * the outbox keeps `effect_at` and `effect_error` — every one sent in the
   * last day with neither, so a change that failed for a passing reason is
   * tried again by the sweep. A refusal is written on the message and never
   * tried again; nothing here throws.
   */
  async function effects(box: LiveOutbox, view: SnapshotView, now: number, justSent: readonly Row[]): Promise<void> {
    const definition = box.definition;
    const cols = definition.columns;
    const kinds = new Set((definition.producers ?? []).flatMap((producer) => (producer.onSent === undefined ? [] : [producer.kind])));
    if (kinds.size === 0) return;
    const outbox = view.table(definition.table);
    const key = outbox.primaryKey[0];
    if (key === undefined) return;
    const handle = await deps.manager.data(box.connectionId);
    const marks = cols.effectAt !== undefined && cols.effectError !== undefined;
    let rows: Row[] = justSent.filter((row) => row[cols.status] === 'sent' && kinds.has(String(row[cols.kind])));
    if (marks && cols.sentAt !== undefined) {
      const sentAt = outbox.columns.get(cols.sentAt);
      const since = sentAt === undefined ? new Date(now - EFFECT_RETRY_MS).toISOString() : normalizeWriteValue(sentAt, new Date(now - EFFECT_RETRY_MS).toISOString());
      rows = (await handle.db
        .selectFrom(outbox.id as never)
        .selectAll()
        .where(cols.status as never, '=', 'sent' as never)
        .where(cols.kind as never, 'in', [...kinds] as never)
        .where(cols.effectAt! as never, 'is', null as never)
        .where(cols.effectError! as never, 'is', null as never)
        .where(cols.sentAt as never, '>=', since as never)
        .orderBy(key as never)
        .limit(OUTBOX_BATCH)
        .execute()) as Row[];
    } else if (marks) {
      rows = rows.filter((row) => row[cols.effectAt!] === null && row[cols.effectError!] === null);
    }
    for (const row of rows) {
      const producer = (definition.producers ?? []).find((candidate) => candidate.kind === row[cols.kind] && candidate.onSent !== undefined);
      if (producer?.onSent === undefined) continue;
      let mark: Row;
      try {
        const refused = await effect(box, view, handle, producer, row);
        mark = refused === null ? { [cols.effectAt ?? '']: new Date(now).toISOString() } : { [cols.effectError ?? '']: sentence(refused) };
      } catch (error) {
        // Not a refusal: the database, the network. Tried again by the next sweep.
        deps.logger?.warn({ err: error, appKey: box.appKey }, 'the change an app email makes once sent failed; it is tried again');
        continue;
      }
      if (!marks) continue;
      const result = await deps.writes.update({
        target: { connectionId: box.connectionId, view, table: outbox, db: handle.db, dialect: handle.dialect },
        pk: { [key]: row[key] },
        values: mark,
        context: outboxContext(box.appKey),
        refine: (query) => query.where(sql.ref(cols.effectAt!), 'is', null).where(sql.ref(cols.effectError!), 'is', null),
        skipIfNone: true,
        announce: async () => {},
      });
      if (result.count > 0 && result.after !== null) deps.announce?.(box.connectionId, outbox, result.after);
    }
  }

  /**
   * One `onSent` change, through the ordinary write: the row the message is
   * about, or the row its foreign key names. Null when made (or when there is
   * nothing to change: the invoice names no project); the refusal's own
   * words when the write path refused it (the project is already done).
   */
  async function effect(
    box: LiveOutbox,
    view: SnapshotView,
    handle: Awaited<ReturnType<ConnectionManager['data']>>,
    producer: OutboxProducer,
    row: Row,
  ): Promise<string | null> {
    const onSent = producer.onSent!;
    const aboutId = referenced(view, box.definition.table, producer.link);
    const about = await rowOf(handle.db, view, aboutId, row[producer.link]);
    if (aboutId === undefined || about === null) return 'The row this message is about is gone';
    const table = view.table(onSent.table);
    const key = table.primaryKey[0];
    if (key === undefined) return 'The row to change has no single key';
    const id = onSent.via === undefined ? about[view.table(aboutId).primaryKey[0] ?? ''] : about[onSent.via];
    // Nothing linked: nothing to change.
    if (id === null || id === undefined) return null;
    const before = await rowOf(handle.db, view, table.id, id);
    if (before === null) return 'The row to change is gone';
    const values = Object.fromEntries(
      Object.entries(onSent.set).map(([column, value]) => {
        const resolved = table.columns.get(column);
        return [column, resolved === undefined ? value : normalizeWriteValue(resolved, value)];
      }),
    );
    const context = outboxContext(box.appKey);
    let outcome;
    try {
      outcome = await deps.writes.update({
        target: { connectionId: box.connectionId, view, table, db: handle.db, dialect: handle.dialect },
        pk: { [key]: id },
        values,
        before,
        context,
        announce: async () => {},
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) return error.message;
      throw error;
    }
    if (outcome.count === 0 || outcome.after === null) return 'The row to change is gone';
    // Announced like any write: the screens, the rules, the other producers.
    deps.announce?.(box.connectionId, table, outcome.after);
    await deps
      .emit?.({
        connectionId: box.connectionId,
        table,
        action: 'update',
        entity: { connectionId: box.connectionId, table: table.id, pk: { [key]: id }, label: String(id) },
        before,
        after: outcome.after,
        origin: 'automation',
        hops: context.hops,
      })
      .catch((error: unknown) => deps.logger?.warn({ err: error, appKey: box.appKey }, 'the change an app email made was not announced'));
    return null;
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
      context: outboxContext(report.app),
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
 * How an app's own notices speak for it, from its settings row: `name` is what
 * its emails are signed with (a sign-in code sent through the app's own key
 * too), `phone` the number a person is told to ring (the notice to an old
 * address after a change of email). Each is null when the app's outbox
 * declares no such column, the row holds nothing there, or on any doubt —
 * and the caller then says what it said before.
 */
export async function appContact(
  meta: MetaDb,
  manager: ConnectionManager,
  appKey: string,
  connectionId: string,
): Promise<{ name: string | null; phone: string | null }> {
  const none = { name: null, phone: null };
  try {
    const stored = await appOutboxesRepo(meta).findByApp(appKey);
    if (stored === null || stored.connectionId !== connectionId) return none;
    const settings = (JSON.parse(stored.definition) as LiveOutbox['definition']).settings;
    if (settings === undefined || (settings.name === undefined && settings.phone === undefined)) return none;
    const { db } = await manager.data(connectionId);
    const row = (await db.selectFrom(settings.table as never).selectAll().limit(1).executeTakeFirst()) as Row | undefined;
    // One line of text each: a stray line break would split the sentence it sits in.
    const text = (column: string | undefined): string | null => {
      const value = column === undefined ? undefined : row?.[column];
      const line = typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : '';
      return line === '' ? null : line;
    };
    return { name: text(settings.name), phone: text(settings.phone) };
  } catch {
    return none;
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
