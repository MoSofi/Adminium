// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side apply EXECUTOR (06-llm-assist.md §8.3, T10b).
 *
 * The transactional counterpart to the browser-safe pure planner
 * (`@adminium/llm` `buildApplyPlan`, T10a): it turns a reviewed run + the
 * accepted suggestion-id set into ordered write descriptors and executes them in
 * ONE `@adminium/meta` transaction — upserting `adminium_schema_overrides`
 * (`origin: 'llm'`, `llm_run_id`) and `adminium_pages` (nav groups, template
 * pages, dashboard pages) per §8.3.
 *
 * Architecture (01 §2.3): provider network + prompt building live elsewhere; the
 * planner is pure and browser-safe; only THIS layer touches the DB. It builds on
 * T07's run-service (status machine, review persistence) and the T09 diff.
 *
 * The three §8.3 invariants it enforces at the write layer:
 *  - **Provenance (user > llm).** Overrides are upserted through
 *    {@link llmOverridesRepo}, which only ever reads/writes `origin: 'llm'` rows —
 *    a user edit is never touched or superseded. The plan additionally excludes
 *    `user-locked` suggestions (they are computed from the live user overrides
 *    and fed into the diff), so a locked target produces no descriptor at all.
 *  - **Idempotency.** Overrides upsert on `(connection, op, table, column)` and
 *    pages upsert on a deterministic id derived from the suggestion-id, so
 *    re-applying the same run writes no duplicates and re-applying a NEWER run
 *    supersedes the prior one (new `llm_run_id`).
 *  - **Undo.** Every insert/update captures a before-image inside the apply
 *    transaction; {@link undoApply} reverts exactly this apply in one transaction.
 *
 * After a durable apply the optional {@link ApplyServiceDeps.regenerate} hook
 * runs the existing generation path so pages pick up the new overrides
 * (localized labels flow through the schema-override i18n layer, never the static
 * locale bundles — §8.3 / 10-i18n-theming.md).
 */

import { createHash } from 'node:crypto';

import { classifyModel, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import {
  buildApplyPlan,
  applyPlanSummary,
  columnLabelId,
  diffEnrichment,
  enumId,
  keyId,
  normalizeHeuristicBaseline,
  normalizeLlmResponse,
  piiId,
  relationId,
  tableLabelId,
  type ApplyPlan,
  type ApplyPlanSummary,
  type DashboardPageWrite,
  type LlmResponseV1,
  type NavGroupWrite,
  type SuggestionDiff,
  type TemplatePageWrite,
} from '@adminium/llm';
import {
  llmOverridesRepo,
  overridesRepo,
  packJson,
  readJson,
  snapshotsRepo,
  writeBool,
  type LlmOverride,
  type LlmRun,
  type LlmRunReview,
  type MetaDb,
  type SchemaOverride,
} from '@adminium/meta';

import { RunNotFoundError, type RunService } from './run-service.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

/** applyRun targeted a run that is not in the `validated` state (§7.4). */
export class RunNotApplicableError extends Error {
  override name = 'RunNotApplicableError';
  constructor(readonly runId: string, readonly status: string) {
    super(`llm run ${runId} is ${status}; only a validated run can be applied`);
  }
}

/** applyRun targeted a run whose snapshot is missing — validation always needs it (§7.4). */
export class SnapshotNotFoundError extends Error {
  override name = 'SnapshotNotFoundError';
  constructor(readonly snapshotId: string) {
    super(`schema snapshot not found: ${snapshotId}`);
  }
}

// ─── Public shapes ─────────────────────────────────────────────────────────────

/** Nav-field before-image for a single page (undo of a nav-group re-placement). */
export interface PageNavBefore {
  id: string;
  navGroup: string | null;
  navOrder: number;
  updatedAt: number;
}

/**
 * Everything needed to revert exactly one apply in a single transaction. Returned
 * from {@link ApplyResult.undo} and consumed by {@link undoApply}; the route layer
 * (T11) parks it in the app-wide undo store and calls back on the toast action.
 */
export interface ApplyUndo {
  connectionId: string;
  /** Override rows inserted by this apply — undo deletes them. */
  insertedOverrideIds: string[];
  /** Override rows superseded by this apply — undo restores these images. */
  updatedOverrides: LlmOverride[];
  /** Page rows inserted by this apply — undo deletes them. */
  insertedPageIds: string[];
  /** Page rows whose nav placement this apply changed — undo restores these images. */
  updatedPages: PageNavBefore[];
}

export interface ApplyCounts {
  /** Override rows written (inserted + superseded). */
  overrides: number;
  /** Page rows created (template + dashboard). */
  pages: number;
  /** Page rows re-placed into a nav group. */
  navGroupUpdates: number;
  /**
   * Accepted template suggestions that wrote no page because the generator
   * already emits one for that `(table, template)` pair — the recommendation
   * is satisfied by the existing page rather than duplicated beside it.
   */
  templatePagesAlreadyCovered: number;
}

export interface ApplyResult {
  run: LlmRun;
  plan: ApplyPlan;
  summary: ApplyPlanSummary;
  /** Accepted/rejected suggestion-id lists persisted on the run (§8.3). */
  review: LlmRunReview;
  /** True when some actionable suggestion was rejected → `partially_applied`. */
  partial: boolean;
  counts: ApplyCounts;
  undo: ApplyUndo;
}

export interface ApplyRunOptions {
  /** The user performing the apply — stamped on the run + created rows. */
  appliedBy?: string | null;
}

/** Context handed to the post-apply regeneration hook (§8.3 step 3). */
export interface RegenerateContext {
  connectionId: string;
  snapshotId: string;
  runId: string;
  appliedBy: string | null;
}

export interface ApplyServiceDeps {
  meta: MetaDb;
  /** T07 run-service — read the run + drive the applied/partially_applied transition. */
  runService: RunService;
  /**
   * Post-apply regeneration (§8.3 step 3): rerun the existing generation path so
   * pages reflect the new overrides. Injected (not hard-wired) so the executor
   * stays testable without a live source connection; the route layer supplies the
   * `runGeneration`-backed implementation. Generated pages are regenerated;
   * `origin: 'llm'` pages this apply created are preserved (never pruned), and
   * a generated page whose `(table, template)` pair one of them already covers
   * is dropped from that run rather than re-created beside it (`generate/run.ts`).
   */
  regenerate?: (ctx: RegenerateContext) => Promise<void> | void;
  /**
   * `LLM_WIDGET_DATA_CONTRACTS` — widget id → the data shapes it accepts,
   * injected as data because the server tree may not import `@adminium/widgets`
   * (01 §2.3). Threaded into `buildApplyPlan` so a widget's query descriptor
   * asks for a shape that widget can actually read; omitted, the planner falls
   * back to inferring the shape from the bound columns, which is what bound
   * every time-columned KPI card as a `timeseries` it could not render.
   */
  widgetContracts?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Clock override — tests. */
  now?: () => number;
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

/** The unqualified name of a `"schema.table"` id. */
function localName(qualified: string): string {
  const dot = qualified.lastIndexOf('.');
  return dot < 0 ? qualified : qualified.slice(dot + 1);
}

/** `snake_case`/`kebab` → `Title Case` for a page-row fallback title. */
function titleCase(name: string): string {
  return name
    .split(/[_\-\s.]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Slugify for a unique-per-connection page slug. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic `page_<hash>` id (≤ char(36)) from the connection + a stable
 * suggestion-id, so a template/dashboard page upserts (never duplicates) across
 * re-applies and newer-run supersessions. The connection scopes the hash:
 * suggestion-ids are pure coordinate functions (`template:main.orders:page-…`),
 * so two connections applying the same golden response would otherwise collide
 * on the page PRIMARY KEY and the second apply would silently rewrite the first
 * connection's row instead of creating its own.
 */
function pageIdFor(connectionId: string, suggestionId: string): string {
  const hash = createHash('sha256')
    .update(`${connectionId}:${suggestionId}`)
    .digest('hex')
    .slice(0, 30);
  return `page_${hash}`;
}

/**
 * Map an existing `origin: 'user'` override to the §8.1 suggestion-id it locks,
 * so the diff can mark that suggestion `user-locked` (provenance user > llm).
 * Ops with no LLM-refinement counterpart (exclude/hidden/semanticType) return null.
 *
 * Only `user` rows lock. `auto` rows — the introspector's proposed PII masks —
 * deliberately do not: they are the engine's guess, and letting them lock would
 * make a misclassification permanent (see `proposePiiMasks` in
 * connections/introspect.ts).
 */
function userLockedSuggestionId(o: SchemaOverride): string | null {
  const col = o.columnName;
  switch (o.op) {
    case 'table.label':
      return tableLabelId(o.tableName);
    case 'column.label':
      return col === null ? null : columnLabelId(o.tableName, col);
    case 'table.keyField':
      return keyId(o.tableName);
    case 'column.pii':
      return col === null ? null : piiId(o.tableName, col);
    case 'column.enumLabels':
      return col === null ? null : enumId(o.tableName, col);
    case 'relation.add': {
      const v = o.value as { fromColumn?: string; toTable?: string; toColumn?: string };
      if (typeof v.fromColumn !== 'string' || typeof v.toTable !== 'string' || typeof v.toColumn !== 'string') {
        return null;
      }
      return relationId(o.tableName, [v.fromColumn], v.toTable, [v.toColumn]);
    }
    default:
      return null;
  }
}

/**
 * Diff rows that are accept/reject units for review accounting (§8.2).
 * `heuristic-only` (the LLM offered nothing) and `user-locked` (§8.2 provenance:
 * a user edit is never superseded) are not offered for acceptance at all.
 */
export const ACTIONABLE_STATUSES: ReadonlySet<SuggestionDiff['status']> = new Set([
  'agree',
  'conflict',
  'llm-new',
  'rejects-heuristic',
]);

/**
 * The headless form of the review screen's "Accept all ≥ N" bulk control
 * (§10.3). Lives here, beside {@link ACTIONABLE_STATUSES}, because "which rows
 * may be accepted" is a diff-semantics question — the CLI's `--yes-above` and
 * any future bulk-apply caller must not each decide it for themselves.
 *
 * Only actionable rows qualify, so a threshold of 0 still cannot accept a
 * `user-locked` row.
 */
export function selectAcceptedByConfidence(
  diff: readonly SuggestionDiff[],
  minConfidence: number,
): string[] {
  return diff
    .filter((row) => ACTIONABLE_STATUSES.has(row.status) && row.confidence >= minConfidence)
    .map((row) => row.id);
}

// ─── Service ─────────────────────────────────────────────────────────────────

export function createApplyService(deps: ApplyServiceDeps) {
  const { meta, runService } = deps;
  const now = deps.now ?? Date.now;

  /** Recompute the reviewed diff + plan for a validated run and a chosen accept set. */
  async function buildPlanForRun(
    run: LlmRun,
    acceptedIds: Iterable<string>,
  ): Promise<{ plan: ApplyPlan; diff: SuggestionDiff[]; model: DatabaseModel }> {
    const snapshot = await snapshotsRepo(meta).findById(run.snapshotId);
    if (snapshot === null) throw new SnapshotNotFoundError(run.snapshotId);

    const model = parseDatabaseModel(snapshot.schema);
    const classified = classifyModel(model);
    const response = run.responseJson as LlmResponseV1;

    const llm = normalizeLlmResponse(response, { llmRunId: run.id });
    const heuristic = normalizeHeuristicBaseline(model, classified);

    const userOverrides = await overridesRepo(meta).listForConnection(run.connectionId, { status: 'active' });
    const userLockedIds: string[] = [];
    for (const o of userOverrides) {
      if (o.origin !== 'user') continue;
      const id = userLockedSuggestionId(o);
      if (id !== null) userLockedIds.push(id);
    }

    const diff = diffEnrichment(llm, heuristic, { userLockedIds });
    const plan = buildApplyPlan(diff, acceptedIds, {
      connectionId: run.connectionId,
      llmRunId: run.id,
      ...(deps.widgetContracts === undefined ? {} : { widgetContracts: deps.widgetContracts }),
    });
    return { plan, diff, model };
  }

  /**
   * Execute a planned write set in ONE transaction (idempotent upserts), capturing
   * before-images for undo. Decoupled from the run lifecycle so the write layer
   * can be exercised directly (e.g. re-running the same plan to prove no dupes).
   */
  async function executeApplyPlan(
    plan: ApplyPlan,
    ctx: { createdBy?: string | null } = {},
  ): Promise<{ undo: ApplyUndo; counts: ApplyCounts }> {
    const at = now();
    const createdBy = ctx.createdBy ?? null;

    return meta.db.transaction().execute(async (trx) => {
      const tmeta: MetaDb = { db: trx, dialect: meta.dialect };
      const llmOv = llmOverridesRepo(tmeta);

      const undo: ApplyUndo = {
        connectionId: plan.connectionId,
        insertedOverrideIds: [],
        updatedOverrides: [],
        insertedPageIds: [],
        updatedPages: [],
      };
      const counts: ApplyCounts = {
        overrides: 0,
        pages: 0,
        navGroupUpdates: 0,
        templatePagesAlreadyCovered: 0,
      };

      // 1) Overrides — labels, keys, enum semantics, relations, PII, micro-copy.
      for (const w of plan.writes) {
        if (w.target !== 'override') continue;
        const res = await llmOv.upsert(
          {
            connectionId: plan.connectionId,
            field: w.field,
            tableName: w.table,
            columnName: w.column,
            value: w.value,
            confidence: w.confidence,
            llmRunId: plan.llmRunId ?? null,
            createdBy,
          },
          at,
        );
        if (res.action === 'inserted') undo.insertedOverrideIds.push(res.override.id);
        else if (res.before !== null) undo.updatedOverrides.push(res.before);
        counts.overrides += 1;
      }

      // 2) Template + dashboard pages (deterministic id → upsert, never duplicate).
      for (const w of plan.writes) {
        if (w.target !== 'page') continue;
        if (w.kind === 'template-page') {
          await upsertTemplatePage(tmeta, plan, w, at, createdBy, undo, counts);
        } else if (w.kind === 'dashboard-page') {
          await upsertDashboardPage(tmeta, plan, w, at, createdBy, undo, counts);
        }
      }

      // 3) Nav-group re-placement LAST, so it also captures the template pages just
      //    created for a member table (they inherit the table's nav group).
      const insertedPages = new Set(undo.insertedPageIds);
      for (const w of plan.writes) {
        if (w.target !== 'page' || w.kind !== 'nav-group') continue;
        await applyNavGroup(tmeta, plan.connectionId, w, at, insertedPages, undo, counts);
      }

      return { undo, counts };
    });
  }

  /**
   * Apply a validated run's accepted suggestions (§8.3). Recomputes the diff +
   * plan, executes the writes transactionally, persists the review + terminal run
   * status (`applied` / `partially_applied`), then fires the regeneration hook.
   */
  async function applyRun(
    runId: string,
    acceptedIds: Iterable<string>,
    opts: ApplyRunOptions = {},
  ): Promise<ApplyResult> {
    const run = await runService.getRun(runId);
    if (run === null) throw new RunNotFoundError(runId);
    if (run.status !== 'validated') throw new RunNotApplicableError(runId, run.status);
    if (run.responseJson === null || run.responseJson === undefined) {
      throw new RunNotApplicableError(runId, 'without a validated response');
    }
    const appliedBy = opts.appliedBy ?? null;

    const acceptedSet = new Set(acceptedIds);
    const { plan, diff } = await buildPlanForRun(run, acceptedSet);
    const { undo, counts } = await executeApplyPlan(plan, { createdBy: appliedBy });

    // Review accounting: actionable suggestions the reviewer did/did not accept.
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const row of diff) {
      if (!ACTIONABLE_STATUSES.has(row.status)) continue;
      (acceptedSet.has(row.id) ? accepted : rejected).push(row.id);
    }
    const partial = rejected.length > 0;
    const review: LlmRunReview = { accepted, rejected };

    const appliedRun = await runService.markApplied(runId, { appliedBy, partial, review });

    // Post-apply regeneration (§8.3 step 3) — after the writes are durable so a
    // regeneration failure cannot roll back a successful apply.
    if (deps.regenerate !== undefined) {
      await deps.regenerate({
        connectionId: run.connectionId,
        snapshotId: run.snapshotId,
        runId,
        appliedBy,
      });
    }

    return {
      run: appliedRun,
      plan,
      summary: applyPlanSummary(plan),
      review,
      partial,
      counts,
      undo,
    };
  }

  /** Revert exactly one apply within the undo window (single transaction). */
  async function undoApply(undo: ApplyUndo): Promise<void> {
    const at = now();
    await meta.db.transaction().execute(async (trx) => {
      const tmeta: MetaDb = { db: trx, dialect: meta.dialect };
      const llmOv = llmOverridesRepo(tmeta);

      // Pages: restore nav placement, then delete inserted rows.
      for (const p of undo.updatedPages) {
        await tmeta.db
          .updateTable('adminium_pages')
          .set({ navGroup: p.navGroup, navOrder: p.navOrder, updatedAt: at })
          .where('id', '=', p.id)
          .execute();
      }
      if (undo.insertedPageIds.length > 0) {
        await tmeta.db.deleteFrom('adminium_pages').where('id', 'in', undo.insertedPageIds).execute();
      }

      // Overrides: restore superseded rows, then delete inserted rows.
      for (const before of undo.updatedOverrides) await llmOv.restore(before, at);
      for (const id of undo.insertedOverrideIds) await llmOv.deleteById(id);
    });
  }

  return { applyRun, executeApplyPlan, buildPlanForRun, undoApply };
}

export type ApplyService = ReturnType<typeof createApplyService>;

// ─── Page writers (transaction-scoped) ───────────────────────────────────────

/** Read a persisted page's bound source table from its envelope config. */
function pageSourceTable(config: unknown): string | null {
  const cfg = config as { source?: { table?: unknown } } | null;
  const table = cfg?.source?.table;
  return typeof table === 'string' ? table : null;
}

/**
 * True when a page of this connection already covers `(table, template)` under
 * a DIFFERENT id — i.e. the generator's own archetype page for the same table.
 *
 * The deterministic {@link pageIdFor} key dedupes llm pages against each other
 * only: the generator keys its pages on `page_<scope>_<table-slug>-<suffix>`
 * (`orders-board`), so an accepted `page-board` for `public.orders` used to
 * insert `public-orders-page-board` right beside it — same template, same bound
 * table, two rows, two nav groups. The bound table lives in the config JSON, so
 * the match is made in JS rather than SQL. A page counts whatever its state: a
 * parked seed (06 §8.3 materialization) is retried by every later run, so
 * skipping it here would only defer the duplicate.
 */
async function pageCoversCoordinate(
  tmeta: MetaDb,
  connectionId: string,
  table: string,
  template: string,
  excludeId: string,
): Promise<boolean> {
  const rows = await tmeta.db
    .selectFrom('adminium_pages')
    .select(['id', 'config'])
    .where('connectionId', '=', connectionId)
    .where('type', '=', template)
    .execute();
  return rows.some((row) => row.id !== excludeId && pageSourceTable(readJson(row.config)) === table);
}

async function upsertTemplatePage(
  tmeta: MetaDb,
  plan: ApplyPlan,
  w: TemplatePageWrite,
  at: number,
  createdBy: string | null,
  undo: ApplyUndo,
  counts: ApplyCounts,
): Promise<void> {
  const id = pageIdFor(plan.connectionId, w.suggestionId);
  // One page per (table, template). When the heuristic generator already emits
  // this archetype for this table, the accepted suggestion is ALREADY satisfied
  // — writing an llm row too would leave the app with two of the same page. The
  // existing page wins: it keeps the readable slug, any layout edits made on it,
  // and it still lands in this run's nav group (the `nav-group` write below
  // stamps every page bound to a member table, whatever its origin). The mirror
  // rule lives in `generate/run.ts`, which drops a generated page whose pair an
  // `origin: 'llm'` page already covers — together they hold in both orders,
  // whether the apply or the first generation ran first.
  if (await pageCoversCoordinate(tmeta, plan.connectionId, w.table, w.template, id)) {
    counts.templatePagesAlreadyCovered += 1;
    return;
  }
  // Qualify the slug with the full `schema.table` (not just `localName`): two
  // same-named tables in different schemas (public.orders + archive.orders) would
  // otherwise collide on UNIQUE(connection_id, slug) and abort the whole apply
  // transaction. The deterministic page id already distinguishes them; the slug
  // must too.
  const slug = slugify(`${w.table}-${w.template}`);
  const title = titleCase(localName(w.table));
  // Minimal §8.3 seed `{ type, table, config, source: 'llm' }`; the full page body
  // is materialized by the regeneration hook from the active snapshot
  // (runGeneration → generate/materialize-llm.ts, wired in cli/runtime.ts).
  const config = { source: { connectionId: plan.connectionId, table: w.table }, llmRunId: plan.llmRunId ?? null };
  await upsertPageRow(tmeta, {
    id,
    connectionId: plan.connectionId,
    slug,
    type: w.template,
    title,
    icon: null,
    navGroup: null,
    navOrder: w.rank,
    config,
    at,
    createdBy,
    undo,
    counts,
  });
}

async function upsertDashboardPage(
  tmeta: MetaDb,
  plan: ApplyPlan,
  w: DashboardPageWrite,
  at: number,
  createdBy: string | null,
  undo: ApplyUndo,
  counts: ApplyCounts,
): Promise<void> {
  const id = pageIdFor(plan.connectionId, w.suggestionId);
  const slug = slugify(`dashboard-${w.dashboard}`);
  const title = w.label.en_US ?? titleCase(w.domain);
  // `config.layout` carries the bound widgets (04-widget-registry.md §6.1).
  const config = {
    domain: w.domain,
    tables: w.tables,
    layout: w.layout,
    source: { connectionId: plan.connectionId, table: null },
    llmRunId: plan.llmRunId ?? null,
  };
  await upsertPageRow(tmeta, {
    id,
    connectionId: plan.connectionId,
    slug,
    type: 'page-dashboard',
    title,
    icon: null,
    navGroup: null,
    navOrder: w.navOrder,
    config,
    at,
    createdBy,
    undo,
    counts,
  });
}

interface PageRowInput {
  id: string;
  connectionId: string;
  slug: string;
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  config: unknown;
  at: number;
  createdBy: string | null;
  undo: ApplyUndo;
  counts: ApplyCounts;
}

/** Insert-or-update one `origin: 'llm'` page keyed on its deterministic id. */
async function upsertPageRow(tmeta: MetaDb, input: PageRowInput): Promise<void> {
  const existing = await tmeta.db
    .selectFrom('adminium_pages')
    .selectAll()
    .where('id', '=', input.id)
    .executeTakeFirst();

  const packed = packJson(input.config);
  if (existing === undefined) {
    await tmeta.db
      .insertInto('adminium_pages')
      .values({
        id: input.id,
        connectionId: input.connectionId,
        slug: input.slug,
        type: input.type,
        title: input.title,
        icon: input.icon,
        navGroup: input.navGroup,
        navOrder: input.navOrder,
        config: packed,
        origin: 'llm',
        manifestId: null,
        generatedFromSnapshotId: null,
        revision: 1,
        isEnabled: writeBool(tmeta, true),
        createdBy: input.createdBy,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .execute();
    input.undo.insertedPageIds.push(input.id);
    input.counts.pages += 1;
    return;
  }
  // Re-apply / newer-run supersede: refresh the body, keep the row (idempotent).
  input.undo.updatedPages.push({
    id: existing.id,
    navGroup: existing.navGroup,
    navOrder: existing.navOrder,
    updatedAt: existing.updatedAt,
  });
  await tmeta.db
    .updateTable('adminium_pages')
    .set({
      slug: input.slug,
      type: input.type,
      title: input.title,
      config: packed,
      revision: existing.revision + 1,
      updatedAt: input.at,
    })
    .where('id', '=', input.id)
    .execute();
  input.counts.pages += 1;
}

/**
 * Stamp `nav_group` + `nav_order` onto every persisted page of each member table (§8.3 `group`).
 *
 * Only until the next generation run: `upsertGenerated` rewrites a generated
 * row's nav columns from its regenerated envelope, which carries the heuristic
 * 09 §2.2 group. Making the accepted placement durable instead is NOT a fix on
 * its own — `buildNavTree` (routes/bootstrap) renders only the five fixed
 * groups and drops every other row, so a page that keeps its domain group
 * disappears from the sidebar. See the note in `generate/run.ts`.
 */
async function applyNavGroup(
  tmeta: MetaDb,
  connectionId: string,
  w: NavGroupWrite,
  at: number,
  insertedPages: ReadonlySet<string>,
  undo: ApplyUndo,
  counts: ApplyCounts,
): Promise<void> {
  const pages = await tmeta.db
    .selectFrom('adminium_pages')
    .selectAll()
    .where('connectionId', '=', connectionId)
    .execute();

  for (let index = 0; index < w.tables.length; index += 1) {
    const table = w.tables[index]!;
    for (const page of pages) {
      if (pageSourceTable(readJson(page.config)) !== table) continue;
      // A page this apply just inserted is deleted on undo — no need to image it.
      if (!insertedPages.has(page.id)) {
        undo.updatedPages.push({
          id: page.id,
          navGroup: page.navGroup,
          navOrder: page.navOrder,
          updatedAt: page.updatedAt,
        });
      }
      await tmeta.db
        .updateTable('adminium_pages')
        .set({ navGroup: w.group, navOrder: index, updatedAt: at })
        .where('id', '=', page.id)
        .execute();
      counts.navGroupUpdates += 1;
    }
  }
}
