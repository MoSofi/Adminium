// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's guests may do through the public API, as its manifest asks
 * (`publicAccess`) — made into endpoints and ONE browser key at install, both
 * marked as the app's, so switching the app off stops them and uninstalling
 * takes them back.
 *
 * Each entry becomes an endpoint on the real table:
 *  - ref: the real table name (`pos_booking_rules`); an entry that proves a
 *    guest's own row (`claim`), or reads a person's own rows (`claimedBy`),
 *    is `<table>_claimed` — `<table>_verified` when it asks for a verified
 *    session — since one table may be read publicly AND claimed, and two
 *    endpoints cannot share a ref;
 *  - `select` as asked, else every column the app declares for the table;
 *  - a claim becomes a `lookup` identity on the table's key: knowing the
 *    row's details (a booking code and a mobile) is what opens it;
 *  - a wrapped `data` response, fifty rows a page, sixty requests a minute.
 *
 * An `availability` entry answers free-or-full for each slot of a day, from
 * the table's booking limit, and never a row: `<table>_availability`, GET
 * only, asked at `/public/availability/<ref>`.
 *
 * The check step shows every endpoint with its own issues, and what would
 * stop the key working — the public API off, no `self` in the origin list,
 * a database with no time zone — before anything is written.
 */
import type { Manifest } from '@adminium/manifest';
import {
  CUSTOMER_KEY_PURPOSE,
  connectionTenantConfig,
  settingsRepo,
  type DsnCrypto,
  type KeyEnabledBy,
  type KeyStaffBinding,
  type MetaDb,
} from '@adminium/meta';

import { SELF_ORIGIN_SENTINEL } from '../config/env.js';
import { isEmailConfigured } from '../email/send.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { endpointIssues, type PublicEndpointDefinition, type PublicMethod } from '../public-api/endpoint.js';
import { EndpointSaveRefused, KeyCreateRefused, type EndpointService } from '../public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../public-api/keys.js';
import { managedGrantIssues } from '../public-api/managed-key.js';
import { guestBase } from '../public-api/guest-base.js';
import { roleSlugFor } from './manifest-roles.js';
import { mapTableRefs } from './real-refs.js';

type PublicAccessEntry = NonNullable<Extract<Manifest, { kind: 'app' }>['publicAccess']>[number];

export interface PlannedPublicEndpoint {
  ref: string;
  /** The manifest's short name for the table. */
  table: string;
  methods: PublicMethod[];
  select: string[];
  writable: string[];
  /** Opened by proving a row's details. */
  claim: string[] | null;
  /** `availability` answers free or full per slot, never a row. */
  kind: 'records' | 'availability';
  /** A guest's create here is confirmed by email. */
  confirms: boolean;
  /** Which of the app's browser keys serves it: `customer`, or a name from `publicKeys`. */
  key: string;
  /** Answered by a later release: listed, not made. None is, today. */
  pending: boolean;
  /** What stops the endpoint as defined (it cannot be made while any remain). */
  issues: string[];
  definition: PublicEndpointDefinition | null;
}

export interface PublicAccessPlan {
  endpoints: PlannedPublicEndpoint[];
  /** What would stop the key working, though the install goes ahead. */
  warnings: { code: 'PUBLIC_API_OFF' | 'ORIGIN_SELF_MISSING' | 'NO_TIME_ZONE' | 'NO_EMAIL' | 'NO_PUBLIC_ADDRESS'; message: string }[];
}

/**
 * Every table an entry names inside it — the settings a door waits on, a
 * confirmation's venue, the identity a person's rows are claimed by, the
 * parent they are seen with — mapped by the one mapper, with those it could
 * not find.
 */
export function nestedRefs(
  entry: PublicAccessEntry,
  idOf: (ref: string) => string | undefined,
): { value: Pick<PublicAccessEntry, 'requireSetting' | 'confirm' | 'claimedBy' | 'visibleWith'>; missing: string[] } {
  return mapTableRefs(
    {
      ...(entry.requireSetting === undefined ? {} : { requireSetting: entry.requireSetting }),
      ...(entry.confirm === undefined ? {} : { confirm: entry.confirm }),
      ...(entry.claimedBy === undefined ? {} : { claimedBy: entry.claimedBy }),
      ...(entry.visibleWith === undefined ? {} : { visibleWith: entry.visibleWith }),
    },
    idOf,
  );
}

/** The endpoint an entry becomes, against the real table in `view`. */
function definitionOf(
  manifest: Extract<Manifest, { kind: 'app' }>,
  entry: PublicAccessEntry,
  ref: string,
  tableId: string,
  primaryKey: readonly string[],
  /** The real id of another of the app's tables (the confirmation's venue). */
  idOf: (ref: string) => string = (other) => other,
  /** The ref of the identity endpoint a `claimedBy` entry is opened through. */
  identityRef?: string,
  /** The parent endpoint a `visibleWith` entry's rows are visible with, and the columns that link them. */
  parent?: { ref: string; localColumn: string; foreignColumn: string },
): PublicEndpointDefinition {
  const declared = manifest.requiredSchema?.tables.find((table) => table.ref === entry.table);
  const key = primaryKey[0] ?? 'id';
  // The tables the entry names inside it, through the one mapper (`real-refs.ts`).
  const nested = nestedRefs(entry, idOf).value;
  if (entry.kind === 'availability') {
    // Free or full per slot: no column of a row is ever read out.
    return {
      path: `/${ref}`,
      source: tableId,
      methods: ['GET'],
      select: [key],
      filters: [],
      pagination: { default_limit: 50, max_limit: 200, order: `${key}.asc` },
      auth: { role: 'anon' },
      rate_limit: { requests: 60, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
      kind: 'availability',
    } as PublicEndpointDefinition;
  }
  const select = entry.select ?? (declared?.columns ?? []).map((column) => column.ref);
  // Ordered by the key when it is shown, else by the first column shown: an
  // order never reveals a column the endpoint does not.
  const order = select.includes(key) || select.length === 0 ? key : (select[0] as string);
  return {
    path: `/${ref}`,
    source: tableId,
    methods: [...entry.methods],
    select,
    // Passed on whole: a relative filter (`today`) is worked out on every
    // request, on the venue's clock.
    filters: (entry.filters ?? []).map((filter) => ({ ...filter })),
    pagination: { default_limit: 50, max_limit: 200, order: `${order}.asc` },
    // Signed in to reach it — except a create a session is optional on.
    auth: {
      role:
        entry.claim !== undefined || entry.visibleWith !== undefined || (entry.claimedBy !== undefined && entry.claimedBy.optional !== true)
          ? 'authenticated'
          : 'anon',
    },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    // A child writes only what it names: never the default of every column shown.
    ...(entry.writable === undefined ? (entry.visibleWith === undefined ? {} : { writable: [] }) : { writable: [...entry.writable] }),
    ...(entry.writableValues === undefined ? {} : { writable_values: { ...entry.writableValues } }),
    ...(entry.requires === undefined ? {} : { requires: [...entry.requires] }),
    ...(entry.files === undefined ? {} : { files: [...entry.files] }),
    ...(entry.writableWhen === undefined ? {} : { writable_when: { ...entry.writableWhen } }),
    ...(entry.defaults === undefined ? {} : { defaults: { ...entry.defaults } }),
    ...(entry.claim === undefined
      ? {}
      : 'by' in entry.claim
        ? {
            // A row shared by link: its code opens it, while not stopped or expired.
            identity: {
              strategy: 'token',
              match: [entry.claim.column],
              column: key,
              ...(entry.claim.expires === undefined ? {} : { expires: entry.claim.expires }),
              ...(entry.claim.stopped === undefined ? {} : { stopped: entry.claim.stopped }),
            },
          }
        : 'match' in entry.claim
        ? {
            identity: {
              strategy: 'lookup',
              match: [...entry.claim.match],
              column: key,
              ...(entry.claim.verify === undefined ? {} : { verify: entry.claim.verify, email: entry.claim.email }),
            },
          }
        : {
            // Signed in by an emailed link: the address is what the job looks a person up by.
            identity: { strategy: 'email-link', match: [entry.claim.email], column: key, verify: 'email-link', email: entry.claim.email },
          }),
    ...(parent === undefined ? {} : { visible_with: { ...parent } }),
    // A person's own rows: opened by the value the identity's session carries.
    ...(entry.claimedBy === undefined
      ? {}
      : {
          claim: {
            column: entry.claimedBy.column,
            ...(identityRef === undefined ? {} : { ref: identityRef }),
            ...(entry.claimedBy.optional === true ? { optional: true } : {}),
          },
        }),
    ...(entry.level === undefined ? {} : { level: entry.level }),
    // A proof of work: before a session-less create here, or (on an identity) before every claim.
    ...(entry.humanCheck === true ? { human_check: true } : {}),
    ...(entry.sensitive === undefined ? {} : { sensitive: entry.sensitive }),
    ...(entry.onClaim === undefined ? {} : { on_claim: { clear: [...entry.onClaim.clear] } }),
    ...(entry.maxOpen === undefined ? {} : { max_open: { ...entry.maxOpen } }),
    ...(entry.requireSetting === undefined
      ? {}
      : { require_setting: (nested.requireSetting ?? []).map((setting) => ({ ...setting })) }),
    ...(entry.anonymous === undefined
      ? {}
      : {
          anonymous: {
            ...(entry.anonymous.perValue === undefined ? {} : { per_value: { columns: [...entry.anonymous.perValue.columns], n: entry.anonymous.perValue.n } }),
            ...(entry.anonymous.perKeyHour === undefined ? {} : { per_key_hour: entry.anonymous.perKeyHour }),
            ...(entry.anonymous.plainText === undefined ? {} : { plain_text: [...entry.anonymous.plainText] }),
          },
        }),
    ...(entry.rank === undefined
      ? {}
      : { rank: { order_by: entry.rank.orderBy, ...(entry.rank.where === undefined ? {} : { where: { ...entry.rank.where } }) } }),
    ...(entry.confirm === undefined
      ? {}
      : {
          confirm: {
            ...entry.confirm,
            ...(nested.confirm?.venue === undefined ? {} : { venue: { ...nested.confirm.venue } }),
          },
        }),
  } as PublicEndpointDefinition;
}

/**
 * The endpoints the manifest asks for. With `view` null (the tables are not
 * made yet) each is listed with the table it will use and no issues checked.
 */
export function planPublicEndpoints(
  manifest: Manifest,
  names: Readonly<Record<string, string>>,
  view: SnapshotView | null,
  /** At plan time a table the install will make is not there yet: listed, checked at install. */
  opts: { tablesMadeLater?: boolean } = {},
): PlannedPublicEndpoint[] {
  if (manifest.kind !== 'app') return [];
  const entries = manifest.publicAccess ?? [];
  // Refs first: a person's own rows are opened through their key's identity, by its ref.
  const taken = new Set<string>();
  const refs = entries.map((entry) => {
    const real = names[entry.table] ?? entry.table;
    const base =
      entry.kind === 'availability'
        ? `${real}_availability`
        : entry.claim !== undefined || ((entry.claimedBy !== undefined || entry.visibleWith !== undefined) && entry.level !== 'verified')
          ? `${real}_claimed`
          : entry.claimedBy !== undefined || entry.visibleWith !== undefined
            ? `${real}_verified`
            : real;
    let ref = base;
    for (let n = 2; taken.has(ref); n += 1) ref = `${base}_${String(n)}`;
    taken.add(ref);
    return ref;
  });
  const identityRefOf = (entry: PublicAccessEntry): string | undefined => {
    const by = entry.claimedBy;
    if (by === undefined) return undefined;
    const at = entries.findIndex((other) => other.claim !== undefined && other.table === by.table && (other.key ?? 'customer') === (entry.key ?? 'customer'));
    return at === -1 ? undefined : refs[at];
  };
  const declared = (short: string) => manifest.requiredSchema?.tables.find((table) => table.ref === short);
  const keyOf = (short: string) => declared(short)?.columns.find((column) => column.role === 'pk')?.ref ?? 'id';
  const pointsAt = (from: string, column: string, to: string) => {
    const found = declared(from)?.columns.find((c) => c.ref === column) as { type?: string; references?: string } | undefined;
    return found?.type === 'fk' && found.references === to;
  };
  /*
   * The parent endpoint a `visibleWith` entry reads through — the one GET
   * entry on that table on the same key — and the columns that link them:
   * this table's key to the parent (a line's `invoice_id`), or the parent's
   * key to this table (a proposal's `terms_version_id`).
   */
  const parentOf = (entry: PublicAccessEntry): { ref: string; localColumn: string; foreignColumn: string } | undefined => {
    const v = entry.visibleWith;
    if (v === undefined) return undefined;
    const at = entries.findIndex((other) => other !== entry && other.table === v.table && (other.key ?? 'customer') === (entry.key ?? 'customer') && other.methods.includes('GET'));
    if (at === -1) return undefined;
    const ref = refs[at] as string;
    return pointsAt(entry.table, v.via, v.table)
      ? { ref, localColumn: v.via, foreignColumn: keyOf(v.table) }
      : { ref, localColumn: keyOf(entry.table), foreignColumn: v.via };
  };
  /** The table the key's person is claimed on: what a child's denormalised copy points at. */
  const identityTableOf = (entry: PublicAccessEntry) =>
    entries.find((other) => other.claim !== undefined && (other.key ?? 'customer') === (entry.key ?? 'customer'))?.table;
  return entries.map((entry, index) => {
    const real = names[entry.table] ?? entry.table;
    const ref = refs[index] as string;
    const parent = parentOf(entry);
    const pending = false;
    const planned: PlannedPublicEndpoint = {
      ref,
      table: entry.table,
      methods: [...entry.methods],
      select: entry.select ?? [],
      writable: entry.writable ?? [],
      claim: entry.claim === undefined ? null : 'match' in entry.claim ? [...entry.claim.match] : [],
      kind: entry.kind === 'availability' ? 'availability' : 'records',
      confirms: entry.confirm !== undefined,
      key: entry.key ?? CUSTOMER_KEY_PURPOSE,
      pending,
      issues: [],
      definition: null,
    };
    if (pending) return planned;
    // What the app's own key may hold is known from the entry alone.
    const safety = managedGrantIssues(ref, definitionOf(manifest, entry, ref, real, ['id'], undefined, identityRefOf(entry), parent), entry.methods, new Set()).map(
      (issue) => issue.message,
    );
    /*
     * A child's copy of its person (`client_id` on a note) is the desk's, not
     * an authority: filled from the parent, never taken from a browser.
     */
    /*
     * A child the parent points at is read by the parent's column: nothing on
     * the key may write that column, or a person re-points their own row at
     * another person's child.
     */
    if (entry.visibleWith !== undefined && parent !== undefined && pointsAt(entry.visibleWith.table, entry.visibleWith.via, entry.table) && !pointsAt(entry.table, entry.visibleWith.via, entry.visibleWith.table)) {
      const via = entry.visibleWith.via;
      for (const other of entries) {
        if (other.table !== entry.visibleWith.table || (other.key ?? 'customer') !== (entry.key ?? 'customer')) continue;
        const writes = (other.writable ?? []).includes(via) || Object.prototype.hasOwnProperty.call(other.writableValues ?? {}, via) || Object.prototype.hasOwnProperty.call(other.defaults ?? {}, via);
        if (writes) safety.push(`"${entry.visibleWith.table}.${via}" is the link a child reads its rows by, so no browser writes it`);
      }
    }
    const identityTable = identityTableOf(entry);
    if (entry.visibleWith !== undefined && identityTable !== undefined) {
      for (const column of entry.writable ?? []) {
        if (pointsAt(entry.table, column, identityTable)) {
          safety.push(`"${entry.table}.${column}" points at the signed-in person's own table, so it is filled from the parent and never written publicly`);
        }
      }
    }
    if (view === null) return { ...planned, issues: safety };
    const table = view.model.tables.find((candidate) => candidate.name === real);
    if (table === undefined) {
      return opts.tablesMadeLater === true
        ? { ...planned, issues: safety }
        : { ...planned, issues: [`"${real}" is not a table of this connection`, ...safety] };
    }
    const found = (short: string) => view.model.tables.find((t) => t.name === (names[short] ?? short))?.id;
    const idOf = (short: string) => found(short) ?? short;
    // The live-model check every nested table gets: named, but not here, is an issue.
    const unfound = nestedRefs(entry, found).missing.map((short) => `"${entry.table}" names "${short}", which this app does not have here`);
    const definition = definitionOf(manifest, entry, ref, table.id, table.primaryKey, idOf, identityRefOf(entry), parent);
    const issues = [...endpointIssues(definition, { ref, view, grantedToAppBoundKey: true }).map((issue) => issue.message), ...safety, ...unfound];
    return { ...planned, select: definition.select, issues, definition };
  });
}

/** Whether an app signs its people in by an emailed link. */
export function signsInByLink(manifest: Manifest): boolean {
  return manifest.kind === 'app' && (manifest.publicAccess ?? []).some((entry) => entry.claim !== undefined && 'verify' in entry.claim && entry.claim.verify === 'email-link');
}

/** What would stop an app's key working on this instance, said before install. */
export async function publicAccessWarnings(
  meta: MetaDb,
  connectionId: string,
  configuredOrigins: readonly string[],
  /** The app confirms guests' bookings by email. */
  sendsEmail = false,
  /** The app (by key) signs its people in by an emailed link: the link needs mail and an address to point at. */
  signIn?: { appKey: string; byLink: boolean },
): Promise<PublicAccessPlan['warnings']> {
  const out: PublicAccessPlan['warnings'] = [];
  const byLink = signIn?.byLink === true;
  if ((sendsEmail || byLink) && !(await isEmailConfigured(meta, null))) {
    out.push({
      code: 'NO_EMAIL',
      message: byLink
        ? 'Email is not set up, so nobody can be sent a sign-in link.'
        : 'Email is not set up, so guests will not be sent a confirmation.',
    });
  }
  // A sign-in link names the app's own public address — never the address a request came in on.
  if (byLink && signIn !== undefined && (await guestBase({ meta }, signIn.appKey)) === null) {
    out.push({
      code: 'NO_PUBLIC_ADDRESS',
      message: 'This app has no public address, so no sign-in link can be sent. Map a domain to its customer side, or set the server’s public address.',
    });
  }
  if (!(await settingsRepo(meta).get('publicApi.enabled'))) {
    out.push({ code: 'PUBLIC_API_OFF', message: 'The public API is switched off, so these endpoints will not answer until it is on.' });
  }
  if (!configuredOrigins.includes(SELF_ORIGIN_SENTINEL)) {
    out.push({
      code: 'ORIGIN_SELF_MISSING',
      message: 'The allowed origins do not include "self", so the app’s own pages on this server cannot call them.',
    });
  }
  const tenant = await connectionTenantConfig(meta, connectionId);
  if (tenant?.timezone == null) {
    out.push({ code: 'NO_TIME_ZONE', message: 'This database has no time zone set, which the public API needs for dates and times.' });
  }
  return out;
}

/**
 * Save the app's endpoints and make its browser keys — after its tables
 * exist and are introspected. Endpoints first: a key is made from them.
 * An endpoint the app already made is saved again (an update may change it).
 *
 * One key per purpose: `customer` for the public side, and one for each of
 * the manifest's `publicKeys` (a kiosk), made only when the app has none of
 * that purpose live. A second key is bound to a signed-in staff member
 * holding the role it names, and switched by its settings column — so its
 * token, served only to that staff member's screen, opens nothing alone.
 */
export async function installPublicAccess(input: {
  service: EndpointService;
  meta: MetaDb;
  crypto: DsnCrypto;
  manifest: Manifest;
  connectionId: string;
  names: Readonly<Record<string, string>>;
  view: SnapshotView;
  appName: string;
  actorId: string | null;
  /** The purposes the app already has a live key for. */
  livePurposes: ReadonlySet<string>;
  /** Purposes whose key the operator revoked: an update does not make them again. */
  withheld?: ReadonlySet<string> | undefined;
}): Promise<{ endpoints: string[]; keyId: string | null; keys: Record<string, string>; skipped: { ref: string; reason: string }[] }> {
  const planned = planPublicEndpoints(input.manifest, input.names, input.view).filter((entry) => !entry.pending);
  const refused = planned.filter((entry) => entry.issues.length > 0 || entry.definition === null);
  if (refused.length > 0) {
    throw new Error(`The public access this app asks for cannot be made: ${refused.flatMap((entry) => entry.issues).join('; ')}`);
  }
  const saved: string[] = [];
  const skipped: { ref: string; reason: string }[] = [];
  for (const entry of planned) {
    try {
      await input.service.saveEndpoint({
        connectionId: input.connectionId,
        ref: entry.ref,
        definition: entry.definition!,
        origin: 'custom',
        actorId: input.actorId,
        managedBy: input.manifest.key,
      });
      saved.push(entry.ref);
    } catch (error) {
      // An update may not widen the key the operator allowed at install:
      // the endpoint stays as it was, and the reply says why.
      if (!(error instanceof EndpointSaveRefused)) throw error;
      if (!input.livePurposes.has(entry.key)) throw refusedInPlainWords(error.issues);
      skipped.push({ ref: entry.ref, reason: error.issues.map((issue) => issue.message).join('; ') });
    }
  }
  const keys: Record<string, string> = {};
  const manifest = input.manifest;
  const purposes = [...new Set(planned.map((entry) => entry.key))];
  for (const purpose of purposes) {
    if (input.livePurposes.has(purpose)) continue;
    // An update never makes again a key the operator took back.
    if (input.withheld?.has(purpose) === true) continue;
    const binding = staffBindingOf(manifest, purpose, input);
    // A second key the manifest does not declare (the check refuses that) is never made unbound —
    // except a shared link's own key, which no staff signs in: its token is its lock.
    if (purpose !== CUSTOMER_KEY_PURPOSE && binding === null && !opensByToken(manifest, purpose)) continue;
    const generated = generatePublishableKey('browser');
    let made: Awaited<ReturnType<EndpointService['createKey']>>;
    try {
      made = await input.service.createKey({
        connectionId: input.connectionId,
        name: purpose === CUSTOMER_KEY_PURPOSE ? `${input.appName} · guests` : `${input.appName} · ${purpose}`,
        access: planned.filter((entry) => entry.key === purpose).map((entry) => ({ ref: entry.ref, methods: entry.methods })),
        secret: { prefix: generated.prefix, tokenHash: generated.tokenHash, tokenEncrypted: sealPublishableKey(input.crypto, generated.token) },
        appKey: manifest.key,
        origins: [],
        kind: 'browser',
        actorId: input.actorId,
        managedBy: manifest.key,
        purpose,
        ...(binding === null ? {} : binding),
      });
    } catch (error) {
      // Refused beside the connection's other keys (one writes the link a child here is read by, say): the install stops, in words.
      throw error instanceof KeyCreateRefused ? refusedInPlainWords(error.issues) : error;
    }
    keys[purpose] = made.key.id;
  }
  return { endpoints: saved, keyId: keys[CUSTOMER_KEY_PURPOSE] ?? null, keys, skipped };
}

/** A refusal as the install says it: the sentences, never the codes. */
function refusedInPlainWords(issues: readonly { message: string }[]): Error {
  return new Error(`The public access this app asks for cannot be made: ${issues.map((issue) => issue.message).join('; ')}`);
}

/** A key the manifest declares with no staff binding: it opens one row by a shared link, and reads. */
function opensByToken(manifest: Manifest, purpose: string): boolean {
  if (manifest.kind !== 'app') return false;
  const declared = manifest.publicKeys?.[purpose];
  if (declared === undefined || declared.requiresStaff !== undefined) return false;
  return (manifest.publicAccess ?? []).some((entry) => (entry.key ?? CUSTOMER_KEY_PURPOSE) === purpose && entry.claim !== undefined && 'by' in entry.claim);
}

/**
 * What a second key (a kiosk's) is bound to, as the manifest declares it: the
 * app's own role a signed-in staff member must hold, and the settings column
 * that switches it. Null for the public side's key, or a purpose the
 * manifest does not declare.
 */
export function staffBindingOf(
  manifest: Manifest,
  purpose: string,
  input: { names: Readonly<Record<string, string>>; view: SnapshotView },
): { requiresStaff: KeyStaffBinding; enabledBy: KeyEnabledBy | null } | null {
  if (purpose === CUSTOMER_KEY_PURPOSE || manifest.kind !== 'app') return null;
  const declared = manifest.publicKeys?.[purpose];
  if (declared?.requiresStaff === undefined) return null;
  return {
    requiresStaff: { appKey: manifest.key, roleSlug: roleSlugFor(manifest.key, declared.requiresStaff.role) },
    enabledBy: declared.enabledBy === undefined ? null : { table: idOfTable(input, declared.enabledBy.table), column: declared.enabledBy.column },
  };
}

/** A manifest table's id in the snapshot, by its real name. */
function idOfTable(input: { names: Readonly<Record<string, string>>; view: SnapshotView }, short: string): string {
  const real = input.names[short] ?? short;
  return input.view.model.tables.find((table) => table.name === real)?.id ?? real;
}
