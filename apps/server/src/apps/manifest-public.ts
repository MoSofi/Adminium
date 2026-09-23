// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's guests may do through the public API, as its manifest asks
 * (`publicAccess`) — made into endpoints and ONE browser key at install, both
 * marked as the app's, so switching the app off stops them and uninstalling
 * takes them back.
 *
 * Each entry becomes an endpoint on the real table:
 *  - ref: the real table name (`pos_booking_rules`); an entry that proves a
 *    guest's own row (`claim`) is `<table>_claimed`, since one table may be
 *    read publicly AND claimed, and two endpoints cannot share a ref;
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
import { connectionTenantConfig, settingsRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';

import { SELF_ORIGIN_SENTINEL } from '../config/env.js';
import { isEmailConfigured } from '../email/send.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { endpointIssues, type PublicEndpointDefinition, type PublicMethod } from '../public-api/endpoint.js';
import { EndpointSaveRefused, type EndpointService } from '../public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../public-api/keys.js';
import { managedGrantIssues } from '../public-api/managed-key.js';

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
  /** Answered by a later release: listed, not made. None is, today. */
  pending: boolean;
  /** What stops the endpoint as defined (it cannot be made while any remain). */
  issues: string[];
  definition: PublicEndpointDefinition | null;
}

export interface PublicAccessPlan {
  endpoints: PlannedPublicEndpoint[];
  /** What would stop the key working, though the install goes ahead. */
  warnings: { code: 'PUBLIC_API_OFF' | 'ORIGIN_SELF_MISSING' | 'NO_TIME_ZONE' | 'NO_EMAIL'; message: string }[];
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
): PublicEndpointDefinition {
  const declared = manifest.requiredSchema?.tables.find((table) => table.ref === entry.table);
  const key = primaryKey[0] ?? 'id';
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
  return {
    path: `/${ref}`,
    source: tableId,
    methods: [...entry.methods],
    select,
    filters: (entry.filters ?? []).map((filter) => ({ column: filter.column, op: filter.op, value: filter.value })),
    pagination: { default_limit: 50, max_limit: 200, order: `${key}.asc` },
    auth: { role: entry.claim === undefined ? 'anon' : 'authenticated' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    ...(entry.writable === undefined ? {} : { writable: [...entry.writable] }),
    ...(entry.defaults === undefined ? {} : { defaults: { ...entry.defaults } }),
    ...(entry.claim === undefined ? {} : { identity: { strategy: 'lookup', match: [...entry.claim.match], column: key } }),
    ...(entry.confirm === undefined
      ? {}
      : {
          confirm: {
            ...entry.confirm,
            ...(entry.confirm.venue === undefined ? {} : { venue: { ...entry.confirm.venue, table: idOf(entry.confirm.venue.table) } }),
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
  const taken = new Set<string>();
  return (manifest.publicAccess ?? []).map((entry) => {
    const real = names[entry.table] ?? entry.table;
    const base = entry.kind === 'availability' ? `${real}_availability` : entry.claim === undefined ? real : `${real}_claimed`;
    let ref = base;
    for (let n = 2; taken.has(ref); n += 1) ref = `${base}_${String(n)}`;
    taken.add(ref);
    const pending = false;
    const planned: PlannedPublicEndpoint = {
      ref,
      table: entry.table,
      methods: [...entry.methods],
      select: entry.select ?? [],
      writable: entry.writable ?? [],
      claim: entry.claim === undefined ? null : [...entry.claim.match],
      kind: entry.kind === 'availability' ? 'availability' : 'records',
      confirms: entry.confirm !== undefined,
      pending,
      issues: [],
      definition: null,
    };
    if (pending) return planned;
    // What the app's own key may hold is known from the entry alone.
    const safety = managedGrantIssues(ref, definitionOf(manifest, entry, ref, real, ['id']), entry.methods, new Set()).map(
      (issue) => issue.message,
    );
    if (view === null) return { ...planned, issues: safety };
    const table = view.model.tables.find((candidate) => candidate.name === real);
    if (table === undefined) {
      return opts.tablesMadeLater === true
        ? { ...planned, issues: safety }
        : { ...planned, issues: [`"${real}" is not a table of this connection`, ...safety] };
    }
    const idOf = (short: string) => view.model.tables.find((t) => t.name === (names[short] ?? short))?.id ?? short;
    const definition = definitionOf(manifest, entry, ref, table.id, table.primaryKey, idOf);
    const issues = [...endpointIssues(definition, { ref, view, grantedToAppBoundKey: true }).map((issue) => issue.message), ...safety];
    return { ...planned, select: definition.select, issues, definition };
  });
}

/** What would stop an app's key working on this instance, said before install. */
export async function publicAccessWarnings(
  meta: MetaDb,
  connectionId: string,
  configuredOrigins: readonly string[],
  /** The app confirms guests' bookings by email. */
  sendsEmail = false,
): Promise<PublicAccessPlan['warnings']> {
  const out: PublicAccessPlan['warnings'] = [];
  if (sendsEmail && !(await isEmailConfigured(meta, null))) {
    out.push({ code: 'NO_EMAIL', message: 'Email is not set up, so guests will not be sent a confirmation.' });
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
 * Save the app's endpoints and make its one browser key — after its tables
 * exist and are introspected. Endpoints first: the key is made from them.
 * An endpoint the app already made is saved again (an update may change it);
 * a key is made only when the app has none live.
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
  hasLiveKey: boolean;
}): Promise<{ endpoints: string[]; keyId: string | null; skipped: { ref: string; reason: string }[] }> {
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
      if (!input.hasLiveKey || !(error instanceof EndpointSaveRefused)) throw error;
      skipped.push({ ref: entry.ref, reason: error.issues.map((issue) => issue.message).join('; ') });
    }
  }
  if (planned.length === 0 || input.hasLiveKey) return { endpoints: saved, keyId: null, skipped };
  const generated = generatePublishableKey('browser');
  const { key } = await input.service.createKey({
    connectionId: input.connectionId,
    name: `${input.appName} · guests`,
    access: planned.map((entry) => ({ ref: entry.ref, methods: entry.methods })),
    secret: { prefix: generated.prefix, tokenHash: generated.tokenHash, tokenEncrypted: sealPublishableKey(input.crypto, generated.token) },
    appKey: input.manifest.key,
    origins: [],
    kind: 'browser',
    actorId: input.actorId,
    managedBy: input.manifest.key,
  });
  return { endpoints: saved, keyId: key.id, skipped };
}
