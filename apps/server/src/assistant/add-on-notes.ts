// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT INSTALLED ADD-ONS TELL THE ASSISTANT (`addOn.assistant`).
 *
 * An add-on may say what its tables are (one English line a table, a line for
 * a column that needs it) and give questions a person might ask on its pages.
 * Both are read here from the add-on as it is installed, so installing keeps
 * them and removing the add-on takes them away with it: there is no table of
 * their own to forget.
 *
 * WHAT THIS IS NOT. A way to widen what anyone reads, to add a tool, or to
 * switch something on. A line is attached to a table the reader was ALREADY
 * going to be shown, by the tool that shows it; a table they may not read
 * gets no line, because it gets no answer. And a line is DATA about a table:
 * it travels inside a tool's result, under the add-on's name, never in the
 * instructions the assistant is given.
 */
import { ADD_ON_COLUMN_NOTE_MAX, ADD_ON_TABLE_NOTE_MAX } from '@adminium/add-on-contracts';
import { pagesRepo } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { AssistantToolDeps } from './types.js';

/** One line of an add-on's, as it is handed to a model: one line, bounded, whatever the stored manifest holds. */
function line(text: unknown, max: number): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** What an add-on says of one table. */
export interface TableNote {
  /** The add-on's own name: whose words these are. */
  addOn: string;
  is: string;
  columns: Readonly<Record<string, string>>;
}

/** What the add-ons installed and switched on here say of their tables, by each table's id on this database. */
export function tableNotesOn(installs: AddOnInstalls, connectionId: string): Map<string, TableNote> {
  const out = new Map<string, TableNote>();
  for (const key of installs.keys?.(connectionId) ?? []) {
    const found = installs.installed(connectionId, key);
    if (found === null || found.status !== 'installed') continue;
    const name = typeof found.manifest.name === 'string' && found.manifest.name !== '' ? found.manifest.name : key;
    for (const [ref, note] of Object.entries(found.manifest.addOn?.assistant?.tables ?? {})) {
      const id = installs.tableOf(connectionId, key, ref);
      const is = line(note.is, ADD_ON_TABLE_NOTE_MAX);
      if (id === null || is === '') continue;
      const columns = Object.fromEntries(Object.entries(note.columns ?? {}).map(([column, text]) => [column, line(text, ADD_ON_COLUMN_NOTE_MAX)] as const).filter(([, text]) => text !== ''));
      out.set(id, { addOn: name, is, columns });
    }
  }
  return out;
}

/** A question an add-on offers on one of its pages, in the reader's language, with whose it is. */
export interface AddOnStarter {
  key: string;
  text: string;
  /** The add-on's name: a starter of an add-on's is labelled as that add-on's. */
  addOn: string;
}

/** `de_DE` and `de-DE` are one language; an add-on's texts are keyed the second way. */
function inLanguage(text: Readonly<Record<string, string>>, locale: string): string {
  return line(text[locale.replace('_', '-')] ?? text['en-US'] ?? '', 120);
}

/**
 * The questions of one add-on for one of its pages: those written for that
 * page, and those written for all of them. None when the add-on is not
 * installed and switched on, on any database this server has.
 */
export function startersOf(installs: AddOnInstalls, connectionIds: readonly string[], addOnKey: string, pageRef: string, locale: string): AddOnStarter[] {
  for (const connectionId of connectionIds) {
    const found = installs.installed(connectionId, addOnKey);
    if (found === null || found.status !== 'installed') continue;
    const name = typeof found.manifest.name === 'string' && found.manifest.name !== '' ? found.manifest.name : addOnKey;
    return (found.manifest.addOn?.assistant?.questions ?? [])
      .filter((question) => question.page === undefined || question.page === pageRef)
      .map((question) => ({ key: `${addOnKey}:${question.key}`, text: inLanguage(question.text, locale), addOn: name }))
      .filter((starter) => starter.text !== '');
  }
  return [];
}

/**
 * The starters for the page a person is on: an add-on's generated page (the
 * page's own record says which add-on brought it), or one of its own screens
 * (the dashboard says which). A page the person may not view gives none.
 */
export async function startersFor(deps: AssistantToolDeps): Promise<AddOnStarter[]> {
  if (deps.installs === undefined) return [];
  const host = deps.host;
  let addOnKey: string | null = null;
  let pageRef = '';
  let connectionIds: string[] = [];
  if (host.pageId !== undefined && host.pageId !== '') {
    const page = await pagesRepo(deps.meta).findById(host.pageId);
    if (page === null || !page.isEnabled) return [];
    if (!(await deps.can(`page:${page.id}:view`)) && !(await deps.can('system:pages:manage'))) return [];
    const owner = (page.config as { app?: unknown } | null)?.app;
    if (typeof owner !== 'string' || owner === '') return [];
    addOnKey = owner;
    pageRef = page.slug;
    connectionIds = page.connectionId === null ? [] : [page.connectionId];
  } else if (host.addOn !== undefined && host.addOn !== '') {
    addOnKey = host.addOn;
    pageRef = host.addOnPage ?? '';
  }
  if (addOnKey === null) return [];
  if (connectionIds.length === 0) connectionIds = (await deps.manager.connections.list()).filter((row) => !row.disabled).map((row) => row.id);
  const installs = await deps.installs().catch(() => null);
  return installs === null ? [] : startersOf(installs, connectionIds, addOnKey, pageRef, deps.locale);
}
