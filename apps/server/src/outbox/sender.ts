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
 * A name nothing fills — no row has it, the row has no such link, or the
 * column is kept from emails — is never sent as `{{…}}`: the row is `failed`,
 * with a sentence naming the variable. It is a mistake in the template (or a
 * row missing what it needs), and a message that says so gets fixed; a mail
 * that says "open the handover: …#{{project.share_token}}" has already gone.
 * What every message may read is always filled, empty when there is nothing:
 * the recipient's name (a client with none on file is greeted "Hello ,"
 * rather than not greeted at all), the practice's columns without a settings
 * row, a visit's time range without an end.
 *
 * ── A CODE ─────────────────────────────────────────────────────────────────
 * The code a shared link opens a row with (a project's `share_token`: a
 * `claim: { by: 'token' }`, `public-api/share-codes.ts`) opens a page to
 * whoever holds it, so an email carries one only to the person it belongs
 * to: the message goes to the address the recipient's own row keeps (as the
 * sign-in link does), and the row the code is on is that person's — it is
 * their row, or it links to it by the link the recipient is named by
 * (`project.client_id`). A message a person addressed by hand to another
 * address, one that links one client and another client's project, or one
 * sent to a setting's address carries no such code: it fails, with a
 * sentence naming the variable, and never hands a link to someone it does not
 * belong to. The practice's settings row is nobody's, and its links' codes
 * never go. A code no link opens anything with — a booking's reference, which
 * a receipt prints for whoever the desk sends it to — is printed like any
 * other value.
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
 * every sample address uses (`skipped`); a row the app's sample ledger lists,
 * whatever its address (`skipped`); a template with an HTML block, whose
 * values would go out unescaped with what a stranger typed in them
 * (`failed`); anything of an app that is switched off (left `queued` until
 * it is switched on).
 *
 * ── WHEN ───────────────────────────────────────────────────────────────────
 * A `queued` row goes once its due moment has come (a row with none goes at
 * once): a batched message waits for its window to close, and a message a
 * producer queued for later waits for its day. A `held` row never goes until
 * a person approves it — and approving one whose day is still ahead, or was
 * never worked out, sends it now. A row an import or an undo brings in is
 * never `queued` (`moves.ts`): it waits for a person like a held one. Just
 * before a row goes it is judged again, as the minute scan judges
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
 * ── A DOCUMENT IT CARRIES ──────────────────────────────────────────────────
 * A template that says `attach: { kind, link }` carries a document of the row
 * that link names: the app's profile of that kind draws it (or hands back the
 * one already drawn while the row is unchanged), right after the row is
 * claimed and before its email is queued. The PDF where the add-on made one,
 * else the HTML print copy (text a PDF cannot set: Arabic, Chinese). No
 * document — the add-on detached, its feature off, the add-on refusing, the
 * file too large — and the message is `failed`, saying why: it never goes
 * without what it was meant to carry.
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
import { guestBase as guestBaseOf } from '../public-api/guest-base.js';
import { shareCodesOn, type ShareCodes } from '../public-api/share-codes.js';
import type { AppManifest, OutboxProducer } from '@adminium/manifest';
import { addOnSettingsRepo, appOutboxesRepo, appTablesRepo, connectionTenantConfig, filesRepo, jobsRepo, overridesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { resolveColumnOptions, resolveEnumLabels, type EffectiveColumn } from '../connections/effective-schema.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { slotInstant } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RecordWriteService, UpdateRecordInput } from '../crud/write-service.js';
import { bindWriteValue, normalizeWriteValue } from '../crud/write-values.js';
import { resolveEmailTemplate } from '../email/builtins.js';
import { appDocumentOff, appProfileFor } from '../documents/app-documents.js';
import { renderDocument, type RenderDeps } from '../documents/render.js';
import { enqueueEmail, withOverride, type EmailSendReport, type EnqueueEmailInput } from '../email/send.js';
import type { EmailSendAttachmentRef } from '../email/types.js';
import { AppError } from '../errors.js';
import { bcp47, formatTag, proseNumber } from '../i18n/bcp47.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import type { JobRegistry } from '../jobs/registry.js';
import { negotiateLocale } from '../plugins/surfaces.js';
import { QR_MAX_BYTES, qrCarries } from '../qr/index.js';
import type { EffectsAnnouncement } from '../states/effects.js';
import { outboxContext, outboxEffectContext } from './context.js';
import { usableLanguage } from './language.js';
import { isSampleRow, verdictsFor, type LiveOutbox, type OutboxLogger } from './producers.js';
import { addressFor, plausibleAddress, referenced, rowOf, type Addressed } from './recipient.js';
import type { SignInLinkMinter } from './sign-in-link.js';
import { producerOf, settingReader, skipSentence } from './timing.js';

/** The job that sends one app's queued rows now. */
export const OUTBOX_SEND_JOB_KIND = 'app-outbox-send';
/** The retry of the change a sent message makes (`onSent`), when making it failed for a passing reason. */
export const OUTBOX_EFFECT_JOB_KIND = 'app-outbox-effect';
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
  /** The document each of its templates carries, by template key. */
  attach: Record<string, { kind: string; link: string }>;
  /** The manifest as installed, for whether a document is switched on. */
  manifest: AppManifest | null;
}
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
  /** The host an app's staff side is served on, when the operator mapped one (`{{staff_url}}`). */
  staffHostFor?: ((appKey: string) => Promise<string | undefined>) | undefined;
  /** Tell the screens watching the log that a row changed. */
  announce?: ((connectionId: string, table: ResolvedTable, row: Row) => void) | undefined;
  /**
   * A row an `onSent` change wrote, as every write is announced: the rules,
   * the other producers (a paused project's notice) and the screens hear it.
   */
  emit?: ((event: RecordWriteEvent) => Promise<void>) | undefined;
  /**
   * The rows an `onSent` change's move moved too (`states.effects`), told as
   * changes of their own — audited as the outbox's, heard by the rules and
   * the screens — as every write's effects are (`states/effects.ts`).
   */
  announceEffects?: ((input: EffectsAnnouncement) => Promise<void>) | undefined;
  /**
   * The document pipeline, for an email that carries a document (a
   * template's `attach`); with none, such an email fails and says so.
   */
  documents?: (() => RenderDeps | undefined) | undefined;
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
  /** The retry job of a sent message's change. */
  retryEffect(input: { app: string; pk: string | number; sentAt: number }): Promise<void>;
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
type Outcome = { status: 'failed' | 'skipped'; error: string | null };

/** A row made ready to go: its email, and what the claim writes back (the address and language looked up). */
/** Whose codes an email may carry: one row of the recipient's table. */
interface CodeHolder {
  table: string;
  id: unknown;
}

interface Prepared {
  to: string;
  email: Omit<EnqueueEmailInput, 'report' | 'dedupeKey'>;
  recordTo?: string;
  language?: string;
}

type AnyUpdateQuery = Parameters<NonNullable<UpdateRecordInput['refine']>>[0];

/** Every `{{name}}` a template reads, wherever it is written in it. */
export function placeholders(parts: readonly unknown[]): Set<string> {
  return new Set([...JSON.stringify(parts).matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]!));
}

/**
 * Why an email that names a value nobody holds is not sent: a column hidden
 * from emails (a secret, a personal column of a linked row), a link the row
 * does not have, a name no row has. The variable is named, so the template —
 * or the row — is what gets fixed.
 */
export function unfilledSentence(names: readonly string[]): string {
  const listed = names.slice(0, 3).map((name) => `{{${name}}}`).join(', ');
  const more = names.length > 3 ? ` and ${String(names.length - 3)} more` : '';
  return sentence(`Not sent: nothing fills ${listed}${more}`);
}

/**
 * Why an email that would carry a code to someone it does not belong to is
 * not sent: the address is not the one on file of the person whose row holds
 * the code.
 */
export function codeWithheldSentence(names: readonly string[]): string {
  const listed = names.slice(0, 2).map((name) => `{{${name}}}`).join(', ');
  return sentence(`Not sent: ${listed} is a code, and goes only to the address on file of the person it belongs to`);
}

/** Why an email whose list of rows cannot be read is not sent: never without its list. */
export const LIST_UNREADABLE = 'Not sent: the email lists rows from a table or link that is not there';

/** Whether a value fills a QR code: empty (no code is drawn), or text a QR code carries. */
const fitsQr = (value: string | undefined): boolean => value === undefined || value === '' || qrCarries(value);

/** A whole `{{<name>.qr}}`: what an image draws as a QR code. */
const QR_WHOLE = /^\{\{\s*([A-Za-z0-9_.-]+\.qr)\s*\}\}$/;

/** The names a template's blocks draw as QR codes: an image's `qr`, a list's row image. */
function drawnQrCodes(blocks: readonly Record<string, unknown>[]): Set<string> {
  const out = new Set<string>();
  for (const block of blocks) {
    const data = (typeof block['data'] === 'object' && block['data'] !== null ? block['data'] : {}) as Record<string, unknown>;
    const row = (typeof data['row'] === 'object' && data['row'] !== null ? data['row'] : {}) as Record<string, unknown>;
    const source = block['block'] === 'email.image' ? data['qr'] : block['block'] === 'email.rows' ? row['image'] : undefined;
    const found = typeof source === 'string' ? QR_WHOLE.exec(source.trim()) : null;
    if (found !== null) out.add(found[1]!);
  }
  return out;
}

/** Why an email whose QR code would hold too much text is not sent. */
export function qrTooLongSentence(names: readonly string[]): string {
  const listed = names.slice(0, 2).map((name) => `{{${name}}}`).join(', ');
  return sentence(`Not sent: ${listed} holds more than a QR code carries (${String(QR_MAX_BYTES)} bytes)`);
}

/** The same address, as a sign-in link or a code is sent to it: the same characters, or the same ASCII letters in another case. */
function sameAddress(stored: string, to: string): boolean {
  const ascii = (text: string) => /^[\x21-\x7e]+$/.test(text);
  return stored === to || (ascii(stored) && ascii(to) && stored.toLowerCase() === to.toLowerCase());
}

/** A person's wording with every `{{name}}` the template does not read taken out. */
export function onlyReads(text: string, reads: ReadonlySet<string>): string {
  return text.replaceAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (whole, name: string) => (reads.has(name) ? whole : ''));
}

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
        [`${prefix}.days_since`]: proseNumber(daysBetween(day, today), tag),
      };
    },
    range(from: Date, to: Date): string {
      return time.formatRange(from, to);
    },
    /** A number as the language writes one, exactly as stored and no longer: "8.25", never "8.250". */
    number(value: unknown): string {
      const exact = decimalText(value);
      return exact === null ? String(value ?? '') : new Intl.NumberFormat(tag, { maximumFractionDigits: 20 }).format(exact as unknown as number);
    },
    /** A number of hundredths as a percentage: 8.25 → "8.25%" ("8,25 %" in German). */
    percent(value: unknown): string {
      const exact = decimalText(value);
      return exact === null ? String(value ?? '') : new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 20 }).format(`${exact}E-2` as unknown as number);
    },
    /** A time of day kept as text (`15:00`) in the reader's clock: "3:00 PM" in the US, "15:00" in Britain. */
    clock(value: unknown): string {
      const found = /^([01]?\d|2[0-3]):([0-5]\d)/.exec(String(value ?? '').trim());
      if (found === null) return String(value ?? '');
      return on({ hour: 'numeric', minute: '2-digit' }, 'UTC').format(new Date(Date.UTC(2000, 0, 1, Number(found[1]), Number(found[2]))));
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

/** A stored number as exact decimal text (a driver's `"8.250"`, SQLite's `8.25`), or null for one that is not a number. */
function decimalText(value: unknown): string | null {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(text) ? text : null;
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

/** A choice's label in the message's language (`card` → "Karte"), from the labels the app gave the column. */
type ChoiceLabels = (tableId: string, column: string, value: string) => string | undefined;

/**
 * The labels an app gave its choice columns on a connection, each read in
 * one language: the enum labels and a column's own listed values, in every
 * language the app shipped them.
 */
async function choiceLabels(meta: MetaDb, connectionId: string): Promise<(locale: string) => ChoiceLabels> {
  const rows = (await overridesRepo(meta).listForConnection(connectionId, { status: 'active' })).filter(
    (row) => (row.op === 'column.enumLabels' || row.op === 'column.options') && row.columnName !== null,
  );
  return (locale) => {
    const resolved = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const key = `${row.tableName}\u0000${row.columnName!}`;
      const into = resolved.get(key) ?? {};
      if (row.op === 'column.enumLabels') Object.assign(into, resolveEnumLabels((row.value as { labels?: unknown }).labels, locale));
      else {
        const options = resolveColumnOptions(row.value, locale);
        if ('values' in options) for (const item of options.values) if (item.label !== undefined && item.label !== '') into[item.value] = item.label;
      }
      resolved.set(key, into);
    }
    return (tableId, column, value) => resolved.get(`${tableId}\u0000${column}`)?.[value];
  };
}

/** What a template reads, and the codes held back from it. */
interface WrittenValues {
  vars: Record<string, string>;
  withheld: Set<string>;
}

/**
 * Whether a row is the code holder's: their own, or one that links to them —
 * by the link the outbox names its recipient by (`client_id`) where the row
 * has one, else by every link it has to their table, all agreeing. A project
 * with an owner and a referrer is the owner's.
 */
function holdersOf(box: LiveOutbox, view: SnapshotView, holder: CodeHolder | null): (table: ResolvedTable, record: Row) => boolean {
  return (table, record) => {
    if (holder === null) return false;
    const key = table.primaryKey[0];
    if (table.id === holder.table && key !== undefined && String(record[key]) === String(holder.id)) return true;
    const links = [...table.columns.keys()].filter((column) => referenced(view, table.id, column) === holder.table);
    const via = box.definition.recipient.via;
    const deciding = links.includes(via) ? [via] : links;
    return deciding.length > 0 && deciding.every((column) => record[column] !== null && record[column] !== undefined && String(record[column]) === String(holder.id));
  };
}

const NUMBER_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);
/** A wall time of day kept as text: `15:00`, `09:30:00`. */
const CLOCK_TEXT = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/**
 * The forms a column's value is read in besides itself, by what the column
 * holds: a number as a number, a percentage and an amount of money in the
 * message's language (`{{order.tax_rate.percent}}` is "8.25%" on every engine,
 * never "8.250"); a choice by its label (`{{order.paid_method.label}}` is
 * "Card", not "card"); a time of day kept as text in the reader's clock; and a
 * code as its QR code (`.qr`, drawn at delivery). Every form is there, empty,
 * when the value is.
 */
function extraForms(
  column: { logicalType: string; name: string },
  effective: EffectiveColumn | undefined,
  value: unknown,
  forms: ReturnType<typeof valueForms>,
  currency: string | null,
  /** A choice's label in the message's language, when the app gave one. */
  labelled?: (value: string) => string | undefined,
): Record<string, string> {
  const empty = value === null || value === undefined;
  const out: Record<string, string> = {};
  if (NUMBER_TYPES.has(column.logicalType) || effective?.semantics?.primary === 'money') {
    out['number'] = empty ? '' : forms.number(value);
    out['percent'] = empty ? '' : forms.percent(value);
    out['money'] = empty ? '' : forms.money(value, currency);
  }
  const hasLabels = effective?.enumLabels !== undefined || (effective?.options !== undefined && 'values' in effective.options) || column.logicalType === 'enum';
  if (hasLabels) out['label'] = empty ? '' : (labelled?.(String(value)) ?? labelOf(effective, String(value)));
  // A time of day kept as text: its clock form; an empty text column reads empty in it too.
  if (column.logicalType === 'time' || (typeof value === 'string' && CLOCK_TEXT.test(value.trim()))) out['time'] = forms.clock(value);
  else if (empty && (column.logicalType === 'text' || column.logicalType === 'varchar')) out['time'] = '';
  if (effective?.code !== undefined) out['qr'] = empty ? '' : String(value);
  return out;
}

/** A choice's label: the column's own label for the value, else the value itself. */
function labelOf(effective: EffectiveColumn | undefined, value: string): string {
  const own = effective?.enumLabels?.[value];
  if (own !== undefined && own !== '') return own;
  const options = effective?.options;
  const item = options !== undefined && 'values' in options ? options.values.find((candidate) => candidate.value === value) : undefined;
  return item?.label !== undefined && item.label !== '' ? item.label : value;
}

/**
 * One row's columns as a template reads them, under `prefix`: every column
 * but a secret one or (outside the settings row) a masked one, each in its
 * forms — and a share code only when the row is the code holder's, else held
 * back by name (with its QR code). A row that keeps its own currency prints
 * its money in it.
 */
function putValues(
  out: WrittenValues,
  ctx: { forms: ReturnType<typeof valueForms>; shareCodes: ShareCodes; labels?: ChoiceLabels | undefined },
  holders: (table: ResolvedTable, record: Row) => boolean,
  prefix: string,
  table: ResolvedTable,
  record: Row,
  settingsRow = false,
): void {
  const { vars, withheld } = out;
  const { forms } = ctx;
  const own = table.columns.has('currency') ? record['currency'] : null;
  const currency = typeof own === 'string' && /^[A-Za-z]{3}$/.test(own.trim()) ? own.trim().toUpperCase() : null;
  // A shared link's code goes only to the person whose row it is on — never from the settings row, which is nobody's.
  // A reference a `code` rule makes that no link opens anything with (a booking's) goes to anyone the message goes to.
  const codes = settingsRow || !holders(table, record) ? (ctx.shareCodes.get(table.id.slice(table.id.lastIndexOf('.') + 1)) ?? new Set<string>()) : new Set<string>();
  if (table.columns.has('starts_at')) vars[`${prefix}.time_range`] = '';
  for (const column of table.columns.values()) {
    if (column.secret || (column.masked && !settingsRow)) continue;
    const name = `${prefix}.${column.name}`;
    if (codes.has(column.name)) {
      withheld.add(name);
      withheld.add(`${name}.qr`);
      continue;
    }
    const value = record[column.name];
    const effective = table.table.columns.find((c) => c.name === column.name);
    const labelled = ctx.labels === undefined ? undefined : (choice: string) => ctx.labels!(table.id, column.name, choice);
    for (const [form, text] of Object.entries(extraForms(column, effective, value, forms, currency, labelled))) vars[`${name}.${form}`] = text;
    if (value === null || value === undefined) {
      vars[name] = '';
      const empty =
        column.logicalType === 'timestamp' || column.logicalType === 'timestamptz'
          ? ['date', 'time', 'day_month', 'relative_day']
          : column.logicalType === 'date'
            ? ['day_month', 'days_since']
            : [];
      for (const form of empty) vars[`${name}.${form}`] = '';
      continue;
    }
    if (column.logicalType === 'timestamp' || column.logicalType === 'timestamptz') Object.assign(vars, forms.instant(name, value));
    else if (column.logicalType === 'date') Object.assign(vars, forms.day(name, value));
    else if (effective?.semantics?.primary === 'money') vars[name] = forms.money(value, currency);
    else vars[name] = value instanceof Date ? value.toISOString() : String(value);
  }
  // A visit's time as a range: to its end, or for its minutes.
  const start = slotInstant(record['starts_at']);
  const end = slotInstant(record['ends_at']) ?? (start === null || !Number.isFinite(Number(record['minutes'])) ? null : new Date(start.getTime() + Number(record['minutes']) * 60_000));
  if (start !== null && end !== null && end > start) vars[`${prefix}.time_range`] = forms.range(start, end);
}

export function createOutboxSender(deps: OutboxSenderDeps): OutboxSender {
  /** Where the app's guest side lives: its own host, else the server's public address, else nowhere. */
  async function guestBase(appKey: string): Promise<string | null> {
    return guestBaseOf({ meta: deps.meta, hostFor: deps.hostFor }, appKey);
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
    const attach: AppFacts['attach'] = {};
    for (const template of (manifest?.['emailTemplates'] as { key?: unknown; attach?: { kind?: unknown; link?: unknown } }[] | undefined) ?? []) {
      const wanted = template.attach;
      if (typeof template.key === 'string' && typeof wanted?.kind === 'string' && typeof wanted.link === 'string') attach[template.key] = { kind: wanted.kind, link: wanted.link };
    }
    const facts: AppFacts = {
      requires: needs.flatMap((need) => (typeof need.key === 'string' ? [need.key] : [])),
      routes: Object.fromEntries(Object.entries(routes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      attach,
      manifest: manifest?.['kind'] === 'app' ? (manifest as unknown as AppManifest) : null,
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

  /** Everything a template may read for one row, and the codes it held back (`{{project.share_token}}`). */
  async function variables(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable; forms: ReturnType<typeof valueForms>; shareCodes: ShareCodes; labels?: ChoiceLabels | undefined },
    row: Row,
    addressed: Addressed | null,
    /** Whose codes the email may carry: the recipient, when it goes to their own address on file; else nobody's. */
    holder: CodeHolder | null,
  ): Promise<{ vars: Record<string, string>; withheld: Set<string> }> {
    const { db, view } = ctx;
    const out: WrittenValues = { vars: {}, withheld: new Set<string>() };
    const { vars, withheld } = out;
    const holders = holdersOf(box, view, holder);
    const put = (prefix: string, table: ResolvedTable, record: Row, settingsRow = false) => putValues(out, ctx, holders, prefix, table, record, settingsRow);

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
    // Always filled — empty with no name on file — so a greeting never stops a message.
    vars['recipient.name'] = '';
    vars['recipient.first_name'] = '';
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
      // The app's own settings row: its phone is the practice's, not a person's. None yet: each is empty.
      put('practice', view.table(settings.table), record ?? {}, true);
      if (record !== undefined && settings.name !== undefined) practiceName = record[settings.name];
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
    // A name a row of the recipient's own fills too (`client.share_token` beside a project's) is not held back.
    for (const name of withheld) if (Object.hasOwn(vars, name)) withheld.delete(name);
    return { vars, withheld };
  }

  /**
   * Whose codes an email may carry: the recipient's, when it goes to the
   * address their own row keeps — the sign-in link's rule. A message to a
   * setting's address, to a person with no row, or to an address somebody
   * typed carries nobody's.
   */
  async function codeHolder(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView },
    row: Row,
    to: string,
    addressed: Addressed | null,
  ): Promise<CodeHolder | null> {
    if (addressed?.bySetting === true) return null;
    const recipient = box.definition.recipient;
    const person = addressed?.person ?? (await rowOf(ctx.db, ctx.view, recipient.table, row[recipient.via]));
    if (person === null) return null;
    const stored = person[recipient.email];
    if (!plausibleAddress(stored) || !sameAddress(stored.trim(), to)) return null;
    const key = ctx.view.table(recipient.table).primaryKey[0];
    const id = key === undefined ? undefined : person[key];
    return id === null || id === undefined ? null : { table: recipient.table, id };
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
   * through the row's own recipient link, and only when the message goes to
   * that person's address AS STORED — the same characters, or the same ASCII
   * letters in another case (the link then goes to the stored spelling). An
   * address that differs in anything else — a look-alike letter that
   * lower-cases to the same text, an old address, one a person typed — gets an
   * empty link. Minted only when the email reads it, so no live link is made
   * for nothing.
   */
  async function signInLink(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; now: number },
    row: Row,
    to: string,
    addressed: Addressed | null,
    producer: OutboxProducer | undefined,
  ): Promise<{ link: string; to: string }> {
    const none = { link: '', to };
    if (deps.signInLinks === undefined || addressed?.bySetting === true) return none;
    const recipient = box.definition.recipient;
    const identity = addressed?.identity ?? (await rowOf(ctx.db, ctx.view, recipient.table, row[recipient.via]));
    if (identity === null) return none;
    const stored = identity[recipient.email];
    if (!plausibleAddress(stored)) return none;
    const exact = stored.trim();
    const ascii = (text: string) => /^[\x21-\x7e]+$/.test(text);
    if (!sameAddress(exact, to)) return none;
    const key = ctx.view.table(recipient.table).primaryKey[0];
    const id = key === undefined ? undefined : identity[key];
    if (key === undefined || (typeof id !== 'string' && typeof id !== 'number')) return none;
    const base = await guestBase(box.appKey);
    if (base === null) return none;
    const target = routeFor(box, (await appFacts(box.row.manifestId)).routes, row, producer);
    try {
      const link = await deps.signInLinks.mint({
        appKey: box.appKey,
        connectionId: box.connectionId,
        table: recipient.table,
        pk: { [key]: id },
        email: ascii(exact) ? exact.toLowerCase() : exact,
        base,
        now: ctx.now,
        ...(target === undefined ? {} : { to: target }),
      });
      return link === null ? none : { link, to: exact };
    } catch (error) {
      deps.logger?.warn({ err: error, appKey: box.appKey }, 'a sign-in link could not be made; the email goes without one');
      return none;
    }
  }

  /**
   * The rows an `email.rows` block lists for one message (an order's
   * tickets): the child rows of the row its link names, filtered, in order,
   * at most its limit — each read as a template reads a row (`row.*`, one hop
   * through its own links, `row.<join>` for each list one level down), its
   * share codes held back unless the row is the code holder's. Null when the
   * block's source cannot be read — a link the outbox does not have, a table
   * that is not there (renamed since), a column it names that the table lacks
   * — so the email is never sent without its list; a source that is there
   * and holds no rows is an empty list, and sends.
   */
  async function rowsFor(
    box: LiveOutbox,
    ctx: { db: Kysely<SourceDatabase>; view: SnapshotView; outbox: ResolvedTable; forms: ReturnType<typeof valueForms>; shareCodes: ShareCodes; labels?: ChoiceLabels | undefined },
    message: Row,
    data: Record<string, unknown>,
    holder: CodeHolder | null,
  ): Promise<WrittenValues[] | null> {
    const { db, view } = ctx;
    const from = (typeof data['from'] === 'object' && data['from'] !== null ? data['from'] : {}) as {
      link?: string;
      table?: string;
      via?: string;
      orderBy?: string;
      where?: { column: string; in: unknown[] };
      unless?: string;
      limit?: number;
    };
    const column = from.link === undefined ? undefined : box.definition.links?.[from.link];
    if (column === undefined || !ctx.outbox.columns.has(column) || from.table === undefined || from.via === undefined) return null;
    let child: ResolvedTable;
    try {
      child = view.table(from.table);
    } catch {
      return null;
    }
    const named = [from.via, ...(from.where === undefined ? [] : [from.where.column]), ...(from.unless === undefined ? [] : [from.unless])];
    if (named.some((name) => !child.columns.has(name))) return null;
    const joins = (typeof data['joins'] === 'object' && data['joins'] !== null ? data['joins'] : {}) as Record<string, { table: string; via: string; column: string; orderBy?: string; separator?: string }>;
    const joinTables = new Map<string, ResolvedTable>();
    for (const [name, join] of Object.entries(joins)) {
      try {
        joinTables.set(name, view.table(join.table));
      } catch {
        return null;
      }
      if (!joinTables.get(name)!.columns.has(join.via) || !joinTables.get(name)!.columns.has(join.column)) return null;
    }
    const parent = message[column];
    // The message names no row to list from: its list is empty.
    if (parent === null || parent === undefined) return [];
    let query = db.selectFrom(child.id as never).selectAll().where(from.via as never, '=', parent as never);
    if (from.where !== undefined && from.where.in.length > 0) {
      // A yes or no as a word every engine knows (SQLite binds none).
      query = query.where(from.where.column as never, 'in', from.where.in.map((value) => (typeof value === 'boolean' ? sql.lit(value) : value)) as never);
    }
    // A row whose bool is true is left out (a ticket handed on): kept while it is false or empty. `false` is a word all three engines know.
    if (from.unless !== undefined) query = query.where(sql<boolean>`(${sql.ref(from.unless)} is null or ${sql.ref(from.unless)} = ${sql.lit(false)})`);
    if (from.orderBy !== undefined && child.columns.has(from.orderBy)) query = query.orderBy(from.orderBy as never);
    for (const key of child.primaryKey) query = query.orderBy(key as never);
    const records = (await query.limit(Math.min(50, Math.max(1, from.limit ?? 50))).execute()) as Row[];
    if (records.length === 0) return [];
    // Each list one level down, for every row at once: at most twenty names a row.
    const joined = new Map<string, Map<string, string[]>>();
    const key = child.primaryKey[0];
    for (const [name, join] of Object.entries(joins)) {
      const byRow = new Map<string, string[]>();
      joined.set(name, byRow);
      if (key === undefined) continue;
      const table = joinTables.get(name)!;
      let names = db.selectFrom(table.id as never).select([join.via, join.column] as never).where(join.via as never, 'in', records.map((record) => record[key]) as never);
      if (join.orderBy !== undefined && table.columns.has(join.orderBy)) names = names.orderBy(join.orderBy as never);
      for (const pk of table.primaryKey) names = names.orderBy(pk as never);
      for (const found of (await names.execute()) as Row[]) {
        const value = found[join.column];
        if (value === null || value === undefined || String(value).trim() === '') continue;
        const owner = String(found[join.via]);
        const list = byRow.get(owner) ?? [];
        if (list.length < 20) list.push(String(value).trim());
        byRow.set(owner, list);
      }
    }
    const holders = holdersOf(box, view, holder);
    const hops = new Map<string, Row | null>();
    const out: WrittenValues[] = [];
    for (const record of records) {
      const one: WrittenValues = { vars: {}, withheld: new Set<string>() };
      putValues(one, ctx, holders, 'row', child, record);
      // One hop through the row's own links: `{{row.ticket_type.name}}` through `ticket_type_id`.
      for (const link of child.columns.keys()) {
        if (!link.endsWith('_id') || record[link] === null || record[link] === undefined) continue;
        const targetId = referenced(view, child.id, link);
        if (targetId === undefined) continue;
        const cacheKey = `${targetId}\u0000${String(record[link])}`;
        if (!hops.has(cacheKey)) hops.set(cacheKey, await rowOf(db, view, targetId, record[link]));
        const target = hops.get(cacheKey) ?? null;
        if (target !== null) putValues(one, ctx, holders, `row.${link.slice(0, -'_id'.length)}`, view.table(targetId), target);
      }
      for (const [name, join] of Object.entries(joins)) {
        one.vars[`row.${name}`] = (joined.get(name)?.get(String(key === undefined ? '' : record[key])) ?? []).join(join.separator ?? ', ');
      }
      for (const name of one.withheld) if (Object.hasOwn(one.vars, name)) one.withheld.delete(name);
      out.push(one);
    }
    return out;
  }

  /**
   * One row, made ready to go: where to, in which words — or the reason it
   * will not go (`skipped`, `failed`). Nothing is written and nothing queued
   * here: the row is claimed, and its message queued, only once this is done.
   */
  async function prepare(
    box: LiveOutbox,
    ctx: {
      db: Kysely<SourceDatabase>;
      view: SnapshotView;
      outbox: ResolvedTable;
      zone: string;
      currency: string | null;
      now: number;
      shareCodes: ShareCodes;
      /** The app's choice labels on the connection, read in a language. */
      labels?: ((locale: string) => ChoiceLabels) | undefined;
    },
    row: Row,
  ): Promise<Outcome | Prepared> {
    const cols = box.definition.columns;
    const kind = String(row[cols.kind] ?? '');
    const producer = producerOf(box.definition, kind);
    // A message the app's sample brought in is sample data like the rest: never sent, whatever address it carries.
    const key = Object.fromEntries(ctx.outbox.primaryKey.map((column) => [column, row[column]]));
    if (await isSampleRow(deps.meta, ctx.db, box, ctx.outbox, key)) return { status: 'skipped', error: 'Sample data (never sent)' };
    const { addressed, to: found, lookedUp } = await addressOf(ctx, box, producer, row);
    if (!plausibleAddress(found)) return { status: 'skipped', error: 'No email on file' };
    if (reservedAddress(found)) return { status: 'skipped', error: 'A reserved address (for examples and tests)' };
    const templateKey = box.definition.kinds[kind];
    if (templateKey === undefined) return { status: 'failed', error: sentence(`No email is set for "${kind}"`) };

    const own = cols.language === undefined ? undefined : row[cols.language];
    // The row's own language first, when a message can be written in it; for a row addressed now, the one looked up with the address.
    const language = usableLanguage(own) ?? addressed?.language ?? undefined;
    const locale =
      (typeof language === 'string' && language !== '' ? negotiateLocale(language.replace(/_/g, '-')) : null) ?? (await recipientLocale(deps.meta, null));
    const template = await resolveEmailTemplate(deps.meta, templateKey, locale);
    if (template === null) return { status: 'failed', error: 'The email is switched off, or has no text' };
    // A person's wording may read only what the template itself reads: never
    // another column of a linked row, however it is spelled.
    const reads = placeholders([template.subject, template.preheader, template.blocks, template.footer]);
    // Never a list's row, nor a QR code: those are drawn by the template's own blocks, which the wording replaces.
    const personal = new Set([...reads].filter((name) => !name.startsWith('row.') && !name.endsWith('.qr')));
    const text = (column: string | undefined) => {
      const value = column === undefined ? undefined : row[column];
      return typeof value === 'string' && value.trim() !== '' ? onlyReads(value, personal) : undefined;
    };
    const override = { subject: text(cols.subjectOverride), body: text(cols.bodyOverride) };
    // A person's wording replaces the blocks; the template's own are sent only without it.
    if (override.body === undefined && (template.blocks as { block?: unknown }[]).some((block) => block.block === 'email.html')) {
      return { status: 'failed', error: 'The email has an HTML block, which cannot carry what a person typed' };
    }

    // The template really sent writes the words — US English when the recipient's language has none —
    // and the recipient's own tag in THAT language the clock and the digits: never Arabic digits in an English email.
    const forms = valueForms({ locale: formatTag(typeof language === 'string' ? language : null, template.locale), zone: ctx.zone, currency: ctx.currency, now: ctx.now });
    let to = found.trim();
    const holder = await codeHolder(box, ctx, row, to, addressed);
    // A choice reads its label in the language the template is written in.
    const labels = ctx.labels?.(template.locale);
    const { vars, withheld } = await variables(box, { ...ctx, forms, labels }, row, addressed, holder);
    vars['signInLink'] = '';
    if (reads.has('signInLink')) {
      const minted = await signInLink(box, ctx, row, to, addressed, producer);
      vars['signInLink'] = minted.link;
      to = minted.to;
    }
    // Every name the email will print has its value — or it does not go, rather than go with `{{…}}` in it.
    const sent = withOverride({ subject: template.subject, blocks: template.blocks as readonly Record<string, unknown>[] }, override);
    // The rows each list names (an order's tickets), each row judged the same way: every `{{row.*}}` filled, a code only to its holder.
    const rows: Record<string, Record<string, string>[]> = {};
    // The codes drawn as QR codes (the whole value of an image, a row's image); met in text, a code prints as itself.
    const drawn = drawnQrCodes(sent.blocks);
    for (const block of sent.blocks) {
      if (block['block'] !== 'email.rows' || typeof block['id'] !== 'string') continue;
      const data = typeof block['data'] === 'object' && block['data'] !== null ? (block['data'] as Record<string, unknown>) : {};
      const listed = await rowsFor(box, { ...ctx, forms, labels }, row, data, holder);
      if (listed === null) return { status: 'failed', error: LIST_UNREADABLE };
      const names = [...placeholders([data['row'], data['empty']])].filter((name) => name.startsWith('row.'));
      for (const one of listed) {
        const missing = names.filter((name) => !Object.hasOwn(one.vars, name));
        const held = missing.filter((name) => one.withheld.has(name));
        if (held.length > 0) return { status: 'failed', error: codeWithheldSentence(held) };
        if (missing.length > 0) return { status: 'failed', error: unfilledSentence(missing) };
        const long = [...drawn].filter((name) => name.startsWith('row.') && !fitsQr(one.vars[name]));
        if (long.length > 0) return { status: 'failed', error: qrTooLongSentence(long) };
      }
      rows[block['id']] = listed.map((one) => one.vars);
    }
    const unfilled = [...placeholders([sent.subject, template.preheader, sent.blocks, template.footer])].filter((name) => !name.startsWith('row.') && !Object.hasOwn(vars, name));
    const codes = unfilled.filter((name) => withheld.has(name));
    if (codes.length > 0) return { status: 'failed', error: codeWithheldSentence(codes) };
    if (unfilled.length > 0) return { status: 'failed', error: unfilledSentence(unfilled) };
    // A QR code draws so many bytes of text at most: a longer code is never queued (it could only fail later, after the row reads sent).
    const long = [...drawn].filter((name) => !name.startsWith('row.') && !fitsQr(vars[name]));
    if (long.length > 0) return { status: 'failed', error: qrTooLongSentence(long) };
    const written = typeof row[cols.to] === 'string' ? (row[cols.to] as string).trim() : null;
    return {
      to,
      // The template checked above is the one sent: never resolved again, as it may have been edited meanwhile.
      email: {
        to,
        templateKey,
        locale,
        vars,
        template,
        ...(Object.keys(rows).length === 0 ? {} : { rows }),
        ...(override.subject === undefined && override.body === undefined ? {} : { override }),
      },
      ...(written === to ? {} : { recordTo: to }),
      ...(lookedUp && typeof language === 'string' && language !== '' && language !== own ? { language } : {}),
    };
  }

  /** A write of the outbox's own to one row, only while `still` holds; the row as written, or null. */
  async function settle(
    box: LiveOutbox,
    target: { view: SnapshotView; outbox: ResolvedTable; db: Kysely<SourceDatabase>; dialect: Awaited<ReturnType<ConnectionManager['data']>>['dialect'] },
    pk: Row,
    values: Row,
    still: (query: Parameters<NonNullable<Parameters<RecordWriteService['update']>[0]['refine']>>[0]) => ReturnType<NonNullable<Parameters<RecordWriteService['update']>[0]['refine']>>,
  ): Promise<Row | null> {
    const result = await deps.writes.update({
      target: { connectionId: box.connectionId, view: target.view, table: target.outbox, db: target.db, dialect: target.dialect },
      pk,
      values,
      context: outboxContext(box.appKey, target.outbox.id),
      refine: still,
      skipIfNone: true,
      announce: async () => {},
    });
    return result.count > 0 ? result.after : null;
  }

  /**
   * One app's rows that have come due, each on its own: judged, made ready,
   * then CLAIMED — marked sent in a statement of its own, only while it is
   * still queued as it was read — and only then handed to the mail queue. So
   * a row a person skipped while its email was being made is not sent; two
   * senders never both send one row; and one row that fails (a bad column, a
   * refused write, a broken setting) takes nobody else's status back with it.
   * A crash between the claim and the mail queue loses that one email rather
   * than sending it twice: the row reads sent.
   */
  async function sendBox(box: LiveOutbox, now: number): Promise<number> {
    const view = await deps.viewFor(box.connectionId);
    if (view === null) return 0;
    const handle = await deps.manager.data(box.connectionId);
    const { db, dialect } = handle;
    const outbox = view.table(box.definition.table);
    const key = outbox.primaryKey[0];
    if (key === undefined) return 0;
    const cols = box.definition.columns;
    const tenant = await connectionTenantConfig(deps.meta, box.connectionId);
    const zone = tenant?.timezone ?? 'UTC';
    const due = cols.due === undefined ? undefined : outbox.columns.get(cols.due);
    const target = { view, outbox, db, dialect };
    const at = new Date(now).toISOString();
    /** The codes shared links open rows with here, read once a message is about to be made. */
    let shareCodes: ShareCodes | undefined;
    /** The app's choice labels, likewise. */
    let labels: ((locale: string) => ChoiceLabels) | undefined;
    /**
     * Sent already: it says when it went and records no failure. (A message
     * that failed keeps when it was tried, with the reason, and a person may
     * queue it again.)
     */
    const sentBefore = (row: Row): boolean =>
      cols.sentAt !== undefined &&
      row[cols.sentAt] !== null &&
      row[cols.sentAt] !== undefined &&
      (cols.error === undefined || row[cols.error] === null || row[cols.error] === undefined || row[cols.error] === '');
    /** While the row is still queued as it was read: same address, same wording. */
    const unchanged = (row: Row) => (query: AnyUpdateQuery) => {
      let still = query.where(sql.ref(cols.status), '=', 'queued');
      for (const column of [cols.to, cols.subjectOverride, cols.bodyOverride]) {
        if (column === undefined) continue;
        const value = row[column];
        still = value === null || value === undefined ? still.where(sql.ref(column), 'is', null) : still.where(sql.ref(column), '=', value as string);
      }
      return still;
    };
    const sentAtWindow = (query: AnyUpdateQuery) => {
      let still = query.where(sql.ref(cols.status), '=', 'sent');
      const sentAt = cols.sentAt === undefined ? undefined : outbox.columns.get(cols.sentAt);
      if (sentAt === undefined) return still;
      const spelled = (ms: number) => bindWriteValue(sentAt, new Date(ms).toISOString(), dialect);
      still = still.where(sql.ref(sentAt.name), '>', spelled(now - 1_000)).where(sql.ref(sentAt.name), '<', spelled(now + 1_000));
      return still;
    };

    let query = db.selectFrom(outbox.id as never).selectAll().where(cols.status as never, '=', 'queued' as never);
    // Only what has come due: a batch whose window is open, a message for a later
    // day, wait — and so does one whose day cannot be worked out yet.
    if (due !== undefined) {
      const spelled = bindWriteValue(due, at, dialect);
      const timed = [...new Set((box.definition.producers ?? []).filter((p) => p.due !== undefined || p.batchMinutes !== undefined || p.holdSeconds !== undefined).map((p) => p.kind))];
      query = query.where((eb) =>
        eb.or([
          eb(sql.ref(due.name), '<=', spelled),
          timed.length === 0 ? eb(sql.ref(due.name), 'is', null) : eb.and([eb(sql.ref(due.name), 'is', null), eb(sql.ref(cols.kind), 'not in', timed)]),
        ]),
      );
    }
    const rows = (await query.orderBy(key as never).limit(OUTBOX_BATCH).execute()) as Row[];
    // Judged again, all together, just before they go.
    const verdicts = await verdictsFor({ db, view, outbox, definition: box.definition, zone, read: settingReader(deps.meta, db), now }, rows, 'send');
    const settled: Row[] = [];
    for (const row of rows) {
      const pk = { [key]: row[key] };
      try {
        const verdict = verdicts.get(row);
        if (sentBefore(row)) {
          // Sent already, and queued again by a door that skipped the moves' check.
          deps.logger?.warn({ appKey: box.appKey, pk: row[key] }, 'a sent app email was queued again; it is not sent twice');
          const back = await settle(box, target, pk, { [cols.status]: 'sent' }, (q) => q.where(sql.ref(cols.status), '=', 'queued'));
          if (back !== null) settled.push(back);
          continue;
        }
        if (verdict?.skip !== undefined) {
          const values: Row = { [cols.status]: 'skipped' };
          if (cols.skipReason !== undefined) values[cols.skipReason] = verdict.skip;
          else if (cols.error !== undefined) values[cols.error] = skipSentence(verdict.skip);
          const skipped = await settle(box, target, pk, values, (q) => q.where(sql.ref(cols.status), '=', 'queued'));
          if (skipped !== null) settled.push(skipped);
          continue;
        }
        if (verdict?.due !== undefined && due !== undefined) {
          // Its day moved ahead, or can no longer be worked out: it waits.
          const values = { [due.name]: verdict.due === null ? null : normalizeWriteValue(due, new Date(verdict.due).toISOString()) };
          const moved = await settle(box, target, pk, values, (q) => q.where(sql.ref(cols.status), '=', 'queued'));
          if (moved !== null) settled.push(moved);
          continue;
        }
        shareCodes ??= await shareCodesOn(deps.meta, box.connectionId, { key: box.appKey, manifest: (await appFacts(box.row.manifestId)).manifest });
        labels ??= await choiceLabels(deps.meta, box.connectionId);
        const ready = await prepare(box, { db, view, outbox, zone, currency: tenant?.currency ?? null, now, shareCodes, labels }, row);
        if ('status' in ready) {
          const values: Row = { [cols.status]: ready.status };
          if (cols.error !== undefined) values[cols.error] = ready.error;
          const done = await settle(box, target, pk, values, unchanged(row));
          if (done !== null) settled.push(done);
          continue;
        }
        // The claim: sent, now, only while nobody changed it since it was read.
        const claim: Row = { [cols.status]: 'sent' };
        if (cols.sentAt !== undefined) claim[cols.sentAt] = at;
        if (cols.error !== undefined) claim[cols.error] = null;
        if (ready.recordTo !== undefined) claim[cols.to] = ready.recordTo;
        if (ready.language !== undefined && cols.language !== undefined) claim[cols.language] = ready.language;
        const claimed = await settle(box, target, pk, claim, unchanged(row));
        if (claimed === null) continue;
        // The document the email carries, drawn (or the one already drawn) now:
        // an email that should carry one never goes without it.
        const wanted = (await appFacts(box.row.manifestId)).attach[ready.email.templateKey];
        let attachments: EmailSendAttachmentRef[] = [];
        if (wanted !== undefined) {
          const drawn = await documentFor(box, view, claimed, wanted, ready.email.locale).catch((error: unknown) => {
            deps.logger?.warn({ err: error, appKey: box.appKey }, 'the document an app email carries could not be drawn');
            return { error: 'The document could not be drawn' };
          });
          if ('error' in drawn) {
            const values: Row = { [cols.status]: 'failed' };
            if (cols.error !== undefined) values[cols.error] = sentence(drawn.error);
            if (cols.sentAt !== undefined) values[cols.sentAt] = null;
            settled.push((await settle(box, target, pk, values, sentAtWindow)) ?? claimed);
            continue;
          }
          attachments = [drawn.attachment];
        }
        let job: unknown = null;
        let why = 'Email is not set up on this server';
        try {
          job = await enqueueEmail(
            { meta: deps.meta, logger: deps.logger === undefined ? undefined : { info: () => undefined, warn: deps.logger.warn.bind(deps.logger) }, secret: deps.secret },
            {
              ...ready.email,
              ...(attachments.length === 0 ? {} : { attachments }),
              report: { app: box.appKey, connectionId: box.connectionId, table: outbox.id, pk: { [key]: row[key] as string | number }, sentAt: now },
              // One claim, one email: queued twice for it, the mail queue keeps one.
              dedupeKey: `app-outbox:${box.appKey}:${outbox.id}:${String(row[key])}:${String(now)}`,
            },
          );
        } catch (error) {
          deps.logger?.warn({ err: error, appKey: box.appKey }, 'an app email could not be queued');
          why = 'The email could not be queued';
        }
        if (job === null) {
          // Claimed and never queued: it did not go.
          const values: Row = { [cols.status]: 'failed' };
          if (cols.error !== undefined) values[cols.error] = why;
          if (cols.sentAt !== undefined) values[cols.sentAt] = null;
          settled.push((await settle(box, target, pk, values, sentAtWindow)) ?? claimed);
          continue;
        }
        settled.push(claimed);
        // The status is committed and the email queued: now the change it makes.
        await effectOf(box, view, claimed, now);
      } catch (error) {
        // This row alone: it fails, with a reason, and the others go on.
        deps.logger?.warn({ err: error, appKey: box.appKey, pk: row[key] }, 'an app email could not be prepared');
        const values: Row = { [cols.status]: 'failed' };
        if (cols.error !== undefined) values[cols.error] = 'The email could not be prepared';
        const failed = await settle(box, target, pk, values, (q) => q.where(sql.ref(cols.status), '=', 'queued')).catch(() => null);
        if (failed !== null) settled.push(failed);
      }
    }
    for (const row of settled) deps.announce?.(box.connectionId, outbox, row);
    return settled.length;
  }

  /**
   * The `onSent` change of a message the sender itself just sent — never of
   * a row that arrived `sent` (an import, sample data, an undo): nothing was
   * sent for it. Made once (`effect_at`), or refused once (`effect_error`);
   * a failure that is not a refusal (the database, the network) is handed to
   * a job that tries again, a few times. Nothing here throws.
   */
  async function effectOf(box: LiveOutbox, view: SnapshotView, row: Row, sentAt: number): Promise<void> {
    const cols = box.definition.columns;
    const producer = (box.definition.producers ?? []).find((candidate) => candidate.kind === row[cols.kind] && candidate.onSent !== undefined);
    if (producer === undefined) return;
    const key = view.table(box.definition.table).primaryKey[0];
    if (key === undefined) return;
    try {
      await applyEffect(box, view, producer, row);
    } catch (error) {
      deps.logger?.warn({ err: error, appKey: box.appKey }, 'the change an app email makes once sent failed; it is tried again');
      if (cols.effectAt === undefined || cols.effectError === undefined) return;
      await jobsRepo(deps.meta)
        .enqueue({
          kind: OUTBOX_EFFECT_JOB_KIND,
          payload: { app: box.appKey, pk: row[key] as string | number, sentAt },
          runAt: Date.now() + 60_000,
          maxAttempts: 5,
          dedupeKey: `${OUTBOX_EFFECT_JOB_KIND}:${box.appKey}:${String(row[key])}:${String(sentAt)}`,
        })
        .catch((failure: unknown) => deps.logger?.warn({ err: failure, appKey: box.appKey }, 'the retry of an app email’s change could not be queued'));
    }
  }

  /**
   * The document a message carries: the app's own profile of that kind for
   * the row the message links, drawn — or, while the row is unchanged, the one
   * drawn before (the same reuse as the staff and public doors, so a second
   * email of an unchanged invoice carries the same document and takes no new
   * number). The PDF when the add-on made one (Latin text), else its HTML print
   * copy. Every reason there is none is said, and the email does not go.
   */
  async function documentFor(
    box: LiveOutbox,
    view: SnapshotView,
    row: Row,
    wanted: { kind: string; link: string },
    locale: string | undefined,
  ): Promise<{ attachment: EmailSendAttachmentRef } | { error: string }> {
    const pipeline = deps.documents?.();
    if (pipeline === undefined) return { error: 'Documents cannot be drawn on this server' };
    const column = box.definition.links?.[wanted.link];
    const id = column === undefined ? undefined : row[column];
    if (column === undefined || id === null || id === undefined) return { error: 'The message names no row to draw its document for' };
    const tableId = referenced(view, box.definition.table, column);
    if (tableId === undefined) return { error: 'The message names no row to draw its document for' };
    const table = view.table(tableId);
    const key = table.primaryKey[0];
    const facts = await appFacts(box.row.manifestId);
    const ref = (await appTablesRepo(deps.meta).forInstall(box.connectionId, box.appKey)).find((record) => record.tableName === table.name)?.ref;
    const profile = await appProfileFor(deps.meta, box.connectionId, box.appKey, tableId, wanted.kind);
    if (profile === null || key === undefined || ref === undefined || facts.manifest === null) {
      return { error: `The ${wanted.kind} is not available: it was not made for the app, as its add-on was not there when it was installed` };
    }
    if (!profile.enabled) return { error: `The ${wanted.kind} is not available: its profile is switched off` };
    const off = await appDocumentOff({ meta: deps.meta, manifest: facts.manifest, profile, table: ref, runtime: pipeline.runtime });
    if (off !== null) return { error: `The ${wanted.kind} is not available: ${off.reason}` };
    const outcome = await renderDocument(pipeline, {
      profileId: profile.id,
      pk: { [key]: id },
      requestedBy: null,
      actorKind: 'system',
      reuse: true,
      ...(locale === undefined ? {} : { locale: locale.replace(/_/g, '-') }),
    });
    if (outcome.status === 'skipped') {
      return { error: outcome.reason === 'row-gone' ? `The ${wanted.kind} could not be drawn: its row is gone` : `The ${wanted.kind} is not available: its add-on draws nothing` };
    }
    if (outcome.status === 'failed') return { error: `The ${wanted.kind} could not be drawn: ${outcome.error}` };
    const fileId = outcome.document.fileId ?? outcome.document.htmlFileId;
    const file = fileId === null ? null : await filesRepo(deps.meta).findById(fileId);
    if (file === null || file.deletedAt !== null) return { error: `The ${wanted.kind} was drawn, but its file is gone` };
    const cap = await settingsRepo(deps.meta).get('email.maxAttachmentBytes');
    if (typeof cap === 'number' && file.sizeBytes > cap) return { error: `The ${wanted.kind} is larger than an email may carry` };
    return { attachment: { fileId: file.id, filename: file.filename } };
  }

  /** Make one message's change and write what became of it; throws only when it should be tried again. */
  async function applyEffect(box: LiveOutbox, view: SnapshotView, producer: OutboxProducer, row: Row): Promise<void> {
    const cols = box.definition.columns;
    const outbox = view.table(box.definition.table);
    const key = outbox.primaryKey[0];
    if (key === undefined) return;
    const handle = await deps.manager.data(box.connectionId);
    const marks = cols.effectAt !== undefined && cols.effectError !== undefined;
    if (marks && (row[cols.effectAt!] !== null && row[cols.effectAt!] !== undefined || (row[cols.effectError!] !== null && row[cols.effectError!] !== undefined))) return;
    const refused = await effect(box, view, handle, producer, row);
    if (!marks) return;
    const mark: Row = refused === null ? { [cols.effectAt!]: new Date().toISOString() } : { [cols.effectError!]: sentence(refused) };
    const result = await deps.writes.update({
      target: { connectionId: box.connectionId, view, table: outbox, db: handle.db, dialect: handle.dialect },
      pk: { [key]: row[key] },
      values: mark,
      context: outboxContext(box.appKey, outbox.id),
      refine: (query) => query.where(sql.ref(cols.effectAt!), 'is', null).where(sql.ref(cols.effectError!), 'is', null),
      skipIfNone: true,
      announce: async () => {},
    });
    if (result.count > 0 && result.after !== null) deps.announce?.(box.connectionId, outbox, result.after);
  }

  /** The retry job: the change of a message the sender sent at `sentAt`, if still not made. */
  async function retryEffect(input: { app: string; pk: string | number; sentAt: number }): Promise<void> {
    const box = (await deps.live()).find((candidate) => candidate.appKey === input.app);
    if (box === undefined) return;
    const view = await deps.viewFor(box.connectionId);
    if (view === null) return;
    const cols = box.definition.columns;
    const outbox = view.table(box.definition.table);
    const { db } = await deps.manager.data(box.connectionId);
    const row = await rowOf(db, view, outbox.id, input.pk);
    // Still the message that was sent then.
    const sentAt = cols.sentAt === undefined ? null : slotInstant(row?.[cols.sentAt]);
    if (row === null || row[cols.status] !== 'sent' || sentAt === null || Math.abs(sentAt.getTime() - input.sentAt) >= 1_000) return;
    const producer = (box.definition.producers ?? []).find((candidate) => candidate.kind === row[cols.kind] && candidate.onSent !== undefined);
    if (producer === undefined) return;
    await applyEffect(box, view, producer, row);
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
    // Another table's row: judged like anyone's write, its change a move the table allows.
    const context = outboxEffectContext(box.appKey);
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
    // The rows that change's move moved too (a project's room, an order's offer), each a change of its own.
    if ((outcome.effects?.length ?? 0) > 0) {
      await deps
        .announceEffects?.({ connectionId: box.connectionId, view, effects: outcome.effects, origin: 'automation', actor: { kind: 'system', id: null, label: context.actor?.label ?? `${box.appKey} outbox` }, hops: context.hops })
        .catch((error: unknown) => deps.logger?.warn({ err: error, appKey: box.appKey }, 'the rows an app email’s change moved too were not announced'));
    }
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
    // With no column to say it failed, it forgets when it went: a person may queue it again.
    else if (cols.sentAt !== undefined) values[cols.sentAt] = null;
    const result = await deps.writes.update({
      target: { connectionId: report.connectionId, view, table: outbox, db: handle.db, dialect: handle.dialect },
      pk: report.pk,
      values,
      context: outboxContext(report.app, outbox.id),
      // A row the desk has since queued again is theirs, and one sent again since is another message's.
      refine: (query) => {
        let still = query.where(sql.ref(cols.status), '=', 'sent');
        const sentAt = cols.sentAt === undefined ? undefined : outbox.columns.get(cols.sentAt);
        if (sentAt !== undefined && report.sentAt !== undefined) {
          const spelled = (ms: number) => bindWriteValue(sentAt, new Date(ms).toISOString(), handle.dialect);
          still = still.where(sql.ref(sentAt.name), '>', spelled(report.sentAt - 1_000)).where(sql.ref(sentAt.name), '<', spelled(report.sentAt + 1_000));
        }
        return still;
      },
      skipIfNone: true,
      announce: async () => {},
    });
    if (result.count > 0 && result.after !== null) deps.announce?.(report.connectionId, outbox, result.after);
  }

  return { sendApp, sweep, markUndelivered, retryEffect };
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

/**
 * The send job (one app's queued rows, now; queued by the producers) and the
 * retry of a sent message's change (queued by the sender). Both internal.
 */
export function registerOutboxSendHandler(registry: JobRegistry, sender: OutboxSender): void {
  registry.registerJobHandler(
    OUTBOX_SEND_JOB_KIND,
    z.object({ app: z.string().min(1).max(64) }).strict(),
    async (payload) => ({ settled: await sender.sendApp(payload.app) }),
    { internal: true },
  );
  registry.registerJobHandler(
    OUTBOX_EFFECT_JOB_KIND,
    z.object({ app: z.string().min(1).max(64), pk: z.union([z.string(), z.number()]), sentAt: z.number() }).strict(),
    async (payload) => {
      await sender.retryEffect(payload);
      return {};
    },
    { internal: true },
  );
}
