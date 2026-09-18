// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every form control is handed, and what it may assume (plan 50 phase E).
 *
 * ─── One shape for twenty-odd controls ─────────────────────────────────────
 *
 * A control is a pure function of (column, value, settings) → element. It never
 * reads the form's state, never decides whether it should exist, and never
 * knows which section it is in — those are the document's business and
 * `RecordForm`'s. That is what makes the registry a lookup rather than a
 * switch, and what lets the designer offer a control per column without the
 * renderer growing a branch for each pair.
 */
import type { CrudFormColumnField } from '../../../page-config/index.js';
import type { GridColumnSpec } from '../../../families/tables/column-spec.js';
import type { ResolvedFile } from '../../../families/tables/cells.js';
import type { CrudApi } from '../crud-api.js';
import type { FileFieldUpload } from '../FileField.js';

/** One answer a choice control offers. */
export interface ControlOption {
  value: string;
  label?: string | undefined;
  tone?: string | undefined;
  description?: string | undefined;
}

/**
 * The aria wiring `FormField` injects through its Radix `Slot`. A control that
 * renders more than one element has to pass these to the one that IS the
 * field, or the label points at nothing.
 */
export interface SlotInjected {
  id?: string;
  /**
   * A name when there is no visible label to point at. One caller: the
   * line-items repeater, whose header names the COLUMN once for every row, so
   * each cell has to say which row it is in for anyone not looking at it.
   */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

export interface ControlProps extends SlotInjected {
  column: GridColumnSpec;
  /** The field as the document describes it: prefix, unit, bounds, words. */
  field?: CrudFormColumnField | undefined;
  value: unknown;
  onChange: (next: unknown) => void;
  /** The answers this column accepts, already resolved. */
  options: readonly ControlOption[];
  mode: 'create' | 'edit';
  error?: boolean | undefined;
  disabled?: boolean | undefined;
  /** The workspace currency, for the money prefix. */
  currency?: string | undefined;
  /** Reference lookups; absent ⇒ a foreign key renders as a plain input. */
  lookup?: CrudApi['lookup'] | undefined;
  /** File transport; absent ⇒ a file column renders its stored reference. */
  upload?: FileFieldUpload | undefined;
  files?: ReadonlyMap<string, ResolvedFile | null> | undefined;
  maxFileBytes?: number | undefined;
  /** The reader's locale — a calendar's month names and week start. */
  locale?: string | undefined;
  /**
   * The rest of the form's values, READ-ONLY. One control needs them: a
   * calendar whose availability is scoped by another field (the room, the
   * practitioner) has to know what that field says. It is deliberately not a
   * setter — a control that writes another field's value is a control that
   * owns the form.
   */
  siblings?: Readonly<Record<string, unknown>> | undefined;
  /** Which instants are already taken; absent ⇒ nothing is struck through. */
  availability?: CrudApi['availability'] | undefined;
  /**
   * The record being edited, on an edit. A calendar excludes it from its own
   * availability read: a booking's own slot is not "taken" from its own Edit
   * dialog, and striking it out would leave no way to save without moving it.
   */
  recordId?: string | undefined;
}

/**
 * A control plus the one thing `RecordForm` must know about it: whether it
 * draws its OWN label.
 *
 * A toggle row and a check row are a label and a control in one bordered row
 * (comp 258–261, 402–407) — wrapping them in a `FormField` would print the
 * label twice, once above the row and once inside it.
 */
export interface ControlEntry {
  component: (props: ControlProps) => React.ReactNode;
  ownsLabel?: boolean;
}
