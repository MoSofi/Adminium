// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-archetype selection — the **Auto-trigger** column of
 * research/widget-registry.md §14, and the H2 cap that closes it: "1 page
 * archetype per table (highest-scoring §14 trigger; `page-crud` always emitted
 * regardless)" (04-widget-registry.md §8).
 *
 * This is the second half of §15 step 3 — "per table emit: `page-crud` always;
 * **plus the highest-scoring archetype from §14 triggers**; plus KPI candidates
 * and 2–4 chart candidates". The candidates themselves come from
 * `./candidates.ts`; this module only answers *which template* a table earns,
 * and `composeTemplate` (`../templates/compose.ts`) fills that template's slots
 * from the candidate list.
 *
 * WHY HERE AND NOT IN THE ENGINE: same reason as `./candidates.ts` — the
 * triggers are properties of the §14 catalog, which this package owns. The input
 * is the classified model as **data** (`CandidateTable` / `ClassifiedTableInput`),
 * so nothing here imports the engine and the Engine adapts its model on the way
 * in (01-architecture.md §2.3).
 *
 * DETERMINISM: pure; scores round to 1e-3 (see `./candidates.ts`). Ranking is a
 * TOTAL order — score desc, then template id — so the winner never depends on
 * rule declaration order and 04 §8 H5's byte-identical re-run holds even when two
 * archetypes tie on score. Only "nothing triggered" means "emit nothing extra";
 * the table still gets its `page-crud` either way.
 *
 * FILLABILITY IS PART OF THE TRIGGER: a rule must not fire unless the candidate
 * rules can fill its template's `required` slots. `composeTemplate` returning
 * `null` costs the table its §14 page outright — the Engine drops it rather than
 * falling back to the runner-up archetype — so each rule below gates on the
 * signals its manifest's required slots actually need.
 */
import {
  BOARD_STATE_RE,
  READ_FLAG_RE,
  buildCandidateView,
  dateRangeStart,
  enumColumns,
  eventDate,
  firstWithSemantic,
  isFileShaped,
  messagesChildOf,
  personFk,
  projectFk,
  withSemantic,
  type CandidateContext,
  type CandidateTable,
  type CandidateTableInput,
  type CandidateView,
  type ClassifiedTableInput,
} from './candidates.js';

/** Annex §14 `page-queue-inbox`: "pending/approved-style workflow enums". */
const QUEUE_STATE_RE =
  /^(pending|awaiting|awaiting_approval|submitted|requested|in_review|review|approved|rejected|declined|denied|granted|escalated|unread)$/i;
/** Annex §5/§14 `page-scheduler`: shift-type vocabulary. */
const SHIFT_TYPE_RE = /(^|_)(shift|slot|rota|duty)(_type|_kind|_name)?(_|$)/i;
/** Annex §5/§14 `page-scheduler`: hours-per-project capacity numerics. */
const HOURS_RE = /(^|_)(hours?|capacity|allocation|workload|effort|load)(_|$)/i;

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function score(base: number, ...modifiers: number[]): number {
  let value = base;
  for (const modifier of modifiers) value *= modifier;
  return round3(clamp01(value));
}

/** Name/vocabulary-match strength (the H2 "name-match strength" modifier). */
function byMatch(matches: boolean, hit = 1.1, miss = 0.95): number {
  return matches ? hit : miss;
}

/* ----------------------------------------------------------------- output */

export interface ArchetypeSelection {
  /** A §14 template id — always one of {@link ARCHETYPE_TEMPLATE_IDS}. */
  template: string;
  /** 0–1; the §14 trigger's confidence for this table. */
  score: number;
  /** Why it triggered — surfaced in the Studio review UI and the LLM prompt. */
  reasons: string[];
}

export interface ArchetypeRule {
  /** The §14 template id this rule triggers. */
  template: string;
  /** `null` ⇔ the trigger does not apply to this table. */
  match(view: CandidateView, ctx: CandidateContext): Omit<ArchetypeSelection, 'template'> | null;
}

/* ------------------------------------------------------------------ rules */

/**
 * §14 — "Status enum classified as workflow; optional lane dimension".
 *
 * Never fires on a log-shaped table. §14 routes "Audit/event/webhook/log tables"
 * to `page-log-viewer` unconditionally, and the classifier's `log` shape/role is
 * a definitive signal — whereas this rule's enum-vocabulary match is a heuristic.
 * Without the exclusion the two compete at near-identical scores on any audit
 * table carrying an open/closed-style enum (`BOARD_STATE_RE` matches those), and
 * a lane dimension makes the board *win* — rendering an append-only audit log as
 * a drag-to-change-status kanban, which is both wrong and unsafe.
 */
const pageBoard: ArchetypeRule = {
  template: 'page-board',
  match(view) {
    if (view.shape === 'log' || view.role === 'log') return null;
    const status = firstWithSemantic(view, 'status-workflow');
    if (status === null || status.enumValues.length === 0 || status.enumValues.length > 6) {
      return null;
    }
    const boardish = status.enumValues.filter((v) => BOARD_STATE_RE.test(v.trim()));
    if (boardish.length === 0) return null;
    const lane =
      enumColumns(view).find((c) => c.name !== status.name && c.semantic === 'category-enum') ??
      personFk(view) ??
      projectFk(view);
    const reasons = [
      `status enum "${status.name}" classified as workflow (${boardish.length}/${status.enumValues.length} kanban-shaped states)`,
    ];
    if (lane !== null && lane !== undefined) {
      reasons.push(`lane dimension "${lane.name}" — swimlane variant`);
    }
    return {
      score: score(
        0.8,
        byMatch(boardish.length === status.enumValues.length),
        lane === null || lane === undefined ? 1 : 1.05,
      ),
      reasons,
    };
  },
};

/**
 * §14 — "Date column + title column".
 *
 * A start/end **pair** is scheduling/gantt data, not point-in-time events
 * (annex §5: "two timestamp columns (start/end) → scheduling candidate"), so a
 * range-only table scores as a weak calendar and normally loses to the
 * scheduler / domain-card archetypes below.
 */
const pageCalendar: ArchetypeRule = {
  template: 'page-calendar',
  match(view) {
    const point = eventDate(view);
    const range = dateRangeStart(view);
    const date = point ?? range;
    if (date === null || view.displayColumn === null) return null;
    const reasons = [`date column "${date.name}" + title column "${view.displayColumn}"`];
    if (point === null) reasons.push('start/end pair only — scheduling-shaped, not point events');
    if (view.shape === 'events') reasons.push('table classified as events-shaped (05 §8)');
    return {
      score: score(0.75, byMatch(view.shape === 'events', 1.15, 1), point === null ? 0.6 : 1),
      reasons,
    };
  },
};

/**
 * §14 — "People-shaped table (name/email/role/avatar)".
 *
 * Like `pageMasterDetail` below, this only fires when the candidate rules can
 * actually fill the manifest's `required` `directory` slot, which accepts just
 * `card-gallery` (needs an `image-url` — `media.image-card-gallery`) or
 * `org-chart` (needs a self-FK — `domain.self-fk-tree`). A people table with
 * neither would select this archetype, compose to `null`, and lose its §14 page
 * entirely — `archetypePages` drops rather than falling back to the runner-up.
 * Gating here instead means such a table keeps whatever archetype it *can*
 * compose (or just its `page-crud`).
 */
const pageDirectory: ArchetypeRule = {
  template: 'page-directory',
  match(view) {
    if (view.shape !== 'people' && view.role !== 'people') return null;
    const identity = withSemantic(view, 'person-name', 'email');
    if (identity.length === 0) return null;
    const avatar = firstWithSemantic(view, 'image-url');
    if (avatar === null && view.hierarchyColumn === null) return null;
    const reasons = [
      `people-shaped table with ${identity.map((c) => `"${c.name}"`).join(' + ')} (05 §8 directory trigger)`,
    ];
    if (avatar !== null) reasons.push(`avatar column "${avatar.name}" — card gallery`);
    if (view.hierarchyColumn !== null) {
      reasons.push(`self-FK "${view.hierarchyColumn}" — org-chart tree variant (annex §14)`);
    }
    // The 1.1 is unconditional now that the gate above guarantees one of the two
    // fillable variants — it is the "name-match strength" hit for a people table
    // that carries a renderable directory signal, not a per-variant bonus.
    return { score: score(0.85, 1.1), reasons };
  },
};

/** §14 — "Person FK × date × shift-type; or hours-per-project assignments". */
const pageScheduler: ArchetypeRule = {
  template: 'page-scheduler',
  match(view) {
    const person = personFk(view);
    if (person === null) return null;

    const date = eventDate(view) ?? dateRangeStart(view);
    const shiftType = enumColumns(view).find(
      (c) => SHIFT_TYPE_RE.test(normalize(c.name)) || c.semantic === 'category-enum',
    );
    if (date !== null && shiftType !== undefined) {
      return {
        score: score(0.82, byMatch(SHIFT_TYPE_RE.test(normalize(shiftType.name)))),
        reasons: [
          `person FK "${person.name}" × date "${date.name}" × shift type "${shiftType.name}" (annex §14 shift scheduler)`,
        ],
      };
    }

    const project = projectFk(view);
    const hours = view.columns.find(
      (c) => NUMERIC_TYPES.has(c.logicalType) && !c.isPrimaryKey && HOURS_RE.test(normalize(c.name)),
    );
    if (project !== null && hours !== undefined) {
      return {
        score: score(0.82),
        reasons: [
          `hours "${hours.name}" per person "${person.name}" per project "${project.name}" (annex §14 team workload)`,
        ],
      };
    }
    return null;
  },
};

/** §14 — "Audit/event/webhook/log tables". */
const pageLogViewer: ArchetypeRule = {
  template: 'page-log-viewer',
  match(view) {
    if (view.shape !== 'log' && view.role !== 'log') return null;
    return {
      score: score(0.88),
      reasons: [`${view.table.id} classified as a log table (05 §8): ${view.classified.shape}`],
    };
  },
};

/** §14 — "File/attachment-shaped tables or storage integration". */
const pageFiles: ArchetypeRule = {
  template: 'page-files',
  match(view) {
    if (!isFileShaped(view)) return null;
    const reasons = ['file-shaped table: display name + size numeric or file reference (annex §8/§14)'];
    if (view.hierarchyColumn !== null) {
      reasons.push(`parent self-FK "${view.hierarchyColumn}" — folder tree`);
    }
    return { score: score(0.9, view.hierarchyColumn !== null ? 1.05 : 1), reasons };
  },
};

/** §14 — "Conversation+message table pair". */
const pageChat: ArchetypeRule = {
  template: 'page-chat',
  match(view, ctx) {
    const messages = messagesChildOf(view, ctx);
    if (messages === null) return null;
    return {
      score: score(0.95),
      reasons: [
        `conversation container paired with messages table "${messages.table.id}" (sender FK + body + created-at, 05 §8)`,
      ],
    };
  },
};

/** §14 — "Tables with pending/approved-style workflow enums or read/unread booleans". */
const pageQueueInbox: ArchetypeRule = {
  template: 'page-queue-inbox',
  match(view) {
    const status = firstWithSemantic(view, 'status-workflow');
    const queueish =
      status === null ? [] : status.enumValues.filter((v) => QUEUE_STATE_RE.test(v.trim()));
    const readFlag = view.columns.find(
      (c) =>
        (c.logicalType === 'boolean' || c.semantic === 'boolean-flag') &&
        READ_FLAG_RE.test(normalize(c.name)),
    );
    if (queueish.length === 0 && readFlag === undefined) return null;
    const reasons: string[] = [];
    if (status !== null && queueish.length > 0) {
      reasons.push(
        `approval-style workflow enum "${status.name}" (${queueish.join(', ')}) (annex §14)`,
      );
    }
    if (readFlag !== undefined) reasons.push(`read/unread boolean "${readFlag.name}" (annex §14)`);
    return {
      score: score(
        0.78,
        byMatch(
          readFlag !== undefined ||
            (status !== null && queueish.length === status.enumValues.length),
        ),
      ),
      reasons,
    };
  },
};

/**
 * §14 — "Enum-heavy tables with rich per-record detail".
 *
 * Two variants, matching the manifest's detail slot (which accepts
 * `detail-key-value` **or a domain card** — `org-chart` / `gantt-chart` /
 * `chat-thread`, per §14's "detail pane (right: `detail-key-value` / domain card
 * / `chat-thread`)"):
 *
 *   - **domain-card**: the table carries the §13 gantt signal ("start+end dates
 *     + phase FK → `gantt-chart`"). `page-master-detail` is the only shipped
 *     archetype whose detail pane accepts `gantt-chart`, so this variant is what
 *     makes that §13 trigger reachable as a page. (§13's other tree signal,
 *     `org-chart` on a self-FK people table, is `page-directory`'s tree variant
 *     — see that rule; it always outscores this one.)
 *   - **enum-heavy**: the literal §14 trigger — ≥2 enum columns plus a detail
 *     payload worth a pane (free text / JSON / ≥6 informative columns).
 *
 * Both variants only fire when the candidate rules can actually fill the
 * manifest's two `required` slots: the domain-card variant mirrors
 * `domain.start-end-phase`, the enum-heavy variant mirrors
 * `tables.enum-master-detail`.
 */
const pageMasterDetail: ArchetypeRule = {
  template: 'page-master-detail',
  match(view) {
    const start = dateRangeStart(view);
    const gantt =
      start !== null && (firstWithSemantic(view, 'percent') !== null || projectFk(view) !== null);
    if (gantt && start !== null) {
      return {
        score: score(0.8),
        reasons: [
          `start/end pair "${start.name}"/"${start.pair?.partner ?? '?'}" with progress/phase — gantt-chart detail pane (annex §13/§14)`,
        ],
      };
    }

    const enums = enumColumns(view);
    if (enums.length < 2) return null;
    const rich =
      withSemantic(view, 'free-text', 'json-config').length > 0 ||
      view.columns.filter((c) => !c.isPrimaryKey && !c.secret).length >= 6;
    if (!rich) return null;
    return {
      score: score(0.6),
      reasons: [
        `enum-heavy (${enums.map((c) => `"${c.name}"`).join(', ')}) with rich per-record detail (annex §14)`,
      ],
    };
  },
};

/**
 * Every §14 auto-trigger the runtime can compose today, in annex table order.
 * The other twelve §14 archetypes are not schema-triggered (`page-settings`,
 * `page-auth`, `page-api`, … are "always generated" / marketing surfaces) or
 * await their manifest, so they never appear here.
 */
export const archetypeRules: readonly ArchetypeRule[] = [
  pageMasterDetail,
  pageQueueInbox,
  pageBoard,
  pageCalendar,
  pageScheduler,
  pageDirectory,
  pageLogViewer,
  pageFiles,
  pageChat,
];

/** Template ids {@link selectArchetype} can return. */
export const ARCHETYPE_TEMPLATE_IDS: readonly string[] = archetypeRules.map((r) => r.template);

/**
 * Every §14 trigger that fires for a table, best first. Ordering is total:
 * score desc, then template id — so a caller inspecting the runners-up (the
 * Studio "why this page?" panel, the LLM prompt) sees a stable list.
 */
export function scoreArchetypes(
  table: CandidateTable,
  classified: ClassifiedTableInput,
  ctx: CandidateContext,
): ArchetypeSelection[] {
  const view = buildCandidateView(table, classified);
  // System and join tables are never paged (05 §8.2).
  if (view.role === 'system' || view.role === 'join-table') return [];

  const out: ArchetypeSelection[] = [];
  for (const rule of archetypeRules) {
    const hit = rule.match(view, ctx);
    if (hit === null || hit.score <= 0) continue;
    out.push({ template: rule.template, score: hit.score, reasons: hit.reasons });
  }
  out.sort((a, b) => b.score - a.score || a.template.localeCompare(b.template));
  return out;
}

/**
 * The one §14 archetype a table earns (H2: "1 page archetype per table —
 * highest-scoring §14 trigger"), or `null` when nothing triggers. `page-crud` is
 * emitted by the Engine regardless and is deliberately not a candidate here.
 *
 * A tie on score is NOT a reason to drop the page: `scoreArchetypes` orders by
 * score desc **then template id**, a total order that does not depend on rule
 * declaration order, so `ranked[0]` is already stable across runs and satisfies
 * 04 §8 H5's byte-identical requirement. Returning `null` instead would silently
 * cost the table its §14 page (the Engine cannot distinguish "nothing triggered"
 * from "two triggers tied"), which breaks H2's "highest-scoring trigger".
 */
export function selectArchetype(
  table: CandidateTable,
  classified: ClassifiedTableInput,
  ctx: CandidateContext,
): ArchetypeSelection | null {
  return scoreArchetypes(table, classified, ctx)[0] ?? null;
}

/**
 * Archetype selection for a whole model, keyed by table id. Threads `ctx.model`
 * through so the cross-table §14 triggers (the conversation+message pair) see
 * every table. Tables that earn nothing are absent from the map.
 */
export function selectModelArchetypes(
  model: readonly CandidateTableInput[],
  ctx: CandidateContext,
): Map<string, ArchetypeSelection> {
  const withModel: CandidateContext = { ...ctx, model };
  const out = new Map<string, ArchetypeSelection>();
  for (const entry of [...model].sort((a, b) => a.table.id.localeCompare(b.table.id))) {
    const selection = selectArchetype(entry.table, entry.classified, withModel);
    if (selection !== null) out.set(entry.table.id, selection);
  }
  return out;
}
