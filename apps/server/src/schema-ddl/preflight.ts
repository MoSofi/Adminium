// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Preflight.
 *
 * ─── What this turns a confirm dialog into ─────────────────────────────────
 *
 * "This may affect other parts of your app" is an adjective. "This drops a
 * column two pages, one saved view and one public API key depend on, and the
 * key will stop answering within 30 seconds" is a fact the operator can act
 * on. Preflight is what produces the second kind, by asking the questions
 * enumerates against the real meta store rather than guessing.
 *
 * ─── The one with the largest blast radius, first ──────────────────────────
 *
 * A public scope that stops compiling takes the **whole API key dark** —
 * `public-api/resolve.ts:150-162` fails the entire key rather than serving what
 * still resolves, on purpose ("a partially-valid authorization document is not
 * a narrower one; it is an unreviewed one"). And `RESOLVER_TTL_MS` is 30 s with
 * a process-local cache, so in a multi-instance deployment instances go dark at
 * different times. That is worth naming by key id before the confirm, not
 * discovering from a customer.
 *
 * ─── Row counts are measured, not estimated ────────────────────────────────
 *
 * A "this will rewrite N rows" warning is only as good as N. Postgres's
 * `reltuples` is `-1` when never analysed; MySQL's `TABLE_ROWS` is documented
 * as up to 40–50% off for InnoDB and cached for 24 hours. So any table
 * carrying a `rewrite` or full-scan step gets a **capped exact count** through
 * the adapter's existing `count()`, and everything else is left alone —
 * counting every table in a plan to decorate a dialog would be its own outage.
 */
import { touchesEveryRow } from '@adminium/engine';
import type { DdlStep, Consequence } from '@adminium/engine';
import type { MetaDb } from '@adminium/meta';
import { manifestsRepo, pagesRepo, publicKeysRepo, publicScopesRepo, viewsRepo } from '@adminium/meta';

import { checkPrivileges, accessForStepKind, type PrivilegeQuestion } from './privileges.js';

/*
 * Which steps get counted, and which get refused above the ceiling, are now ONE
 * question — `touchesEveryRow` in the engine, beside the hazard matrix it reads.
 *
 * They used to be two, and they disagreed: `COUNT_WORTHY = ['rewrite','lossy']`
 * decided the counting and `step.hazard === 'rewrite'` decided the refusing, so
 * a `lossy` step was counted, warned about, and could never be refused. A
 * narrowing type change on a 400-million-row table is `lossy` — its own
 * rationale says "MySQL copies the whole table" — and it went straight past the
 * ceiling that exists to stop it. Both sets also missed D18's full-scan
 * `locking` kinds entirely.
 */

export interface PreflightInput {
  meta: MetaDb;
  connectionId: string;
  steps: readonly DdlStep[];
  /** Capped exact count for one table; wired to the adapter's `count()`. */
  countRows?: (tableId: string) => Promise<{ value: number; capped: boolean } | null>;
  /** The live connection, for the privilege probe. Absent = skip it. */
  privileges?: {
    db: Parameters<typeof checkPrivileges>[0];
    dialect: Parameters<typeof checkPrivileges>[1];
  };
  /** Ceiling above which a rewrite is refused rather than warned. */
  rewriteRefuseAbove?: number;
  /** Row count above which a rewrite is warned about. */
  rewriteWarnAbove?: number;
  /**
   * D18's one door through the row ceiling.
   *
   * Keyed by TABLE, not by step. The count is a fact about a table, one table's
   * ceiling can gate several steps in the same plan, and a step id
   * (`create-table-1`) is POSITIONAL — it changes when the plan changes, so an
   * acknowledgement keyed to one would silently stop matching after any edit.
   *
   * Both halves are required to open it: a principal who is Super Admin, and
   * that principal having named the table. Neither alone is enough, and the
   * `acknowledged` set is populated only from what the caller typed.
   */
  ceilingDoor?: {
    superAdmin: boolean;
    /** Table ids the operator confirmed by typing the table's own name. */
    acknowledged: ReadonlySet<string>;
  };
}

/** One table the row ceiling gates, and what it would take to pass it. */
export interface CeilingGate {
  table: string;
  /** Rows measured. When `capped`, a lower bound rather than the total. */
  rows: number;
  capped: boolean;
  /** Whether the acknowledgement for this table was supplied and accepted. */
  acknowledged: boolean;
  /** Whether this principal could open it at all (D18: Super Admin only). */
  openable: boolean;
}

export interface PreflightResult {
  /** `stepId → consequences`, ready to attach to the plan. */
  consequences: Map<string, Consequence[]>;
  /**
   * Tables the ceiling gates, and whether this principal can open that gate —
   * the plan-LEVEL fact the client needs to render D18's second confirm field.
   *
   * Plan-level rather than a field on the refusal, because `planReply`'s
   * refusal object is a closed Zod shape and Fastify's serializer silently
   * strips anything not declared in it: a `door` property added to a refusal
   * would exist on the server, survive every server test, and never reach the
   * browser.
   */
  ceilings: CeilingGate[];
  /** Steps preflight turned into refusals, by step id. */
  refusals: Map<string, { code: string; message: string }>;
  /** Row counts it measured, for the UI and the ledger. */
  rowCounts: Map<string, { value: number; capped: boolean }>;
}

/** O2's defaults: warn above 100k, refuse above 1M. */
export const DEFAULT_REWRITE_WARN_ABOVE = 100_000;
export const DEFAULT_REWRITE_REFUSE_ABOVE = 1_000_000;

export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  const consequences = new Map<string, Consequence[]>();
  const refusals = new Map<string, { code: string; message: string }>();
  const rowCounts = new Map<string, { value: number; capped: boolean }>();
  const ceilings: CeilingGate[] = [];
  const add = (stepId: string, consequence: Consequence): void => {
    const list = consequences.get(stepId) ?? [];
    list.push(consequence);
    consequences.set(stepId, list);
  };

  const warnAbove = input.rewriteWarnAbove ?? DEFAULT_REWRITE_WARN_ABOVE;
  const refuseAbove = input.rewriteRefuseAbove ?? DEFAULT_REWRITE_REFUSE_ABOVE;

  // --- 1. privileges, per target (D17) -----------------------------
  if (input.privileges !== undefined) {
    /*
     * A table this plan is CREATING cannot be owned yet, so it must never be
     * asked about as an alter target. Postgres answers "you do not own
     * public.reservations" for a table that does not exist — which is true and
     * useless, and it refused the very foreign key that made the table worth
     * creating. The `CREATE` privilege on the schema, checked once for the
     * create step, is what authorises everything the new table needs.
     */
    const beingCreated = new Set(
      input.steps.filter((s) => s.kind === 'create-table').map((s) => s.table),
    );
    const questions: PrivilegeQuestion[] = [
      ...new Map(
        input.steps
          .filter((s) => s.kind === 'create-table' || !beingCreated.has(s.table))
          .map((s) => [
            `${s.table}:${accessForStepKind(s.kind)}`,
            { tableId: s.table, access: accessForStepKind(s.kind) } as PrivilegeQuestion,
          ]),
      ).values(),
    ];
    const verdicts = await checkPrivileges(input.privileges.db, input.privileges.dialect, questions);
    const denied = new Map(
      verdicts.filter((v) => !v.allowed).map((v) => [`${v.tableId}:${v.access}`, v]),
    );
    for (const step of input.steps) {
      if (step.kind !== 'create-table' && beingCreated.has(step.table)) continue;
      const verdict = denied.get(`${step.table}:${accessForStepKind(step.kind)}`);
      if (verdict !== undefined) {
        refusals.set(step.id, {
          code: 'INSUFFICIENT_PRIVILEGE',
          message: verdict.reason ?? `the connected role cannot ${verdict.access} "${verdict.tableId}"`,
        });
      }
    }
  }

  // --- 2. row counts for the steps that rewrite ---------------------
  if (input.countRows !== undefined) {
    const tables = [
      ...new Set(input.steps.filter((s) => touchesEveryRow(s)).map((s) => s.table)),
    ];
    for (const tableId of tables) {
      const count = await input.countRows(tableId).catch(() => null);
      /*
       * A count that FAILED is an unknown, and an unknown is not zero.
       *
       * This read `if (count === null) continue`, which deleted the row-count
       * consequence, the ceiling refusal and D18's acknowledgement door in one
       * line — so anything that made the query fail (a lock, a statement
       * timeout, a killed connection, or simply a table too big to scan inside
       * the server's own timeout) switched the whole gate off for that apply,
       * on exactly the tables the gate exists to protect. It failed OPEN.
       *
       * `COUNT_UNAVAILABLE` fails closed instead: Adminium will not rewrite a
       * table whose size it could not establish. That is a refusal an operator
       * can act on — grant the count, or run the change with their own tooling
       * — where silence was not.
       */
      if (count === null) {
        for (const step of input.steps) {
          if (step.table !== tableId || !touchesEveryRow(step)) continue;
          refusals.set(step.id, {
            code: 'COUNT_UNAVAILABLE',
            message:
              `Adminium could not count "${tableId}", so it cannot tell whether this change is ` +
              'within the row ceiling. It will not rewrite a table of unknown size.',
          });
        }
        continue;
      }
      rowCounts.set(tableId, count);
      if (count.value > refuseAbove && input.steps.some((st) => st.table === tableId && touchesEveryRow(st))) {
        ceilings.push({
          table: tableId,
          rows: count.capped ? count.value - 1 : count.value,
          capped: count.capped,
          acknowledged: input.ceilingDoor?.acknowledged.has(tableId) === true,
          openable: input.ceilingDoor?.superAdmin === true,
        });
      }
      for (const step of input.steps) {
        if (step.table !== tableId || !touchesEveryRow(step)) continue;
        const shown = count.capped
          ? `over ${(count.value - 1).toLocaleString('en-US')}`
          : count.value.toLocaleString('en-US');
        add(step.id, {
          kind: 'row-count',
          message: `${shown} row${count.value === 1 && !count.capped ? '' : 's'} will be rewritten`,
          refs: [],
        });
        /*
         * A CAPPED count still proves the ceiling.
         *
         * This read `!count.capped`, on the reasonable-sounding ground that a
         * capped number is not the real one. But the count is capped at one
         * PAST the ceiling, so reaching the cap is a lower bound above it —
         * proof, not an estimate. With the guard in place the refusal could
         * never fire for exactly the tables it exists to protect: the ones too
         * big to count.
         */
        if (count.value > refuseAbove) {
          /*
           * D18's door, and the reason it is checked HERE rather than at apply.
           *
           * Preflight is the one place that decides refusals, and the plan the
           * operator authorises has to be the plan that runs (D2). Suppressing
           * the refusal only on the apply path produced two different plans —
           * a refused step compiles to no SQL (`compileFor`), so the door-open
           * plan hashed differently and `applySchemaEdit`'s checksum compare
           * threw SCHEMA_DRIFT before the door was ever consulted. The door
           * could not open at all. It is worse on SQLite, where a
           * `rebuild-table` step compiles to no SQL either way: the two plans
           * hashed IDENTICALLY, so a checksum taken from a refused plan would
           * have replayed straight into a door-open apply.
           *
           * So the plan itself takes the acknowledgement, and the checksum
           * covers it (`checksumOf`).
           */
          const opened =
            input.ceilingDoor?.superAdmin === true &&
            input.ceilingDoor.acknowledged.has(tableId);
          if (!opened) {
            refusals.set(step.id, {
              code: 'TABLE_TOO_LARGE',
              message:
                `"${tableId}" holds ${shown} rows, over the ${refuseAbove.toLocaleString('en-US')}-row ` +
                'ceiling. A Super Admin can authorise it by naming the table; anyone else should run ' +
                'this change during a maintenance window with their own tooling.',
            });
          }
        } else if (count.value > warnAbove) {
          add(step.id, {
            kind: 'row-count',
            message:
              'This table is large enough that the change may hold a lock for a noticeable time.',
            refs: [],
          });
        }
      }
    }
  }

  /*
   * --- 2b. what a RENAME moves, and what it deliberately does not ----------
   *
   * A rename is `safe` for the data and anything but safe for the references.
   * D33 rewrites Adminium's own — page bindings, role grants, schema
   * overrides, the included-table list, the diagram layout — and four things
   * keep the old name on purpose.
   *
   * Not inside `addDependents`: that pass runs only for destructive steps and
   * describes what BREAKS ("N saved views will stop resolving"), which is the
   * wrong sentence for a change that repairs them. The drop path stated both
   * halves and the rename path stated neither, so the entire review pane for a
   * rename read "A metadata-only rename." — true of the table, false of the
   * app around it, and a rename is the change an operator is most likely to
   * assume is harmless.
   */
  for (const step of input.steps) {
    if (step.kind !== 'rename-table' && step.kind !== 'rename-column') continue;
    add(step.id, {
      kind: 'repaired',
      message:
        'Adminium follows the new name: page bindings, role grants, schema overrides, the ' +
        'included-table list and the diagram layout are all rewritten in the same operation.',
      refs: [],
    });
    add(step.id, {
      kind: 'not-repaired',
      message:
        'Audit history and import history keep the OLD name on purpose (they are a record of ' +
        'what happened). Notification links and file attachments pointing here will not resolve.',
      refs: [],
    });
  }

  // --- 3. dependent objects -------------------------------------------
  const destructive = input.steps.filter(
    (s) => s.kind === 'drop-table' || s.kind === 'drop-column' || s.hazard === 'lossy',
  );
  if (destructive.length > 0) {
    await addDependents(input, destructive, add);
  }

  return { consequences, refusals, rowCounts, ceilings };
}

/**
 * Enumerate what says a drop or rename breaks. Every lookup here is a real
 * query; nothing is inferred from naming.
 */
async function addDependents(
  input: PreflightInput,
  steps: readonly DdlStep[],
  add: (stepId: string, consequence: Consequence) => void,
): Promise<void> {
  const { meta, connectionId } = input;
  const tables = new Set(steps.map((s) => s.table));

  const pages = pagesRepo(meta);
  const navRows = await pages.navRows().catch(() => []);
  const byTable = new Map<string, { slug: string; id: string }[]>();
  for (const row of navRows) {
    if (row.connectionId !== connectionId || row.sourceTable === null) continue;
    const list = byTable.get(row.sourceTable) ?? [];
    list.push({ slug: row.slug, id: row.id });
    byTable.set(row.sourceTable, list);
  }

  // Saved views hang off a page, so a table's views are its pages' views.
  const views = viewsRepo(meta);
  const viewsByTable = new Map<string, string[]>();
  for (const table of tables) {
    const names: string[] = [];
    for (const page of byTable.get(table) ?? []) {
      const list = await views.listForPageUser(page.id, '').catch(() => []);
      names.push(...list.map((v) => v.name));
    }
    if (names.length > 0) viewsByTable.set(table, names);
  }

  /*
   * The largest blast radius in the table: a scope that stops compiling
   * takes the whole KEY dark, not just the resource that named the table.
   *
   * ─── Why this probe reads the document as TEXT ─────────────────────────────
   *
   * `PublicScope.document` is declared `string` and the repo normalises it to
   * text whatever the store did — it is already JSON. Running `JSON.stringify`
   * over it produced the ESCAPED form (`\"public.orders\"`), so the
   * `"table"` probe matched nothing and **this consequence had never once
   * fired for a real scope**. Verified in a browser: a table read by a live
   * publishable key planned a drop whose review pane said nothing about it.
   *
   * There was no test either — the highest-consequence lookup in the file was
   * the only one nobody had asserted.
   */
  const scopes = await publicScopesRepo(meta)
    .listByConnection(connectionId)
    .catch(() => []);
  const publicKeys = publicKeysRepo(meta);
  const scopesByTable = new Map<string, { id: string; name: string }[]>();
  for (const scope of scopes) {
    const document =
      typeof scope.document === 'string' ? scope.document : JSON.stringify(scope.document ?? {});
    for (const table of tables) {
      const bare = table.slice(table.lastIndexOf('.') + 1);
      if (document.includes(`"${table}"`) || document.includes(`"${bare}"`)) {
        const list = scopesByTable.get(table) ?? [];
        list.push({ id: scope.id, name: scope.name });
        scopesByTable.set(table, list);
      }
    }
  }

  /*
   * …and which KEYS those scopes carry, because a key is the thing that is
   * published. A scope id is an internal handle; the operator's question is
   * "which of the keys I have given out stops working", and answering it with
   * the scope alone leaves them to go and look that up under time pressure.
   */
  const keysByScope = new Map<string, { id: string; name: string }[]>();
  for (const list of scopesByTable.values()) {
    for (const scope of list) {
      if (keysByScope.has(scope.id)) continue;
      const bound = await publicKeys.listByScope(scope.id).catch(() => []);
      keysByScope.set(
        scope.id,
        bound.filter((k) => k.revokedAt === null).map((k) => ({ id: k.id, name: k.name })),
      );
    }
  }

  // A table an installed add-on declares is not the operator's to drop while
  // the add-on is attached. `requiredSchema` is validated at install and
  // never re-checked; this is the lookup that makes it a live guard.
  const manifests = await manifestsRepo(meta, {} as never)
    .list()
    .catch(() => []);
  const addOnTables = new Set<string>();
  for (const installed of manifests) {
    const required = (installed.document as { requiredSchema?: { tables?: { ref?: string }[] } })
      ?.requiredSchema?.tables;
    for (const t of required ?? []) {
      if (typeof t.ref === 'string') addOnTables.add(t.ref);
    }
  }

  for (const step of steps) {
    const table = step.table;
    const bare = table.slice(table.lastIndexOf('.') + 1);

    const boundPages = byTable.get(table) ?? [];
    if (boundPages.length > 0) {
      add(step.id, {
        kind: 'page',
        message:
          `${boundPages.length} page${boundPages.length === 1 ? '' : 's'} read this table. ` +
          'Generated pages are pruned on the next regeneration; a page whose layout you edited ' +
          'is kept and will be broken.',
        refs: boundPages.map((p) => p.slug),
      });
    }

    const viewNames = viewsByTable.get(table) ?? [];
    if (viewNames.length > 0) {
      add(step.id, {
        kind: 'saved-view',
        message: `${viewNames.length} saved view${viewNames.length === 1 ? '' : 's'} will stop resolving.`,
        refs: viewNames,
      });
    }

    const affectedScopes = scopesByTable.get(table) ?? [];
    if (affectedScopes.length > 0) {
      const affectedKeys = affectedScopes.flatMap((scope) => keysByScope.get(scope.id) ?? []);
      const scopeNames = affectedScopes.map((scope) => scope.name).join(', ');
      add(step.id, {
        kind: 'public-scope',
        message:
          `Public API access will STOP for ${
            affectedKeys.length === 0
              ? 'every key bound to'
              : `${affectedKeys.length} publishable key${affectedKeys.length === 1 ? '' : 's'} on`
          } ${affectedScopes.length} scope${affectedScopes.length === 1 ? '' : 's'} (${scopeNames})` +
          ' — the WHOLE key stops, not just this table, and up to 30 seconds apart across server ' +
          'instances.',
        // The keys, not the scopes: a key is what was published, and it is what
        // the operator has to go and replace.
        refs: affectedKeys.length > 0 ? affectedKeys.map((k) => k.id) : affectedScopes.map((s) => s.id),
      });
      if (affectedKeys.length > 0) {
        add(step.id, {
          kind: 'public-scope',
          message: `Keys that stop working: ${affectedKeys.map((k) => k.name).join(', ')}.`,
          refs: affectedKeys.map((k) => k.id),
        });
      }
    }

    if (addOnTables.has(bare) || addOnTables.has(table)) {
      add(step.id, {
        kind: 'manifest',
        message: 'An installed add-on declares this table in its required schema.',
        refs: [bare],
      });
    }

    if (step.kind === 'drop-table' || step.kind === 'drop-column') {
      // The "not repaired" row, stated rather than left to be discovered.
      add(step.id, {
        kind: 'not-repaired',
        message:
          'Audit history and import history keep the old name on purpose (they are a record of ' +
          'what happened). Notification links and file attachments pointing here will not resolve.',
        refs: [],
      });
    }
  }
}
