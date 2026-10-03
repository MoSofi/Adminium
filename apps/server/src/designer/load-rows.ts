// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An attached CSV's rows, loaded into a table of the session's own app (65-T65).
 *
 * This is the dashboard's Import, not a second way to write: the file is kept
 * as an import's file, checked by the import's own validation, and written by
 * the import's own job, so column types, required columns, column rules and
 * hooks hold exactly as they do there, and the load shows in the Imports list
 * with its error report. What is this file's: which table (one of the app's
 * own, by the name the engine gave it, never a name a model wrote), and the
 * words a person reads before saying yes.
 */
import { appTablesRepo, filesRepo, importsRepo, jobsRepo, manifestsRepo, newId, type EnqueueJobInput, type Job, type MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { FileStore } from '../files/store.js';
import { IMPORT_RUN_KIND } from '../jobs/import-run.js';
import { validateRows } from '../routes/imports/index.js';
import type { Actor } from './tool-types.js';

export interface LoadPlan {
  connectionId: string;
  /** The table's real name on the connection. */
  table: string;
  /** The table as the app names it. */
  ref: string;
  /** CSV header → the table's column. */
  mapping: { from: string; to: string }[];
  total: number;
  valid: number;
  /** Rows the check already refuses, and the first reasons, in words. */
  invalid: number;
  reasons: string[];
}

export type LoadOutcome = { ok: true; loaded: number; left: number; reasons: string[] } | { ok: false; why: string };

export interface RowLoader {
  /** Check a load without writing: the table, the mapping, every row. */
  plan(appKey: string, ref: string, csv: { header: string[]; rows: string[][] }, columns: Record<string, string>): Promise<{ ok: true; plan: LoadPlan } | { ok: false; problem: string }>;
  load(plan: LoadPlan, file: { label: string; bytes: Buffer }, by: Actor, signal: AbortSignal): Promise<LoadOutcome>;
}

export interface RowLoaderDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStore;
  credentialCrypto: { encrypt(value: string): string; decrypt(value: string): string };
  enqueue(input: EnqueueJobInput): Promise<Job>;
  jobTimeoutMs?: number;
  pollMs?: number;
}

const said = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createRowLoader(deps: RowLoaderDeps): RowLoader {
  return {
    async plan(appKey, ref, csv, columns) {
      const installed = await manifestsRepo(deps.meta, deps.credentialCrypto).findByKey(appKey);
      const connectionId = installed?.row.connectionId ?? null;
      if (installed === null || installed.row.kind !== 'app' || connectionId === null) {
        return { ok: false, problem: 'The app is not applied yet, so it has no table to load into. apply_app first, then call this again.' };
      }
      const real = await appTablesRepo(deps.meta).realNames(connectionId, appKey);
      const table = real[ref];
      if (table === undefined) {
        return { ok: false, problem: `The app has no applied table "${ref}". Its tables are: ${Object.keys(real).sort().join(', ') || '(none yet: apply_app first)'}.` };
      }
      const connection = await deps.manager.mustFind(connectionId).catch(() => null);
      if (connection === null) return { ok: false, problem: 'The app’s database is not connected.' };
      if (connection.readOnly) return { ok: false, problem: 'The app’s database is read-only here: nothing can be loaded into it.' };

      const view = await loadSnapshotView(deps.meta, connectionId);
      let resolved;
      try {
        resolved = view.table(table);
      } catch (error) {
        return { ok: false, problem: `The table "${ref}" cannot be read yet (${said(error)}). apply_app, then call this again.` };
      }
      if (resolved.readOnly) return { ok: false, problem: `The table "${ref}" is read-only.` };

      const entries = Object.entries(columns).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '');
      if (entries.length === 0) return { ok: false, problem: `Give "columns": which CSV column goes to which column of "${ref}". The CSV's columns are: ${csv.header.join(', ')}.` };
      const headers = new Set(csv.header.map((name) => name.trim()));
      const unknown = entries.filter(([from]) => !headers.has(from.trim())).map(([from]) => from);
      if (unknown.length > 0) return { ok: false, problem: `The CSV has no column ${unknown.map((name) => `"${name}"`).join(', ')}. Its columns are: ${csv.header.join(', ')}.` };
      const tableColumns = resolved.table.columns.map((column) => column.name);
      const missing = entries.filter(([, to]) => !tableColumns.includes(to)).map(([, to]) => to);
      if (missing.length > 0) return { ok: false, problem: `"${ref}" has no column ${missing.map((name) => `"${name}"`).join(', ')}. Its columns are: ${tableColumns.join(', ')}.` };
      const twice = entries.map(([, to]) => to).filter((to, index, all) => all.indexOf(to) !== index);
      if (twice.length > 0) return { ok: false, problem: `Two CSV columns go to the same column (${[...new Set(twice)].join(', ')}). Map each column of "${ref}" once.` };

      // A column of choices takes only its choices. The import does not check this on every engine, so it is checked here, before anyone is asked: rows with a value the app does not know would sit in no column of a board.
      const declared = ((installed.document as { requiredSchema?: { tables?: { ref: string; columns: { ref: string; type?: string; enum?: unknown }[] }[] } } | null)?.requiredSchema?.tables ?? []).find((entry) => entry.ref === ref);
      for (const [from, to] of entries) {
        const column = declared?.columns.find((entry) => entry.ref === to);
        if (column?.type !== 'enum' || !Array.isArray(column.enum)) continue;
        const allowed = new Set(column.enum.filter((value): value is string => typeof value === 'string'));
        const at = csv.header.findIndex((name) => name.trim() === from.trim());
        const other = new Map<string, number>();
        for (const row of csv.rows) {
          const value = (row[at] ?? '').trim();
          if (value !== '' && !allowed.has(value)) other.set(value, (other.get(value) ?? 0) + 1);
        }
        if (other.size > 0) {
          const listed = [...other.entries()].slice(0, 8).map(([value, count]) => `"${value.slice(0, 40)}" (${String(count)} rows)`);
          return {
            ok: false,
            problem: `The column "${to}" of "${ref}" allows only ${[...allowed].join(', ')}, and the file's "${from}" also has ${listed.join(', ')}. Add those values to the column's "enum" in manifest/tables/${ref}.json (spelled as in the file), apply_app, then call this again. Or leave "${from}" out of "columns", and the rows take the column's default.`,
          };
        }
      }

      const mapping = entries.map(([from, to]) => ({ from, to }));
      let report;
      try {
        report = validateRows(csv.rows, csv.header, { columns: mapping }, view, resolved);
      } catch (error) {
        return { ok: false, problem: said(error) };
      }
      if (report.valid === 0) {
        return {
          ok: false,
          problem: `None of the ${String(report.total)} rows can go into "${ref}" as mapped: ${report.issues.slice(0, 5).map((issue) => `row ${String(issue.row)}, ${issue.column}: ${issue.message}`).join('; ')}. Change the mapping or the table's columns, then call this again.`,
        };
      }
      return {
        ok: true,
        plan: {
          connectionId,
          table: resolved.id,
          ref,
          mapping,
          total: report.total,
          valid: report.valid,
          invalid: report.invalid,
          reasons: report.issues.slice(0, 5).map((issue) => `row ${String(issue.row)}, ${issue.column}: ${issue.message}`),
        },
      };
    },

    async load(plan, file, by, signal) {
      if (by.id === null) return { ok: false, why: 'Nobody is signed in to load rows as.' };
      try {
        const fileId = newId('file');
        const written = await deps.storage.write({ id: fileId, kind: 'import', filename: file.label, mime: 'text/csv; charset=utf-8', bytes: file.bytes });
        await filesRepo(deps.meta).create({
          id: fileId,
          filename: file.label,
          mime: 'text/csv; charset=utf-8',
          sizeBytes: written.sizeBytes,
          sha256: written.sha256,
          kind: 'import',
          uploadedBy: by.id,
          storageKey: written.storageKey,
          destinationId: written.destinationId,
          storage: written.storage,
        });
        const imports = importsRepo(deps.meta);
        const row = await imports.create({
          connectionId: plan.connectionId,
          tableName: plan.table,
          requestedBy: by.id,
          fileId,
          mapping: { columns: plan.mapping },
          // New rows only; a row that does not pass is left out and counted, as the card said.
          options: { mode: 'insert', skipInvalid: true },
        });
        await imports.markReady(row.id, { total: plan.total });
        const job = await deps.enqueue({ kind: IMPORT_RUN_KIND, payload: { importId: row.id, userId: by.id } });

        const until = Date.now() + (deps.jobTimeoutMs ?? 300_000);
        for (;;) {
          if (signal.aborted) return { ok: false, why: 'The turn was stopped; the load goes on, and Imports in the dashboard shows how it ended.' };
          const now = await jobsRepo(deps.meta).findById(job.id);
          if (now === null) return { ok: false, why: 'The load’s job is gone.' };
          if (now.status === 'succeeded') break;
          if (now.status === 'failed' || now.status === 'cancelled') return { ok: false, why: now.lastError ?? 'The load did not finish.' };
          if (Date.now() > until) return { ok: false, why: 'The load is taking long; Imports in the dashboard shows how it ends.' };
          await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 400));
        }
        const done = await imports.findById(row.id);
        const loaded = done?.stats?.inserted ?? 0;
        const left = done?.stats?.skipped ?? Math.max(0, plan.total - loaded);
        return { ok: true, loaded, left, reasons: left > 0 ? plan.reasons : [] };
      } catch (error) {
        return { ok: false, why: said(error) };
      }
    },
  };
}
