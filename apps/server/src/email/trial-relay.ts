// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mail on a trial instance: all of it is on, and all of it goes through the
 * operator's relay (`ADMINIUM_TRIAL_SMTP_URL`), shaped so the relay cannot be
 * used to pass as someone else and capped so it cannot be used to flood.
 *
 * WHAT EVERY MESSAGE GETS, at the moment it is queued (`email/send.ts`, the one
 * place all mail is queued):
 *
 *  - From is fixed: `"<instance name> via <operator name>" <address>`, the
 *    address the relay pins for this instance (`ADMINIUM_TRIAL_MAIL_FROM`).
 *    The instance name is the workspace's name, filtered ({@link safeSenderName}):
 *    no `@`, no brand or account-safety words, no look-alike spelling of one.
 *    A name the filter refuses gives way to the instance's host name.
 *  - Reply-To, on user mail, is a staff member's own sign-in address: the one
 *    the mail asked for when it is one, else the first Super Admin's. System
 *    mail has none.
 *  - User mail ends with a fixed footer naming the instance's address and a
 *    link to report the message (`ADMINIUM_TRIAL_MAIL_REPORT_URL`).
 *
 * WHAT IS COUNTED. System mail (the four account templates: password reset,
 * invitation, sign-in code, address changed) has its own quota
 * ({@link TRIAL_SYSTEM_EMAILS_PER_DAY} a day, {@link TRIAL_SYSTEM_EMAILS_PER_HOUR}
 * an hour) that user mail never touches, and its wording is the shipped one
 * (`email/send.ts`). User mail is everything else: `ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY`
 * a day, 20 an hour, and at most {@link TRIAL_RECIPIENTS_PER_DAY} different
 * people a day. Days and hours are UTC.
 *
 * HELD, NEVER DROPPED. A user mail past a cap is queued for the first hour the
 * caps leave room in (`runAt`), and the queue sends it then; the Email settings
 * card says how many are waiting and lists them. Mail that would only go out
 * after the trial's end is not queued: user mail stops then. System mail past
 * its quota is not queued at all: a reset link that arrives tomorrow is no use,
 * and the quota is what stops a flood of them.
 *
 * BOUNCES AND COMPLAINTS hold user mail for the rest of the day once
 * {@link TRIAL_BOUNCES_PER_DAY} addresses bounced or {@link TRIAL_COMPLAINTS_PER_DAY}
 * reported a mail as spam today: what the do-not-email list learned from the
 * relay's refusals and from the mail services' notices (`email/notices/`).
 *
 * Marketing mail is off on a trial (campaigns, and every mail classed as
 * marketing): refused here, at the campaign routes and in the campaign runner.
 *
 * The counts live in memory, rebuilt from the job queue the first time they are
 * read after a boot: a container that sleeps and wakes counts on where it
 * stopped. The engine's caps are a courtesy; the relay's own, per instance, are
 * the limit.
 */
import { createHash } from 'node:crypto';

import { createServerI18n } from '@adminium/i18n/server';
import { jobsRepo, settingsRepo, stopListRepo, usersRepo, type Job, type MetaDb } from '@adminium/meta';

import { escapeHtml } from './render.js';
import type { SmtpConfig } from './types.js';

/** At most this many different people get user mail in a day. */
export const TRIAL_RECIPIENTS_PER_DAY = 20;
/** System mail's own quota: never spent by user mail. */
export const TRIAL_SYSTEM_EMAILS_PER_DAY = 50;
export const TRIAL_SYSTEM_EMAILS_PER_HOUR = 20;
/** Bounced addresses in a day that hold user mail until the next. */
export const TRIAL_BOUNCES_PER_DAY = 5;
/** Spam reports in a day that hold user mail until the next. */
export const TRIAL_COMPLAINTS_PER_DAY = 1;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How far ahead a held mail is looked for a slot: past this it is not queued. */
const MAX_SLOTS = 24 * 400;

/** The operator's relay, from the environment. */
export interface TrialRelay {
  smtp: SmtpConfig;
  /** The address the relay pins for this instance. */
  address: string;
  /** "<instance> via <operator>". */
  operatorName: string;
  /** https:// or mailto:, in the footer of user mail. */
  reportUrl: string;
  /** The instance's own address (`ADMINIUM_PUBLIC_ORIGIN`), named in the footer. */
  origin: string | null;
}

export interface TrialMailCaps {
  perDay: number;
  perHour: number;
  recipientsPerDay: number;
  systemPerDay: number;
  systemPerHour: number;
  bouncesPerDay: number;
  complaintsPerDay: number;
}

export interface TrialMailSetup {
  /** Null: trial mode with no relay set, so no mail goes at all. */
  relay: TrialRelay | null;
  caps: TrialMailCaps;
  /** When the trial ends: user mail is not queued, nor sent, from then on. Null: no end. */
  endsAt: number | null;
  /** Whether a template is system mail (`email/send.ts`). */
  isSystem: (templateKey: string) => boolean;
  /** The recipient and subject of a queued message's sealed envelope. */
  openEnvelope: (sealed: string) => { to: string; subject: string };
  now?: (() => number) | undefined;
}

/** Why a user mail waits, or a system mail was not queued. */
export type EmailCap = 'day' | 'hour' | 'recipients' | 'bounces' | 'system';

/** Told when a cap first holds back mail in its window (a signed operator event listens). */
export interface EmailCapReached {
  cap: EmailCap;
  /** When it happened. */
  at: number;
  /** Start of the day (or hour) the cap is for, UTC. */
  window: number;
  /** User mail waiting now. */
  waiting: number;
}

interface Entry {
  system: boolean;
  /** sha256 of the lower-case address: in memory only. */
  rcpt: string;
  /** When it goes out, or went. */
  at: number;
  sent: boolean;
}

interface State {
  setup: TrialMailSetup;
  now: () => number;
  entries: Map<string, Entry>;
  loaded: Promise<void> | null;
  chain: Promise<unknown>;
  /** `cap:window` already told. */
  told: Set<string>;
}

let state: State | null = null;
const listeners = new Set<(event: EmailCapReached) => void>();

/** From `compose.ts`: the trial's mail rules, or null on any other server. Each call starts the counts afresh. */
export function configureTrialMail(setup: TrialMailSetup | null): void {
  state = setup === null ? null : { setup, now: setup.now ?? Date.now, entries: new Map(), loaded: null, chain: Promise.resolve(), told: new Set() };
}

/** Whether this server runs a trial's mail rules. */
export function trialMailOn(): boolean {
  return state !== null;
}

/** The relay's connection on a trial (null: no relay, so no mail); undefined on any other server. */
export function trialRelaySmtp(): SmtpConfig | null | undefined {
  if (state === null) return undefined;
  return state.setup.relay?.smtp ?? null;
}

/** Listen for a cap holding mail back; the returned function stops listening. */
export function onEmailCapReached(listener: (event: EmailCapReached) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Past the trial's end: user mail is neither queued nor sent. */
export function userMailStopped(at?: number): boolean {
  if (state === null || state.setup.endsAt === null) return false;
  return (at ?? state.now()) >= state.setup.endsAt;
}

/** The relay's connection from `ADMINIUM_TRIAL_SMTP_URL`: its From is the pinned address. */
export function relaySmtpOf(url: string, address: string): SmtpConfig {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'smtps:';
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port === '' ? (secure ? 465 : 587) : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    pass: decodeURIComponent(parsed.password),
    from: address,
    secure,
  };
}

// --- the name ----------------------------------------------------------------------

/**
 * Words a sender name may not carry, in any spelling: the brands phishing most
 * often wears, and the words that make a mail read as an account-safety
 * notice. Matched inside the name after {@link folded}, so `PayPa1 Shop` and
 * `my-paypal` are both refused.
 */
const REFUSED_WORDS = [
  'adminium',
  'paypal',
  'apple',
  'icloud',
  'google',
  'gmail',
  'microsoft',
  'outlook',
  'office365',
  'hotmail',
  'amazon',
  'facebook',
  'instagram',
  'whatsapp',
  'netflix',
  'stripe',
  'docusign',
  'dropbox',
  'linkedin',
  'twitter',
  'fedex',
  'dhl',
  'usps',
  'royalmail',
  'coinbase',
  'binance',
  'metamask',
  'wellsfargo',
  'citibank',
  'hsbc',
  'barclays',
  'santander',
  'revolut',
  'venmo',
  'mastercard',
  'americanexpress',
  'security',
  'verify',
  'verification',
  'password',
  'login',
  'signin',
  'billing',
  'helpdesk',
  'noreply',
  'postmaster',
  'mailerdaemon',
  'webmaster',
  'administrator',
];

/** Letters and digits that pass for a Latin letter, by the letter they pass for. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '|': 'l',
  '!': 'l',
  // Every vertical stroke reads alike: i, l, I and 1 are one letter here.
  i: 'l',
  // Cyrillic
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'l',
  ї: 'l',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ӏ: 'l',
  ɡ: 'g',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'l',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
};

/** A name as it is compared: lower case, accents off, look-alikes read as the letter they pass for, letters only. */
export function folded(name: string): string {
  const plain = name
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  let out = '';
  for (const char of plain) out += LOOK_ALIKES[char] ?? char;
  return out
    .replace(/[^a-z]/g, '')
    .replaceAll('rn', 'm')
    .replaceAll('vv', 'w');
}

const REFUSED_FOLDED = REFUSED_WORDS.map(folded);

/**
 * The name as a From may carry it, or null when it may not: control and
 * invisible characters and everything a header or an address is made of taken
 * out, at most 60 characters, and refused when it holds a brand or an
 * account-safety word in any spelling.
 */
export function safeSenderName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .normalize('NFKC')
    .replace(/[\p{C}]/gu, '')
    .replace(/[@<>"\\,;:()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  if (name === '') return null;
  const key = folded(name);
  if (key === '' || REFUSED_FOLDED.some((word) => key.includes(word))) return null;
  return name;
}

/** The instance's host, for a name the filter refused. */
function hostOf(origin: string | null): string | null {
  if (origin === null) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/** What a name in a fixed system mail reads as: the name, else the instance's host. */
export function shownName(raw: string | null | undefined): string {
  return safeSenderName(raw) ?? hostOf(state?.setup.relay?.origin ?? null) ?? '';
}

/** `"<instance> via <operator>" <address>` with the workspace's name as it stands. */
async function fromHeader(meta: MetaDb, relay: TrialRelay): Promise<string> {
  const instance = safeSenderName(await settingsRepo(meta).get('branding.appName')) ?? hostOf(relay.origin);
  const name = instance === null ? relay.operatorName : `${instance} via ${relay.operatorName}`;
  return `"${name}" <${relay.address}>`;
}

/** The From a queued message goes out with on a trial: always the relay's, whatever the envelope says. */
export async function relayDeliveryFrom(meta: MetaDb, envelopeFrom: string | undefined): Promise<string | undefined> {
  const relay = state?.setup.relay ?? null;
  if (relay === null) return envelopeFrom;
  if (envelopeFrom !== undefined && envelopeFrom.trim().toLowerCase().endsWith(`<${relay.address}>`)) return envelopeFrom;
  return await fromHeader(meta, relay);
}

// --- Reply-To ------------------------------------------------------------------------

/** A staff member's sign-in address: an active account's, never one somebody typed. */
async function staffAddress(meta: MetaDb, wanted: string | undefined): Promise<string | null> {
  const users = usersRepo(meta);
  if (wanted !== undefined && wanted.trim() !== '') {
    const user = await users.findByEmail(wanted.trim());
    if (user !== null && user.status === 'active') return user.email;
  }
  return await ownerAddress(meta);
}

/** The first Super Admin's sign-in address, while they are active. */
async function ownerAddress(meta: MetaDb): Promise<string | null> {
  const row = await meta.db
    .selectFrom('adminium_users')
    .innerJoin('adminium_user_roles', 'adminium_user_roles.userId', 'adminium_users.id')
    .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
    .select(['adminium_users.email'])
    .where('adminium_roles.slug', '=', 'super-admin')
    .where('adminium_users.status', '=', 'active')
    .orderBy('adminium_users.createdAt', 'asc')
    .orderBy('adminium_users.id', 'asc')
    .executeTakeFirst();
  return row?.email ?? null;
}

// --- the footer ----------------------------------------------------------------------

/** The fixed footer of user mail, in the message's language: the instance's address and the report link. */
async function footerOf(relay: TrialRelay, locale: string): Promise<{ html: string; text: string }> {
  const { t } = await createServerI18n({ locale });
  const address = relay.origin ?? relay.address;
  const sentence = t('email:trialRelay.footer', { address, defaultValue: 'Sent from the installation at {address}, through its operator’s mail service.' });
  const report = t('email:trialRelay.report', { defaultValue: 'Report this email' });
  const style = 'margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9a9aa5;text-align:center;';
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" data-part="trial-relay-footer">` +
    `<tr><td align="center" style="padding:0 12px 24px;">` +
    `<p style="${style}">${escapeHtml(sentence)}</p>` +
    `<p style="${style}"><a href="${escapeHtml(relay.reportUrl)}" style="color:#9a9aa5;text-decoration:underline;">${escapeHtml(report)}</a></p>` +
    `</td></tr></table>`;
  return { html, text: `\n----\n${sentence}\n${report}: ${relay.reportUrl}\n` };
}

/** `html` and `text` with the footer drawn last. */
function withFooter(body: { html: string; text: string }, footer: { html: string; text: string }): { html: string; text: string } {
  const at = body.html.lastIndexOf('</body>');
  const html = at < 0 ? `${body.html}${footer.html}` : `${body.html.slice(0, at)}${footer.html}\n${body.html.slice(at)}`;
  return { html, text: `${body.text.replace(/\s+$/, '')}\n${footer.text}` };
}

// --- the counts ----------------------------------------------------------------------

const dayOf = (at: number): number => Math.floor(at / DAY_MS) * DAY_MS;
const hourOf = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS;
const rcptOf = (address: string): string => createHash('sha256').update(address.trim().toLowerCase()).digest('hex');

/** The day's mail, read once from the queue after a boot. */
async function loaded(meta: MetaDb, s: State): Promise<void> {
  s.loaded ??= (async () => {
    const since = dayOf(s.now());
    let rows: Job[] = [];
    try {
      rows = await jobsRepo(meta).ofKindSince('email.send', since);
    } catch {
      rows = [];
    }
    for (const row of rows) {
      if (s.entries.has(row.id)) continue;
      const key = typeof row.payload['templateKey'] === 'string' ? row.payload['templateKey'] : '';
      const sealed = typeof row.payload['envelope'] === 'string' ? row.payload['envelope'] : '';
      let to: string;
      try {
        to = s.setup.openEnvelope(sealed).to;
      } catch {
        continue;
      }
      const sent = row.status === 'succeeded';
      s.entries.set(row.id, { system: s.setup.isSystem(key), rcpt: rcptOf(to), at: sent ? (row.finishedAt ?? row.runAt) : row.runAt, sent });
    }
  })();
  await s.loaded;
}

/** Forget what went before today. */
function prune(s: State, now: number): void {
  const today = dayOf(now);
  for (const [id, entry] of s.entries) if (entry.at < today) s.entries.delete(id);
}

function inWindow(s: State, system: boolean, from: number, length: number): Entry[] {
  return [...s.entries.values()].filter((entry) => entry.system === system && entry.at >= from && entry.at < from + length);
}

/** Bounces or spam reports today past their limit: user mail waits for tomorrow. */
async function bouncesHold(meta: MetaDb, s: State, now: number): Promise<boolean> {
  const stop = stopListRepo(meta);
  const today = dayOf(now);
  try {
    const [bounced, reported] = await Promise.all([stop.countSince('bounce', today), stop.countSince('spam', today)]);
    return bounced >= s.setup.caps.bouncesPerDay || reported >= s.setup.caps.complaintsPerDay;
  } catch {
    return false;
  }
}

/** The first moment at or after `from` that a user mail to `rcpt` fits every cap, and the first cap that held it. */
function slotFor(s: State, rcpt: string, from: number, held: boolean): { at: number; cap: EmailCap | null } | null {
  const { caps } = s.setup;
  const today = dayOf(s.now());
  let at = from;
  let cap: EmailCap | null = null;
  for (let step = 0; step < MAX_SLOTS; step += 1) {
    const day = dayOf(at);
    const hour = hourOf(at);
    if (held && day === today) {
      cap ??= 'bounces';
      at = day + DAY_MS;
      continue;
    }
    const sameDay = inWindow(s, false, day, DAY_MS);
    if (sameDay.length >= caps.perDay) {
      cap ??= 'day';
      at = day + DAY_MS;
      continue;
    }
    const people = new Set(sameDay.map((entry) => entry.rcpt));
    if (!people.has(rcpt) && people.size >= caps.recipientsPerDay) {
      cap ??= 'recipients';
      at = day + DAY_MS;
      continue;
    }
    if (sameDay.filter((entry) => entry.at >= hour && entry.at < hour + HOUR_MS).length >= caps.perHour) {
      cap ??= 'hour';
      at = hour + HOUR_MS;
      continue;
    }
    return { at, cap };
  }
  return null;
}

function waitingNow(s: State, now: number): number {
  return [...s.entries.values()].filter((entry) => !entry.system && !entry.sent && entry.at > now).length;
}

function tell(s: State, cap: EmailCap, window: number, now: number): void {
  const key = `${cap}:${String(window)}`;
  if (s.told.has(key)) return;
  s.told.add(key);
  const event: EmailCapReached = { cap, at: now, window, waiting: waitingNow(s, now) };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A listener's failure is its own.
    }
  }
}

// --- queueing ------------------------------------------------------------------------

/** What a message asks of the relay. */
export interface RelayAsk {
  templateKey: string;
  to: string;
  locale: string;
  /** Marketing mail is off on a trial. */
  marketing: boolean;
  replyTo?: string | undefined;
  /** The caller's own "not before" (quiet hours, a schedule). */
  runAt?: number | undefined;
  html: string;
  text: string;
}

/** The message as the relay sends it. */
export interface RelayShaped {
  from: string;
  replyTo: string | undefined;
  html: string;
  text: string;
  /** When it goes out: now, or the first hour the caps leave room in. */
  runAt: number;
}

/** Why a message was not queued. */
export type RelayRefusal = 'no-relay' | 'marketing' | 'system-quota' | 'after-the-end' | 'no-slot';

export type RelayLogger = { info(obj: Record<string, unknown>, msg?: string): void; warn(obj: Record<string, unknown>, msg?: string): void };

/**
 * Shape one message for the relay and queue it with `enqueue`, one at a time so
 * two messages never take the same slot. Null when it was not queued (the
 * logger says why).
 */
export async function queueThroughRelay(
  meta: MetaDb,
  ask: RelayAsk,
  enqueue: (shaped: RelayShaped) => Promise<Job | null>,
  logger?: RelayLogger | undefined,
): Promise<Job | null> {
  const s = state;
  if (s === null) throw new Error('queueThroughRelay outside trial mode');
  const run = async (): Promise<Job | null> => {
    const refuse = (why: RelayRefusal, message: string): null => {
      logger?.info({ templateKey: ask.templateKey, why }, message);
      return null;
    };
    const relay = s.setup.relay;
    if (relay === null) return refuse('no-relay', 'an email was not queued: this trial has no mail relay');
    if (ask.marketing) return refuse('marketing', 'an email was not queued: marketing mail is off on a trial');
    await loaded(meta, s);
    const now = s.now();
    prune(s, now);
    const system = s.setup.isSystem(ask.templateKey);
    const rcpt = rcptOf(ask.to);
    const from = Math.max(now, ask.runAt ?? now);
    let at: number;
    if (system) {
      const caps = s.setup.caps;
      if (inWindow(s, true, dayOf(from), DAY_MS).length >= caps.systemPerDay || inWindow(s, true, hourOf(from), HOUR_MS).length >= caps.systemPerHour) {
        tell(s, 'system', dayOf(from), now);
        return refuse('system-quota', 'an account email was not queued: this trial has sent its share of account email for now');
      }
      at = from;
    } else {
      const slot = slotFor(s, rcpt, from, await bouncesHold(meta, s, now));
      if (slot === null) return refuse('no-slot', 'an email was not queued: the trial’s email limits leave no room for it');
      if (s.setup.endsAt !== null && slot.at >= s.setup.endsAt) {
        return refuse('after-the-end', 'an email was not queued: the email limits hold it past the trial’s end, when user mail stops');
      }
      if (slot.cap !== null) tell(s, slot.cap, slot.cap === 'hour' ? hourOf(from) : dayOf(from), now);
      at = slot.at;
    }
    const body = system ? { html: ask.html, text: ask.text } : withFooter({ html: ask.html, text: ask.text }, await footerOf(relay, ask.locale));
    const job = await enqueue({
      from: await fromHeader(meta, relay),
      replyTo: system ? undefined : ((await staffAddress(meta, ask.replyTo)) ?? undefined),
      html: body.html,
      text: body.text,
      runAt: at,
    });
    if (job !== null && !s.entries.has(job.id)) s.entries.set(job.id, { system, rcpt, at: Math.max(at, job.runAt), sent: false });
    if (job !== null && at > now && !system) logger?.info({ templateKey: ask.templateKey, runAt: at }, 'an email is waiting in the outbox: the trial’s email limits hold it until then');
    return job;
  };
  const result = s.chain.then(run, run);
  s.chain = result.then(
    () => undefined,
    () => undefined,
  );
  return await result;
}

/** A queued message went out (the `email.send` handler). */
export function relaySent(jobId: string, at?: number): void {
  const s = state;
  const entry = s?.entries.get(jobId);
  if (s === null || entry === undefined) return;
  entry.sent = true;
  entry.at = at ?? s.now();
}

// --- what is read back ------------------------------------------------------------------

/** User mail sent through the relay today and this hour (UTC); null on any other server. */
export async function relayCounts(meta: MetaDb, at: number): Promise<{ today: number | null; thisHour: number | null }> {
  const s = state;
  if (s === null || s.setup.relay === null) return { today: null, thisHour: null };
  await loaded(meta, s);
  const sent = [...s.entries.values()].filter((entry) => !entry.system && entry.sent && entry.at <= at);
  return {
    today: sent.filter((entry) => entry.at >= dayOf(at)).length,
    thisHour: sent.filter((entry) => entry.at >= hourOf(at)).length,
  };
}

/** What the Email settings card shows on a trial: the relay's From and Reply-To, the caps, today's use and what waits. */
export interface TrialMailPanel {
  /** The From header as a mail queued now carries it; null with no relay. */
  from: string | null;
  /** Where replies go by default: the first Super Admin's address. */
  replyTo: string | null;
  caps: { perDay: number; perHour: number; recipientsPerDay: number };
  /** User mail taking today's and this hour's room: sent, or going out later in the window. */
  today: number;
  thisHour: number;
  /** Different people written to today. */
  people: number;
  /** User mail waiting for a later hour or day. */
  waiting: number;
  /** The cap a new user mail would wait for now; null when it would go at once. */
  limit: EmailCap | null;
  /** When the first waiting mail goes out. */
  nextAt: number | null;
}

/** Null on any other server. */
export async function trialMailPanel(meta: MetaDb): Promise<TrialMailPanel | null> {
  const s = state;
  if (s === null) return null;
  await loaded(meta, s);
  const now = s.now();
  prune(s, now);
  const today = inWindow(s, false, dayOf(now), DAY_MS);
  const thisHour = today.filter((entry) => entry.at >= hourOf(now) && entry.at < hourOf(now) + HOUR_MS);
  const people = new Set(today.map((entry) => entry.rcpt)).size;
  const { caps } = s.setup;
  const held = await bouncesHold(meta, s, now);
  const limit: EmailCap | null = held ? 'bounces' : today.length >= caps.perDay ? 'day' : thisHour.length >= caps.perHour ? 'hour' : people >= caps.recipientsPerDay ? 'recipients' : null;
  const waiting = [...s.entries.values()].filter((entry) => !entry.system && !entry.sent && entry.at > now);
  const relay = s.setup.relay;
  return {
    from: relay === null ? null : await fromHeader(meta, relay),
    replyTo: await ownerAddress(meta),
    caps: { perDay: caps.perDay, perHour: caps.perHour, recipientsPerDay: caps.recipientsPerDay },
    today: today.length,
    thisHour: thisHour.length,
    people,
    waiting: waiting.length,
    limit,
    nextAt: waiting.length === 0 ? null : Math.min(...waiting.map((entry) => entry.at)),
  };
}

/** One user mail waiting in the outbox. */
export interface WaitingEmail {
  id: string;
  to: string;
  subject: string;
  queuedAt: number;
  goesOutAt: number;
}

/** The user mail waiting for a later hour or day, soonest first; null on any other server. */
export async function waitingEmails(meta: MetaDb, limit: number): Promise<WaitingEmail[] | null> {
  const s = state;
  if (s === null) return null;
  await loaded(meta, s);
  const now = s.now();
  const ids = [...s.entries.entries()]
    .filter(([, entry]) => !entry.system && !entry.sent && entry.at > now)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([id]) => id);
  const jobs = jobsRepo(meta);
  const out: WaitingEmail[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const job = await jobs.findById(id);
    if (job === null || job.status !== 'pending') continue;
    try {
      const opened = s.setup.openEnvelope(String(job.payload['envelope'] ?? ''));
      out.push({ id: job.id, to: opened.to, subject: opened.subject, queuedAt: job.createdAt, goesOutAt: job.runAt });
    } catch {
      // An envelope this server cannot open is not listed.
    }
  }
  return out;
}
