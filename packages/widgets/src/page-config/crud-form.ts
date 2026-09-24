// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `config.form` — the FORM DOCUMENT of a `page-crud` body.
 *
 * ─── Absence is the norm, and that is the whole design ─────────────────────
 *
 * A page carries a `form` block only when somebody has designed one. With no
 * block, {@link deriveFormDocument} builds the form from the LIVE column facts
 * on the page reply, which is what makes a form follow the table when a column
 * is added and a stored spec cannot (regeneration skips a page anybody has
 * edited — including merely hiding a column).
 *
 * That is why this is version **2**. Version 1 exists in the wild: every
 * generated page since M-something carries a `form: { fields: [...] }` block
 * that NOTHING has ever read — written by `composeCrudBody`, and disagreeing
 * with the live form's own rules (it hid a timestamp only when something filled
 * it, and segmented at ≤ 3 where the form segments at ≤ 4). A version-1 block is
 * ignored here rather than migrated: it never drove anything, so honouring it
 * now would CHANGE how a stored page renders, which is precisely what an
 * unedited page is promised will not happen.
 *
 * ─── Tolerant, like every other leaf ───────────────────────────────────────
 *
 * `parseCrudForm` answers `null` for anything it cannot read — a v1 block, a
 * wave-2 preset, a field kind this build does not have — and the caller derives
 * the form instead. A page whose stored document is a little ahead of the
 * binary renders the derived form, never an error.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// The control catalog (Appendix C)
// ---------------------------------------------------------------------------

/**
 * Every control a field may name. Closed on purpose: the designer offers what
 * is legal for a column, and a control the renderer has no component for would
 * be a field that renders as nothing.
 *
 * `calendar` joined with phase L, `child-rows` with phase M and the `recap`
 * block with phase N. A document naming a control this build does not have
 * still fails to parse and falls back to the derived form, which is the
 * degradation a stored document ahead of the binary is owed.
 */
export const FORM_CONTROLS = [
  'text',
  'title',
  'textarea',
  'mono',
  'email',
  'url',
  'phone',
  'password',
  'number',
  'currency',
  'stepper',
  'slider',
  'date',
  'time',
  'datetime',
  'select',
  'segmented',
  'pill-switch',
  'choice-cards',
  'toggle-row',
  'check-row',
  'chips',
  'reference',
  'reference-chips',
  'image',
  'avatar',
  'attachments',
  'json',
  'readonly',
  /**
   * A month grid, optionally beside a grid of times (phase L). One control
   * over ONE temporal column: the day and the slot are one instant, and two
   * fields for one column is how a form comes to hold half a booking.
   */
  'calendar',
] as const;
export type FormControl = (typeof FORM_CONTROLS)[number];

/** The layouts this build renders. */
export const FORM_PRESETS = [
  'sectioned',
  'quick-create',
  'wizard',
  'multi-entry',
  'segmented-files',
  'choice-cards',
  'upload-chips',
  'split-pane',
  'repeater-totals',
] as const;
export type FormPreset = (typeof FORM_PRESETS)[number];

/** At most this many fields in one document — past it a dialog is a page. */
export const MAX_FORM_FIELDS = 80;
export const MAX_FORM_SECTIONS = 12;
/** Typed, untranslated strings, like `crud-labels`. */
const shortText = z.string().trim().min(1).max(80);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const initialSchema = z.union([
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
  z.object({ kind: z.enum(['now', 'today']) }),
  z.object({ kind: z.literal('current-user'), field: z.enum(['id', 'name']) }),
]);
export type FormFieldInitial = z.infer<typeof initialSchema>;

/** How a reference renders a row: its name, a big value line, up to two details. */
const referenceSchema = z.object({
  name: z.string().optional(),
  value: z.string().optional(),
  detail: z.array(z.string()).max(2).optional(),
  avatar: z.boolean().optional(),
});

const columnFieldSchema = z.object({
  column: z.string().min(1),
  control: z.enum(FORM_CONTROLS).optional(),
  label: shortText.optional(),
  placeholder: shortText.optional(),
  help: z.string().trim().min(1).max(200).optional(),
  span: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  required: z.literal(true).optional(),
  hidden: z.literal(true).optional(),
  initial: initialSchema.optional(),
  reference: referenceSchema.optional(),
  prefix: z.string().max(8).optional(),
  unit: z.string().max(12).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  itemFormat: z.enum(['email', 'url']).optional(),
  /**
   * `chips` only: each chip makes its own RECORD instead of a list in one
   * column — the invitations field (comp 484–488). The rest of the form is
   * shared by every row, and all of them are written in one transaction under
   * one undo token.
   */
  each: z.literal('record').optional(),
  /**
   * A `calendar` field's times. Absent ⇒ a month grid alone, which is what a
   * `date` column wants; present ⇒ the comp's slot grid beside it.
   */
  slots: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    })
    .optional(),
  /**
   * What makes a day or a slot "taken". Absent ⇒ nothing is struck through and
   * the legend shows "Selected" alone: a product must not draw a claim about
   * availability that nobody has told it how to make.
   */
  availability: z
    .object({
      /** A column of this table whose value scopes the question. */
      resource: z.string().min(1).optional(),
    })
    .optional(),
});
export type CrudFormColumnField = z.infer<typeof columnFieldSchema>;

/** One column of the line-items table, as the repeater draws it. */
const childColumnSchema = z.object({
  column: z.string().min(1),
  label: shortText.optional(),
  control: z.enum(FORM_CONTROLS).optional(),
  /** The comp's grid track: `1fr`, `70px`, `96px` (289). */
  width: z.string().max(12).optional(),
  /** Right-aligned and mono, like the comp's computed Total column (300). */
  readOnly: z.literal(true).optional(),
});
export type CrudFormChildColumn = z.infer<typeof childColumnSchema>;

/**
 * The comp's totals block (306–312): Subtotal, a rate, a ruled Total.
 *
 * `row` is what ONE line totals; `rows` are the lines under the table. The fold
 * lives outside the expression language on purpose — `FieldExpr` is shared with
 * the server's `compute=`, which compiles it into SQL, and a `Σ over rows` leaf
 * would be a wire change, a server change and a Studio change for a block that
 * only ever runs in a browser.
 */
const childTotalsSchema = z.object({
  /** One line's own total. Absent ⇒ no computed column and no block. */
  row: z.object({ expr: z.unknown() }).optional(),
  scale: z.number().int().min(0).max(6).optional(),
  rows: z
    .array(
      z.object({
        label: shortText,
        of: z.enum(['sum', 'rate', 'total']),
        /** `of: 'rate'` only — a decimal string, e.g. `0.085`. */
        rate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      }),
    )
    .min(1)
    .max(6),
});
export type CrudFormChildTotals = z.infer<typeof childTotalsSchema>;

const relationFieldSchema = z.object({
  relation: z.string().min(1),
  control: z.enum(['reference-chips', 'check-rows', 'child-rows']).optional(),
  label: shortText.optional(),
  help: z.string().trim().min(1).max(200).optional(),
  span: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  reference: referenceSchema.optional(),
  /** `child-rows` only: which of the child table's columns the repeater edits. */
  columns: z.array(childColumnSchema).min(1).max(8).optional(),
  totals: childTotalsSchema.optional(),
  /** How few and how many lines a save accepts. */
  min: z.number().int().min(0).max(200).optional(),
  max: z.number().int().min(1).max(200).optional(),
});
export type CrudFormRelationField = z.infer<typeof relationFieldSchema>;

/**
 * The recap box (comp 443–446): a sentence about what has been filled in, and
 * one computed number.
 *
 * It is not a field — nothing about it is sent, and nothing about it is stored.
 * It reads what is already on screen, which is why it can say things a database
 * could not: the values it sums have not been saved yet.
 *
 * `sentence` is the author's copy with `{column}` placeholders. They resolve
 * through the column's OPTION LABELS, not its stored values: a plan stored as
 * `std` reads "Standard shipping" everywhere else on the screen, and a recap
 * that printed the code would be the one place showing the database's spelling.
 */
const recapFieldSchema = z.object({
  recap: z.object({
    sentence: z.string().trim().min(1).max(200),
    value: z.object({ expr: z.unknown(), scale: z.number().int().min(0).max(6).optional() }).optional(),
    icon: z.literal('sparkles').optional(),
  }),
});
export type CrudFormRecapField = z.infer<typeof recapFieldSchema>;

const fieldSchema = z.union([columnFieldSchema, relationFieldSchema, recapFieldSchema]);
export type CrudFormField = z.infer<typeof fieldSchema>;

const sectionSchema = z.object({
  id: z.string().min(1),
  label: shortText.optional(),
  /** The wizard rail's second line. */
  hint: shortText.optional(),
  /** The muted line above the fields (comp 401). */
  intro: z.string().trim().min(1).max(200).optional(),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** A column whose image renders beside the fields rather than among them. */
  aside: z.string().min(1).optional(),
  fields: z.array(fieldSchema),
});
export type CrudFormSection = z.infer<typeof sectionSchema>;

export const crudFormConfigSchema = z.object({
  v: z.literal(2),
  preset: z.enum(FORM_PRESETS).default('sectioned'),
  dialog: z
    .object({
      title: shortText.optional(),
      subtitle: shortText.optional(),
      icon: z.string().max(40).optional(),
      cta: z
        .object({
          label: shortText.optional(),
          icon: z.enum(['plus', 'check', 'send', 'arrow-right']).optional(),
        })
        .optional(),
      /** `false` means "no footnote", which is different from "generate one". */
      footnote: z.union([shortText, z.literal(false)]).optional(),
    })
    .optional(),
  sections: z.array(sectionSchema).min(1).max(MAX_FORM_SECTIONS),
});
export type CrudFormConfig = z.infer<typeof crudFormConfigSchema>;

/**
 * The stored form document, or `null` when the page carries none — or carries
 * one this build cannot read, which degrades to the same derived form.
 */
export function parseCrudForm(config: Record<string, unknown>): CrudFormConfig | null {
  const raw = config['form'];
  if (raw === undefined || raw === null) return null;
  const parsed = crudFormConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  const document = parsed.data;
  const fields = document.sections.flatMap((section) => section.fields);
  if (fields.length === 0 || fields.length > MAX_FORM_FIELDS) return null;
  // A column twice is a form with two inputs writing one value, and the last
  // one silently wins. Refusing here is what makes that a Studio refusal with a
  // reason rather than a page that behaves strangely.
  const named = fields.flatMap((field, index) =>
    'column' in field
      ? [`c:${field.column}`]
      : 'relation' in field
        ? [`r:${field.relation}`]
        : // A recap names no column, so two of them are two boxes rather than
          // two writers of one value: keyed by position, never deduped away.
          [`x:${String(index)}`],
  );
  if (new Set(named).size !== named.length) return null;
  return document;
}

// ---------------------------------------------------------------------------
// Which control a column gets, and which it may be given
// ---------------------------------------------------------------------------

/**
 * What {@link controlFor} needs to know about a column: the stored spec's own
 * shape, narrowed to the fields that decide a control. Deliberately structural
 * rather than importing `GridColumnSpec` — this leaf is read by the server (via
 * `@adminium/engine/config`) as well as by the template.
 */
export interface FormColumnShape {
  name: string;
  logicalType: string;
  semantic?: string | null;
  nullable?: boolean;
  maxLength?: number | null;
  primaryKey?: boolean;
  unique?: boolean;
  readOnly?: boolean;
  enumValues?: readonly string[] | undefined;
  /** An option list an admin fixed, or the values themselves. */
  options?: { list: string } | { values: { value: string }[] } | undefined;
  fk?: unknown;
  file?: unknown;
  lookup?: unknown;
  reverse?: unknown;
  derived?: unknown;
  /** A `json` column or a Postgres array: a list of strings (D19). */
  list?: boolean;
}

/** Enum arity at or below which a REQUIRED choice renders as a segmented tray. */
export const SEGMENTED_MAX_ARITY = 4;

function optionCount(column: FormColumnShape): number {
  if (column.enumValues !== undefined) return column.enumValues.length;
  const options = column.options;
  if (options !== undefined && 'values' in options) return options.values.length;
  // A named list's length is not known here — it resolves at render time, and a
  // list long enough to be a list is long enough for a select.
  if (options !== undefined) return Number.POSITIVE_INFINITY;
  return 0;
}

function hasChoices(column: FormColumnShape): boolean {
  return optionCount(column) > 0;
}

/**
 * The control a column gets when nobody chose one (D18, Appendix C).
 *
 * The order of these branches is the order of the catalog's "Default for"
 * column, and it is load-bearing: a money column is a `decimal` and a phone
 * number is a `varchar`, so the SEMANTIC has to be asked before the type.
 */
export function controlFor(column: FormColumnShape): FormControl {
  if (column.readOnly === true) return 'readonly';
  if (column.fk !== undefined && column.fk !== null) return 'reference';
  if (column.file !== undefined && column.file !== null) return 'attachments';
  if (column.list === true) return 'chips';
  if (hasChoices(column)) {
    const count = optionCount(column);
    return count <= SEGMENTED_MAX_ARITY && column.nullable === false ? 'segmented' : 'select';
  }
  if (column.logicalType === 'boolean') return 'toggle-row';

  switch (column.semantic) {
    case 'money':
      return 'currency';
    case 'phone':
      return 'phone';
    case 'email':
      return 'email';
    case 'url':
    case 'image-url':
      return 'url';
    case 'free-text':
      return 'textarea';
    default:
      break;
  }

  switch (column.logicalType) {
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
      return 'number';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'timestamp':
    case 'timestamptz':
      return 'datetime';
    case 'json':
      return 'json';
    default:
      break;
  }

  // Unbounded text is a paragraph — unless it is an identifier, where the
  // single line is the point.
  if (
    column.logicalType === 'text' &&
    (column.maxLength ?? null) === null &&
    column.primaryKey !== true &&
    column.unique !== true
  ) {
    return 'textarea';
  }
  return 'text';
}

/**
 * Every control this column may legally be given (Appendix C's "Legal for").
 *
 * The designer offers exactly this list. A control outside it is refused at the
 * save rather than rendered as something the column cannot hold — a `slider`
 * over a `varchar` has no meaning, and a `toggle-row` over a date has no value
 * to toggle.
 */
export function legalControls(column: FormColumnShape): FormControl[] {
  if (column.readOnly === true) return ['readonly'];
  if (column.fk !== undefined && column.fk !== null) return ['reference', 'choice-cards', 'select'];
  if (column.file !== undefined && column.file !== null) return ['attachments', 'image', 'avatar'];
  if (column.list === true) return ['chips', 'check-row'];

  const textual = column.logicalType === 'text' || column.logicalType === 'varchar';
  const numeric =
    column.logicalType === 'integer' ||
    column.logicalType === 'bigint' ||
    column.logicalType === 'decimal' ||
    column.logicalType === 'float';

  if (hasChoices(column)) {
    const count = optionCount(column);
    const controls: FormControl[] = ['select'];
    if (count <= 5) controls.push('segmented');
    if (count <= 3) controls.push('pill-switch');
    if (count <= 6) controls.push('choice-cards');
    return controls;
  }
  if (column.logicalType === 'boolean') return ['toggle-row', 'check-row'];
  if (numeric) {
    const controls: FormControl[] = ['number', 'currency'];
    if (column.logicalType === 'integer' || column.logicalType === 'bigint') controls.push('stepper');
    // A slider needs both ends; without them it is a control with no scale.
    return controls;
  }
  // A calendar is legal wherever a day is — it is the same value, drawn as a
  // month instead of as a text box. It is never the DEFAULT: a month grid is
  // 34px × 7 × 6 of dialog for a field most forms want one line for.
  if (column.logicalType === 'date') return ['date', 'calendar'];
  if (column.logicalType === 'time') return ['time'];
  if (column.logicalType === 'timestamp' || column.logicalType === 'timestamptz') {
    return ['datetime', 'calendar'];
  }
  if (column.logicalType === 'json') return ['json', 'chips'];
  if (textual) {
    return ['text', 'title', 'textarea', 'mono', 'email', 'url', 'phone', 'password'];
  }
  // uuid and anything else scalar: a single line, and nothing pretending.
  return ['text', 'mono'];
}

// ---------------------------------------------------------------------------
// The derived document
// ---------------------------------------------------------------------------

/** One column as the page reply describes it (`columnFacts`). */
export interface FormColumnFact {
  spec: FormColumnShape;
  ordinal: number;
  writable: boolean;
  filledBy: 'database' | 'adminium' | null;
  required: boolean;
  options?: { list: string } | { values: { value: string }[] } | undefined;
}

/** One link relation the page reply says this table can write through. */
export interface FormRelationFact {
  relationId: string;
  /** What the field is called: the target's label, else its name. */
  label: string;
  targetTable: string;
  targetKey: string;
  /** The column a chip SHOWS; absent ⇒ the key labels itself. */
  targetName?: string | undefined;
  /** What the linked table is called ("Visit types"): the picker says it, never the table's id. */
  targetLabel?: string | undefined;
}

export interface DeriveFormInput {
  columns: readonly FormColumnFact[];
  /**
   * The link relations this table can write through. Absent ⇒ a server that
   * does not answer them yet, and a form with columns only — which is exactly
   * what every form was before link fields existed.
   */
  relations?: readonly FormRelationFact[] | undefined;
}

/** Controls that take the whole row however many columns the section has. */
const FULL_WIDTH: ReadonlySet<FormControl> = new Set([
  'textarea',
  'json',
  'chips',
  'check-row',
  'toggle-row',
  'attachments',
  'image',
  'reference-chips',
]);

/**
 * The form a table gets when nobody has designed one.
 *
 * ─── Why table order, and why every writable column ────────────────────────
 *
 * `config.columns[]` is the GRID's list: ranked, and capped at eight. That cap
 * is right for a table and wrong for a form — a column that did not make the
 * grid still has to be settable, and a required column the cap dropped was
 * re-appended LAST, so it rendered at the bottom of the form under everything
 * optional (B10). The table's own order is the order the person who made the
 * table chose, and it is the only order that is about meaning rather than about
 * what fits.
 */
export function deriveFormDocument(input: DeriveFormInput): CrudFormConfig {
  const fields: CrudFormColumnField[] = [];
  for (const fact of [...input.columns].sort((a, b) => a.ordinal - b.ordinal)) {
    const spec = fact.spec;
    // A projection has nothing on this table to write.
    if (spec.lookup !== undefined || spec.reverse !== undefined || spec.derived !== undefined) continue;
    // A generated column is the database's arithmetic: it may be read, never sent.
    if (!fact.writable) continue;
    /*
     * The key, and the timestamps, ONLY when something really fills them —
     * which is the whole of B1. A `created_at` that nothing fills is the
     * person's business and stays in the form.
     */
    const serverManaged =
      spec.primaryKey === true || spec.semantic === 'created-at' || spec.semantic === 'updated-at';
    if (serverManaged && fact.filledBy !== null) continue;

    const withOptions: FormColumnShape =
      fact.options === undefined ? spec : { ...spec, options: fact.options };
    const control = controlFor(withOptions);
    fields.push({
      column: spec.name,
      control,
      ...(fact.required ? { required: true as const } : {}),
      ...(FULL_WIDTH.has(control) ? { span: 2 as const } : {}),
    });
  }

  /*
   * The link fields come LAST, and they are full width: a set of chips is a
   * list, and half a row of chips wrapping under a date input reads as two
   * broken fields rather than one working one.
   */
  const relationFields: CrudFormRelationField[] = (input.relations ?? []).map((relation) => ({
    relation: relation.relationId,
    control: 'reference-chips' as const,
    label: relation.label,
    span: 2 as const,
  }));

  return {
    v: 2,
    preset: 'sectioned',
    sections: [
      {
        id: 'main',
        columns: 2,
        fields: [...fields, ...relationFields].slice(0, MAX_FORM_FIELDS),
      },
    ],
  };
}

/**
 * The document a dialog renders: the stored one with any column it MUST ask for
 * appended, or the derived one.
 *
 * The safety net is not decoration. A stored document is a snapshot of the
 * table as it was the day somebody designed the form; a NOT NULL column added
 * since is one the database will demand and the form would never show, which is
 * the same failure as B1 wearing a different hat.
 */
export function formDocumentFor(
  stored: CrudFormConfig | null,
  facts: DeriveFormInput,
): CrudFormConfig {
  if (stored === null) return deriveFormDocument(facts);
  const named = new Set(
    stored.sections.flatMap((section) =>
      section.fields.filter((field): field is CrudFormColumnField => 'column' in field).map((f) => f.column),
    ),
  );
  const missing = facts.columns
    .filter((fact) => fact.required && fact.writable && fact.filledBy === null && !named.has(fact.spec.name))
    .sort((a, b) => a.ordinal - b.ordinal);
  if (missing.length === 0) return stored;

  const sections = [...stored.sections];
  const last = sections[sections.length - 1]!;
  sections[sections.length - 1] = {
    ...last,
    fields: [
      ...last.fields,
      ...missing.map((fact) => ({
        column: fact.spec.name,
        control: controlFor(fact.spec),
        required: true as const,
      })),
    ],
  };
  return { ...stored, sections };
}
