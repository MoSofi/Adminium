// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `publicAccess` and `publicKeys`.
 *
 * The inverse of `definitionOf` (`apps/manifest-public.ts`). What strangers
 * may do on this database is what its live keys were granted: each endpoint a
 * key holds becomes one entry, served through that key, with the methods the
 * key holds. Endpoints and keys an install made are that install's, and an
 * endpoint no key holds serves nobody, so it is not saved.
 *
 * KEYS. The oldest live browser key is the app's `customer` key. A key bound
 * to a staff role keeps its name, its role (by key) and its settings switch.
 * Any other key, a server key and a key bound to a scope written by hand have
 * no form in a file: they are named in Check. A key's token, its hash, its
 * prefix and its origins never travel; the install makes new keys.
 *
 * ADDRESSES. Every entry carries `path`, the endpoint's own address here,
 * which is already a valid ref. Without it the install would name the
 * endpoint after the table's real name, and a name with a schema or a space
 * (`sales.Order Lines`) is no address at all. So the address strangers call
 * stays the same.
 *
 * FAITHFUL OR NOT AT ALL. An entry is checked by planning it the way the
 * install will, against this database: the endpoint it would make must be the
 * one stored here, field for field, and must have no issue. Anything else is
 * left out and said, so a save never widens what a stranger may do.
 */
import { CUSTOMER_KEY, publicAccessSchema, publicKeySchema, type Manifest, type PublicAccess, type PublicKey } from '@adminium/manifest';
import { publicEndpointsRepo, publicKeysRepo, publicScopesRepo, rolesRepo, keyEnabledBy, keyStaffBinding, type PublicEndpoint } from '@adminium/meta';

import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { parseDefinition, type PublicEndpointDefinition } from '../../public-api/endpoint.js';
import { planPublicEndpoints } from '../manifest-public.js';
import { mapTableRefs } from '../real-refs.js';
import type { ConvertContext, ConvertPart } from './types.js';
import { noteAddOnUse, tableRefOf } from './uses.js';

class LeftOut extends Error {}

/** Fields of a stored endpoint that only narrow what a stranger may do and have no form in a file. */
const NARROWING_ONLY = ['filterable', 'searchable', 'orderable', 'allow_cascade'] as const;

type Def = PublicEndpointDefinition & Record<string, unknown>;
type Rec = Record<string, unknown>;

const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

/** Keys sorted at every level, so two definitions compare by what they say. */
function canonical(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort);
    if (typeof node !== 'object' || node === null) return node;
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .filter((key) => (node as Rec)[key] !== undefined)
        .map((key) => [key, sort((node as Rec)[key])]),
    );
  };
  return JSON.stringify(sort(value));
}

interface Inverse {
  ctx: ConvertContext;
  /** A stored endpoint ref → the table of that endpoint, as a source id. */
  tableOfRef: (ref: string) => string | null;
  /** The source model's primary key of a table, by source id. */
  keyOf: (tableId: string) => string;
}

function tab(inv: Inverse, table: unknown): string {
  const ref = tableRefOf(inv.ctx, table);
  if (ref === null) throw new LeftOut('it names a table that is not saved with the app');
  return ref;
}

/** Table ids inside a nested block (`table` keys at any depth) → refs. */
function nestedTables<T>(inv: Inverse, value: T): T {
  const mapped = mapTableRefs(value, (id) => tableRefOf(inv.ctx, id) ?? undefined);
  if (mapped.missing.length > 0) throw new LeftOut('it names a table that is not saved with the app');
  return mapped.value;
}

function perValue(v: unknown): { columns: string[]; n: number } | undefined {
  const p = v as { columns?: string[]; n?: number } | undefined;
  return p === undefined ? undefined : { columns: [...(p.columns ?? [])], n: p.n as number };
}

function childOf(inv: Inverse, name: string, child: Rec): [string, Rec] {
  const ref = tab(inv, child['source']);
  if (ref !== name) throw new LeftOut(`its child rows "${name}" would be sent under another name`);
  const sum = child['sum_max'] as { column: string; max: number | { table: string; column: string } } | undefined;
  const children = child['children'] as Record<string, Rec> | undefined;
  return [
    ref,
    {
      via: child['via'],
      writable: [...(child['writable'] as string[])],
      ...opt('select', child['select'] as string[] | undefined),
      ...opt('defaults', child['defaults'] as Rec | undefined),
      ...opt('writableValues', child['writable_values'] as Rec | undefined),
      ...opt('requires', child['requires'] as string[] | undefined),
      ...opt('position', child['position'] as string | undefined),
      ...opt('min', child['min'] as number | undefined),
      max: child['max'],
      ...opt('agrees', child['agrees'] === undefined ? undefined : structuredClone(child['agrees'])),
      ...opt('counts', child['counts'] === undefined ? undefined : structuredClone(child['counts'])),
      ...opt('plainText', child['plain_text'] === undefined ? undefined : structuredClone(child['plain_text'])),
      ...opt('uploads', child['uploads'] as string[] | undefined),
      ...opt('sumMax', sum === undefined ? undefined : { column: sum.column, max: typeof sum.max === 'number' ? sum.max : { table: tab(inv, sum.max.table), column: sum.max.column } }),
      ...opt('children', children === undefined ? undefined : Object.fromEntries(Object.entries(children).map(([n, c]) => childOf(inv, n, c)))),
    },
  ];
}

/** The stored identity → the entry's claim. */
function claimOf(identity: Rec): PublicAccess['claim'] {
  const match = identity['match'] as string[];
  switch (identity['strategy']) {
    case 'token': {
      const address = identity['address'] as string[] | undefined;
      return {
        by: 'token',
        column: match[0]!,
        ...opt('expires', identity['expires'] as string | undefined),
        ...opt('stopped', identity['stopped'] as string | undefined),
        ...(identity['own'] === true ? { own: true as const } : {}),
        ...opt('address', address === undefined ? undefined : address.length === 1 ? address[0]! : ([address[0]!, address[1]!] as [string, string])),
      };
    }
    case 'lookup':
      return { match: [...match], ...(identity['verify'] === 'email-code' ? { verify: 'email-code' as const, email: identity['email'] as string } : {}) };
    case 'email-link':
      return { verify: 'email-link', email: identity['email'] as string };
    default:
      throw new LeftOut('a guest proves who they are in a way a file cannot say');
  }
}

/** One stored endpoint, as the key `keyName` holds it, → an entry. */
function entryOf(inv: Inverse, endpoint: PublicEndpoint, def: Def, keyName: string, methods: PublicAccess['methods']): PublicAccess {
  const table = tab(inv, def.source);
  const base = { table, methods, path: `/${endpoint.ref}`, ...(keyName === CUSTOMER_KEY ? {} : { key: keyName }) };
  if (def['kind'] === 'availability') {
    const showLeft = def['show_left'] as { below?: number; below_share?: number } | undefined;
    const words = def['words'] as { add_on: string; id: string } | undefined;
    if (words !== undefined) noteAddOnUse(inv.ctx, { key: words.add_on, optional: false, what: 'a public page answers from its stock' });
    return {
      ...base,
      kind: 'availability',
      ...opt('rule', def['capacity_rule'] as number | undefined),
      ...opt('showLeft', showLeft === undefined ? undefined : showLeft.below !== undefined ? { below: showLeft.below } : { belowShare: showLeft.below_share as number }),
      ...opt('under', def['under'] as string | undefined),
      ...opt('words', words === undefined ? undefined : `${words.add_on}:${words.id}`),
    } as PublicAccess;
  }
  const claim = def['claim'] as { column?: string; ref?: string; optional?: true; via?: unknown } | undefined;
  if (claim?.via !== undefined || (claim !== undefined && claim.column === undefined)) throw new LeftOut('its rows are claimed in a way a file cannot say');
  let claimedBy: PublicAccess['claimedBy'];
  if (claim !== undefined) {
    const identityTable = claim.ref === undefined ? null : inv.tableOfRef(claim.ref);
    if (identityTable === null) throw new LeftOut('the sign-in its rows are claimed through is not saved');
    claimedBy = { table: tab(inv, identityTable), column: claim.column!, ...(claim.optional === true ? { optional: true as const } : {}) };
  }
  const visible = def['visible_with'] as { ref: string; localColumn: string; foreignColumn: string } | undefined;
  let visibleWith: PublicAccess['visibleWith'];
  if (visible !== undefined) {
    const parent = inv.tableOfRef(visible.ref);
    if (parent === null) throw new LeftOut('the entry its rows are read with is not saved');
    // The parent's key on the far side: this table points at it. Otherwise the parent points here.
    visibleWith = { table: tab(inv, parent), via: visible.foreignColumn === inv.keyOf(parent) ? visible.localColumn : visible.foreignColumn };
  }
  const found = def['find_or_create'] as { identity_ref: string; email: string; link: string; fill?: Rec; on?: { to: string } } | undefined;
  let identity: PublicAccess['identity'];
  if (found !== undefined) {
    const person = inv.tableOfRef(found.identity_ref) ?? found.identity_ref;
    identity = { table: tab(inv, person), email: found.email, link: found.link, ...opt('fill', found.fill as Record<string, string> | undefined), ...opt('on', found.on === undefined ? undefined : { to: found.on.to }) };
  }
  const forget = def['forget'] as { columns: string[]; stamp?: string; links?: unknown[] } | undefined;
  const newLink = def['new_link'] as { column: string; kind: string; when?: Rec } | undefined;
  const withhold = def['withhold'] as { columns: string[]; unless_holder?: string; when?: Rec } | undefined;
  const unlock = def['unlock_by'] as { table: string; column: string; link: string; self?: true; length?: number; where?: Rec[] } | undefined;
  const unlockWhere = unlock?.where?.map((c) =>
    'eq' in c ? { column: c['column'], eq: c['eq'] } : 'not_before' in c ? { column: c['column'], notBefore: c['not_before'], ...(c['or_empty'] === true ? { orEmpty: true } : {}) } : { column: c['column'], notAfter: c['not_after'], ...(c['or_empty'] === true ? { orEmpty: true } : {}) },
  );
  const rank = def['rank'] as { order_by: string; where?: Rec } | undefined;
  const anonymous = def['anonymous'] as Rec | undefined;
  const limits = def['limits'] as Rec | undefined;
  const confirm = def['confirm'] as (Rec & { venue?: Rec }) | undefined;
  const settings = def['require_setting'] as { table: string; column: string; when?: 'anonymous' }[] | undefined;
  const identityDef = def['identity'] as Rec | undefined;
  const children = def['children'] as Record<string, Rec> | undefined;
  const shareLink = def['share_link'] as { column: string } | undefined;
  const ownToken = identityDef?.['strategy'] === 'token' && identityDef['own'] === true;

  return {
    ...base,
    select: [...def.select],
    ...(def.filters.length === 0 ? {} : { filters: def.filters.map((filter) => ({ ...filter })) as PublicAccess['filters'] }),
    pagination: { defaultLimit: def.pagination.default_limit, maxLimit: def.pagination.max_limit, order: def.pagination.order },
    rateLimit: { requests: def.rate_limit.requests, window: def.rate_limit.window },
    response: def.response.shape === 'array' ? 'array' : def.response.shape === 'single' ? 'single' : 'wrapped',
    ...opt('writable', def.writable === undefined ? undefined : [...def.writable]),
    ...opt('writableValues', def.writable_values as PublicAccess['writableValues']),
    ...opt('requires', def.requires === undefined ? undefined : [...def.requires]),
    ...opt('requiresWhen', def.requires_when === undefined ? undefined : (structuredClone(def.requires_when) as PublicAccess['requiresWhen'])),
    ...opt('files', def.files === undefined ? undefined : [...def.files]),
    ...opt('uploads', def.uploads === undefined ? undefined : [...def.uploads]),
    ...opt('writableWhen', def.writable_when === undefined ? undefined : (nestedTables(inv, structuredClone(def.writable_when)) as PublicAccess['writableWhen'])),
    ...opt('defaults', def.defaults as PublicAccess['defaults']),
    ...opt('claim', identityDef === undefined ? undefined : claimOf(identityDef)),
    ...opt('visibleWith', visibleWith),
    ...opt('claimedBy', claimedBy),
    // A row's own link opens a verified session by itself: the level is the link's.
    ...opt('level', ownToken ? undefined : def.level),
    ...(def.human_check === true ? { humanCheck: true as const } : {}),
    ...opt('sensitive', def.sensitive),
    ...opt('onClaim', def.on_claim === undefined ? undefined : { clear: [...def.on_claim.clear] }),
    ...opt('maxOpen', def.max_open as PublicAccess['maxOpen']),
    ...opt('requireSetting', settings === undefined ? undefined : settings.map((s) => ({ table: tab(inv, s.table), column: s.column, ...opt('when', s.when) }))),
    ...opt(
      'anonymous',
      anonymous === undefined
        ? undefined
        : { ...opt('perValue', perValue(anonymous['per_value'])), ...opt('perKeyHour', anonymous['per_key_hour'] as number | undefined), ...opt('perIpHour', anonymous['per_ip_hour'] as number | undefined), ...opt('plainText', anonymous['plain_text'] === undefined ? undefined : structuredClone(anonymous['plain_text'])) },
    ),
    ...opt('limits', limits === undefined ? undefined : { ...opt('perValue', perValue(limits['per_value'])), ...opt('plainText', limits['plain_text'] === undefined ? undefined : structuredClone(limits['plain_text'])) }),
    ...opt('rank', rank === undefined ? undefined : { orderBy: rank.order_by, ...opt('where', rank.where === undefined ? undefined : { ...rank.where }) }),
    ...opt('confirm', confirm === undefined ? undefined : { ...confirm, ...opt('venue', confirm.venue === undefined ? undefined : { ...confirm.venue, table: tab(inv, confirm.venue['table']) }) }),
    ...opt(
      'unlockBy',
      unlock === undefined
        ? undefined
        : unlock.self === true
          ? { header: true, column: unlock.column, self: true, length: unlock.length, ...opt('where', unlockWhere) }
          : { table: tab(inv, unlock.table), column: unlock.column, link: unlock.link, ...opt('where', unlockWhere) },
    ),
    ...opt('pictures', def.pictures === undefined ? undefined : [...def.pictures]),
    ...opt('assets', def.assets === undefined ? undefined : [...def.assets]),
    ...opt('appColumn', def.app_column),
    ...opt('children', children === undefined ? undefined : Object.fromEntries(Object.entries(children).map(([name, child]) => childOf(inv, name, child)))),
    ...opt('agrees', def.agrees === undefined ? undefined : structuredClone(def.agrees)),
    ...(def.dry_run === true ? { dryRun: true as const } : {}),
    ...opt('expect', def.expect),
    ...opt('clientKey', def.client_key),
    ...opt('identity', identity),
    ...opt('shareLink', shareLink?.column),
    ...opt('forget', forget === undefined ? undefined : { columns: [...forget.columns], ...opt('stamp', forget.stamp), ...(forget.links === undefined ? {} : { links: true as const }) }),
    ...opt('newLink', newLink === undefined ? undefined : { column: newLink.column, kind: newLink.kind, ...opt('when', newLink.when === undefined ? undefined : structuredClone(newLink.when)) }),
    ...opt('withhold', withhold === undefined ? undefined : { columns: [...withhold.columns], ...opt('unlessHolder', withhold.unless_holder), ...opt('when', withhold.when === undefined ? undefined : structuredClone(withhold.when)) }),
  } as PublicAccess;
}

/** The tables the check plans against: each saved table's key, links and yes/no columns, as the target will have them. */
function draftTables(ctx: ConvertContext): unknown[] {
  return ctx.refs.tables().map((saved) => ({
    ref: saved.ref,
    columns: saved.model.columns.map((column) => {
      const target = column.references === null ? null : ctx.refs.table(column.references.tableId);
      return {
        ref: column.name,
        ...(saved.model.primaryKey.includes(column.name) ? { role: 'pk' } : {}),
        ...(target !== null ? { type: 'fk', references: target } : { type: column.logicalType === 'boolean' ? 'bool' : 'text' }),
      };
    }),
  }));
}

export const convertPublicAccess: ConvertPart = async (ctx) => {
  const { meta, connectionId } = ctx.source;
  const scopes = await publicScopesRepo(meta).listByConnection(connectionId);
  for (const scope of scopes) {
    if (scope.derivedForKey === null && scope.proposedFromManifest === null) {
      ctx.check.add({ group: 'info', code: 'PUBLIC_SCOPE_BY_HAND', kind: 'public', item: scope.name, message: 'A public scope written by hand cannot be said in a file, so it is not saved.' });
    }
  }
  const scopeIds = new Set(scopes.map((scope) => scope.id));
  const now = Date.now();
  const keys = (await publicKeysRepo(meta).list())
    .filter((key) => scopeIds.has(key.scopeId) && key.managedBy === null && key.revokedAt === null && (key.expiresAt === null || key.expiresAt > now))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const endpoints = (await publicEndpointsRepo(meta).listByConnection(connectionId)).filter((endpoint) => endpoint.managedBy === null);
  const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const defs = new Map<string, Def>();
  for (const endpoint of endpoints) {
    const parsed = parseDefinition(endpoint.definition);
    if (parsed.ok) defs.set(endpoint.id, parsed.definition as Def);
  }

  // Which key serves each endpoint, and its name in the file.
  const keyNames = new Map<string, string>();
  const publicKeys: Record<string, PublicKey> = {};
  const roles = await rolesRepo(meta).list();
  for (const key of keys) {
    const leftOut = (why: string) => ctx.check.add({ group: 'info', code: 'PUBLIC_KEY_LEFT_OUT', kind: 'public', item: key.name, message: why });
    if (key.kind !== 'browser') {
      leftOut('A server key is not saved: make one again after installing if it is needed.');
      continue;
    }
    if (key.access === null) {
      leftOut('It serves a public scope written by hand, which a file cannot say, so it is not saved.');
      continue;
    }
    const staff = keyStaffBinding(key);
    if (staff === null) {
      if ([...keyNames.values()].includes(CUSTOMER_KEY)) {
        leftOut('Only one key open to anyone is saved with an app: this one is not.');
        continue;
      }
      keyNames.set(key.id, CUSTOMER_KEY);
      if (key.peakReads !== null && key.peakWrites !== null) publicKeys[CUSTOMER_KEY] = { peak: { reads: key.peakReads, writes: key.peakWrites } };
      continue;
    }
    const role = roles.find((one) => one.slug === staff.roleSlug);
    const roleKey = role === undefined ? null : ctx.refs.role(role.id);
    const name = (key.purpose.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '') || 'staff').slice(0, 32);
    if (roleKey === null || name === CUSTOMER_KEY || publicKeys[name] !== undefined) {
      leftOut('The staff role it is bound to is not saved with the app, so it is not saved.');
      continue;
    }
    const enabled = keyEnabledBy(key);
    const enabledTable = enabled === null ? null : tableRefOf(ctx, enabled.table);
    const declared = { requiresStaff: { role: roleKey }, ...(enabled === null || enabledTable === null ? {} : { enabledBy: { table: enabledTable, column: enabled.column } }), ...(key.peakReads !== null && key.peakWrites !== null ? { peak: { reads: key.peakReads, writes: key.peakWrites } } : {}) };
    const parsed = publicKeySchema.safeParse(declared);
    if (!parsed.success || (enabled !== null && enabledTable === null)) {
      leftOut('It cannot be said in a file, so it is not saved.');
      continue;
    }
    keyNames.set(key.id, name);
    publicKeys[name] = parsed.data;
  }

  const tableOfRef = (ref: string): string | null => {
    const endpoint = endpoints.find((one) => one.ref === ref);
    return endpoint === undefined ? null : (defs.get(endpoint.id)?.source ?? null);
  };
  const keyOf = (tableId: string): string => ctx.source.model.tables.find((table) => table.id === tableId)?.primaryKey[0] ?? 'id';
  const inv: Inverse = { ctx, tableOfRef, keyOf };
  const chosen = ctx.choices.publicEndpoints === undefined ? null : new Set(ctx.choices.publicEndpoints);

  // Each endpoint once, through the first key that holds it.
  const candidates: { endpoint: PublicEndpoint; def: Def; entry: PublicAccess }[] = [];
  const served = new Set<string>();
  for (const key of keys) {
    const name = keyNames.get(key.id);
    if (name === undefined) continue;
    const access = JSON.parse(key.access as string) as Record<string, string[]>;
    for (const [endpointId, granted] of Object.entries(access)) {
      const endpoint = byId.get(endpointId);
      const def = defs.get(endpointId);
      if (endpoint === undefined || def === undefined) continue;
      if (chosen !== null && !chosen.has(endpointId)) continue;
      if (served.has(endpointId)) {
        ctx.check.add({ group: 'info', code: 'PUBLIC_ENDPOINT_SHARED', kind: 'public', item: endpoint.ref, message: `It is served through "${key.name}" too, which is not saved that way: after installing it is served through one key only.` });
        continue;
      }
      const methods = def.methods.filter((method) => granted.includes(method));
      if (methods.length === 0) continue;
      try {
        candidates.push({ endpoint, def: { ...def, methods }, entry: entryOf(inv, endpoint, def, name, methods as PublicAccess['methods']) });
        served.add(endpointId);
      } catch (error) {
        if (!(error instanceof LeftOut)) throw error;
        ctx.check.add({ group: 'info', code: 'PUBLIC_ENDPOINT_LEFT_OUT', kind: 'public', item: endpoint.ref, message: `It is not saved: ${error.message}.` });
      }
    }
  }
  for (const endpoint of endpoints) {
    const held = keys.some((key) => keyNames.has(key.id) && key.access !== null && endpoint.id in (JSON.parse(key.access) as Rec));
    if (!held && (chosen === null || chosen.has(endpoint.id))) {
      ctx.check.add({ group: 'info', code: 'PUBLIC_ENDPOINT_UNUSED', kind: 'public', item: endpoint.ref, message: 'No key that is saved serves it, so it is not saved.' });
    }
  }

  // Each entry must plan into the very endpoint stored here, with no issue. Planned again until nothing more drops out:
  // an entry left out can take another's sign-in or parent with it.
  let kept = candidates.filter((candidate) => publicAccessSchema.safeParse(candidate.entry).success);
  for (const dropped of candidates.filter((candidate) => !kept.includes(candidate))) {
    ctx.check.add({ group: 'info', code: 'PUBLIC_ENDPOINT_LEFT_OUT', kind: 'public', item: dropped.endpoint.ref, message: 'It cannot be said in a file, so it is not saved.' });
  }
  if (kept.length > 0) {
    const view = await loadSnapshotView(meta, connectionId);
    const names = Object.fromEntries(ctx.refs.tables().map((saved) => [saved.ref, saved.model.name]));
    for (let round = 0; round < 8 && kept.length > 0; round += 1) {
      const draft = { kind: 'app', key: ctx.choices.key, name: ctx.choices.name, publisher: { id: 'local', name: ctx.choices.label }, requiredSchema: { tables: draftTables(ctx) }, publicAccess: kept.map((c) => c.entry), publicKeys } as unknown as Manifest;
      const planned = planPublicEndpoints(draft, names, view);
      const next = kept.filter((candidate, i) => {
        const plan = planned[i];
        const stored = { ...candidate.def } as Rec;
        const narrowing = NARROWING_ONLY.filter((field) => stored[field] !== undefined);
        for (const field of narrowing) delete stored[field];
        const rebuilt = plan === undefined || plan.definition === null ? null : parseDefinition(plan.definition);
        const same = plan !== undefined && plan.issues.length === 0 && rebuilt !== null && rebuilt.ok && canonical(rebuilt.definition) === canonical(stored);
        if (!same) {
          ctx.check.add({ group: 'info', code: 'PUBLIC_ENDPOINT_LEFT_OUT', kind: 'public', item: candidate.endpoint.ref, message: 'It would not install exactly as it is here, so it is not saved.' });
          return false;
        }
        if (narrowing.length > 0) {
          ctx.check.add({ group: 'info', code: 'PUBLIC_ENDPOINT_NARROWED', kind: 'public', item: candidate.endpoint.ref, field: narrowing.join(', '), message: 'What strangers may filter, search or sort by is not saved: after installing they may do less here.' });
        }
        return true;
      });
      if (next.length === kept.length) break;
      kept = next;
    }
  }

  // A named key with nothing left to serve is not saved either.
  const used = new Set(kept.map((c) => c.entry.key ?? CUSTOMER_KEY));
  for (const name of Object.keys(publicKeys)) if (name !== CUSTOMER_KEY && !used.has(name)) delete publicKeys[name];
  if (!used.has(CUSTOMER_KEY)) delete publicKeys[CUSTOMER_KEY];
  if (kept.length === 0) return {};
  ctx.check.add({ group: 'info', code: 'PUBLIC_KEYS_NEW', kind: 'public', item: 'keys', message: 'New keys are made when it is installed: the apps that call it need the new key, and its allowed origins are set again.' });
  return { publicAccess: kept.map((c) => c.entry), ...(Object.keys(publicKeys).length === 0 ? {} : { publicKeys }) };
};
