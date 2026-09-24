// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing endpoints and the keys made from them.
 *
 * `derive.ts` says what a key's grants add up to; this file decides what may
 * be COMMITTED, and commits it all or not at all.
 *
 * ── AN ENDPOINT SAVE REWRITES EVERY LIVE KEY THAT GRANTS IT ────────────────
 * One endpoint is shared by many keys, so saving it regenerates each of their
 * documents. Three rules decide what a save may do:
 *
 * 1. **Refuse only what the save INTRODUCES.** Each affected key's
 *    stored document and its regenerated one are compiled against the schema
 *    as it is now, and the save is refused only when the new one raises an
 *    issue the old one did not. A key already broken by drift in another
 *    endpoint is then repaired one save at a time. Refusing every save that
 *    leaves it broken would make it unrepairable.
 * 2. **Derive outside the transaction, commit on a revision.**
 *    Compiling reads the meta store, and on SQLite the store has ONE
 *    connection, which a transaction holds. So everything is derived first;
 *    the commit is short and advances `adminium_public_api_state.revision`
 *    only if nobody else did in between. If somebody did, it derives again.
 * 3. **Only live keys regenerate.** A revoked or expired key keeps the
 *    document it had.
 *
 * ── A KEY IS WRITTEN SCOPE FIRST ────────────────────────────────────────────
 * The key's id is minted up front, its document is derived and compiled, and
 * then — in one transaction — the scope row (naming the key) and the key row
 * (naming the scope) are inserted. A virtual endpoint the key is granted is
 * stored first, outside that transaction, because two creates may race to
 * store it and the loser must read the winner's row.
 */

import {
  newId,
  overridesRepo,
  publicApiStateRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  publicScopesRepo,
  type KeyEnabledBy,
  type KeyStaffBinding,
  type MetaDb,
  type PublicEndpoint,
  type PublicKey,
} from '@adminium/meta';
import { createHash } from 'node:crypto';

import type { SnapshotView } from '../crud/identifiers.js';
import {
  dedupeIssues,
  deriveScopeDocument,
  derivedDocumentIssues,
  documentMentions,
  endpointMap,
  introducedIssues,
  parseAccess,
  wideningOf,
  type DeriveEndpoint,
  type PublicKeyKind,
  type Widening,
} from './derive.js';
import {
  canonicalMethods,
  effectiveEndpoints,
  ENDPOINT_REF_PATTERN,
  endpointIssues,
  parseDefinition,
  printDefinition,
  type PublicEndpointDefinition,
  type PublicMethod,
} from './endpoint.js';
import { DECIDED_COLUMN_OPS, managedEditIssues, managedGrantIssues } from './managed-key.js';
import { compileScope, type InheritedTenantConfig, type PublicScopeDocument, type ScopeIssue } from './scope.js';

/* ------------------------------------------------------------------ errors */

/** A live key, named in a refusal so the operator sees what would break. */
export interface KeyRef {
  id: string;
  name: string;
  prefix: string;
  scopeId: string;
}

/** A save refused: every issue, and the keys it would have broken. → 422 */
export class EndpointSaveRefused extends Error {
  override readonly name = 'EndpointSaveRefused';
  constructor(
    readonly issues: readonly ScopeIssue[],
    readonly keys: readonly KeyRef[],
  ) {
    super(`endpoint save refused: ${issues.map((i) => i.code).join(', ')}`);
  }
}

/** Another writer kept winning the revision. The request may simply be retried. → 409 */
export class PublicApiContended extends Error {
  override readonly name = 'PublicApiContended';
}

/** Live keys grant the endpoint, so it cannot be deleted or renamed. → 409 `PUBLIC_KEYS_LIVE` */
export class EndpointInUse extends Error {
  override readonly name = 'EndpointInUse';
  constructor(readonly keys: readonly KeyRef[]) {
    super(`${keys.length} live key(s) grant this endpoint`);
  }
}

/** No stored endpoint under that ref. → 404 */
export class EndpointNotFound extends Error {
  override readonly name = 'EndpointNotFound';
}

/** Another endpoint of the connection holds the ref. → 409 */
export class EndpointRefTaken extends Error {
  override readonly name = 'EndpointRefTaken';
}

/** A key create refused with every issue. → 422 */
export class KeyCreateRefused extends Error {
  override readonly name = 'KeyCreateRefused';
  constructor(readonly issues: readonly ScopeIssue[]) {
    super(`key create refused: ${issues.map((i) => i.code).join(', ')}`);
  }
}

/**
 * A generated endpoint the sheet showed is not what the server would store
 * now — the table was re-introspected, or somebody stored the ref meanwhile.
 * → 409 `PUBLIC_ENDPOINT_CHANGED`
 */
export class EndpointChanged extends Error {
  override readonly name = 'EndpointChanged';
  constructor(readonly refs: readonly string[]) {
    super(`these endpoints changed since they were shown: ${refs.join(', ')}`);
  }
}

/* ------------------------------------------------------------------ helpers */

/**
 * A short fingerprint of what a generated endpoint selects. The keys sheet
 * sends back the fingerprint it showed, and a create that would store a
 * different column set is refused rather than granting columns nobody saw.
 */
export function selectHash(definition: Pick<PublicEndpointDefinition, 'source' | 'select'>): string {
  return createHash('sha256').update(JSON.stringify([definition.source, definition.select])).digest('hex').slice(0, 16);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The derived-scope wording for a missing time zone. A derived document has
 * no `timezone` of its own, so the scope compiler's "or state one on this
 * scope" names a remedy that does not exist here.
 */
function forDerived(issues: readonly ScopeIssue[]): ScopeIssue[] {
  return issues.map((i) =>
    i.code === 'SCOPE_TIMEZONE_INVALID'
      ? { ...i, message: "no time zone is configured for this connection. Set the connection's time zone." }
      : i,
  );
}

/* ----------------------------------------------------------------- service */

export interface EndpointServiceDeps {
  meta: MetaDb;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  tenantConfigOf: (connectionId: string) => Promise<InheritedTenantConfig | undefined>;
  /** The resolver's per-key invalidation, run after each commit. */
  invalidate?: (keyId: string) => void;
  now?: () => number;
  /** Compare-and-set attempts before giving up. */
  maxAttempts?: number;
}

interface AffectedKey {
  ref: KeyRef;
  kind: PublicKeyKind;
  appKey: string | null;
  /** The installed app that made the key: held to the safe list. */
  managedBy: string | null;
  access: Record<string, PublicMethod[]>;
  storedDocument: unknown;
}

export interface SaveEndpointInput {
  connectionId: string;
  ref: string;
  definition: PublicEndpointDefinition;
  /** Used only when the save creates the row. */
  origin?: 'generated' | 'custom';
  actorId?: string | null;
  /** The installed app the endpoint belongs to; set only when the save creates the row. */
  managedBy?: string | null;
}

export interface SaveCheck {
  /** Everything that refuses the save: the definition's own issues, then what it would break. */
  issues: ScopeIssue[];
  /** Keys the save would break. */
  keys: KeyRef[];
  /** Keys whose regenerated document still fails — broken before this save, and not by it. */
  keysStillBroken: KeyRef[];
  /** Live BROWSER keys that would gain something, per key. */
  widened: (KeyRef & { gains: Widening[] })[];
}

export interface SaveEndpointResult extends Omit<SaveCheck, 'issues' | 'keys'> {
  endpoint: PublicEndpoint;
  /** Every key whose document was rewritten. */
  regenerated: KeyRef[];
}

export interface CreateKeyGrant {
  ref: string;
  methods: readonly PublicMethod[];
  /**
   * For a generated endpoint not yet stored: what the sheet showed. A
   * mismatch refuses the create.
   */
  source?: string;
  selectHash?: string;
}

export interface CreateKeyInput {
  connectionId: string;
  name: string;
  access: readonly CreateKeyGrant[];
  /** The secret, generated and sealed by the caller — this file never sees plaintext. */
  secret: { prefix: string; tokenHash: string; tokenEncrypted: string };
  appKey?: string | null;
  origins?: string[];
  expiresAt?: number | null;
  actorId?: string | null;
  /** `browser` (default) or `server`. The caller generated the matching secret. */
  kind?: PublicKeyKind;
  /** The installed app that made the key, which alone may take it back. */
  managedBy?: string | null;
  /** Which of the app's browser keys (default `customer`). */
  purpose?: string;
  /** Bound to a signed-in staff member holding this app role. */
  requiresStaff?: KeyStaffBinding | null;
  /** Switched off by a yes/no in the app's settings row. */
  enabledBy?: KeyEnabledBy | null;
}

export function createEndpointService(deps: EndpointServiceDeps) {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const endpoints = publicEndpointsRepo(meta);
  const keys = publicKeysRepo(meta);
  const scopes = publicScopesRepo(meta);
  const state = publicApiStateRepo(meta);
  const maxAttempts = deps.maxAttempts ?? 5;

  /** Live keys whose grant includes `endpointId`, or whose stored document names `ref`. */
  async function affectedKeys(connectionId: string, endpointId: string | null, ref: string, at: number): Promise<AffectedKey[]> {
    const out: AffectedKey[] = [];
    for (const row of await keys.listLiveDerived(connectionId, at)) {
      const access = parseAccess(row.access);
      const storedDocument = parseJson(row.scopeDocument);
      const grants = endpointId !== null && hasOwn(access, endpointId);
      if (!grants && !documentMentions(storedDocument, ref)) continue;
      out.push({
        ref: { id: row.id, name: row.name, prefix: row.prefix, scopeId: row.scopeId },
        kind: row.kind === 'server' ? 'server' : 'browser',
        appKey: row.appKey,
        managedBy: row.managedBy,
        access,
        storedDocument,
      });
    }
    return out;
  }

  /** The columns of `source` Adminium decides (copied, coded, numbered, totalled, stamped, a balance, a late flag). */
  async function decidedColumns(connectionId: string, source: string): Promise<Set<string>> {
    const rows = (await overridesRepo(meta).listForConnection(connectionId)).filter((o) => o.status === 'active' && o.tableName === source);
    const flag = rows.find((o) => o.op === 'table.booking')?.value['cancel'] as { flag?: unknown } | undefined;
    const balances = rows.flatMap((o) => {
      const balance = o.op === 'column.rollup' ? (o.value['balance'] as { column?: unknown } | undefined) : undefined;
      return typeof balance?.column === 'string' ? [balance.column] : [];
    });
    return new Set([
      ...rows.filter((o) => DECIDED_COLUMN_OPS.includes(o.op)).flatMap((o) => (o.columnName === null ? [] : [o.columnName])),
      ...(typeof flag?.flag === 'string' ? [flag.flag] : []),
      ...balances,
    ]);
  }

  /** Everything a save would do, computed without writing anything. */
  async function plan(input: SaveEndpointInput) {
    const { connectionId, ref, definition } = input;
    const at = now();
    const revision = await state.read();
    const view = await deps.viewFor(connectionId);
    const inherited = await deps.tenantConfigOf(connectionId);
    const stored = await endpoints.listByConnection(connectionId);
    const existing = stored.find((e) => e.ref === ref) ?? null;
    // A new endpoint is in no key's `access` yet, so its placeholder id only
    // has to be distinct while deriving.
    const endpointId = existing?.id ?? `new:${ref}`;

    const before = endpointMap(stored);
    const after = new Map(before);
    after.set(endpointId, { id: endpointId, ref, definition });

    const affected = await affectedKeys(connectionId, existing?.id ?? null, ref, at);
    const appBound = affected.some((k) => k.appKey !== null && hasOwn(k.access, endpointId));
    const own = endpointIssues(definition, { ref, view, grantedToAppBoundKey: appBound });
    const managed = affected.filter((k) => k.managedBy !== null && hasOwn(k.access, endpointId));
    const priorDefinition = existing === null ? null : parseDefinition(existing.definition);
    const decided = managed.length === 0 ? new Set<string>() : await decidedColumns(connectionId, definition.source);

    const introduced: ScopeIssue[] = [];
    const breaking: KeyRef[] = [];
    const stillBroken: KeyRef[] = [];
    const widened: (KeyRef & { gains: Widening[] })[] = [];
    const writes: { key: AffectedKey; document: PublicScopeDocument }[] = [];

    for (const key of affected) {
      const old = deriveScopeDocument({ kind: key.kind, access: key.access }, before, view);
      const next = deriveScopeDocument({ kind: key.kind, access: key.access }, after, view);
      const oldIssues = [...derivedDocumentIssues(key.storedDocument, view, inherited), ...old.issues];
      const newIssues = [...derivedDocumentIssues(next.document, view, inherited), ...next.issues];
      const added = introducedIssues(oldIssues, newIssues);
      if (added.length > 0) {
        introduced.push(...forDerived(added));
        breaking.push(key.ref);
        continue;
      }
      if (newIssues.length > 0) stillBroken.push(key.ref);
      const gains = key.kind === 'browser' ? wideningOf(key.storedDocument, next.document) : [];
      if (gains.length > 0) widened.push({ ...key.ref, gains });
      if (managed.includes(key)) {
        const held = (key.access[endpointId] ?? []).filter((m) => definition.methods.includes(m));
        const unsafe = [
          ...managedGrantIssues(ref, definition, held, decided),
          ...managedEditIssues(ref, priorDefinition?.ok === true ? priorDefinition.definition : null, definition, gains),
        ];
        if (unsafe.length > 0) {
          introduced.push(...unsafe);
          breaking.push(key.ref);
          continue;
        }
      }
      writes.push({ key, document: next.document });
    }

    const check: SaveCheck = {
      issues: [...own, ...dedupeIssues(introduced)],
      keys: breaking,
      keysStillBroken: stillBroken,
      widened,
    };
    return { check, at, revision, existing, writes };
  }

  /** The builder's Apply and Save: what a save would refuse, break and widen (the `/check` route). */
  async function checkEndpoint(input: SaveEndpointInput): Promise<SaveCheck> {
    return (await plan(input)).check;
  }

  /**
   * Store an endpoint definition and regenerate every live key that grants it
   * — all of it, or none of it. Throws {@link EndpointSaveRefused}.
   */
  async function saveEndpoint(input: SaveEndpointInput): Promise<SaveEndpointResult> {
    const text = printDefinition(input.definition);
    await state.ensure(now());
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { check, at, revision, existing, writes } = await plan(input);
      if (check.issues.length > 0) throw new EndpointSaveRefused(check.issues, check.keys);

      const committed = await meta.db.transaction().execute(async (trx) => {
        if (!(await state.advanceFrom(revision, at, trx))) return null;
        let row: PublicEndpoint;
        if (existing === null) {
          row = await endpoints.create(
            {
              connectionId: input.connectionId,
              ref: input.ref,
              origin: input.origin ?? 'custom',
              definition: text,
              createdBy: input.actorId ?? null,
              managedBy: input.managedBy ?? null,
            },
            at,
            trx,
          );
        } else {
          await endpoints.update(existing.id, { definition: text }, at, trx);
          row = { ...existing, definition: text, updatedAt: at };
        }
        for (const w of writes) {
          await scopes.update(w.key.ref.scopeId, { document: JSON.stringify(w.document) }, at, trx);
        }
        return row;
      });
      if (committed === null) continue;

      for (const w of writes) deps.invalidate?.(w.key.ref.id);
      return {
        endpoint: committed,
        keysStillBroken: check.keysStillBroken,
        widened: check.widened,
        regenerated: writes.map((w) => w.key.ref),
      };
    }
    throw new PublicApiContended('the public API changed under this save too many times; try again');
  }

  /**
   * Delete an endpoint. Refused with {@link EndpointInUse} while a live
   * key grants it (the scope-delete rule, kept).
   *
   * A GENERATED endpoint is not deleted but switched off — stored with no
   * methods — so its virtual default, full CRUD, does not quietly come back
   * the moment the row is gone. When its table no longer exists
   * there is no default to come back, and the row is deleted.
   */
  async function removeEndpoint(input: { connectionId: string; ref: string }): Promise<{ outcome: 'deleted' | 'switched-off'; before: PublicEndpoint }> {
    const existing = await endpoints.findByRef(input.connectionId, input.ref);
    if (existing === null) throw new EndpointNotFound(`no endpoint "${input.ref}"`);
    const live = await affectedKeys(input.connectionId, existing.id, input.ref, now());
    if (live.length > 0) throw new EndpointInUse(live.map((k) => k.ref));

    if (existing.origin === 'generated') {
      const parsed = parseDefinition(existing.definition);
      const view = await deps.viewFor(input.connectionId);
      if (parsed.ok) {
        const off = { ...parsed.definition, methods: [] };
        if (endpointIssues(off, { ref: input.ref, view }).length === 0) {
          await saveEndpoint({ connectionId: input.connectionId, ref: input.ref, definition: off });
          return { outcome: 'switched-off', before: existing };
        }
      }
    }
    const at = now();
    await state.ensure(at);
    await meta.db.transaction().execute(async (trx) => {
      await endpoints.remove(existing.id, trx);
      await state.bump(at, trx);
    });
    return { outcome: 'deleted', before: existing };
  }

  /**
   * Rename an endpoint. Refused while a live key grants it: a rename
   * breaks every deployed page that calls the old path, and nothing in the
   * derived document would notice.
   */
  async function renameEndpoint(input: { connectionId: string; ref: string; to: string }): Promise<PublicEndpoint> {
    if (!ENDPOINT_REF_PATTERN.test(input.to) || input.to.length > 64) {
      throw new EndpointSaveRefused(
        [{ code: 'ENDPOINT_REF_INVALID', message: `"${input.to}" is not a ref`, ref: input.to }],
        [],
      );
    }
    const existing = await endpoints.findByRef(input.connectionId, input.ref);
    if (existing === null) throw new EndpointNotFound(`no endpoint "${input.ref}"`);
    if (input.to === input.ref) return existing;
    if ((await endpoints.findByRef(input.connectionId, input.to)) !== null) {
      throw new EndpointRefTaken(`"${input.to}" is another endpoint's ref`);
    }
    const live = await affectedKeys(input.connectionId, existing.id, input.ref, now());
    if (live.length > 0) throw new EndpointInUse(live.map((k) => k.ref));
    const parsed = parseDefinition(existing.definition);
    if (!parsed.ok) throw new EndpointSaveRefused(parsed.issues, []);
    const text = printDefinition({ ...parsed.definition, path: `/${input.to}` });
    const at = now();
    await state.ensure(at);
    await meta.db.transaction().execute(async (trx) => {
      await endpoints.update(existing.id, { ref: input.to, definition: text }, at, trx);
      await state.bump(at, trx);
    });
    return { ...existing, ref: input.to, definition: text, updatedAt: at };
  }

  /**
   * Create a key from endpoint grants. Throws {@link KeyCreateRefused}
   * with every issue, or {@link EndpointChanged} when a generated endpoint is
   * no longer what the sheet showed.
   */
  async function createKey(input: CreateKeyInput): Promise<{ key: PublicKey; document: PublicScopeDocument }> {
    const { connectionId } = input;
    const kind: PublicKeyKind = input.kind ?? 'browser';
    await state.ensure(now());

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const revision = await state.read();
      const view = await deps.viewFor(connectionId);
      const inherited = await deps.tenantConfigOf(connectionId);
      const stored = await endpoints.listByConnection(connectionId);
      const effective = effectiveEndpoints(view, stored);
      const byRef = new Map(effective.endpoints.map((e) => [e.ref, e]));

      const issues: ScopeIssue[] = [];
      const changed: string[] = [];
      const seen = new Set<string>();
      let total = 0;
      for (const grant of input.access) {
        const methods = canonicalMethods(grant.methods);
        total += methods.length;
        if (seen.has(grant.ref)) {
          issues.push({ code: 'KEY_REF_DUPLICATE', message: `"${grant.ref}" is granted twice`, ref: grant.ref });
          continue;
        }
        seen.add(grant.ref);
        const endpoint = byRef.get(grant.ref);
        if (endpoint?.definition === null || endpoint?.definition === undefined) {
          issues.push({ code: 'KEY_REF_UNKNOWN', message: `there is no endpoint "${grant.ref}"`, ref: grant.ref });
          continue;
        }
        if (!endpoint.stored) {
          const shown = grant.source !== undefined && grant.source !== endpoint.definition.source;
          const hashed = grant.selectHash !== undefined && grant.selectHash !== selectHash(endpoint.definition);
          if (shown || hashed) changed.push(grant.ref);
        }
        // An app's own key: only what the safe list allows.
        if (input.managedBy !== undefined && input.managedBy !== null) {
          const decided = await decidedColumns(connectionId, endpoint.definition.source);
          issues.push(...managedGrantIssues(grant.ref, endpoint.definition, methods, decided));
        }
        const offered = new Set(endpoint.definition.methods);
        for (const m of methods) {
          if (!offered.has(m)) {
            issues.push({
              code: 'KEY_METHOD_NOT_OFFERED',
              message: `"${grant.ref}" does not offer ${m}`,
              ref: grant.ref,
            });
          }
        }
      }
      if (total === 0) issues.push({ code: 'KEY_NO_METHOD', message: 'grant at least one method' });
      // A hosted surface is a browser, so its key is a browser key.
      if (kind === 'server' && input.appKey !== undefined && input.appKey !== null) {
        issues.push({ code: 'KEY_SERVER_APP_BOUND', message: 'a server key cannot be bound to a hosted app' });
      }
      if (kind === 'server' && input.origins !== undefined && input.origins.length > 0) {
        issues.push({ code: 'KEY_SERVER_ORIGINS', message: 'a server key is refused from every browser; it takes no origins' });
      }
      if (changed.length > 0) throw new EndpointChanged(changed);

      // Derive against placeholder ids for the virtual ones: a document names
      // refs, never ids, so it is the same document once they are stored.
      const map = new Map<string, DeriveEndpoint>();
      const access: Record<string, PublicMethod[]> = {};
      for (const grant of input.access) {
        const endpoint = byRef.get(grant.ref);
        if (endpoint?.definition === null || endpoint?.definition === undefined) continue;
        const id = endpoint.id ?? `virtual:${endpoint.ref}`;
        map.set(id, { id, ref: endpoint.ref, definition: endpoint.definition });
        access[id] = canonicalMethods(grant.methods);
      }
      const derivation = deriveScopeDocument({ kind, access }, map, view);
      issues.push(...derivation.issues);
      if (issues.length === 0) {
        issues.push(...forDerived(derivedDocumentIssues(derivation.document, view, inherited)));
      }
      if (issues.length > 0) throw new KeyCreateRefused(dedupeIssues(issues));

      // Store the generated endpoints the key is granted. Outside any
      // transaction: two creates may race on the same ref.
      const realAccess: Record<string, PublicMethod[]> = {};
      for (const [id, methods] of Object.entries(access)) {
        const endpoint = map.get(id) as DeriveEndpoint;
        if (!id.startsWith('virtual:')) {
          realAccess[id] = methods;
          continue;
        }
        const text = printDefinition(endpoint.definition);
        const row = await endpoints.createOrGet({
          connectionId,
          ref: endpoint.ref,
          origin: 'generated',
          definition: text,
          createdBy: input.actorId ?? null,
        });
        // Somebody stored something else under the ref meanwhile.
        if (row.definition !== text) throw new EndpointChanged([endpoint.ref]);
        realAccess[row.id] = methods;
      }

      const compiled = compileScope(derivation.document, undefined, inherited, { derived: true });
      const keyId = newId('pbk');
      const at = now();
      const key = await meta.db.transaction().execute(async (trx) => {
        if (!(await state.advanceFrom(revision, at, trx))) return null;
        const scope = await scopes.create(
          {
            connectionId,
            side: derivation.document.side,
            name: input.name,
            timezone: compiled.timezone,
            document: JSON.stringify(derivation.document),
            derivedForKey: keyId,
            createdBy: input.actorId ?? null,
          },
          at,
          trx,
        );
        return keys.create(
          {
            id: keyId,
            name: input.name,
            prefix: input.secret.prefix,
            tokenHash: input.secret.tokenHash,
            tokenEncrypted: input.secret.tokenEncrypted,
            scopeId: scope.id,
            side: derivation.document.side,
            access: realAccess,
            kind,
            ...(input.appKey === undefined || input.appKey === null ? {} : { appKey: input.appKey }),
            ...(input.origins === undefined ? {} : { origins: input.origins }),
            ...(input.managedBy === undefined || input.managedBy === null ? {} : { managedBy: input.managedBy }),
            ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
            ...(input.requiresStaff === undefined || input.requiresStaff === null ? {} : { requiresStaff: input.requiresStaff }),
            ...(input.enabledBy === undefined || input.enabledBy === null ? {} : { enabledBy: input.enabledBy }),
            createdBy: input.actorId ?? null,
            expiresAt: input.expiresAt ?? null,
          },
          at,
          trx,
        );
      });
      if (key === null) continue;
      return { key, document: derivation.document };
    }
    throw new PublicApiContended('the public API changed under this key create too many times; try again');
  }

  return { checkEndpoint, saveEndpoint, removeEndpoint, renameEndpoint, createKey };
}

export type EndpointService = ReturnType<typeof createEndpointService>;
