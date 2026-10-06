// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BUTTONS A RECORD PAGE MAY SHOW ONE CALLER (`states.actions`).
 *
 * A table's states may name actions; which of them a person is offered, and in
 * which states of the row, is decided here — from the stored rule, the
 * caller's roles and what their roles may write — and nowhere in a browser.
 * A page reads the list beside its other capabilities; an add-on's code page
 * reads the same list through the kit. One function, two readers.
 *
 * Asked ahead, never as a promise: `requires` (a count of rows, a condition,
 * a window on the clock) is not judged here — the button shows, the save
 * refuses, the page says why. And an action that is not offered is still
 * refused by the save that would make it.
 *
 * Meta and the snapshot only: no source read, no lock.
 */
import { addOnManifestSchema } from '@adminium/manifest';
import { appTablesRepo, pagesRepo, rolesRepo, type MetaDb } from '@adminium/meta';

import { addOnPagePermission, pagesAreGated } from '../../add-ons/page-gate.js';
import type { EffectiveColumn, StateActionRule, StateActionTone, StateMoveRule, StoredWords } from '../../connections/effective-schema.js';
import type { TablePrivilegeMap } from '@adminium/engine/adapter';

import { writeRefused } from '../../connections/privileges.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { readLimitsOn } from '../../rbac/read-limits.js';
import { SUPER_ADMIN_SLUG, type PermissionSet } from '../../rbac/resolver.js';
import { assertWithinCreateLimit, assertWithinLimit, createLimitOf, updateLimitOf } from '../../rbac/update-limits.js';

type Scalar = string | number | boolean;

/** One button, as one caller may use it. */
export interface StateActionFact {
  id: string;
  kind: 'move' | 'set' | 'link' | 'child';
  /** In the reader's language. */
  label: string;
  tone: StateActionTone;
  confirm?: string;
  /** The states of the row this caller may use it in; never empty. */
  from: string[];
  /** What a move or a set asks for before it is made. */
  ask?: { column: string; label: string; required: boolean }[];
  /** A link: the record's id is appended. */
  href?: string;
  /** A child form: the child table's id, its link to this row and the columns the form shows. */
  child?: { table: string; via: string; form: string[] };
  /** A child form only: the new row's fixed values. What a move or a set writes never leaves the server. */
  set?: Record<string, Scalar>;
}

export interface StateActionAsker {
  can(permission: string): Promise<boolean>;
  permissions: Pick<PermissionSet, 'superAdmin' | 'roleIds' | 'updateLimits' | 'createLimits' | 'readLimits'>;
  /** The reader's locale (`de_DE`); absent, en_US. */
  locale?: string | undefined;
  /** What the database's own role may write, when known. */
  rights?: TablePrivilegeMap | null | undefined;
  log?: { warn(details: object, message: string): void } | undefined;
}

const words = (stored: StoredWords, locale: string | undefined): string =>
  typeof stored === 'string' ? stored : (stored[locale ?? 'en_US'] ?? stored['en_US'] ?? Object.values(stored)[0] ?? '');

const kindOf = (action: StateActionRule): StateActionFact['kind'] => ('move' in action ? 'move' : 'link' in action ? 'link' : 'child' in action ? 'child' : 'set');

/** Whether a limit lets these values through; no limit lets everything. */
function within(check: () => void): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

/** The caller's role slugs as a move judges them: `'any'` for Super Admin. */
async function rolesOf(meta: MetaDb, permissions: StateActionAsker['permissions']): Promise<ReadonlySet<string> | 'any'> {
  if (permissions.superAdmin) return 'any';
  const repo = rolesRepo(meta);
  const slugs = new Set<string>();
  for (const id of permissions.roleIds) {
    const role = await repo.findById(id);
    if (role !== null) slugs.add(role.slug);
  }
  return slugs.has(SUPER_ADMIN_SLUG) ? 'any' : slugs;
}

/** The installed add-on a link names, as much of it as the gate asks. */
async function addOnPage(meta: MetaDb, key: string, ref: string): Promise<{ gated: boolean } | null> {
  const row = await meta.db.selectFrom('adminium_manifests').select(['manifest', 'status']).where('manifestKey', '=', key).where('kind', '=', 'add-on').executeTakeFirst();
  if (row === undefined || row.status !== 'installed') return null;
  const parsed = addOnManifestSchema.safeParse(typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest);
  if (!parsed.success || !(parsed.data.addOn.pages ?? []).some((page) => page.ref === ref)) return null;
  return { gated: pagesAreGated(parsed.data) };
}

/**
 * The actions of one table this caller may take, or undefined when there is
 * nothing to say (no states, no actions) — and when anything here throws: a
 * facts bug leaves a page with Edit only, never a 500.
 */
export async function stateActionFacts(meta: MetaDb, asker: StateActionAsker, view: SnapshotView, tableId: string): Promise<StateActionFact[] | undefined> {
  try {
    const resolved = view.table(tableId);
    const table = resolved.table;
    const states = table?.states;
    if (table === undefined || states?.actions === undefined || states.actions.length === 0) return undefined;
    const connectionId = view.connectionId;
    const column = (name: string): EffectiveColumn | undefined => table.columns.find((candidate) => candidate.name === name);
    const roles = await rolesOf(meta, asker.permissions);
    const canUpdate = (await asker.can(`table:${connectionId}:${resolved.id}:update`)) && !writeRefused(asker.rights ?? null, resolved.id, 'update');
    const limit = updateLimitOf(asker.permissions, connectionId, resolved.id);
    const writes = (values: Record<string, unknown>): boolean => within(() => assertWithinLimit(limit, resolved.id, values, null));
    // A value the role is asked about ahead: any text stands for "something typed".
    const typed = (columns: readonly string[]): boolean => limit === null || columns.every((name) => limit.writable.includes(name));
    // A column the caller's read does not show is theirs to type only when their update names it — as the save judges it.
    const readTable = view.readAs(readLimitsOn(asker.permissions, connectionId, [resolved.id])).table(resolved.id);
    const hidden = (name: string): boolean => readTable.columns.get(name)?.unreadable === true;
    const mayType = (columns: readonly string[]): boolean => columns.every((name) => !hidden(name) || limit?.writable.includes(name) === true);
    let owner: string | null | undefined;

    const out: StateActionFact[] = [];
    for (const action of states.actions) {
      const kind = kindOf(action);
      let from: string[] = [];
      const fact: Partial<StateActionFact> = {};

      if ('move' in action) {
        const to = action.move.to;
        if (canUpdate && typed([states.column, ...(action.ask ?? [])]) && mayType(action.ask ?? []) && writes({ [states.column]: to })) {
          for (const [state, moves] of Object.entries(states.moves)) {
            const move = moves.map((candidate) => (typeof candidate === 'string' ? { to: candidate } : candidate) as StateMoveRule).find((candidate) => candidate.to === to);
            if (move === undefined || move.planned === true) continue;
            if (move.roles !== undefined && roles !== 'any' && !move.roles.some((slug) => roles.has(slug))) continue;
            from.push(state);
          }
        }
      } else if ('link' in action) {
        const link = action.link;
        if (link.page !== undefined) {
          const page = await pagesRepo(meta).findBySlug(connectionId, link.page);
          if (page !== null && (await asker.can(`page:${page.id}:view`))) {
            from = [...action.in];
            fact.href = `/p/${encodeURIComponent(page.slug)}?${link.param}=`;
          }
        } else if (link.addOnPage !== undefined) {
          const at = link.addOnPage.indexOf(':');
          if (at < 0 && owner === undefined) owner = (await appTablesRepo(meta).forConnection(connectionId)).find((record) => record.tableName === resolved.name)?.appKey ?? null;
          const key = at < 0 ? owner : link.addOnPage.slice(0, at);
          const ref = at < 0 ? link.addOnPage : link.addOnPage.slice(at + 1);
          const target = key === null || key === undefined ? null : await addOnPage(meta, key, ref);
          if (key !== null && key !== undefined && target !== null && (!target.gated || (await asker.can(addOnPagePermission(ref))))) {
            from = [...action.in];
            fact.href = `/add-ons/${encodeURIComponent(key)}/${ref.split('/').map(encodeURIComponent).join('/')}?${link.param}=`;
          }
        }
      } else if ('child' in action) {
        const child = view.table(action.child.table);
        const set = (action.set ?? {}) as Record<string, Scalar>;
        const createLimit = createLimitOf(asker.permissions, connectionId, child.id);
        const may =
          (await asker.can(`table:${connectionId}:${child.id}:create`)) &&
          !writeRefused(asker.rights ?? null, child.id, 'create') &&
          (createLimit === null || action.child.form.every((name) => createLimit.writable.includes(name))) &&
          within(() => assertWithinCreateLimit(createLimit, child.id, set));
        if (may) {
          // The states in which the child's tie to this row refuses a new one are not offered.
          const tie = child.table?.stateParents?.find((parent) => parent.table === resolved.id && parent.via === action.child.via);
          const open = tie?.createIn ?? tie?.parentIn;
          from = action.in.filter((state) => !(tie?.lock === true && tie.lockedIn.includes(state)) && (open === undefined || open.includes(state)));
          fact.child = { table: child.id, via: action.child.via, form: [...action.child.form] };
          if (Object.keys(set).length > 0) fact.set = set;
        }
      } else {
        // Nothing but columns: no move's roles keep it, so the role's own limit does — on every column it writes.
        const fixed = Object.fromEntries(Object.entries(action.set).filter(([, value]) => value === null || typeof value !== 'object'));
        const stamped = Object.entries(action.set).filter(([, value]) => value !== null && typeof value === 'object').map(([name]) => name);
        // The state the page saw is a condition of the change: somebody who does not read it cannot name it.
        if (canUpdate && !hidden(states.column) && typed([...stamped, ...(action.ask ?? [])]) && mayType(action.ask ?? []) && writes(fixed)) from = [...action.in];
      }

      if (from.length === 0) continue;
      const to = 'move' in action ? action.move.to : null;
      const ask = 'ask' in action ? action.ask : undefined;
      out.push({
        id: action.id,
        kind,
        label: words(action.label, asker.locale),
        tone: action.tone ?? 'neutral',
        ...('confirm' in action && action.confirm !== undefined ? { confirm: words(action.confirm, asker.locale) } : {}),
        from,
        ...(ask === undefined || ask.length === 0
          ? {}
          : {
              ask: ask.map((name) => {
                const asked = column(name);
                const when = asked?.requiredWhen;
                const required = asked !== undefined && (!asked.nullable || asked.requiredByRule === true || (to !== null && when?.column === states.column && when.in.some((value) => String(value) === to)));
                return { column: name, label: asked?.label ?? name, required };
              }),
            }),
        ...fact,
      });
    }
    return out;
  } catch (error) {
    asker.log?.warn({ err: error, table: tableId }, 'the record page\'s actions could not be worked out; the page keeps Edit only');
    return undefined;
  }
}
