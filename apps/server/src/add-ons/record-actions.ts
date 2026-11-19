// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH ADD-ONS' ACTIONS A RECORD PAGE SHOWS, AND TO WHOM (`record.actions`).
 *
 * An add-on's `record.actions` fill that names a kind of declared table
 * (`on: "companies"`) is drawn by the generated record page as a button
 * beside "Edit", opening the fill's code in a side sheet (the dashboard's
 * `pages/record/AddOnRecordAction.tsx`). This says which such buttons the
 * record page of one table shows one reader:
 *
 *  - the table is one an app on the database declares as that kind
 *    (`people[].kind`, with the owner's word on it: `leads/companies.ts`);
 *    a people table, or a table nobody declares, shows none;
 *  - the add-on is installed on that database and switched on, and its code
 *    LOADED: a package whose server half was refused (not vouched for, its
 *    files changed on disk) or failed to import shows nothing, as nothing it
 *    would ask of the engine could be answered;
 *  - the reader may change the table (its `update` grant, and the database's
 *    own), as the button only ever leads to a change of the record: a reader
 *    who may only read it sees no button, as they see no "Edit";
 *  - the reader reaches the add-on's database and may open one of its pages
 *    or keep its settings: the engine's routes the fill calls ask the same.
 *
 * Beside the actions, the add-ons that keep where a companies table's fields
 * came from (`addOn.leads`): the page asks each for its notes ("From
 * {source} · {date}"), for any reader of the record who reaches the add-on's
 * database.
 *
 * Read from what is installed and loaded as it stands. A facts bug leaves the
 * page without the button, never a page that does not load.
 */
import type { RecordActionKind } from '@adminium/add-on-contracts';
import { leadsOf } from '@adminium/manifest';
import type { InstalledManifest, ManifestsRepo, MetaDb } from '@adminium/meta';
import type { TablePrivilegeMap } from '@adminium/engine/adapter';
import type { FastifyRequest } from 'fastify';

import { storedTableRef, tableRefIndex } from '../apps/table-ref.js';
import { writeRefused } from '../connections/privileges.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { readerWords } from '../i18n/bcp47.js';
import { installReachOf } from '../installs/reach.js';
import { installManifest } from '../lead-sources/call.js';
import { companiesTablesOn } from '../leads/companies.js';
import { addOnSettingsGrantHeld } from '../rbac/add-on-grant.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { getPrincipal } from '../rbac/principal.js';
import { addOnPagePermission, pagesAreGated } from './page-gate.js';
import type { AddOnRuntimeState } from './runtime.js';

/** The slot an add-on's action on a record fills. */
export const RECORD_ACTIONS_SLOT = 'record.actions';

/** One add-on's action on a record page, as the server offers it to one reader (`GET /pages/:id` · `recordActions`). */
export interface RecordActionFact {
  addOn: string;
  /** The install whose code is drawn: the one on the record's database. */
  installId: string;
  /** The kind of table it acts on. */
  kind: RecordActionKind;
  /** The table as the add-on's tables name it (`<app>:<ref>`): what the fill is handed. */
  table: string;
  /** The button's words in the reader's language (the add-on's English where it wrote none), and its key in the add-on's strings. */
  label: string;
  labelKey: string;
  icon: string;
  /** The fill's file, as the add-ons list names its bundle. */
  client: string;
  order: number;
}

export interface RecordActionsDeps {
  meta: MetaDb;
  manifests: Pick<ManifestsRepo, 'list'>;
  /** The add-ons' loaded code; null before it is built (then no action is shown). */
  runtime: () => AddOnRuntimeState | null;
}

export interface RecordActionsAsker {
  request: FastifyRequest;
  /** The reader's locale (`de_DE`); absent, en_US. */
  locale?: string | undefined;
  /** What the database's own role may write, when known. */
  rights?: TablePrivilegeMap | null | undefined;
}

/** Whether an add-on's code loaded whole: no part of it refused or failed. */
export function addOnLoaded(runtime: AddOnRuntimeState, addOnKey: string, client: string): boolean {
  if (runtime.problems.some((problem) => problem.addOnKey === addOnKey)) return false;
  return (runtime.slots.get(RECORD_ACTIONS_SLOT) ?? []).some((fill) => fill.addOnKey === addOnKey && fill.client === client);
}

/**
 * Whether a person may use an add-on's screens: they manage add-ons, keep its
 * settings, or may open one of its pages (every page, when none is gated).
 * The lead door asks the same of every call.
 */
export async function mayUseAddOnScreens(meta: MetaDb, request: FastifyRequest, install: InstalledManifest): Promise<boolean> {
  if (typeof request.can !== 'function') return true;
  if (await request.can(PERMISSIONS.manifestsManage)) return true;
  const principal = getPrincipal(request);
  if (principal !== null && (await addOnSettingsGrantHeld(meta, principal, install))) return true;
  const manifest = installManifest(install);
  const pages = manifest?.addOn.pages ?? [];
  if (manifest === null || pages.length === 0) return false;
  if (!pagesAreGated(manifest)) return true;
  for (const page of pages) if (await request.can(addOnPagePermission(page.ref))) return true;
  return false;
}

/** An add-on whose fields' sources a record page asks for its notes (`GET /leads/:key/notes`). */
export interface FieldNotesFact {
  addOn: string;
  installId: string;
  /** The table as the add-on's tables name it (`<app>:<ref>`). */
  table: string;
}

/** What a record page of one table offers one reader from the add-ons: its actions, and where its fields' notes are asked. */
export interface RecordAddOnFacts {
  actions?: RecordActionFact[];
  notes?: FieldNotesFact[];
}

/**
 * The add-ons' actions the record page of `tableId` shows this reader (see
 * the header), and the add-ons that keep where its fields came from: every
 * reader of a declared companies table reads those notes, as they read its
 * history, whether or not they may change it. Each absent when there is none.
 */
export async function recordActionsFor(deps: RecordActionsDeps, asker: RecordActionsAsker, view: SnapshotView, tableId: string): Promise<RecordAddOnFacts> {
  const { request } = asker;
  try {
    const connectionId = view.connectionId;
    // Only a table an app declares as companies: the one kind there is (`RECORD_ACTION_KINDS`).
    const kind: RecordActionKind = 'companies';
    const declared = (await companiesTablesOn(deps.meta, connectionId, view)).find((one) => one.table.id === tableId);
    if (declared === undefined) return {};
    const may = async (action: 'read' | 'update'): Promise<boolean> =>
      (typeof request.can !== 'function' || (await request.can(`table:${connectionId}:${tableId}:${action}`))) && (action === 'read' || !writeRefused(asker.rights ?? null, tableId, action));
    if (!(await may('read'))) return {};
    // A reader who may not change the table: no button, as no Edit.
    const changes = await may('update');
    const runtime = deps.runtime();

    const reach = installReachOf(deps.meta, request);
    const actions: RecordActionFact[] = [];
    const notes: FieldNotesFact[] = [];
    let tableRef: string | null = null;
    const refOf = async (): Promise<string> => (tableRef ??= storedTableRef(await tableRefIndex(deps.meta, connectionId, view.model), tableId));
    for (const install of await deps.manifests.list('add-on')) {
      if (install.row.connectionId !== connectionId || install.row.status !== 'installed') continue;
      const manifest = installManifest(install);
      if (manifest === null) continue;
      const key = install.row.manifestKey;
      const fills = (manifest.addOn.slots ?? []).filter((fill) => fill.slot === RECORD_ACTIONS_SLOT && fill.on === kind && fill.label !== undefined && fill.icon !== undefined);
      const keepsSources = leadsOf(manifest) !== null;
      if (fills.length === 0 && !keepsSources) continue;
      if (!(await reach(install))) continue;
      if (keepsSources) notes.push({ addOn: key, installId: install.row.id, table: await refOf() });
      if (!changes || runtime === null || fills.length === 0 || !(await mayUseAddOnScreens(deps.meta, request, install))) continue;
      for (const fill of fills) {
        if (!addOnLoaded(runtime, key, fill.client)) continue;
        actions.push({
          addOn: key,
          installId: install.row.id,
          kind,
          table: await refOf(),
          // Named before any of the add-on's code runs, in the reader's language where the add-on wrote it.
          label: readerWords(fill.labels, asker.locale ?? 'en-US') ?? fill.label!.fallback,
          labelKey: fill.label!.key,
          icon: fill.icon!,
          client: fill.client,
          order: fill.order,
        });
      }
    }
    actions.sort((a, b) => a.order - b.order || (a.addOn < b.addOn ? -1 : a.addOn > b.addOn ? 1 : 0));
    notes.sort((a, b) => (a.addOn < b.addOn ? -1 : a.addOn > b.addOn ? 1 : 0));
    return { ...(actions.length === 0 ? {} : { actions }), ...(notes.length === 0 ? {} : { notes }) };
  } catch (error) {
    request.log?.warn({ table: tableId, reason: error instanceof Error ? error.message : String(error) }, 'the record actions of a table could not be worked out: the page shows none');
    return {};
  }
}
