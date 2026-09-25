// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RBAC permission grammar and its mapping onto the
 * `adminium_role_permissions` matrix rows.
 *
 * Grant strings:
 *
 * ```
 * system:<area>:<verb>                      // closed set — meta SYSTEM_ACTION_KEYS,
 *                                           // e.g. system:users:manage ⇔ `users.manage`
 * table:<connectionId>:<table>:<action>     // action: read|create|update|delete|export|import|read_pii
 * page:<pageId>:<view|edit>
 * app:<appKey>:staff                        // an installed app's staff screens
 * addOn:<addOnKey>:settings                 // one add-on's non-secret settings
 * ```
 *
 * Wildcards: `*` may stand in for any single segment of a stored `table:` or
 * `page:` grant (`table:*:*:read`), with one exception: a `*` ACTION never
 * stands for `read_pii`. Seeing people's phone numbers and addresses is given
 * by name (`table:*:*:read_pii` names it for every table), so a role handed
 * "everything on this table" does not quietly gain it, and no grant stored
 * before the action existed changes meaning. Permissions *checked* at enforcement time
 * are always concrete. `system:` grants are always concrete and validated
 * against the v1 closed set. Deny-by-default: anything unparseable never
 * matches anything.
 *
 * Reserved keys: meta's `RESERVED_SYSTEM_ACTION_KEYS` (automations.manage,
 * webhooks.manage, sql.run) are deferred features with no enforcement point in
 * v1. `manifests.manage` left that list on 2026-08-29 when the
 * `/api/v1/add-ons` routes landed to check it. The grammar here still accepts them — stored grants
 * must keep round-tripping — but no permissions UI may offer them; grantable lists come from meta's
 * `GRANTABLE_SYSTEM_ACTION_KEYS`.
 */

import {
  SYSTEM_ACTION_KEYS,
  type PageActions,
  type PermissionActions,
  type ResourceKind,
  type RolePermission,
  type TableActions,
} from '@adminium/meta';

/**
 * Table matrix actions (`actions` payload). `read_pii` shows the table's
 * personal columns in clear (crud/mask.ts); without it they read as `null`.
 */
export const TABLE_ACTIONS = ['read', 'create', 'update', 'delete', 'export', 'import', 'read_pii'] as const;
export type TableAction = (typeof TABLE_ACTIONS)[number];

/** What a `*` action stands for: every action but `read_pii` (see the header). */
export const WILDCARD_TABLE_ACTIONS = TABLE_ACTIONS.filter(
  (action): action is Exclude<TableAction, 'read_pii'> => action !== 'read_pii',
);

export const PAGE_ACTIONS = ['view', 'edit'] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];

/** Canonical permission constants used by route guards in this wave. */
export const PERMISSIONS = {
  usersManage: 'system:users:manage',
  rolesManage: 'system:roles:manage',
  settingsManage: 'system:settings:manage',
  auditRead: 'system:audit:read',
  apiKeysManage: 'system:api-keys:manage',
  // M7 wave 2 (T5 data-io + T6 scheduled reports). The routes carry local
  // constants (EXPORTS_MANAGE_PERMISSION / IMPORTS_MANAGE_PERMISSION /
  // REPORTS_MANAGE_PERMISSION); these are the canonical spellings.
  exportsManage: 'system:exports:manage',
  importsManage: 'system:imports:manage',
  reportsManage: 'system:reports:manage',
  // Jobs. The routes/realtime hub carry local constants
  // (JOBS_READ_PERMISSION / JOBS_MANAGE_PERMISSION in realtime/hub.ts);
  // these are the canonical spellings.
  jobsRead: 'system:jobs:read',
  jobsManage: 'system:jobs:manage',
  // M16 / — the add-on runtime. Deliberately NOT `settingsManage`:
  // installing an add-on and changing a workspace setting are not the same
  // authority, was amended to say so.
  manifestsManage: 'system:manifests:manage',
  // `filesManage` gates seeing and acting on
  // files somebody else uploaded (lists are mine-only without it); uploading is
  // authorised by the entity table's own grant, never by this. `storageManage`
  // gates the destinations themselves.
  filesManage: 'system:files:manage',
  storageManage: 'system:storage:manage',
  // ONE key this wave, gating both pages, every rule write and every
  // run read. A read-only `automations.read` is a residual: while
  // only super-admins and explicitly-granted admins author rules, a second
  // key would be a switch with nothing behind it.
  automationsManage: 'system:automations:manage',
  // Project folders: what `pull --from` reads (`GET /project/export`).
  projectRead: 'system:project:read',
  // Schema enrichment and the Settings -> AI page. The canonical spelling of
  // the constant `routes/llm/index.ts` carries locally.
  llmRun: 'system:llm:run',
  // The page assistant: opening it and running a turn. Saving what it drafts
  // is NOT this key — that rides `settingsManage`, the same grant the host
  // pages' own saves ride, so a role can be given the assistant without being
  // given the authority to change what the workspace sends out.
  assistantUse: 'system:assistant:use',
} as const;

/**
 * `addOn:<key>:settings` — edit ONE add-on's non-secret settings.
 *
 * Its own grant because `manifests.manage`, the only other door to those
 * settings, also installs and removes add-ons: code that runs in this
 * process. A person who keeps the business name on the invoices up to date
 * needs neither. Always concrete — `addOn:*:settings` is no grant — so a role
 * is given the add-ons it may configure by name.
 */
export function addOnSettingsPermission(addOnKey: string): string {
  return `addOn:${addOnKey}:settings`;
}

/**
 * How the settings grant is stored until the matrix has a kind of its own: an
 * `app` row whose ref is `add-on/<key>`. A `/` is never part of an app key
 * segment, so such a row can never answer an `app:<key>:staff` check.
 */
const ADD_ON_SETTINGS_REF_PREFIX = 'add-on/';

/** The matrix row ref an add-on's settings grant is stored under. */
export function addOnSettingsRef(addOnKey: string): string {
  return `${ADD_ON_SETTINGS_REF_PREFIX}${addOnKey}`;
}

export type ParsedGrant =
  | { kind: 'system'; area: string; verb: string }
  | { kind: 'table'; connectionId: string; table: string; action: TableAction | '*' }
  | { kind: 'page'; pageId: string; action: PageAction | '*' }
  /** `app:<key>:staff` — an installed app's staff screens; `app:*:staff` is every app's. */
  | { kind: 'app'; appKey: string; action: 'staff' }
  | { kind: 'addOn'; addOnKey: string; action: 'settings' };

/** A concrete (wildcard-free) permission, as passed to `can()`/`require()`. */
export type ParsedPermission =
  | { kind: 'system'; area: string; verb: string }
  | { kind: 'table'; connectionId: string; table: string; action: TableAction }
  | { kind: 'page'; pageId: string; action: PageAction }
  | { kind: 'app'; appKey: string; action: 'staff' }
  | { kind: 'addOn'; addOnKey: string; action: 'settings' };

const SYSTEM_KEY_SET: ReadonlySet<string> = new Set(SYSTEM_ACTION_KEYS);
const TABLE_ACTION_SET: ReadonlySet<string> = new Set(TABLE_ACTIONS);
const PAGE_ACTION_SET: ReadonlySet<string> = new Set(PAGE_ACTIONS);

/** Segments may not be empty and may not contain `:`, `/`, or whitespace. */
function validSegment(segment: string): boolean {
  return segment.length > 0 && !/[:\s/]/.test(segment);
}

/**
 * Parse a grant string (wildcards allowed on table/page segments).
 * Returns `null` for anything outside the grammar — never throws.
 */
export function parseGrant(input: string): ParsedGrant | null {
  const segments = input.split(':');
  const kind = segments[0];

  if (kind === 'system' && segments.length === 3) {
    const [, area, verb] = segments as [string, string, string];
    if (!validSegment(area) || !validSegment(verb)) return null;
    if (area === '*' || verb === '*') return null; // system grants are concrete
    if (!SYSTEM_KEY_SET.has(`${area}.${verb}`)) return null; // v1 closed set
    return { kind: 'system', area, verb };
  }

  if (kind === 'table' && segments.length === 4) {
    const [, connectionId, table, action] = segments as [string, string, string, string];
    if (!validSegment(connectionId) || !validSegment(table)) return null;
    if (action !== '*' && !TABLE_ACTION_SET.has(action)) return null;
    return { kind: 'table', connectionId, table, action: action as TableAction | '*' };
  }

  if (kind === 'page' && segments.length === 3) {
    const [, pageId, action] = segments as [string, string, string];
    if (!validSegment(pageId)) return null;
    if (action !== '*' && !PAGE_ACTION_SET.has(action)) return null;
    return { kind: 'page', pageId, action: action as PageAction | '*' };
  }

  if (kind === 'app' && segments.length === 3) {
    const [, appKey, action] = segments as [string, string, string];
    if (!validSegment(appKey) || action !== 'staff') return null;
    return { kind: 'app', appKey, action: 'staff' };
  }

  if (kind === 'addOn' && segments.length === 3) {
    const [, addOnKey, action] = segments as [string, string, string];
    // Concrete only: a wildcard would hand out every add-on's settings,
    // including ones installed after the role was written.
    if (!validSegment(addOnKey) || addOnKey === '*' || action !== 'settings') return null;
    return { kind: 'addOn', addOnKey, action: 'settings' };
  }

  return null;
}

/** Parse a concrete permission for an enforcement check — no wildcards. */
export function parsePermission(input: string): ParsedPermission | null {
  const parsed = parseGrant(input);
  if (parsed === null) return null;
  if (parsed.kind === 'table') {
    if (parsed.connectionId === '*' || parsed.table === '*' || parsed.action === '*') return null;
    return parsed as ParsedPermission;
  }
  if (parsed.kind === 'page') {
    if (parsed.pageId === '*' || parsed.action === '*') return null;
    return parsed as ParsedPermission;
  }
  if (parsed.kind === 'app') {
    if (parsed.appKey === '*') return null;
    return parsed;
  }
  return parsed;
}

function segmentMatches(grantSegment: string, requiredSegment: string): boolean {
  return grantSegment === '*' || grantSegment === requiredSegment;
}

/** Does one stored grant satisfy one concrete required permission? */
export function grantMatches(grant: string, required: string): boolean {
  const g = parseGrant(grant);
  const r = parsePermission(required);
  if (g === null || r === null || g.kind !== r.kind) return false;
  switch (r.kind) {
    case 'system': {
      const gs = g as Extract<ParsedGrant, { kind: 'system' }>;
      return gs.area === r.area && gs.verb === r.verb;
    }
    case 'table': {
      const gt = g as Extract<ParsedGrant, { kind: 'table' }>;
      if (gt.action === '*' && r.action === 'read_pii') return false; // given by name only
      return (
        segmentMatches(gt.connectionId, r.connectionId) &&
        segmentMatches(gt.table, r.table) &&
        segmentMatches(gt.action, r.action)
      );
    }
    case 'page': {
      const gp = g as Extract<ParsedGrant, { kind: 'page' }>;
      return segmentMatches(gp.pageId, r.pageId) && segmentMatches(gp.action, r.action);
    }
    case 'app': {
      const ga = g as Extract<ParsedGrant, { kind: 'app' }>;
      return segmentMatches(ga.appKey, r.appKey);
    }
    case 'addOn': {
      const go = g as Extract<ParsedGrant, { kind: 'addOn' }>;
      return go.addOnKey === r.addOnKey;
    }
  }
}

/**
 * Deny-by-default union check: exact set hit first, then the wildcard scan.
 * `grants` must contain normalized grant strings (as produced by
 * {@link grantsFromMatrixRows}).
 */
export function isGranted(grants: ReadonlySet<string>, required: string): boolean {
  if (parsePermission(required) === null) return false;
  if (grants.has(required)) return true;
  for (const grant of grants) {
    if (grant.includes('*') && grantMatches(grant, required)) return true;
  }
  return false;
}

// --- matrix-row ⇄ grant-string mapping ---------------------------------------

/** `table` resource_ref is `<connectionId>/<schema.table>`. */
function splitTableRef(resourceRef: string): { connectionId: string; table: string } | null {
  const slash = resourceRef.indexOf('/');
  if (slash <= 0 || slash === resourceRef.length - 1) return null;
  return { connectionId: resourceRef.slice(0, slash), table: resourceRef.slice(slash + 1) };
}

/** `system` resource_ref is the dotted action key, e.g. `users.manage`. */
function splitSystemRef(resourceRef: string): { area: string; verb: string } | null {
  const dot = resourceRef.indexOf('.');
  if (dot <= 0 || dot === resourceRef.length - 1) return null;
  return { area: resourceRef.slice(0, dot), verb: resourceRef.slice(dot + 1) };
}

/** Expand matrix rows into the flat, normalized grant-string union. */
export function grantsFromMatrixRows(rows: readonly RolePermission[]): string[] {
  const grants: string[] = [];
  for (const row of rows) {
    if (row.resourceKind === 'system') {
      const ref = splitSystemRef(row.resourceRef);
      if (ref !== null && (row.actions as { allowed?: boolean }).allowed === true) {
        grants.push(`system:${ref.area}:${ref.verb}`);
      }
      continue;
    }
    if (row.resourceKind === 'table') {
      const ref = splitTableRef(row.resourceRef);
      if (ref === null) continue;
      const actions = row.actions as TableActions;
      for (const action of TABLE_ACTIONS) {
        if (actions[action] === true) grants.push(`table:${ref.connectionId}:${ref.table}:${action}`);
      }
      continue;
    }
    if (row.resourceKind === 'app') {
      if ((row.actions as { staff?: boolean }).staff !== true) continue;
      if (row.resourceRef.startsWith(ADD_ON_SETTINGS_REF_PREFIX)) {
        grants.push(addOnSettingsPermission(row.resourceRef.slice(ADD_ON_SETTINGS_REF_PREFIX.length)));
      } else {
        grants.push(`app:${row.resourceRef}:staff`);
      }
      continue;
    }
    const actions = row.actions as PageActions;
    for (const action of PAGE_ACTIONS) {
      if (actions[action] === true) grants.push(`page:${row.resourceRef}:${action}`);
    }
  }
  return grants;
}

export interface MatrixRowInput {
  resourceKind: ResourceKind;
  resourceRef: string;
  actions: PermissionActions;
}

export interface MatrixConversion {
  rows: MatrixRowInput[];
  /** Grant strings outside the grammar (or unknown system keys). */
  invalid: string[];
}

function emptyTableActions(): TableActions {
  return { read: false, create: false, update: false, delete: false, export: false, import: false };
}

/**
 * Group a `grants: string[]` payload (PUT /roles/:id/permissions) into matrix
 * rows, merging grants that land on the same (kind, ref) cell. Invalid grants
 * are collected instead of thrown so the route can 422 with the full list.
 */
export function matrixRowsFromGrants(grants: readonly string[]): MatrixConversion {
  const invalid: string[] = [];
  const tableRows = new Map<string, TableActions>();
  const pageRows = new Map<string, PageActions>();
  const systemRefs = new Set<string>();
  const appRefs = new Set<string>();

  for (const grant of grants) {
    const parsed = parseGrant(grant);
    if (parsed === null) {
      invalid.push(grant);
      continue;
    }
    if (parsed.kind === 'system') {
      systemRefs.add(`${parsed.area}.${parsed.verb}`);
      continue;
    }
    if (parsed.kind === 'app') {
      appRefs.add(parsed.appKey);
      continue;
    }
    if (parsed.kind === 'addOn') {
      appRefs.add(`${ADD_ON_SETTINGS_REF_PREFIX}${parsed.addOnKey}`);
      continue;
    }
    if (parsed.kind === 'table') {
      const ref = `${parsed.connectionId}/${parsed.table}`;
      const actions = tableRows.get(ref) ?? emptyTableActions();
      if (parsed.action === '*') {
        for (const action of WILDCARD_TABLE_ACTIONS) actions[action] = true;
      } else {
        actions[parsed.action] = true;
      }
      tableRows.set(ref, actions);
      continue;
    }
    const actions = pageRows.get(parsed.pageId) ?? { view: false, edit: false };
    if (parsed.action === '*') {
      actions.view = true;
      actions.edit = true;
    } else {
      actions[parsed.action] = true;
    }
    pageRows.set(parsed.pageId, actions);
  }

  const rows: MatrixRowInput[] = [];
  for (const ref of systemRefs) rows.push({ resourceKind: 'system', resourceRef: ref, actions: { allowed: true } });
  for (const [ref, actions] of tableRows) rows.push({ resourceKind: 'table', resourceRef: ref, actions });
  for (const [ref, actions] of pageRows) rows.push({ resourceKind: 'page', resourceRef: ref, actions });
  for (const ref of appRefs) rows.push({ resourceKind: 'app', resourceRef: ref, actions: { staff: true } });
  return { rows, invalid };
}
