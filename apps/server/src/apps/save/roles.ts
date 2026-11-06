// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `roles`.
 *
 * Each travelling role is written with its grants named by the file's own
 * refs: a table grant as `table:@<ref>:<action>`, a page grant as
 * `page:@<ref>:view|edit`, finding and erasing people's data as
 * `privacy:@:people`, one add-on's settings as `addOn:<key>:settings` (only an
 * add-on here for this database), and a grant on an add-on's table on the
 * role's `tables`. What a grant limits (the columns an update writes, the
 * columns a read shows, the rows it reaches) goes to `limits`.
 *
 * A wildcard is never written: it becomes the app's own tables and pages, which
 * is narrower, and Check says so. Any other `system:` grant is named in the
 * file only so the install can list it: the install never gives it, and the
 * owner gives it by hand after installing. Built-in roles never travel.
 */
import type { RoleAddOnTable, RoleLimit } from '@adminium/manifest';
import {
  manifestsRepo,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  SERVER_SCOPE,
  type RolePermission,
  type RowLimit,
  type RowReach,
  type TableActions,
} from '@adminium/meta';

import { TABLE_ACTIONS } from '../../rbac/permissions.js';
import type { ConvertContext, ConvertPart } from './types.js';

type ManifestRole = {
  key: string;
  name: string;
  names?: Record<string, string>;
  permissions?: string[];
  limits?: Record<string, RoleLimit>;
  tables?: RoleAddOnTable[];
};

/** The actions a role may hold on an add-on's table. */
const ADD_ON_TABLE_ACTIONS = ['read', 'create', 'update', 'read_pii', 'delete'] as const;
/** How the matrix stores one add-on's settings grant (`rbac/permissions.ts`). */
const ADD_ON_SETTINGS_REF = 'add-on/';
const ROLE_NAME_MAX = 80;
const TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** `<connectionId>/<table id>` split at the first slash; null when it is not one. */
function tableRefOf(resourceRef: string): { connection: string; table: string } | null {
  const slash = resourceRef.indexOf('/');
  if (slash <= 0 || slash === resourceRef.length - 1) return null;
  return { connection: resourceRef.slice(0, slash), table: resourceRef.slice(slash + 1) };
}

/** The keys of the add-ons this database has: its own, and those kept once per server. */
async function addOnsHere(ctx: ConvertContext): Promise<Set<string>> {
  const repo = manifestsRepo(ctx.source.meta, { encrypt: (v) => v, decrypt: (v) => v });
  const here = [...(await repo.listInScope(ctx.source.connectionId, 'add-on')), ...(await repo.listInScope(SERVER_SCOPE, 'add-on'))];
  return new Set(here.map((one) => one.row.manifestKey));
}

/**
 * A stored limit as the file writes it, or undefined when the grant limits
 * nothing. A listing a row reach does not count (`notThrough`) is a table,
 * named by its ref; one that does not travel is left out and said.
 */
function limitOf(actions: TableActions, tableRef: (id: string) => string | null, dropped: (what: string) => void): RoleLimit | undefined {
  const limit: Record<string, unknown> = {};
  if (actions.updateLimit !== undefined) {
    limit['writable'] = [...actions.updateLimit.writable];
    if (actions.updateLimit.writableValues !== undefined) limit['writableValues'] = actions.updateLimit.writableValues;
    if (actions.updateLimit.writableFrom !== undefined) limit['writableFrom'] = actions.updateLimit.writableFrom;
  }
  if (actions.readLimit !== undefined) limit['readable'] = [...actions.readLimit.readable];
  if (actions.createLimit !== undefined) {
    limit['creatable'] = [...actions.createLimit.writable];
    if (actions.createLimit.writableValues !== undefined) limit['creatableValues'] = actions.createLimit.writableValues;
  }
  if (actions.rowLimit !== undefined) {
    const rows = rowsOf(actions.rowLimit, tableRef, dropped);
    if (rows !== undefined) limit['rows'] = rows;
  }
  return Object.keys(limit).length === 0 ? undefined : (limit as RoleLimit);
}

function rowsOf(stored: RowLimit, tableRef: (id: string) => string | null, dropped: (what: string) => void): RoleLimit['rows'] {
  const reach = (one: RowReach): Record<string, unknown> => {
    const out: Record<string, unknown> = { reach: one.reach };
    if (one.unowned === true) out['unowned'] = true;
    if (one.while !== undefined) out['while'] = { column: one.while.column, in: [...one.while.in] };
    if (one.by !== undefined) out['by'] = one.by;
    if (one.notBy !== undefined) out['notBy'] = one.notBy;
    if (one.via !== undefined) out['via'] = one.via;
    if (one.notThrough !== undefined) {
      const listed = typeof one.notThrough === 'string' ? [one.notThrough] : one.notThrough;
      const refs = listed.flatMap((id) => {
        const ref = tableRef(id);
        if (ref === null) dropped('notThrough');
        return ref === null ? [] : [ref];
      });
      if (refs.length === 1) out['notThrough'] = refs[0];
      else if (refs.length > 1) out['notThrough'] = refs;
    }
    return out;
  };
  const out: Record<string, unknown> = {};
  for (const action of ['read', 'update', 'delete'] as const) {
    const written = stored[action];
    if (written === undefined) continue;
    out[action] = Array.isArray(written) ? written.map(reach) : reach(written as RowReach);
  }
  return Object.keys(out).length === 0 ? undefined : (out as RoleLimit['rows']);
}

export const convertRoles: ConvertPart = async (ctx) => {
  const { meta, connectionId } = ctx.source;
  const { refs, check } = ctx;
  const permissions = permissionsRepo(meta);
  const pagesHere = new Set((await pagesRepo(meta).listForConnection(connectionId)).map((page) => page.id));
  const addOns = await addOnsHere(ctx);
  const installKinds = new Map<string, string | null>();
  const kindOfInstall = async (id: string): Promise<string | null> => {
    if (!installKinds.has(id)) {
      const found = await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).findById(id);
      installKinds.set(id, found?.row.kind ?? null);
    }
    return installKinds.get(id) ?? null;
  };
  const tableRef = (id: string): string | null => refs.table(id) ?? refs.tableByName(id);
  const allTables = refs.tables().map((table) => table.ref);
  const allPages = refs.pages().map((page) => page.ref);

  const out: ManifestRole[] = [];
  for (const { role, key } of refs.roles()) {
    const item = role.name;
    const info = (code: string, message: string, field?: string) => check.add({ group: 'info', code, kind: 'role', item, ...(field === undefined ? {} : { field }), message });
    const grants: string[] = [];
    const give = (grant: string) => {
      if (!grants.includes(grant)) grants.push(grant);
    };
    const limits: Record<string, RoleLimit> = {};
    const tables: RoleAddOnTable[] = [];
    let widened = false;

    const rows: RolePermission[] = await permissions.listForRole(role.id);
    for (const row of rows) {
      if (row.resourceKind === 'table') {
        const split = tableRefOf(row.resourceRef);
        if (split === null || (split.connection !== connectionId && split.connection !== '*')) continue;
        const actions = row.actions as TableActions;
        const held = TABLE_ACTIONS.filter((action) => actions[action] === true);
        if (split.table === '*') {
          // Every table: the app's own tables, which is narrower.
          widened = true;
          for (const ref of allTables) for (const action of held) give(`table:@${ref}:${action}`);
          continue;
        }
        const ref = tableRef(split.table);
        if (ref !== null) {
          for (const action of held) give(`table:@${ref}:${action}`);
          const limit = limitOf(actions, tableRef, (field) => info('LIMIT_TABLE_LEFT_OUT', 'A limit names a table that is not in the app, so that part of the limit is left out.', field));
          if (limit !== undefined) limits[ref] = limit;
          continue;
        }
        const record = refs.heldBy(split.table)?.record;
        if (record !== undefined && record.manifestId !== null &&(await kindOfInstall(record.manifestId)) === 'add-on' && addOns.has(record.appKey)) {
          const actionsOnIt = ADD_ON_TABLE_ACTIONS.filter((action) => actions[action] === true);
          if (actions.export === true || actions.import === true) info('ADD_ON_TABLE_ACTION', 'Export and import on an add-on\'s table are not carried; the role gets them by hand.', record.ref);
          if (actionsOnIt.length === 0) continue;
          const limit = limitOf(actions, () => null, (field) => info('LIMIT_TABLE_LEFT_OUT', 'A limit names a table that is not in the app, so that part of the limit is left out.', field));
          tables.push({ addOn: record.appKey, table: record.ref, actions: actionsOnIt, ...(limit === undefined ? {} : { limit }) });
          continue;
        }
        info('GRANT_TABLE_LEFT_OUT', 'A grant on a table that is not in the app is left out.');
        continue;
      }
      if (row.resourceKind === 'page') {
        const actions = row.actions as { view?: boolean; edit?: boolean };
        const held = (['view', 'edit'] as const).filter((action) => actions[action] === true);
        if (row.resourceRef === '*') {
          widened = true;
          for (const ref of allPages) for (const action of held) give(`page:@${ref}:${action}`);
          continue;
        }
        const ref = refs.page(row.resourceRef);
        if (ref !== null) for (const action of held) give(`page:@${ref}:${action}`);
        else if (pagesHere.has(row.resourceRef)) info('GRANT_PAGE_LEFT_OUT', 'A grant on a page that is not in the app is left out.');
        continue;
      }
      if (row.resourceKind === 'system') {
        if ((row.actions as { allowed?: boolean }).allowed !== true) continue;
        const dot = row.resourceRef.indexOf('.');
        if (dot <= 0) continue;
        const grant = `system:${row.resourceRef.slice(0, dot)}:${row.resourceRef.slice(dot + 1)}`;
        if (grant === 'system:privacy:people') {
          give('privacy:@:people');
          continue;
        }
        // Named so the install can list it; never given by the install.
        give(grant);
        check.add({ group: 'after', code: 'SYSTEM_GRANT', kind: 'role', item, field: grant, afterKind: 'system-grant', message: 'A console permission is never given by an app: the owner gives it to the role after installing.' });
        continue;
      }
      // An app's screens or one add-on's settings.
      if ((row.actions as { staff?: boolean }).staff !== true) continue;
      if (row.resourceRef.startsWith(ADD_ON_SETTINGS_REF)) {
        const addOn = row.resourceRef.slice(ADD_ON_SETTINGS_REF.length);
        if (addOns.has(addOn)) give(`addOn:${addOn}:settings`);
        else info('ADD_ON_NOT_HERE', 'A grant on the settings of an add-on this database does not have is left out.', addOn);
        continue;
      }
      info('APP_SCREENS', 'A grant on another app\'s screens is not carried.', row.resourceRef === '*' ? 'every app' : row.resourceRef);
    }

    if (widened) info('WILDCARD_NARROWED', 'A grant on every table or page is written as a grant on each of the app\'s own tables and pages.');
    if (role.screensOnly) info('SCREENS_ONLY', 'The app has no screens of its own, so the role opens the dashboard.');

    const names = role.names !== null && role.names.from === role.name
      ? Object.fromEntries(Object.entries(role.names.names).filter(([tag, text]) => TAG.test(tag) && text.length > 0).map(([tag, text]) => [tag, text.slice(0, ROLE_NAME_MAX)]))
      : {};
    out.push({
      key,
      name: role.name.slice(0, ROLE_NAME_MAX),
      ...(Object.keys(names).length === 0 ? {} : { names }),
      ...(grants.length === 0 ? {} : { permissions: grants }),
      ...(Object.keys(limits).length === 0 ? {} : { limits }),
      ...(tables.length === 0 ? {} : { tables }),
    });
  }

  // A built-in role is the deployment's: what it holds here never travels, and the person is told.
  for (const role of await rolesRepo(meta).list()) {
    if (!role.isBuiltin) continue;
    const rows = await permissions.listForRole(role.id);
    const here = rows.some((row) => (row.resourceKind === 'table' && row.resourceRef.startsWith(`${connectionId}/`)) || (row.resourceKind === 'page' && pagesHere.has(row.resourceRef)));
    if (here) check.add({ group: 'info', code: 'BUILTIN_ROLE_CHANGED', kind: 'role', item: role.name, message: 'This built-in role holds grants on this database. Built-in roles are not saved in an app.' });
  }

  return out.length === 0 ? {} : ({ roles: out } as never);
};
