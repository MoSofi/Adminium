// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S ROLES WILL HOLD OF AN ADD-ON'S TABLES, before anyone agrees.
 *
 * An app may give its roles a hold on an add-on's tables (`roles[].tables`):
 * read a stock line, add a transfer. The table is the add-on's, and its rows
 * may be another app's too, so the check says it table by table, with the
 * columns: what each role reads, changes and fills in, what the app asked for
 * and the add-on keeps back, and — on an update — what is new.
 *
 * Roles that hold the same of one table share a line. Only ever rendered from
 * the install wizard and the update check, both lazy: none of this is in the
 * first paint.
 */
import { KeyRound } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { namesList } from './addOnWords.js';
import type { PlanRoleTable } from './appsApi.js';

const EVERY = '*';

/** One line: a table, the roles holding the same of it, and that hold. */
interface Line {
  entry: PlanRoleTable;
  roles: string[];
}

/** Roles that hold the same of a table, together; in the order the plan lists them. */
function linesOf(entries: readonly PlanRoleTable[]): Line[] {
  const out = new Map<string, Line>();
  for (const entry of entries) {
    const { role: _role, roleName: _name, ...hold } = entry;
    const key = JSON.stringify(hold);
    const line = out.get(key);
    if (line === undefined) out.set(key, { entry, roles: [entry.roleName] });
    else line.roles.push(entry.roleName);
  }
  return [...out.values()];
}

const columnsWords = (columns: readonly string[]): string => (columns.includes(EVERY) ? t('studio:appAddOns.roleTables.everyColumn', 'every column') : columns.join(', '));

function actionWords(action: string): string {
  if (action === 'read') return t('studio:appAddOns.roleTables.action.read', 'read');
  if (action === 'create') return t('studio:appAddOns.roleTables.action.create', 'add rows');
  if (action === 'update') return t('studio:appAddOns.roleTables.action.update', 'change rows');
  return action;
}

/** What one hold lets its roles do, one sentence an action. */
function holdWords(entry: PlanRoleTable): string[] {
  const out: string[] = [];
  if (entry.actions.includes('read')) {
    out.push(
      entry.readable === undefined
        ? t('studio:appAddOns.roleTables.readsAll', 'Reads every column')
        : t('studio:appAddOns.roleTables.reads', 'Reads {columns}', { columns: entry.readable.join(', ') }),
    );
  }
  if (entry.actions.includes('update')) {
    out.push(
      entry.writable === undefined
        ? t('studio:appAddOns.roleTables.changesAll', 'Changes every column')
        : t('studio:appAddOns.roleTables.changes', 'Changes {columns}', { columns: entry.writable.join(', ') }),
    );
  }
  if (entry.actions.includes('create')) {
    out.push(
      entry.creatable === undefined
        ? t('studio:appAddOns.roleTables.addsAll', 'Adds rows, filling in any column')
        : t('studio:appAddOns.roleTables.adds', 'Adds rows, filling in {columns}', { columns: entry.creatable.join(', ') }),
    );
  }
  return out;
}

/** Why nothing of a table is given, when nothing is. */
function nothingWords(entry: PlanRoleTable, addOnName: string): string {
  if (entry.skipped === 'not-offered') return t('studio:appAddOns.roleTables.notOffered', 'Not given: {addOn} shares this table with no app.', { addOn: addOnName });
  if (entry.skipped === 'ledger-table') return t('studio:appAddOns.roleTables.keptBack', 'Not given: {addOn} keeps this table to itself.', { addOn: addOnName });
  if (entry.skipped === 'unknown-table' || entry.skipped === 'unknown-column') return t('studio:appAddOns.roleTables.unknown', 'Not given: {addOn} has no such table or column.', { addOn: addOnName });
  return t('studio:appAddOns.roleTables.allowsLess', 'Not given: {addOn} allows less than this.', { addOn: addOnName });
}

/** What the app asked for and does not get: actions, then columns. */
function narrowedWords(entry: PlanRoleTable): string | null {
  const cut = entry.narrowed;
  if (cut === undefined || entry.actions.length === 0) return null;
  const columns = [...new Set([...(cut.readable ?? []), ...(cut.writable ?? []), ...(cut.creatable ?? [])])];
  const parts = [...cut.actions.map(actionWords), ...columns];
  return parts.length === 0 ? null : t('studio:appAddOns.roleTables.notGiven', 'Asked for, not given: {what}', { what: parts.join(', ') });
}

function widerWords(entry: PlanRoleTable): string | null {
  const wider = entry.wider;
  if (wider === undefined) return null;
  const parts = [...wider.actions.map(actionWords), ...(wider.columns.length === 0 ? [] : [columnsWords(wider.columns)])];
  return t('studio:appAddOns.roleTables.wider', 'New in this version: {what}', { what: parts.join(', ') });
}

/** The holds on one add-on's tables, one line a table and hold. */
export function RoleTablesLines({ entries, addOnName }: { entries: readonly PlanRoleTable[]; addOnName: string }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5" data-part="role-tables-lines">
      {linesOf(entries).map(({ entry, roles }) => {
        const words = holdWords(entry);
        const cut = narrowedWords(entry);
        const wider = widerWords(entry);
        return (
          <li key={`${entry.addOn}/${entry.table}:${roles.join('|')}`} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[11.5px] leading-[1.45]" data-role-table={entry.table}>
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-mono font-bold" dir="ltr">
                {entry.table}
              </span>
              <span className="text-fg-muted">{namesList(roles)}</span>
            </p>
            {words.length === 0 ? (
              <p className="text-fg-subtle">{nothingWords(entry, addOnName)}</p>
            ) : (
              words.map((line) => (
                <p key={line} className="text-fg-muted">
                  {line}
                </p>
              ))
            )}
            {cut === null ? null : <p className="text-fg-subtle">{cut}</p>}
            {wider === null ? null : (
              <p className="font-bold text-warn" data-part="role-table-wider">
                {wider}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * On an add-on's row of the install check: a disclosure, closed, saying how
 * many of its tables the app's roles reach, opened to the lines.
 */
export function RoleTablesDisclosure({ entries, appName, addOnName }: { entries: readonly PlanRoleTable[]; appName: string; addOnName: string }) {
  if (entries.length === 0) return null;
  const tables = new Set(entries.filter((entry) => entry.actions.length > 0).map((entry) => entry.table)).size;
  const unchecked = entries.some((entry) => entry.unchecked === true);
  return (
    <details className="group mt-1.5" data-part="add-on-role-tables">
      <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded text-[11.5px] leading-[1.45] text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <KeyRound aria-hidden className="mt-px size-[13px] shrink-0 text-fg-subtle" />
        <span className="underline decoration-dotted underline-offset-2">
          {t('studio:appAddOns.roleTables.summary', '{app}’s roles get {count, plural, one {# of its tables} other {# of its tables}}. See what they read and change.', { app: appName, count: tables })}
        </span>
      </summary>
      {unchecked ? (
        <p className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-subtle">
          {t('studio:appAddOns.roleTables.unchecked', '{addOn} isn’t on this server yet, so this is what {app} asks for. The add-on may allow less.', { addOn: addOnName, app: appName })}
        </p>
      ) : null}
      <RoleTablesLines entries={entries} addOnName={addOnName} />
      <p className="mt-1.5 text-[11px] leading-[1.45] text-fg-subtle">
        {t('studio:appAddOns.roleTables.keyAndLinks', 'A read also shows each row’s key and its links to other rows.')}
      </p>
    </details>
  );
}

/** What a new version's roles hold more of add-ons' tables: the update's check, which the Update button allows. */
export function RoleTablesUpdateCard({ entries: all }: { entries: readonly PlanRoleTable[] }) {
  // Other apps' roles are their own card.
  const entries = all.filter((entry) => entry.app === undefined);
  if (entries.length === 0) return null;
  return (
    <section className="rounded-[14px] border border-warn/30 bg-warn-soft p-[14px]" data-testid="update-role-tables">
      <h3 className="flex items-center gap-[9px] text-[13px] font-extrabold">
        <KeyRound aria-hidden className="size-4 text-warn" />
        {t('studio:appAddOns.roleTables.updateTitle', 'Roles get more of add-ons’ tables')}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
        {t('studio:appAddOns.roleTables.updateBody', 'This version lets these roles do more with tables that belong to add-ons. Updating allows it.')}
      </p>
      {[...new Set(entries.map((entry) => entry.addOn))].map((addOn) => (
        <RoleTablesLines key={addOn} entries={entries.filter((entry) => entry.addOn === addOn)} addOnName={addOn} />
      ))}
    </section>
  );
}

/**
 * What an add-on's new version gives apps' roles more of its tables (its
 * `appGrants` widened), app by app: on the add-on's own update, and on an
 * app's install or update that brings the add-on's new version along. The
 * button that goes ahead allows it.
 */
export function AppsRoleTablesWiderCard({ entries: all }: { entries: readonly PlanRoleTable[] }) {
  const entries = all.filter((entry) => entry.app !== undefined && entry.wider !== undefined);
  if (entries.length === 0) return null;
  const apps = [...new Set(entries.map((entry) => entry.app!))];
  return (
    <section className="rounded-[14px] border border-warn/30 bg-warn-soft p-[14px]" data-testid="add-on-role-tables-wider">
      <h3 className="flex items-center gap-[9px] text-[13px] font-extrabold">
        <KeyRound aria-hidden className="size-4 text-warn" />
        {t('studio:appAddOns.roleTables.othersTitle', 'Apps’ roles get more of an add-on’s tables')}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
        {t('studio:appAddOns.roleTables.othersBody', 'The add-on’s new version lets these roles do more with its tables. Going ahead allows it.')}
      </p>
      {apps.map((app) => {
        const mine = entries.filter((entry) => entry.app === app);
        return (
          <div key={app} className="mt-2" data-role-tables-app={app}>
            <p className="text-[12px] font-bold">{t('studio:appAddOns.roleTables.appRoles', '{app}’s roles', { app: mine[0]!.appName ?? app })}</p>
            {[...new Set(mine.map((entry) => entry.addOn))].map((addOn) => (
              <RoleTablesLines key={addOn} entries={mine.filter((entry) => entry.addOn === addOn)} addOnName={addOn} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
