// SPDX-License-Identifier: AGPL-3.0-only
import { cn, firstDayOfWeek, FormField, MonoText, Tag } from '@adminium/ui';
import { Sparkles } from 'lucide-react';
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { computeTotals } from '../../page-config/child-totals.js';
import { evaluateDerivedFields } from '../../page-config/derive-eval.js';
import { ChildRowsControl } from './controls/child-rows.js';
import { QuickLayout, type PillKind, type QuickPill } from './layouts/QuickLayout.js';
import { SplitLayout } from './layouts/SplitLayout.js';
import { WizardLayout } from './layouts/WizardLayout.js';
import type { FileFieldUpload } from './FileField.js';
import type {
  CrudFormColumnField,
  CrudFormConfig,
  FormFieldInitial,
  CrudFormRecapField,
  CrudFormRelationField,
  FormRelationFact,
} from '../../page-config/index.js';
import { dateOnlyValue } from '../../families/tables/column-spec.js';
import {
  coerceFieldValue,
  controlForColumn,
  fieldTypeTag,
  formColumns,
  isRequired,
  optionsForColumn,
} from './field-mapping.js';
import { CONTROL_COMPONENTS, type ControlOption } from './controls/index.js';
import { relationColumnShape } from './controls/reference-chips.js';
import type { ColumnFact, ColumnFacts, ListOptionsResolver } from './field-mapping.js';
import type { CrudApi, CrudRow } from './crud-api.js';
import { gridColumnSpecSchema, type GridColumnSpec } from '../../families/tables/column-spec.js';
import type { ResolvedFile } from '../../families/tables/cells.js';

/**
 * RecordForm — the create/edit form generated from column specs: one
 * `FormField` per editable column with a mono type tag (`varchar`, `enum`,
 * `→ public.team_members` — the UI explains its own generation), control
 * by `fieldKindFor`, FK → async avatar `Combobox` fed by `CrudApi.lookup`
 * (debounced 200 ms), server field errors inline.
 */

export const FK_LOOKUP_DEBOUNCE_MS = 200;

/** What a document's field says about a column, beyond the column itself. */
interface FieldOverrides {
  label?: string;
  required?: boolean;
  /** No `FormField` chrome at all — quick-create's title and detail box. */
  bare?: boolean;
  /** True inside a document's sections: the field anatomy the comp draws. */
  sectioned?: boolean;
  /** The document's own entry: the control, the words, the bounds. */
  field?: CrudFormColumnField;
  /** A relation field's own entry, when this is one (a line-items repeater). */
  relationField?: CrudFormRelationField;
}

/**
 * One rendered entry: a column's field, a relation's, or a recap box — each
 * with the stand-in column the layouts place it by.
 */
interface FieldEntry {
  field: CrudFormColumnField | CrudFormRelationField | CrudFormRecapField;
  column: GridColumnSpec;
}

/**
 * The stand-in column of a relation field the page reply does not offer: it
 * renders a notice and is never collected, sent or checked.
 */
const UNAVAILABLE_PREFIX = 'unavailable:';

/** The relation a stand-in column stands for, or null for a real column. */
export function relationIdOf(column: GridColumnSpec): string | null {
  return column.name.startsWith('rel:') ? column.name.slice('rel:'.length) : null;
}

/**
 * The date pill's five rows (comp 741) — and what each one STORES (DP12).
 *
 * The comp stores a label; a column stores a date. "This week" and "Next week"
 * are the last day of that week **in the viewer's locale**, which is why the
 * week's end is computed rather than assumed to be Sunday: in `en-US` the week
 * ends on Saturday, in most of Europe on Sunday, and in `ar-EG` on Friday.
 */
export function quickDatePresets(
  t: ReturnType<typeof useMaybeT>,
  locale?: string | undefined,
  now: Date = new Date(),
): ControlOption[] {
  const day = 24 * 60 * 60 * 1000;
  /*
   * The viewer's OWN calendar day. Not `dateOnlyValue`, which exists to recover
   * a date the database serialized as local midnight and shifts by twelve hours
   * to do it — here the Date is already the reader's, and "Today" means the day
   * they are looking at.
   */
  const iso = (date: Date): string =>
    `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  const endOfWeek = (from: Date): Date => {
    const first = firstDayOfWeek(locale);
    const ahead = (first + 6 - from.getDay() + 7) % 7;
    return new Date(from.getTime() + ahead * day);
  };
  const thisWeek = endOfWeek(now);
  return [
    { value: iso(now), label: t('ui:formDialog.quick.today', 'Today') },
    { value: iso(new Date(now.getTime() + day)), label: t('ui:formDialog.quick.tomorrow', 'Tomorrow') },
    { value: iso(thisWeek), label: t('ui:formDialog.quick.thisWeek', 'This week') },
    {
      value: iso(new Date(thisWeek.getTime() + 7 * day)),
      label: t('ui:formDialog.quick.nextWeek', 'Next week'),
    },
  ];
}


/** `section.columns` → the grid. Written out because Tailwind scans literals. */
const SECTION_COLUMNS: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
};

const SPAN_CLASS: Readonly<Record<1 | 2 | 3, string>> = {
  1: '',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
};

/**
 * One line-items relation's own table.
 *
 * ONE shape for two readers: the repeater needs the label and the columns, and
 * `PageCrud` needs the rest to read the rows that already exist. Two shapes for
 * one fact is how a table's key column comes to be spelled twice.
 */
export interface ChildFacts {
  label: string;
  /** The child table's snapshot id, for the read. */
  table: string;
  /** The child column pointing back at the parent; the form never writes it. */
  foreignColumn: string;
  /** The parent column it points at. */
  parentKeyColumn: string;
  /** The child's own key, for telling one existing row from another. */
  primaryKey: readonly string[];
  columns: readonly GridColumnSpec[];
  facts?: ColumnFacts | undefined;
}

/** Most lines one field reads or writes — the server's own cap. */
export const MAX_CHILD_ROWS = 200;

/** One child row as a form holds it: its key when it already exists. */
export interface ChildRow {
  key?: CrudRow | undefined;
  values: CrudRow;
}

export interface RecordFormProps {
  columns: readonly GridColumnSpec[];
  /**
   * The FORM DOCUMENT: which fields, in what order, grouped into
   * which sections, and how wide each one sits. Absent ⇒ the form renders the
   * flat stack of editable columns it always has, which is what every page
   * without a designed form still gets until its dialog derives one.
   *
   * The document decides the LAYOUT and the words. Which control a field gets
   * is still `fieldKindFor`'s answer — the control catalog and the per-field
   * `control` override are phase E, and wiring half of it now would mean two
   * mappings disagreeing in the same file.
   */
  document?: CrudFormConfig | undefined;
  /** Initial values — the record on edit, {} on create. */
  initialValues?: CrudRow | undefined;
  mode: 'create' | 'edit';
  /** Per-column server errors (unique violation etc.), by column name. */
  errors?: Readonly<Record<string, string>> | undefined;
  /**
   * What the server says about the table RIGHT NOW (`columnFacts` on the page
   * reply): who fills each column, and which ones the form has to ask for.
   * Absent ⇒ the stored spec decides, exactly as before.
   */
  facts?: ColumnFacts | undefined;
  /**
   * Resolves a `column.options` rule that NAMES a list into the answers it
   * holds. Absent ⇒ a named list offers nothing and the column
   * falls back to its own enum, which is what the write path does with a list
   * it cannot resolve either.
   *
   * A resolver rather than a map, because the host is the one that knows the
   * reader's language: `builtin:countries` is 249 codes here and 249 NAMES on
   * screen, and which names depends on who is looking.
   */
  listOptions?: ListOptionsResolver | undefined;
  /** FK lookup feed (CrudApi.lookup); absent → FK renders a plain input. */
  lookup?: CrudApi['lookup'] | undefined;
  /**
   * Which instants a temporal column already holds; absent ⇒ a calendar
   * strikes nothing out, which is the honest picture of "not checked".
   */
  availability?: CrudApi['availability'] | undefined;
  /** The record being edited — what a calendar excludes from that read. */
  recordId?: string | undefined;
  /**
   * The records each link RELATION already points at, by relation id, with
   * their names — what the chips show before anybody searches. Absent on a
   * create, and on a server that does not answer relations.
   */
  initialLinks?: Readonly<Record<string, readonly ControlOption[]>> | undefined;
  /**
   * The child rows each line-items relation already holds, by relation id.
   * Absent on a create — there is no parent to hold any.
   */
  initialChildren?: Readonly<Record<string, ChildRow[]>> | undefined;
  /**
   * What each line-items relation's own table looks like: its label and its
   * columns. Absent ⇒ a `child-rows` field renders nothing, which is the same
   * degradation every other fact-dependent control follows.
   */
  childFacts?: Readonly<Record<string, ChildFacts>> | undefined;
  /**
   * The link relations this table can write through (`columnFacts.relations`).
   * Absent ⇒ a form of columns only, which is what every form was before link
   * fields existed.
   */
  relations?: readonly FormRelationFact[] | undefined;
  /**
   * Submit with coerced values and, when the form has link fields, the target
   * keys each relation should end up pointing at. The links are a SEPARATE
   * argument because they are not columns of this row: they are rows of
   * another table, and folding them into `values` would put a key the table
   * does not have into the write path.
   */
  onSubmit: (
    values: CrudRow,
    links?: Record<string, string[]>,
    children?: Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>,
    /** One record per value of this column — the invitations field. */
    repeat?: { column: string; values: string[] },
  ) => void;
  formId?: string | undefined;
  /** Helper copy for unique columns ("Checked against 8,402 rows"). */
  uniqueHelper?: ((column: GridColumnSpec) => ReactNode) | undefined;
  /** Action row rendered INSIDE the form element (submit buttons). */
  footer?: ReactNode | undefined;
  /**
   * The wizard's state, reported upward whenever it moves.
   *
   * The STEPS live here because the values do: Continue has to check the step's
   * own fields before it advances, and a refusal that arrives from the server
   * has to jump back to the step holding it. The dialog owns the footer, so it
   * is handed `back` and `next` rather than asked to re-derive them.
   */
  onWizard?:
    | ((state: { step: number; steps: number; back: () => void; next: () => void }) => void)
    | undefined;
  /**
   * Uploads a file and resolves to the reference to store. Absent ⇒ every
   * `file` column renders the plain text input it had before its block was
   * configured — this package has no transport of its own.
   */
  uploadFile?: FileFieldUpload | undefined;
  /** What the current values already name, keyed by the stored value. */
  files?: ReadonlyMap<string, ResolvedFile | null> | undefined;
  /** Workspace upload cap, so the field can refuse before the request starts. */
  maxFileBytes?: number | undefined;
  /** The connection's currency, for the money prefix (comp 243–244). */
  currency?: string | undefined;
  /**
   * The reader's locale. Quick-create's "This week" stores the last day of the
   * week WHERE THEY ARE — Saturday in `en-US`, Friday in `ar-EG` — so the
   * preset cannot be computed without it.
   */
  locale?: string | undefined;
  /**
   * Who is signed in, for a field whose designer-set starting value is
   * "who is signed in" (plan 50's `initial: current-user`). Absent, such a
   * field starts empty.
   */
  currentUser?: { id: string; name: string } | undefined;
}

/**
 * The values a new record starts with, from the form document's `initial`
 * settings. `now` is the moment the form opens; `today` is the reader's
 * calendar day, as the date control shows it.
 */
export function startingValues(
  document: CrudFormConfig | undefined,
  currentUser: { id: string; name: string } | undefined,
  at: Date = new Date(),
): CrudRow {
  const out: CrudRow = {};
  for (const section of document?.sections ?? []) {
    for (const field of section.fields) {
      if (!('column' in field) || typeof field.column !== 'string') continue;
      const initial = (field as { initial?: FormFieldInitial }).initial;
      if (initial === undefined) continue;
      switch (initial.kind) {
        case 'literal':
          out[field.column] = initial.value;
          break;
        case 'now':
          out[field.column] = at.toISOString();
          break;
        case 'today': {
          const pad = (n: number) => String(n).padStart(2, '0');
          out[field.column] = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
          break;
        }
        case 'current-user':
          if (currentUser !== undefined) out[field.column] = currentUser[initial.field];
          break;
      }
    }
  }
  return out;
}

export function RecordForm({
  columns,
  document: formDocument,
  initialValues,
  currentUser,
  mode,
  errors,
  facts,
  initialLinks,
  initialChildren,
  childFacts,
  relations,
  listOptions,
  lookup,
  availability,
  recordId,
  onSubmit,
  formId,
  uniqueHelper,
  footer,
  onWizard,
  uploadFile,
  files,
  maxFileBytes,
  currency,
  locale,
}: RecordFormProps) {
  const t = useMaybeT();
  const byName = useMemo(() => new Map(columns.map((column) => [column.name, column])), [columns]);
  const relationFacts = useMemo(
    () => Object.fromEntries((relations ?? []).map((relation) => [relation.relationId, relation])),
    [relations],
  );
  /** The stand-in column a relation field's control renders with. */
  const relationColumn = (fact: FormRelationFact, label?: string): GridColumnSpec =>
    gridColumnSpecSchema.parse(
      relationColumnShape({
        relationId: fact.relationId,
        label: label ?? fact.label,
        targetTable: fact.targetTable,
        targetKey: fact.targetKey,
        ...(fact.targetName === undefined ? {} : { targetName: fact.targetName }),
        ...(fact.targetLabel === undefined ? {} : { targetLabel: fact.targetLabel }),
      }),
    );
  /**
   * The document's sections, resolved to the columns this form actually has.
   *
   * A field naming a column the page does not carry is SKIPPED rather than
   * rendered empty: a designed form can outlive the column it was designed
   * against, and a field with nothing behind it is a box that cannot be saved.
   * Telling the admin about it is the designer's job (phase H), not the
   * dialog's.
   */
  /** A relation field the page reply cannot back, kept as a notice in its place. */
  const unavailable = (field: CrudFormRelationField): FieldEntry => ({
    field,
    column: gridColumnSpecSchema.parse({
      name: `${UNAVAILABLE_PREFIX}${field.relation}`,
      label: field.label ?? field.relation,
      logicalType: 'text',
    }),
  });
  const sections = useMemo(() => {
    if (formDocument === undefined) return null;
    return formDocument.sections.map((section) => ({
      ...section,
      entries: section.fields.flatMap((field, index): FieldEntry[] => {
        /*
         * A RECAP is not a field: it writes nothing and reads everything. It
         * still travels as an entry so the layouts place it among the fields
         * where the document put it, with a stand-in column carrying its
         * position — two recaps in one section are two boxes.
         */
        if ('recap' in field) {
          return [
            {
              field,
              column: gridColumnSpecSchema.parse({
                // The name is a position, never a column: a recap writes
                // nothing, and `collect` skips it on that basis.
                name: `recap:${String(index)}`,
                label: 'Recap',
                logicalType: 'text',
              }),
            },
          ];
        }
        if ('relation' in field) {
          /*
           * A LINE-ITEMS field is described by the CHILD facts, not the link
           * ones: it edits rows of the other table rather than picking keys
           * from it, and the two blocks are answered by two different
           * questions on the page reply.
           */
          if (field.control === 'child-rows') {
            const child = childFacts?.[field.relation];
            if (child === undefined) return childFacts === undefined ? [] : [unavailable(field)];
            return [
              {
                field,
                column: gridColumnSpecSchema.parse({
                  name: `rel:${field.relation}`,
                  label: field.label ?? child.label,
                  logicalType: 'json',
                }),
              },
            ];
          }
          // A relation field renders through the control registry like any
          // other, with a stand-in column carrying the target (see
          // `relationColumnShape`). A relation the reply does not offer is
          // said, in its place: the form was designed with it, and a field
          // that silently vanished is one nobody can find out about. A reply
          // with no relations at all (an older server) offers none to say.
          const fact = relationFacts?.[field.relation];
          if (fact === undefined) return relations === undefined ? [] : [unavailable(field)];
          return [{ field, column: relationColumn(fact, field.label) }];
        }
        const column = byName.get(field.column);
        return column === undefined ? [] : [{ field, column }];
      }),
    }));
  }, [formDocument, byName, relationFacts, childFacts, relations]);

  const fields = useMemo(
    () =>
      sections === null
        ? formColumns(columns, facts, listOptions)
        : sections.flatMap((section) => section.entries.map((entry) => entry.column)),
    [sections, columns, facts, listOptions],
  );
  /*
   * A NEW record starts from the designer's starting values.
   * The form designer has always saved `initial`; nothing read it, so "starts
   * as today" and "starts as who is signed in" silently did nothing. A value
   * the caller passed wins — it is the record being copied, or a prefill.
   */
  const [values, setValues] = useState<CrudRow>(() => ({
    ...(mode === 'create' ? startingValues(formDocument, currentUser) : {}),
    ...(initialValues ?? {}),
  }));
  /**
   * The child rows each line-items field holds, by relation id. Separate from
   * `values` because they are ROWS OF ANOTHER TABLE, and separate from `links`
   * because a link is a key and a child row is a record.
   */
  const [children, setChildren] = useState<Record<string, ChildRow[]>>(() => ({
    ...(initialChildren ?? {}),
  }));
  /**
   * The keys each relation should end up pointing at. Seeded from the links the
   * record already has, so a save that touches nothing else replaces a set with
   * itself rather than emptying it.
   */
  const [links, setLinks] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      Object.entries(initialLinks ?? {}).map(([relationId, options]) => [
        relationId,
        options.map((option) => option.value),
      ]),
    ),
  );
  /**
   * What THIS form refused, keyed by column — as opposed to `errors`, which is
   * what the server refused. Cleared for a field the moment it is edited, so a
   * message never outlives the value it was about.
   */
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});
  /** Which step a wizard is on. Ignored by every other preset. */
  const [step, setStep] = useState(0);

  const setField = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setIssues((current) => {
      if (current[name] === undefined) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  /** Empty for the purposes of "you have to give me this one". */
  const isBlank = (raw: unknown): boolean =>
    raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);

  const isWizard = formDocument?.preset === 'wizard' && sections !== null && sections.length > 1;
  const isQuick = formDocument?.preset === 'quick-create' && sections !== null;
  const isSplit = formDocument?.preset === 'split-pane' && sections !== null;

  /*
   * A refusal from the SERVER jumps to the step holding it. Without this a
   * wizard answers "something is wrong" on the last step about a field two
   * steps back, which is the failure the steps existed to prevent.
   */
  useEffect(() => {
    if (!isWizard || sections === null || errors === undefined) return;
    const named = Object.keys(errors);
    if (named.length === 0) return;
    const holding = sections.findIndex((section) =>
      section.entries.some((entry) => named.includes(entry.column.name)),
    );
    if (holding >= 0) setStep(holding);
  }, [errors, isWizard, sections]);

  /**
   * The values to send and what the FORM refused, over a set of columns.
   *
   * Taken out of `submit` because the wizard checks one step at a time: the
   * same rules, over the step's own fields, before it lets anybody past.
   */
  const collect = (over: readonly GridColumnSpec[]): { out: CrudRow; refused: Record<string, string> } => {
    const out: CrudRow = {};
    const refused: Record<string, string> = {};
    for (const column of over) {
      // A relation's stand-in column is not a column of this row: its keys go
      // in the second argument, as rows of another table. A recap's stand-in
      // is not a column of anything — it writes nothing at all.
      if (relationIdOf(column) !== null || column.name.startsWith('recap:') || column.name.startsWith(UNAVAILABLE_PREFIX)) continue;
      const fact = facts?.[column.name];
      if (controlForColumn(column, fact, listOptions) === 'readonly') continue;
      /*
       * An on/off switch nobody touched shows OFF, and off is what it means —
       * unless something else fills the column, in which case sending nothing
       * lets it. It used to stay `undefined`, which the check below read as
       * blank, so a new record's untouched switch said "This field is
       * required.".
       */
      const untouchedSwitch =
        mode === 'create' &&
        values[column.name] === undefined &&
        column.logicalType === 'boolean' &&
        (fact === undefined ? column.hasDefault !== true : fact.filledBy === null);
      const raw = untouchedSwitch ? false : values[column.name];
      /*
       * `required` used to be DECORATION — an asterisk and `aria-required`,
       * with nothing checking either. A blank NOT NULL field went to the
       * server, which answered 500 with no column named. Now the form says so
       * itself, before the request, under the field.
       */
      if (isRequired(column, fact, values) && isBlank(raw) && !(mode === 'edit' && raw === undefined)) {
        refused[column.name] = t('ui:formDialog.issue.required', 'This field is required.');
        continue;
      }
      // Blank and something else fills it ⇒ send nothing, and let whatever
      // fills it do so. `filledBy` is the fact; `hasDefault` is the old guess.
      const filled = fact === undefined ? column.hasDefault === true : fact.filledBy !== null;
      if (mode === 'create' && isBlank(raw) && filled) continue;
      if (raw === undefined && mode === 'edit') continue; // untouched
      out[column.name] = coerceFieldValue(column, raw);
    }
    return { out, refused };
  };

  /*
   * Continue: check THIS step's fields, then move. A wizard that walks a
   * person to the end and only then says the second step was wrong has wasted
   * the walk.
   */
  const advance = (): void => {
    if (sections === null) return;
    const columns = (sections[step]?.entries ?? []).map((entry) => entry.column);
    const { refused } = collect(columns);
    setIssues(refused);
    if (Object.keys(refused).length > 0) return;
    if (step + 1 < sections.length) setStep(step + 1);
    else submit();
  };

  useEffect(() => {
    if (!isWizard || sections === null) return;
    onWizard?.({
      step,
      steps: sections.length,
      back: () => setStep((current) => Math.max(0, current - 1)),
      next: advance,
    });
    // `advance` closes over the values, so this reports on every change — which
    // is what keeps the footer's Continue checking what is on screen NOW.
  });

  /**
   * A line's computed total, written into the child column that holds it.
   *
   * Computed numbers are stored ONLY where a column exists for them: the field
   * has to name one and mark it read-only, and nothing else about the block is
   * ever written. Done at submit rather than on every keystroke — an effect
   * that wrote a computed value back into the values it is computed from is a
   * loop waiting for a rounding difference.
   */
  const stampLineTotals = (relationId: string, rows: readonly ChildRow[]): ChildRow[] => {
    const field = sections
      ?.flatMap((section) => section.entries.map((entry) => entry.field))
      .find((entry) => 'relation' in entry && entry.relation === relationId);
    if (field === undefined || !('relation' in field)) return [...rows];
    const totals = field.totals;
    const holder = field.columns?.find((column) => column.readOnly === true);
    if (totals?.row === undefined || holder === undefined) return [...rows];
    const computed = computeTotals(totals, rows.map((row) => row.values));
    return rows.map((row, index) => ({
      ...row,
      values: { ...row.values, [holder.column]: computed.lines[index] ?? null },
    }));
  };

  const submit = () => {
    const { out, refused } = collect(fields);
    setIssues(refused);
    if (Object.keys(refused).length > 0) return;
    /*
     * The links go only when the form HAS link fields. A form with none must
     * send no `links` key at all: an empty object would be a request to replace
     * nothing, which is harmless, and a key the older server does not know,
     * which is not.
     */
    const relationFields =
      sections === null
        ? (relations ?? []).map((relation) => relation.relationId)
        : sections.flatMap((section) =>
            section.entries.flatMap((entry) => {
              const relationId = relationIdOf(entry.column);
              if (relationId === null) return [];
              /*
               * A LINE-ITEMS field is a relation and is NOT a link: its rows
               * travel under `children`. Sending its id under `links` asks the
               * server to resolve a one-to-many as a join table, which it
               * refuses — correctly, and with a message about a link table
               * that means nothing to somebody editing invoice lines.
               */
              const field = entry.field;
              if ('relation' in field && field.control === 'child-rows') return [];
              return [relationId];
            }),
          );
    const childFields = sections === null ? [] : Object.keys(children);

    /*
     * A chips field marked "one record each" is not a value of this row: its
     * items are rows of their own, and the column it names carries one of them
     * each. Taken out of `out` here so the payload cannot say both things.
     */
    const repeating = sections
      ?.flatMap((section) => section.entries.map((entry) => entry.field))
      .find((entry) => 'column' in entry && entry.each === 'record');
    let repeat: { column: string; values: string[] } | undefined;
    if (repeating !== undefined && 'column' in repeating) {
      const raw = out[repeating.column];
      const items = Array.isArray(raw) ? raw.map((item) => String(item)).filter((item) => item !== '') : [];
      delete out[repeating.column];
      if (items.length === 0) {
        setIssues({
          [repeating.column]: t('ui:formDialog.issue.required', 'This field is required.'),
        });
        return;
      }
      repeat = { column: repeating.column, values: items };
    }

    if (relationFields.length === 0 && childFields.length === 0) {
      // ONE argument when there is nothing else to say: an adapter written
      // before any of this took exactly one, and handing it three `undefined`s
      // would be three arguments it never asked for.
      if (repeat === undefined) onSubmit(out);
      else onSubmit(out, undefined, undefined, repeat);
      return;
    }
    onSubmit(
      out,
      Object.fromEntries(relationFields.map((relationId) => [relationId, links[relationId] ?? []])),
      childFields.length === 0
        ? undefined
        : Object.fromEntries(
            childFields.map((relationId) => [relationId, stampLineTotals(relationId, children[relationId] ?? [])]),
          ),
      repeat,
    );
  };

  /**
   * The answers a choice control offers for this column.
   *
   * An admin's `column.options` rule wins; failing that, the column's own enum
   * is the database's list, tinted with what an admin gave its values
   * (`enumTones`, the remap op that already exists). `optionsForColumn` owns
   * the precedence, because `controlForColumn` has to agree with it about what
   * this column even is.
   */
  const optionsFor = (column: GridColumnSpec, fact?: ColumnFact | undefined): ControlOption[] =>
    optionsForColumn(column, fact, listOptions);

  /**
   * What a column's current value is CALLED — the option's label where there is
   * one, the value itself otherwise.
   *
   * The recap reads through this rather than off `values`: a choice stored as
   * `std` reads "Standard shipping" everywhere else on the screen, and a recap
   * printing the code would be the one place showing the database's spelling.
   */
  const labelFor = (name: string): string => {
    const raw = values[name];
    if (raw === undefined || raw === null || raw === '') return '';
    const column = byName.get(name);
    if (column === undefined) return String(raw);
    const found = optionsFor(column, facts?.[name]).find((option) => option.value === String(raw));
    return found?.label ?? String(raw);
  };

  /**
   * One field, whole — resolved through the CONTROL REGISTRY.
   *
   * The control is the document's if the designer chose one, else the one
   * `controlForColumn` gives this column. Everything the control needs arrives
   * as props; nothing about the form's state, its layout or its section reaches
   * it, which is what keeps twenty-odd controls a lookup rather than a switch.
   */
  const renderField = (column: GridColumnSpec, overrides: FieldOverrides = {}): ReactNode => {
    /*
     * A RELATION field: its value is a list of target keys held beside the
     * row's values, because it writes rows of another table. Everything else
     * about it — the control, the label, the chrome — is the ordinary path.
     */
    const relationId = relationIdOf(column);
    const fact = relationId === null ? facts?.[column.name] : undefined;
    const resolved = relationId === null ? controlForColumn(column, fact, listOptions) : 'reference-chips';
    if (resolved === 'hidden') return null;
    const field = overrides.field;
    const control = field?.control ?? resolved;

    /*
     * A LINE-ITEMS field is the one relation field that is not a picker: it
     * edits whole rows of another table, so it renders its own component with
     * that table's columns rather than going through the control registry,
     * whose whole contract is (column, value) → element.
     */
    const relationField = overrides.relationField;
    if (relationId !== null && relationField?.control === 'child-rows') {
      const fact = childFacts?.[relationId];
      if (fact === undefined) return null;
      const error = errors?.[relationId] ?? issues[relationId];
      return (
        <div key={column.name} className="flex flex-col gap-1.5">
          <ChildRowsControl
            field={relationField}
            columns={fact.columns}
            {...(fact.facts === undefined ? {} : { facts: fact.facts })}
            rows={children[relationId] ?? []}
            onChange={(rows) => setChildren((current) => ({ ...current, [relationId]: rows }))}
            label={relationField.label ?? fact.label}
            {...(currency === undefined ? {} : { currency })}
            {...(locale === undefined ? {} : { locale })}
          />
          {error === undefined ? null : <p className="text-caption text-danger">{error}</p>}
        </div>
      );
    }

    const entry = CONTROL_COMPONENTS[control as keyof typeof CONTROL_COMPONENTS] ?? CONTROL_COMPONENTS.text;
    const Control = entry.component;

    const required = relationId === null && (overrides.required === true || isRequired(column, fact, values));
    // The server's refusal wins: it saw the value that was actually sent. A
    // link refusal arrives under the RELATION id, which is what the write path
    // names it (`details.fields["<relationId>"]`).
    const errorKey = relationId ?? column.name;
    const error = errors?.[errorKey] ?? issues[errorKey];
    const value = relationId === null ? values[column.name] : (links[relationId] ?? []);

    const controlProps = {
      column,
      ...(field === undefined ? {} : { field }),
      value,
      onChange:
        relationId === null
          ? (next: unknown) => setField(column.name, next)
          : (next: unknown) =>
              setLinks((current) => ({
                ...current,
                [relationId]: Array.isArray(next) ? next.map((key) => String(key)) : [],
              })),
      options:
        relationId === null
          ? optionsFor(column, fact)
          : ((initialLinks?.[relationId] ?? []) as readonly ControlOption[]),
      mode,
      ...(error === undefined ? {} : { error: true as const }),
      ...(currency === undefined ? {} : { currency }),
      ...(lookup === undefined ? {} : { lookup }),
      ...(uploadFile === undefined ? {} : { upload: uploadFile }),
      ...(files === undefined ? {} : { files }),
      ...(maxFileBytes === undefined ? {} : { maxFileBytes }),
      ...(locale === undefined ? {} : { locale }),
      ...(availability === undefined ? {} : { availability }),
      ...(recordId === undefined ? {} : { recordId }),
      // Read-only, and only one control asks for them: a calendar scoped by
      // another field has to know what that field currently says.
      siblings: values,
    };

    /*
     * A toggle row and a check row ARE the label (comp 258–261, 402–407), so
     * they are rendered bare — a `FormField` around them would print the label
     * twice. Their error, when there is one, goes under the row.
     */
    if (entry.ownsLabel === true) {
      return (
        <div key={column.name} className="flex flex-col gap-1.5">
          <Control {...controlProps} />
          {error === undefined ? null : (
            <p className="text-[11.5px] font-medium text-danger">{error}</p>
          )}
        </div>
      );
    }

    /*
     * Quick-create's title and detail box carry no label and no tag: the
     * placeholder IS the label there, and a column of labels over a 440px
     * dialog is what the preset exists to avoid.
     */
    if (overrides.bare === true) {
      return (
        <div key={column.name} className="flex flex-col gap-1">
          <Control {...controlProps} />
          {error === undefined ? null : <p className="text-[11.5px] font-medium text-danger">{error}</p>}
        </div>
      );
    }

    const common = {
      label: overrides.label ?? column.label,
      required,
      /*
       * ONLY A REFERENCE CARRIES A TYPE TAG in the designed form (comp 212,
       * 269; 0.2 #4). The flat stack keeps tagging everything, because that is
       * what every page without a form document renders today and changing it
       * would change every one of them.
       */
      ...(overrides.sectioned !== true || column.fk !== undefined
        ? { tag: <Tag mono>{fieldTypeTag(column)}</Tag> }
        : {}),
      ...(error !== undefined ? { error } : {}),
      ...(error === undefined && field?.help !== undefined ? { helper: field.help } : {}),
      ...(error === undefined && field?.help === undefined && column.unique && uniqueHelper !== undefined
        ? { helper: uniqueHelper(column) }
        : {}),
    };

    return (
      <FormField key={column.name} {...common}>
        <Control {...controlProps} />
      </FormField>
    );
  };

  /**
   * QUICK CREATE, from the document's own order (comp 142–182).
   *
   * The first field is the title, the first long text after it is the detail
   * box, everything a pill can hold becomes one, and anything else keeps the
   * ordinary field anatomy between the two (F20). Nothing here is a new
   * control: a pill's menu is the column's own options, and the date pill's
   * last row is a real date input, because the comp stores a label and the
   * product has to store a date (DP12).
   */
  const quickParts = useMemo(() => {
    if (sections === null) return null;
    const entries = sections.flatMap((section) => section.entries);
    if (entries.length === 0) return null;
    const [first, ...others] = entries;
    const detailIndex = others.findIndex(
      (entry) => entry.column.logicalType === 'text' || (entry.column.maxLength ?? 0) > 120,
    );
    const detail = detailIndex >= 0 ? others[detailIndex] : undefined;
    const rest = others.filter((_, index) => index !== detailIndex);
    return { first: first as FieldEntry, detail, rest };
  }, [sections]);

  const pillKindOf = (column: GridColumnSpec, fact?: ColumnFact | undefined): PillKind | null => {
    if (column.logicalType === 'boolean') return 'boolean';
    if (['date', 'timestamp', 'timestamptz'].includes(column.logicalType)) return 'date';
    if (column.fk !== undefined) return 'reference';
    return optionsForColumn(column, fact, listOptions).length > 0 ? 'choice' : null;
  };

  /** One section's fields, in its grid — the same markup in every layout. */
  const renderSectionFields = (section: {
    columns: 1 | 2 | 3;
    entries: FieldEntry[];
    aside?: string | undefined;
  }): ReactNode => {
    const entryOf = (entry: FieldEntry): ReactNode => {
      // A RECAP renders itself: no label, no control, no value to collect.
      if ('recap' in entry.field) {
        return <RecapBox key={entry.column.name} recap={entry.field.recap} values={values} labels={labelFor} />;
      }
      if (entry.column.name.startsWith(UNAVAILABLE_PREFIX)) {
        return <UnavailableField key={entry.column.name} label={'label' in entry.field ? entry.field.label : undefined} />;
      }
      return renderField(entry.column, {
        sectioned: true,
        // A relation's entry is not a column field: it carries no bounds, no
        // format and no `required`, and handing it to a control that reads
        // those would be a lie about what the document said.
        ...('column' in entry.field ? { field: entry.field } : { relationField: entry.field }),
        ...(entry.field.label === undefined ? {} : { label: entry.field.label }),
        ...('column' in entry.field && entry.field.required === true ? { required: true } : {}),
      });
    };

    /*
     * THE MEDIA ASIDE (comp 268; DP14). A section may name ONE of its own
     * fields — an image or an avatar — to stand beside the rest rather than
     * among them. It keeps the comp's 150px because it is a named section
     * feature rather than a per-row pixel grid: `1fr 200px` on an ordinary row
     * would be a layout an admin cannot express, but "this picture goes on the
     * side" is exactly what the document says here.
     */
    const aside = section.aside === undefined
      ? undefined
      : section.entries.find((entry) => entry.column.name === section.aside);
    const rest = aside === undefined ? section.entries : section.entries.filter((entry) => entry !== aside);

    const grid = (
      <div className={cn('grid flex-1 gap-3.5', SECTION_COLUMNS[section.columns])}>
        {rest.map((entry) => (
          <div
            key={entry.column.name}
            className={
              // A control that needs the row takes it; `span` counts COLUMNS,
              // so a 2-span in a 3-column section is two.
              SPAN_CLASS[
                Math.min(
                  // A recap is a box about the whole form, so it takes the row.
                  'recap' in entry.field ? 3 : (entry.field.span ?? 1),
                  section.columns,
                ) as 1 | 2 | 3
              ]
            }
          >
            {entryOf(entry)}
          </div>
        ))}
      </div>
    );

    if (aside === undefined) return grid;
    return (
      <div className="flex flex-wrap items-start gap-3.5" data-part="section-aside">
        <div className="w-[150px] shrink-0">{entryOf(aside)}</div>
        {grid}
      </div>
    );
  };

  return (
    <form
      id={formId}
      data-part="record-form"
      className={sections === null ? 'flex flex-col gap-4' : 'flex flex-col gap-[22px]'}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {sections === null ? (
        [
          ...fields.map((column) => renderField(column)),
          // A form with no document is a flat stack of columns; its link
          // fields go under them, in the order the reply named them. The
          // record page's edit dialog is the caller that has no document.
          ...(relations ?? []).map((relation) => renderField(relationColumn(relation))),
        ]
      ) : isQuick && quickParts !== null ? (
        <QuickLayout
          title={renderField(quickParts.first.column, {
            sectioned: true,
            bare: true,
            ...('column' in quickParts.first.field ? { field: quickParts.first.field } : {}),
          })}
          {...(quickParts.detail === undefined
            ? {}
            : {
                detail: renderField(quickParts.detail.column, {
                  sectioned: true,
                  bare: true,
                  ...('column' in quickParts.detail.field ? { field: quickParts.detail.field } : {}),
                }),
              })}
          rest={quickParts.rest
            .filter(
              (entry) =>
                !('recap' in entry.field) &&
                pillKindOf(entry.column, facts?.[entry.column.name]) === null,
            )
            .map((entry) =>
              renderField(entry.column, {
                sectioned: true,
                ...('column' in entry.field
                  ? { field: entry.field }
                  : 'relation' in entry.field
                    ? { relationField: entry.field }
                    : {}),
                ...('recap' in entry.field || entry.field.label === undefined
                  ? {}
                  : { label: entry.field.label }),
              }),
            )}
          pills={quickParts.rest.flatMap((entry): QuickPill[] => {
            const fact = facts?.[entry.column.name];
            const kind = pillKindOf(entry.column, fact);
            if (kind === null) return [];
            const options = optionsForColumn(entry.column, fact, listOptions);
            // A recap never becomes a pill (it is filtered out above), so this
            // is only ever a column's or a relation's own label.
            const entryLabel = 'recap' in entry.field ? undefined : entry.field.label;
            const value = values[entry.column.name];
            const chosen = options.find((option) => option.value === String(value ?? ''));
            return [
              {
                key: entry.column.name,
                kind,
                placeholder: entryLabel ?? entry.column.label,
                ...(chosen?.label === undefined ? {} : { label: chosen.label }),
                value,
                options: kind === 'date' ? quickDatePresets(t, locale) : options,
                onChange: (next) => setField(entry.column.name, next),
                // The clear row belongs to an OPTIONAL column only: offering
                // "No date" on a column the database demands is offering a
                // refusal (611).
                ...(isRequired(entry.column, fact, values)
                  ? {}
                  : {
                      clearLabel: t('ui:formDialog.quick.clear', 'No {field}', {
                        field: (entryLabel ?? entry.column.label).toLowerCase(),
                      }),
                    }),
                ...(kind === 'reference' && entry.column.fk !== undefined
                  ? {
                      reference: {
                        table: entry.column.fk.table,
                        column: entry.column.fk.column,
                        ...(entry.column.fk.display === undefined ? {} : { display: entry.column.fk.display }),
                        lookup,
                        // The picker itself, for a target too big to list
                        // (F14) — the same control the sectioned form uses.
                        picker: renderField(entry.column, { sectioned: true, bare: true }),
                      },
                    }
                  : {}),
                ...(kind === 'date'
                  ? {
                      // DP12: the comp's own date input, as the menu's last row.
                      menu: (
                        <input
                          type="date"
                          className="h-[30px] w-full rounded-lg border border-border-strong bg-surface-2 px-2 text-[12.5px] text-fg"
                          aria-label={t('ui:formDialog.quick.pickDate', 'Pick a date')}
                          value={typeof value === 'string' ? dateOnlyValue(value) : ''}
                          onChange={(event) => setField(entry.column.name, event.target.value)}
                        />
                      ),
                    }
                  : {}),
              },
            ];
          })}
        />
      ) : isWizard ? (
        <WizardLayout
          steps={sections.map((section, index) => ({
            id: section.id,
            label: section.label ?? t('ui:formDialog.wizard.step', 'Step {n}', { n: index + 1 }),
            ...(section.hint === undefined ? {} : { hint: section.hint }),
            ...(section.intro === undefined ? {} : { intro: section.intro }),
            content: renderSectionFields(section),
          }))}
          current={Math.min(step, sections.length - 1)}
          railLabel={t('ui:formDialog.wizard.rail', 'Steps')}
          onStep={setStep}
        />
      ) : isSplit ? (
        <SplitLayout
          panes={sections.map((section) => ({
            id: section.id,
            ...(section.label === undefined ? {} : { label: section.label }),
            ...(section.intro === undefined ? {} : { intro: section.intro }),
            content: renderSectionFields(section),
          }))}
        />
      ) : (
        sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-3">
            {section.label === undefined ? null : (
              // 11 / 700, .05em, uppercase, subtle (comp 188, 199, 207).
              <h3 className="text-[11px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
                {section.label}
              </h3>
            )}
            {section.intro === undefined ? null : (
              <p className="text-body-sm text-fg-muted">{section.intro}</p>
            )}
            {renderSectionFields(section)}
          </section>
        ))
      )}
      {footer}
    </form>
  );
}


/**
 * A designed field this record has nothing behind: a relation the page reply
 * does not offer (its link table is not one Adminium can write through, or it
 * is hidden from this reader). Said where the field would be, so the form
 * never looks complete with a field quietly gone.
 */
function UnavailableField({ label }: { label: string | undefined }) {
  const t = useMaybeT();
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2" data-testid="form-field-unavailable">
      {label === undefined ? null : <p className="text-[12px] font-semibold text-fg">{label}</p>}
      <p className="text-[12px] text-fg-muted">
        {t('ui:formDialog.unavailable', 'This field can’t be shown: nothing links this record to the rows it names.')}
      </p>
    </div>
  );
}

/**
 * THE RECAP BOX — the comp's accent-soft summary (443–446, 683–684, 781–782).
 *
 * A sentence about what has been filled in and one computed number, over values
 * nobody has saved. Nothing here is sent and nothing is stored: it is a reading
 * of the screen, which is exactly why it can say things a database could not.
 *
 * A placeholder naming a field nobody has filled renders as NOTHING rather than
 * as `{plan}` — half a sentence is better than a template leaking into the UI.
 */
function RecapBox({
  recap,
  values,
  labels,
}: {
  recap: CrudFormRecapField['recap'];
  values: CrudRow;
  labels: (column: string) => string;
}) {
  const sentence = recap.sentence.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => labels(name));
  const value =
    recap.value === undefined
      ? null
      : (evaluateDerivedFields(
          [{ id: 'recap', expr: recap.value.expr as never, scale: recap.value.scale ?? 2 }],
          { row: values as Record<string, unknown> },
        ).values['recap'] ?? null);

  return (
    <div
      className="flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3.5"
      data-testid="form-recap"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-fg-muted" data-testid="form-recap-sentence">
          {sentence}
        </p>
        {value === null ? null : (
          <MonoText
            className="mt-0.5 text-[18px] font-extrabold tracking-[-0.02em] text-accent"
            data-testid="form-recap-value"
          >
            {value}
          </MonoText>
        )}
      </div>
      {recap.icon === undefined ? null : <Sparkles className="size-[18px] text-accent" aria-hidden="true" />}
    </div>
  );
}
