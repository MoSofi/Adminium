// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `templateFit` — a template states what it needs as DATA, not as a prose
 * refusal.
 *
 * `composeRequestedPage` already answers "can this table back this template?",
 * and its answer is a joined string of engine-internal warnings. A human can
 * read it; nothing can act on it. So the picker offers every table, the
 * operator picks one with no date column, and the only thing the product can
 * say is no. This module is the same question asked so the answer can drive an
 * offer: which required slot is empty, which column would fill it if it were
 * tagged, and what a new column would have to be.
 *
 * THE REQUIREMENT IS READ OUT OF THE RULE, NOT RESTATED. Two things could have
 * been written here and deliberately were not:
 *
 *   - *which slots are unfilled* is taken from `composeTemplate`'s own
 *     `required-slot-unfillable` warnings, by running the real composition;
 *   - *whether a role is satisfied* is decided by calling the registry's own
 *     predicate (`eventDate`, `boardStatus`, `personFk`, …) — the same function
 *     the trigger itself calls.
 *
 * A second description of "what a calendar needs" would drift, and the drift
 * would be invisible: the page composes or it does not, and nobody diffs the
 * reason.
 *
 * WHAT IS IRREDUCIBLY DECLARED HERE is `wants` — what a column that does not
 * exist yet would have to BE. That cannot come from a predicate, because a
 * predicate rejects; it does not construct. It is therefore the one thing in
 * this file that can lie, and `generate-fit-descriptors.test.ts` is its gate: a
 * synthetic table built from nothing but each `wants` must actually compose the
 * template. Without that test a repair could add a column of the right TYPE
 * under a name the classifier does not tag, and build a gate that cannot open —
 * the specific failure this whole plan exists to avoid.
 */

import {
  boardStatus,
  buildCandidateView,
  composeTemplate,
  dateRangeStart,
  emitCandidates,
  eventDate,
  getPageTemplateManifest,
  isRegisteredWidgetId,
  personFk,
  scoreArchetypes,
  shiftTypeColumn,
  type CandidateContext,
  type CandidateTableInput,
  type CandidateView,
  type ClassifiedTableInput,
} from '@adminium/widgets/generate';

import { classifyModel, type ClassifiedTable } from '../classify/index.js';
import { isTableBoundTemplate } from '../config-schema/table-bound.js';
import type { DatabaseModel, SemanticTag, TableModel } from '../schema-model.js';
import { toCandidateModel, toTemplateCandidate } from './archetype.js';

/* --------------------------------------------------------------- the shape */

/**
 * The part a template needs a column to play. Named after the JOB, not after
 * the semantic tag that encodes it — the UI says "a calendar needs a date for
 * each row", and `event-timestamp` is an implementation detail of how that gets
 * asserted.
 */
export type FitRole = 'event-date' | 'title' | 'status-workflow' | 'person-fk' | 'shift-type';

/** What a column would have to BE to play a role nothing on the table can. */
export interface FitWants {
  /** Any one of these logical types will do. */
  logicalTypes: string[];
  /** The semantic the classifier — or an override — must carry. */
  semantic: SemanticTag;
  /**
   * A name the classifier's own heuristic tags unaided.
   *
   * `r12-event-timestamp` is a NAME SUFFIX rule (`_at|_date|_on|_time|_ts`), so
   * `event_date` qualifies and `date` does not: a repair that adds the right
   * type under a name of the operator's choosing builds a column the check
   * still refuses. Pre-filling a conforming name is half of D3; stamping the
   * override is the other half, and each covers the other's failure.
   */
  suggestedNames: string[];
  /**
   * A length the classifier's own rule requires. `r07-status-workflow` accepts
   * a text column only at `maxLength <= 32`, so a repair that adds an unbounded
   * `text` status column produces one the rule refuses to tag — the same class
   * of dead end as the wrong NAME, one layer down.
   */
  maxLength?: number;
  /**
   * Values the column must be able to hold, when the requirement reaches into
   * them. `page-board` is the only one that does: a `status` enum of
   * `bronze|silver|gold` has the right type, the right semantic and still no
   * board, so a repair seeding no kanban-shaped values builds another gate that
   * cannot open.
   */
  enumValues?: string[];
  /**
   * This column is a FOREIGN KEY, so it cannot simply be added: it needs a
   * target table, and `personFk` tests that table's NAME as well as the
   * reference. A caller offering "add the missing column" must leave this role
   * out and say so, rather than adding an integer that satisfies nothing.
   */
  needsReference?: true;
}

export interface FitRequirement {
  role: FitRole;
  /** The column playing this part today, or null. */
  satisfiedBy: string | null;
  /**
   * Columns that are the right TYPE and the wrong SEMANTIC — the tag remedy.
   *
   * Computed by PROBING, not by a type test: each candidate is re-classified as
   * if it already carried `wants.semantic`, and the role's own predicate is
   * asked again. A column that would still not satisfy the rule never reaches
   * the operator as an offer, which is the difference between a remedy and a
   * dead end.
   */
  taggable: { column: string; logicalType: string }[];
  wants: FitWants;
  /** Nothing is optional today; the field exists so a role can become one. */
  optional: boolean;
}

/** A `required: true` slot of the manifest that no candidate could fill. */
export interface UnfilledSlot {
  slot: string;
  /** What the manifest would have accepted there. */
  accepts: { widgets: string[]; shapes: string[] };
}

export interface TemplateFit {
  template: string;
  tableId: string;
  /** False ⇔ the template is not table-bound; there is no requirement to state. */
  bindable: boolean;
  satisfied: boolean;
  /** Required slots with no accepted candidate — stated for all ten templates. */
  unfilled: UnfilledSlot[];
  /**
   * Role-level repair descriptors, for the three templates that render a blank
   * rectangle when they cannot bind (D4: *which slot failed* costs the same for
   * ten templates as for three and so ships for all ten; the DDL remedies
   * behind these descriptors do not).
   */
  requirements: FitRequirement[];
  /** Why, when the failure was not a slot — an unavailable table. */
  reason: string;
}

/* ------------------------------------------------------------- descriptors */

interface RoleDescriptor {
  role: FitRole;
  wants: FitWants;
  /** The registry's own predicate: the column playing this part, or null. */
  satisfiedBy: (view: CandidateView) => string | null;
  /**
   * Semantics that put a column out of the OFFER, even though tagging it would
   * technically satisfy the role.
   *
   * This is a product judgement, not an engine rule, and the distinction
   * matters. An override beats the classifier by design, so tagging
   * `created_at` as the event date genuinely works — the probe below says so.
   * It is still the wrong thing to put in front of someone repairing a
   * calendar: rows 9 and 10 claimed that column because it is a bookkeeping
   * stamp, and re-purposing it silently changes what "created" means everywhere
   * else the semantic is read. The rare table that really does record the event
   * time in `created_at` is not blocked — Studio's Column Inspector tags any
   * column, and that is the surface for deciding a column means something other
   * than it says.
   */
  notAlready?: readonly SemanticTag[];
}

const EVENT_DATE: RoleDescriptor = {
  role: 'event-date',
  wants: {
    logicalTypes: ['timestamptz', 'timestamp', 'date'],
    semantic: 'event-timestamp',
    // Several, because the first one can be TAKEN. A table whose `event_date`
    // is a text column fails this role and collides with the repair, and a
    // caller that has to invent its own second name is a caller inventing one
    // the classifier does not tag. Every name here ends `_at`/`_date`/`_on`.
    suggestedNames: ['event_date', 'starts_at', 'scheduled_at', 'occurred_on'],
  },
  satisfiedBy: (view) => (eventDate(view) ?? dateRangeStart(view))?.name ?? null,
  notAlready: ['created-at', 'updated-at'],
};

/**
 * The title half almost never fails: `selectDisplayColumn` takes any text-ish,
 * non-PK, non-secret column — exact title/name, then `_name`-suffixed, then
 * unique text-ish, then simply the first one. A table with any text column has
 * a title. It is stated anyway because a table with none does exist, and "this
 * table has no column to put on the event" is a sentence an operator can act
 * on where a blank month grid is not.
 *
 * It carries no taggable list by construction — the display column is chosen
 * structurally, not from a semantic, so no tag can create one.
 */
const TITLE: RoleDescriptor = {
  role: 'title',
  wants: {
    logicalTypes: ['text', 'varchar'],
    semantic: 'plain',
    suggestedNames: ['title', 'name', 'label', 'summary'],
  },
  satisfiedBy: (view) => view.displayColumn,
};

const STATUS: RoleDescriptor = {
  role: 'status-workflow',
  wants: {
    // `varchar` FIRST, and bounded: `r07-status-workflow` takes an `enum`
    // column or a textish one at `maxLength <= 32`, and `addColumns` has no way
    // to carry an enum's VALUES (`AddColumn` holds a `DesiredColumn`; only
    // `DesiredTable` has `enumValues`). So the shape a repair can actually
    // create is a bounded varchar whose values ride the override channel.
    logicalTypes: ['varchar', 'enum', 'text'],
    semantic: 'status-workflow',
    suggestedNames: ['status', 'workflow_status', 'stage'],
    maxLength: 32,
    // Every value is kanban-shaped against `BOARD_STATE_RE`, so a seeded column
    // satisfies the rule at full strength rather than at its margin.
    enumValues: ['todo', 'in_progress', 'blocked', 'done'],
  },
  satisfiedBy: (view) => boardStatus(view)?.column.name ?? null,
};

/**
 * The person dimension of a scheduler. It carries no taggable list either, and
 * for a sharper reason: `personFk` tests the column's `references` and the
 * TARGET TABLE's name, neither of which a semantic tag can change. Offering a
 * tag here would be offering something that cannot work.
 */
const PERSON_FK: RoleDescriptor = {
  role: 'person-fk',
  wants: {
    logicalTypes: ['integer', 'bigint', 'uuid'],
    semantic: 'fk',
    suggestedNames: ['employee_id', 'assignee_id', 'staff_id'],
    needsReference: true,
  },
  satisfiedBy: (view) => personFk(view)?.name ?? null,
};

const SHIFT_TYPE: RoleDescriptor = {
  role: 'shift-type',
  wants: {
    logicalTypes: ['varchar', 'enum', 'text'],
    semantic: 'category-enum',
    suggestedNames: ['shift_type', 'slot_type', 'duty_type'],
    maxLength: 32,
    // Deliberately NOT workflow vocabulary: `r07-status-workflow` runs before
    // `r08-category-enum`, so values it recognised would claim this column as
    // a workflow status and the scheduler would lose its shift dimension.
    enumValues: ['morning', 'evening', 'night'],
  },
  satisfiedBy: (view) => shiftTypeColumn(view)?.name ?? null,
};

/**
 * The three templates that render a blank rectangle when they cannot bind, and
 * therefore the three that earn repair descriptors (D4).
 *
 * `page-scheduler` is listed by its PRIMARY branch (person × date × shift
 * type). Its rule has a second, narrower one — a project FK plus an hours
 * column — and a table satisfying that composes, is reported `satisfied`, and
 * never reaches these descriptors. Flattening both branches into one list would
 * state requirements that are not requirements.
 */
const REPAIRABLE: Readonly<Record<string, readonly RoleDescriptor[]>> = {
  'page-calendar': [EVENT_DATE, TITLE],
  'page-board': [STATUS],
  'page-scheduler': [PERSON_FK, EVENT_DATE, SHIFT_TYPE],
};

/** The templates `templateFit` can describe a repair for. */
export const REPAIRABLE_TEMPLATES: readonly string[] = Object.keys(REPAIRABLE).sort();

/** The column descriptors a template declares — read by the descriptor gate. */
export function fitDescriptorsFor(template: string): readonly FitWants[] {
  return (REPAIRABLE[template] ?? []).map((role) => role.wants);
}

/**
 * The roles a template declares, each with its `wants` — what the new-table
 * draft builds from. The title role is not always among them (a board states
 * only its status), so a caller building a whole table adds it itself.
 */
export function fitRolesFor(template: string): readonly { role: FitRole; wants: FitWants }[] {
  return (REPAIRABLE[template] ?? []).map(({ role, wants }) => ({ role, wants }));
}

/** The title role's `wants`, for a caller that builds a table from nothing. */
export const TITLE_WANTS: FitWants = TITLE.wants;

/* ---------------------------------------------------------------- prelude */

export interface BindableSet {
  /** The tables that can carry a page, sorted by id. */
  tables: TableModel[];
  classified: Map<string, ClassifiedTable>;
  candidateModel: CandidateTableInput[];
}

/**
 * The classify → filter → adapt prelude `composeRequestedPage` and
 * `composeRequestedArchetype` both run, in one place so the fit report and the
 * composition it predicts can never disagree about which tables are bindable.
 *
 * The filter is `generatePages`' own splitTables rule: system and join tables
 * never earn a page, so offering one here would offer a page the next
 * generation run deletes.
 */
export function bindableSet(model: DatabaseModel): BindableSet {
  const classified = new Map<string, ClassifiedTable>(
    classifyModel(model).tables.map((t) => [t.tableId, t]),
  );
  const tables = [...model.tables]
    .filter((table) => {
      const role = classified.get(table.id)?.semantics.role ?? table.semantics?.role ?? 'entity';
      return !table.system && role !== 'system' && role !== 'join-table';
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return { tables, classified, candidateModel: toCandidateModel(model, tables, classified) };
}

/* ----------------------------------------------------------------- probing */

/** The same classified input with one column re-tagged — the tag remedy, simulated. */
function retagged(
  classified: ClassifiedTableInput,
  column: string,
  semantic: SemanticTag,
): ClassifiedTableInput {
  const present = classified.columns.some((c) => c.column === column);
  const columns = classified.columns.map((c) => (c.column === column ? { ...c, semantic } : c));
  // A column the classifier emitted no row for still needs one, or the probe
  // would silently test nothing and report the column as untaggable.
  return { ...classified, columns: present ? columns : [...columns, { column, semantic }] };
}

/**
 * Columns for which tagging ALONE would satisfy this role.
 *
 * The probe is the point. A plain type test would offer every timestamp on the
 * table, `created_at` included — which rows 9 and 10 of the classifier claim
 * before the event rule sees it, and which is a bookkeeping stamp, not an
 * event. Re-asking the rule after a simulated tag offers only what would
 * actually work.
 */
function taggableFor(
  descriptor: RoleDescriptor,
  entry: CandidateTableInput,
): { column: string; logicalType: string }[] {
  const wanted = new Set(descriptor.wants.logicalTypes);
  const spokenFor = new Set<string>(descriptor.notAlready ?? []);
  const semanticOf = new Map(entry.classified.columns.map((c) => [c.column, c.semantic]));
  const out: { column: string; logicalType: string }[] = [];
  for (const column of entry.table.columns) {
    if (!wanted.has(column.logicalType)) continue;
    if (spokenFor.has(semanticOf.get(column.name) ?? 'plain')) continue;
    const probe = buildCandidateView(
      entry.table,
      retagged(entry.classified, column.name, descriptor.wants.semantic),
    );
    if (descriptor.satisfiedBy(probe) !== column.name) continue;
    out.push({ column: column.name, logicalType: column.logicalType });
  }
  return out;
}

/* -------------------------------------------------------------- the report */

export interface TemplateFitOptions {
  /** Widget-registry membership test; defaults to the checked-in mirror. */
  isRegistered?: ((widgetId: string) => boolean) | undefined;
}

/** A connection id is part of every query descriptor; fit composes none. */
const FIT_CONNECTION = 'fit';

function requirementsFor(
  template: string,
  entry: CandidateTableInput,
): FitRequirement[] {
  const view = buildCandidateView(entry.table, entry.classified);
  return (REPAIRABLE[template] ?? []).map((descriptor) => ({
    role: descriptor.role,
    satisfiedBy: descriptor.satisfiedBy(view),
    taggable: taggableFor(descriptor, entry),
    wants: descriptor.wants,
    optional: false,
  }));
}

/**
 * Can `tableId` back `template`, and if not, what exactly is missing?
 *
 * Pure. No I/O, no connection, no snapshot — the caller hands in the model it
 * would compose from, so the report and the composition answer about the same
 * schema.
 */
export function templateFit(
  model: DatabaseModel,
  tableId: string,
  template: string,
  opts: TemplateFitOptions = {},
): TemplateFit {
  const empty = { template, tableId, unfilled: [], requirements: [], reason: '' };

  if (!isTableBoundTemplate(template)) {
    // A dashboard composes from a DOMAIN, and the tool surfaces ignore their
    // stored body; neither has a per-table requirement to state.
    return { ...empty, bindable: false, satisfied: false };
  }

  const set = bindableSet(model);
  const entry = set.candidateModel.find((e) => e.table.id === tableId);
  if (entry === undefined) {
    return {
      ...empty,
      bindable: true,
      satisfied: false,
      reason: `table ${tableId} is not available (excluded from this connection, or a system/join table)`,
    };
  }

  // `page-crud` composes column-by-column rather than slot-by-slot
  // (`buildCrudEnvelope`), so it has no required slot and every available table
  // fits. Saying so beats running a composition that cannot fail.
  if (template === 'page-crud') {
    return { ...empty, bindable: true, satisfied: true };
  }

  const isRegistered = opts.isRegistered ?? isRegisteredWidgetId;
  const ctx: CandidateContext = {
    connectionId: FIT_CONNECTION,
    model: set.candidateModel,
    isRegistered,
  };
  const candidates = emitCandidates(entry.table, entry.classified, ctx);
  const composed = composeTemplate(template, candidates.map(toTemplateCandidate), { isRegistered });

  const manifest = getPageTemplateManifest(template);
  const unfilled: UnfilledSlot[] = [];
  for (const warning of composed.warnings) {
    if (warning.code !== 'required-slot-unfillable' || warning.slot === undefined) continue;
    const slot = manifest?.slots.find((s) => s.slot === warning.slot);
    unfilled.push({
      slot: warning.slot,
      accepts: {
        widgets: [...(slot?.accepts.widgets ?? [])],
        shapes: [...(slot?.accepts.shapes ?? [])],
      },
    });
  }

  return {
    template,
    tableId: entry.table.id,
    bindable: true,
    satisfied: composed.page !== null,
    unfilled,
    requirements: requirementsFor(template, entry),
    reason: '',
  };
}

/* --------------------------------------------------- remedy 0: other tables */

/** One table offered in place of the one the operator picked. */
export interface FittingTable {
  tableId: string;
  /** The table's effective label, when it carries one. */
  label: string | null;
  /** The archetype trigger's own confidence for this template; 0 when none. */
  score: number;
  /** The trigger's own words, for the offer's "why this one" line. */
  reasons: string[];
  /** Which column plays each declared role, for the offer's summary. */
  roles: { role: FitRole; column: string | null }[];
}

/**
 * Remedy 0 — every table of this model that CAN back `template`, best first.
 *
 * Offered before any repair and on its own, because the most common real
 * failure is not a broken table: it is the wrong table, picked by someone who
 * did not know which one carried the date. It writes nothing to the operator's
 * database, needs no DDL privilege and asks them to know nothing about their own
 * schema — which is why it goes first under D1's principle.
 *
 * Ranking is total and therefore stable: score desc, then table id. The score is
 * the archetype trigger's own confidence, so a table the generator would itself
 * have chosen this template for outranks one that merely satisfies it.
 */
export function fittingTables(
  model: DatabaseModel,
  template: string,
  opts: TemplateFitOptions & { exclude?: string | undefined } = {},
): FittingTable[] {
  if (!isTableBoundTemplate(template)) return [];

  const isRegistered = opts.isRegistered ?? isRegisteredWidgetId;
  const set = bindableSet(model);
  const ctx: CandidateContext = {
    connectionId: FIT_CONNECTION,
    model: set.candidateModel,
    isRegistered,
  };
  const descriptors = REPAIRABLE[template] ?? [];

  const out: FittingTable[] = [];
  for (const entry of set.candidateModel) {
    if (entry.table.id === opts.exclude) continue;
    if (!templateFit(model, entry.table.id, template, opts).satisfied) continue;
    const ranked = scoreArchetypes(entry.table, entry.classified, ctx).find(
      (s) => s.template === template,
    );
    const view = buildCandidateView(entry.table, entry.classified);
    out.push({
      tableId: entry.table.id,
      label: entry.table.label ?? null,
      score: ranked?.score ?? 0,
      reasons: ranked?.reasons ?? [],
      roles: descriptors.map((d) => ({ role: d.role, column: d.satisfiedBy(view) })),
    });
  }
  out.sort((a, b) => b.score - a.score || a.tableId.localeCompare(b.tableId));
  return out;
}
