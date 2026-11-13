// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signed instance events: the few changes this instance tells the server's
 * operator about, while it is awake.
 *
 * The operator endpoint (`operator/endpoint.ts`) is asked; a sleeping
 * container answers nothing, and asking wakes it. So an awake instance also
 * says, on its own, what the operator's control service must know:
 *
 *   public-page.changed     a customer side or a live form, as strangers get it now
 *   super-admin.signed-in   when, and from which address
 *   email.cap-reached       a cap of the operator's mail relay held mail back
 *   storage.over-80         the data folder, or a database, crossed 80% of its cap
 *
 * Only to `ADMINIUM_OPERATOR_EVENTS_URL`, only with `ADMINIUM_OPERATOR_TOKEN`
 * (the boot refuses the one without the other), on any server that has both:
 * a trial, a hosted instance or anybody's. Without the URL nothing is queued.
 *
 * ── THE SIGNATURE ──────────────────────────────────────────────────────────
 * Each event is one `POST` of a small JSON body:
 *
 *   { "v": 1, "id": "job_…", "type": "…", "at": <ms>, "data": { … } }
 *
 * with `X-Adminium-Timestamp: <unix seconds>` and
 * `X-Adminium-Signature: v1=<hex HMAC-SHA256(token, "<timestamp>.<body>")>`,
 * the key being the token's text as written. The receiver computes the same
 * over the raw bytes it got, compares in constant time, refuses a timestamp
 * more than {@link SIGNATURE_TOLERANCE_SECONDS} from its clock (a replay), and
 * keeps the ids it has seen: a retry carries the same `id` and a new
 * timestamp. {@link verifyOperatorEvent} is that check.
 *
 * ── THE QUEUE ──────────────────────────────────────────────────────────────
 * Events are jobs (`operator.event`) in the meta store's queue: the worker
 * retries a refused send with its backoff (30 s, doubling, at most an hour
 * apart) up to {@link EVENT_MAX_ATTEMPTS} times, while the instance is awake;
 * a sleeping one picks up where it stopped when it wakes. The jobs routes
 * never list, show or cancel them (the instance's own people cannot hold back
 * what is told about their instance), and no archive or export carries them.
 * A job holds what the event is about, never a page: the body is built when it
 * is sent, so a page sends what strangers get at that moment.
 *
 * ── THE DIAL ───────────────────────────────────────────────────────────────
 * The address is checked (`net/address-guard.ts`: never the cloud metadata
 * address; the operator named it, so its own network passes) and the
 * connection pinned to what was checked. No redirect is followed (one is a
 * failed send, tried again later at the same address), the send gives up
 * after {@link SEND_TIMEOUT_MS}, and no more than {@link REPLY_MAX_BYTES} of
 * the reply is read.
 *
 * ── NO ROW DATA ────────────────────────────────────────────────────────────
 * A body carries what its event names and nothing else: what strangers are
 * served (`operator/public-content.ts`, the same document the endpoint's
 * `public-content` answers), a sign-in's time and address, a cap's numbers, a
 * size. Never a row of the instance's databases, a person's name or email, a
 * form's answers, a user agent.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { inIdOrder, jobsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import type { HostedSurface } from '../cli/surfaces-root.js';
import type { EmailCapReached } from '../email/trial-relay.js';
import type { JobRegistry } from '../jobs/registry.js';
import { checkHost, type HostLookup } from '../net/address-guard.js';
import { pinnedFetch } from '../net/pinned-fetch.js';
import { SUPER_ADMIN_SLUG } from '../rbac/resolver.js';
import type { SizeCapEvent } from '../trial/size-cap.js';
import { buildPublicContent, type PublicSide } from './public-content.js';
import { onPublicFilesChanged } from './public-signal.js';

/** The queue's kind for an event. */
export const OPERATOR_EVENT_JOB_KIND = 'operator.event';
/** The body's `v`. */
export const OPERATOR_EVENT_VERSION = 1;

export const SIGNATURE_HEADER = 'x-adminium-signature';
export const TIMESTAMP_HEADER = 'x-adminium-timestamp';
export const EVENT_ID_HEADER = 'x-adminium-event-id';
export const EVENT_TYPE_HEADER = 'x-adminium-event';
/** How far a timestamp may be from the receiver's clock. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** One send gives up after this. */
export const SEND_TIMEOUT_MS = 10_000;
/** The most of a reply that is read; the rest is dropped unread. */
export const REPLY_MAX_BYTES = 16 * 1024;
/** Sends of one event before it is given up. */
export const EVENT_MAX_ATTEMPTS = 25;
/** Ahead of the instance's own jobs: an event is small and the control service waits on it. */
const EVENT_PRIORITY = 10;

/** The storage event fires when a reading reaches this share of its cap... */
export const STORAGE_EVENT_SHARE = 0.8;
/** ...and again only after a reading under this one. */
export const STORAGE_REARM_SHARE = 0.75;

/** A burst of changes is looked at once, this long after the last of them. */
export const PUBLIC_CHECK_DEBOUNCE_MS = 2_000;
/** ...and never later than this after the first. */
const PUBLIC_CHECK_MAX_WAIT_FACTOR = 10;
/** What no hook says (a file edited in place outside a build) is found by looking again this often. */
export const PUBLIC_CHECK_EVERY_MS = 10 * 60_000;
/** Queued events read back at start, newest first, for what was told already. */
const PRIME_ROWS = 5_000;

export type OperatorEventType = 'public-page.changed' | 'super-admin.signed-in' | 'email.cap-reached' | 'storage.over-80';

const publicItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('side'), appKey: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('form'), slug: z.string().min(1).max(200) }),
]);
type PublicItem = z.infer<typeof publicItem>;

/** What a queued event holds: what it is about, never the page itself. */
export const operatorEventPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('public-page.changed'),
    at: z.number(),
    item: publicItem,
    /** What the item looked like when the change was seen; null: gone. Read back at start. */
    fingerprint: z.string().max(80).nullable(),
  }),
  z.object({ type: z.literal('super-admin.signed-in'), at: z.number(), ip: z.string().max(100).nullable() }),
  z.object({ type: z.literal('email.cap-reached'), at: z.number(), cap: z.string().max(20), window: z.number(), waiting: z.number() }),
  z.object({
    type: z.literal('storage.over-80'),
    at: z.number(),
    target: z.enum(['files', 'database']),
    connectionId: z.string().max(64).optional(),
    usedBytes: z.number(),
    limitBytes: z.number(),
  }),
]);
export type OperatorEventPayload = z.infer<typeof operatorEventPayloadSchema>;

// --- the signature ------------------------------------------------------------------

/** `v1=<hex HMAC-SHA256(token, "<timestamp>.<body>")>`. */
export function signOperatorEvent(token: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', token).update(`${String(timestamp)}.${body}`, 'utf8').digest('hex')}`;
}

/** The receiver's check: the signature over the raw body, in constant time, and a timestamp near `now`. */
export function verifyOperatorEvent(input: { token: string; body: string; timestamp: string; signature: string; now?: number; toleranceSeconds?: number }): boolean {
  if (!/^\d{1,12}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > (input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return false;
  const expected = Buffer.from(signOperatorEvent(input.token, timestamp, input.body), 'utf8');
  const given = Buffer.from(input.signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// --- what an event is built from ------------------------------------------------------

/** The live forms, as the forms door serves them (`forms/catalog.ts`). */
export interface PublicFormsSource {
  liveSlugs(): Promise<{ addOn: string; slug: string }[]>;
  find(slug: string): Promise<{ state: string; live?: { addOn: string; form: unknown } }>;
  /** Drop what is kept of a form (all, without a slug), so it is read as it is now. */
  forget?(slug?: string): void;
}

export interface OperatorEventsOptions {
  meta: MetaDb;
  /** `ADMINIUM_OPERATOR_EVENTS_URL`; null: nothing is queued, and a queued event is let go unsent. */
  url: string | null;
  /** `ADMINIUM_OPERATOR_TOKEN`, the signing key. */
  token: string | null;
  /** Every app side this server serves now. */
  surfaces: () => readonly HostedSurface[];
  forms: PublicFormsSource | null;
  /** Whether a table is a forms add-on's forms table: a write to it may publish or change a form. */
  formsTable?: ((connectionId: string, tableId: string) => Promise<boolean>) | undefined;
  log?: { warn(fields: object, message: string): void } | undefined;
  now?: (() => number) | undefined;
  /** Test seam: the lookup the address is checked with. */
  lookup?: HostLookup | undefined;
  debounceMs?: number | undefined;
  checkEveryMs?: number | undefined;
  sendTimeoutMs?: number | undefined;
}

/** A customer side as strangers get it now, or that it is gone. */
async function sideNow(opts: OperatorEventsOptions, appKey: string): Promise<PublicSide | { appKey: string; removed: true }> {
  const content = await buildPublicContent({
    surfaces: () => opts.surfaces().filter((surface) => surface.side === 'customer' && surface.appKey === appKey).slice(0, 1),
    forms: null,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
  return content.sides[0] ?? { appKey, removed: true };
}

/** A form as strangers get it now, or that it is gone. */
async function formNow(opts: OperatorEventsOptions, slug: string): Promise<{ slug: string; addOn: string; form: unknown } | { slug: string; removed: true }> {
  if (opts.forms === null) return { slug, removed: true };
  opts.forms.forget?.(slug);
  const found = await opts.forms.find(slug);
  return found.state === 'live' && found.live !== undefined ? { slug, addOn: found.live.addOn, form: found.live.form } : { slug, removed: true };
}

/** The body's `data`: what the event names, read now where it is a page. */
async function eventData(opts: OperatorEventsOptions, payload: OperatorEventPayload): Promise<Record<string, unknown>> {
  switch (payload.type) {
    case 'public-page.changed':
      return payload.item.kind === 'side' ? { side: await sideNow(opts, payload.item.appKey) } : { form: await formNow(opts, payload.item.slug) };
    case 'super-admin.signed-in':
      return { ip: payload.ip };
    case 'email.cap-reached':
      return { cap: payload.cap, window: payload.window, waiting: payload.waiting };
    case 'storage.over-80':
      return payload.target === 'files'
        ? { target: 'files', usedBytes: payload.usedBytes, limitBytes: payload.limitBytes }
        : { target: 'database', connectionId: payload.connectionId ?? null, usedBytes: payload.usedBytes, limitBytes: payload.limitBytes };
  }
}

// --- the send -----------------------------------------------------------------------

/** Read at most `max` bytes of a reply, then let the rest go. */
async function dropReply(res: Response, max: number): Promise<void> {
  const reader = res.body?.getReader();
  if (reader === undefined) return;
  let read = 0;
  try {
    while (read <= max) {
      const chunk = await reader.read();
      if (chunk.done) return;
      read += chunk.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** One signed `POST` to the events address, and only there. Throws when it was not taken (2xx). */
async function sendSigned(input: {
  url: string;
  token: string;
  body: string;
  id: string;
  type: OperatorEventType;
  now: () => number;
  lookup: HostLookup | undefined;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const url = new URL(input.url);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // The operator named this address: their own network passes, the metadata address never does.
  const checked = await checkHost(host, { listed: true, failClosed: true, ...(input.lookup === undefined ? {} : { lookup: input.lookup }) });
  if (!checked.ok) throw new Error(`The events address was refused (${checked.reason}).`);
  const pins = checked.addresses.map((address) => ({ address, family: isIP(address) === 6 ? (6 as const) : (4 as const) }));
  const timestamp = Math.floor(input.now() / 1000);
  const res = await pinnedFetch(pins)(url.href, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: String(timestamp),
      [SIGNATURE_HEADER]: signOperatorEvent(input.token, timestamp, input.body),
      [EVENT_ID_HEADER]: input.id,
      [EVENT_TYPE_HEADER]: input.type,
    },
    body: input.body,
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]),
  });
  await dropReply(res, REPLY_MAX_BYTES);
  if (res.status >= 300 && res.status < 400) throw new Error(`The events address answered ${String(res.status)}, a redirect, which is never followed.`);
  if (res.status < 200 || res.status >= 300) throw new Error(`The events address answered ${String(res.status)}.`);
}

/**
 * The queue's handler for events: built, signed and sent when it runs.
 * Registered on every server, so a queued event is let go unsent where the
 * operator took the URL away, rather than retried for ever.
 */
export function registerOperatorEventsHandler(registry: JobRegistry, opts: OperatorEventsOptions): void {
  registry.registerJobHandler(
    OPERATOR_EVENT_JOB_KIND,
    operatorEventPayloadSchema,
    async (payload, ctx) => {
      if (opts.url === null || opts.token === null) {
        ctx.log('an operator event was let go unsent: this server has no events address');
        return { sent: false };
      }
      const now = opts.now ?? Date.now;
      const body = JSON.stringify({ v: OPERATOR_EVENT_VERSION, id: ctx.jobId, type: payload.type, at: payload.at, data: await eventData(opts, payload) });
      await sendSigned({ url: opts.url, token: opts.token, body, id: ctx.jobId, type: payload.type, now, lookup: opts.lookup, timeoutMs: opts.sendTimeoutMs ?? SEND_TIMEOUT_MS, signal: ctx.signal });
      return { sent: true };
    },
    { internal: true, hidden: true },
  );
}

// --- hearing the hooks --------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    /** The signed instance events; null where `ADMINIUM_OPERATOR_EVENTS_URL` is not set (`operator/events.ts`). */
    operatorEvents?: OperatorEvents | null;
  }
}

export interface OperatorEvents {
  /** A `login` audit row was written: told when it is a Super Admin's. */
  signedIn(entry: { actorId: string | null; createdAt: number; ip: string | null }): void;
  /** A cap of the operator's mail relay held mail back (`email/trial-relay.ts`). */
  emailCapReached(event: EmailCapReached): void;
  /** A reading of the size caps (`trial/size-cap.ts`). */
  storageReading(event: SizeCapEvent): void;
  /** A row was written: a forms table's row may publish or change a form. */
  onRecordEvent(event: { connectionId: string; table: { id: string } }): void;
  /** What strangers are served may have changed: look again, once the burst is over. */
  publicMayHaveChanged(): void;
  /** Read what was told already, look at the public pages, and keep looking. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Settles once everything heard so far is queued. */
  settled(): Promise<void>;
}

interface Told {
  item: PublicItem;
  fingerprint: string | null;
}

const itemKey = (item: PublicItem): string => (item.kind === 'side' ? `side:${item.appKey}` : `form:${item.slug}`);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const storageKey = (event: SizeCapEvent): string => (event.kind === 'storage' ? 'files' : `database:${event.connectionId}`);

/** The events of a server with an events address. */
export function createOperatorEvents(opts: OperatorEventsOptions): OperatorEvents {
  if (opts.url === null || opts.token === null) throw new Error('Instance events need ADMINIUM_OPERATOR_EVENTS_URL and ADMINIUM_OPERATOR_TOKEN.');
  const { meta } = opts;
  const now = opts.now ?? Date.now;
  const debounceMs = opts.debounceMs ?? PUBLIC_CHECK_DEBOUNCE_MS;
  const warn = (error: unknown, message: string): void => opts.log?.warn({ err: error }, message);

  /** Public items as last told (or found told at start). */
  const told = new Map<string, Told>();
  /** Storage targets whose crossing was told and not yet undone by a reading under the re-arm share. */
  const reported = new Set<string>();
  let primed: Promise<void> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let firstAsked = 0;
  let fired: { promise: Promise<void>; resolve: () => void } | null = null;
  let interval: NodeJS.Timeout | null = null;
  let unlisten: (() => void) | null = null;

  /** One thing at a time, in the order heard: a failure is logged, never thrown at the hook. */
  function queue(work: () => Promise<void>): void {
    chain = chain.then(work).catch((error: unknown) => warn(error, 'an operator event could not be queued'));
  }

  async function enqueue(payload: OperatorEventPayload, dedupeKey?: string): Promise<void> {
    const repo = jobsRepo(meta);
    let key = dedupeKey ?? null;
    if (key !== null) {
      // One waiting event per page: the newer one replaces it (its body is built when sent, its fingerprint is what is read back).
      const active = await repo.active(key);
      if (active !== null && !(active.status === 'pending' && (await repo.cancel(active.id)))) key = null;
    }
    await repo.enqueue({ kind: OPERATOR_EVENT_JOB_KIND, payload, priority: EVENT_PRIORITY, maxAttempts: EVENT_MAX_ATTEMPTS, dedupeKey: key }, now());
  }

  /** What was told already, from the queue: the newest event per page and per storage target. */
  async function prime(): Promise<void> {
    const ids = (
      await meta.db
        .selectFrom('adminium_jobs')
        .select('id')
        .where('kind', '=', OPERATOR_EVENT_JOB_KIND)
        .where('status', 'in', ['pending', 'running', 'succeeded'])
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(PRIME_ROWS)
        .execute()
    ).map((row) => row.id);
    const storageSeen = new Set<string>();
    for (let at = 0; at < ids.length; at += 500) {
      const slice = ids.slice(at, at + 500);
      const rows = inIdOrder(slice, await meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('id', 'in', slice).execute());
      for (const row of rows) {
        let raw: unknown = row.payload;
        if (typeof raw === 'string') {
          try {
            raw = JSON.parse(raw) as unknown;
          } catch {
            continue;
          }
        }
        const parsed = operatorEventPayloadSchema.safeParse(raw);
        if (!parsed.success) continue;
        const payload = parsed.data;
        if (payload.type === 'public-page.changed') {
          const key = itemKey(payload.item);
          if (!told.has(key)) told.set(key, { item: payload.item, fingerprint: payload.fingerprint });
        } else if (payload.type === 'storage.over-80') {
          const key = payload.target === 'files' ? 'files' : `database:${payload.connectionId ?? ''}`;
          if (!storageSeen.has(key)) {
            storageSeen.add(key);
            reported.add(key);
          }
        }
      }
    }
  }
  const ready = (): Promise<void> => (primed ??= prime().catch((error: unknown) => warn(error, 'the operator events already told could not be read')));

  /** Every public item and how it looks now. */
  async function lookNow(): Promise<Map<string, Told>> {
    opts.forms?.forget?.();
    const content = await buildPublicContent({ surfaces: opts.surfaces, forms: opts.forms, now });
    const seen = new Map<string, Told>();
    for (const side of content.sides) {
      const item: PublicItem = { kind: 'side', appKey: side.appKey };
      if (seen.has(itemKey(item))) continue;
      seen.set(itemKey(item), { item, fingerprint: digest({ path: side.path, truncated: side.truncated, files: side.files.map((file) => [file.path, file.bytes, file.sha256]) }) });
    }
    for (const form of content.forms) {
      const item: PublicItem = { kind: 'form', slug: form.slug };
      seen.set(itemKey(item), { item, fingerprint: digest({ addOn: form.addOn, form: form.form }) });
    }
    return seen;
  }

  /** Tell each page that changed since it was last told, alone. */
  async function check(): Promise<void> {
    if (stopped) return;
    await ready();
    let current: Map<string, Told>;
    try {
      current = await lookNow();
    } catch (error) {
      warn(error, 'the public pages could not be read for the operator');
      return;
    }
    const changes: Told[] = [];
    for (const [key, entry] of current) if (told.get(key)?.fingerprint !== entry.fingerprint) changes.push(entry);
    for (const [key, entry] of told) if (entry.fingerprint !== null && !current.has(key)) changes.push({ item: entry.item, fingerprint: null });
    for (const change of changes) {
      await enqueue({ type: 'public-page.changed', at: now(), item: change.item, fingerprint: change.fingerprint }, `${OPERATOR_EVENT_JOB_KIND}:${itemKey(change.item)}`);
      told.set(itemKey(change.item), change);
    }
  }

  function publicMayHaveChanged(): void {
    if (stopped) return;
    const at = now();
    if (timer === null) {
      firstAsked = at;
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      fired = { promise, resolve };
    } else {
      // A burst: wait for its end, but not for ever.
      if (at - firstAsked >= debounceMs * PUBLIC_CHECK_MAX_WAIT_FACTOR) return;
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      queue(check);
      fired?.resolve();
    }, debounceMs);
    timer.unref();
  }

  return {
    signedIn(entry) {
      const { actorId } = entry;
      if (actorId === null || stopped) return;
      queue(async () => {
        // A Super Admin is whoever holds that role now, as the status endpoint counts them.
        const superAdmin = await meta.db
          .selectFrom('adminium_user_roles')
          .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
          .select('adminium_user_roles.userId')
          .where('adminium_roles.slug', '=', SUPER_ADMIN_SLUG)
          .where('adminium_user_roles.userId', '=', actorId)
          .executeTakeFirst();
        if (superAdmin === undefined) return;
        await enqueue({ type: 'super-admin.signed-in', at: Number(entry.createdAt), ip: entry.ip });
      });
    },
    emailCapReached(event) {
      if (stopped) return;
      queue(async () => enqueue({ type: 'email.cap-reached', at: event.at, cap: event.cap, window: event.window, waiting: event.waiting }));
    },
    storageReading(event) {
      if (stopped || event.limitBytes <= 0) return;
      queue(async () => {
        await ready();
        const key = storageKey(event);
        const share = event.usedBytes / event.limitBytes;
        if (share < STORAGE_REARM_SHARE) {
          reported.delete(key);
          return;
        }
        if (share < STORAGE_EVENT_SHARE || reported.has(key)) return;
        reported.add(key);
        await enqueue({
          type: 'storage.over-80',
          at: now(),
          target: event.kind === 'storage' ? 'files' : 'database',
          ...(event.kind === 'data' ? { connectionId: event.connectionId } : {}),
          usedBytes: event.usedBytes,
          limitBytes: event.limitBytes,
        });
      });
    },
    onRecordEvent(event) {
      if (stopped || opts.formsTable === undefined) return;
      void opts.formsTable(event.connectionId, event.table.id).then(
        (isForms) => {
          if (isForms) publicMayHaveChanged();
        },
        (error: unknown) => warn(error, 'whether a table holds forms could not be read'),
      );
    },
    publicMayHaveChanged,
    async start() {
      if (stopped) return;
      await ready();
      unlisten = onPublicFilesChanged(publicMayHaveChanged);
      interval = setInterval(publicMayHaveChanged, opts.checkEveryMs ?? PUBLIC_CHECK_EVERY_MS);
      interval.unref();
      // What changed while nobody was looking (an archive restored, a folder edited): told now.
      queue(check);
    },
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      fired?.resolve();
      if (interval !== null) clearInterval(interval);
      unlisten?.();
      await chain;
    },
    async settled() {
      for (;;) {
        if (timer !== null && fired !== null) await fired.promise;
        const waiting = chain;
        await waiting;
        if (waiting === chain && timer === null) return;
      }
    },
  };
}
