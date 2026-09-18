// SPDX-License-Identifier: AGPL-3.0-only
/**
 * QUICK CREATE: a title, a detail box, and the rest as meta pills
 * (comp 142–182, 561, 609–611, 739–750).
 *
 * ─── Which field becomes what ──────────────────────────────────────────────
 *
 * The document's order decides, because the document is what a person arranged:
 *
 *   1. the FIRST field is the title input — big, unlabelled, its placeholder is
 *      the field's own (else its label);
 *   2. the first LONG-TEXT field after it is the detail box;
 *   3. every field a pill can hold — a choice, a date, a boolean, a reference —
 *      becomes a `MetaPill`, in order;
 *   4. anything else (a number, a file) keeps the ordinary field anatomy and
 *      sits between the detail box and the pills (F20).
 *
 * ─── Why a pill and not a labelled field ───────────────────────────────────
 *
 * A quick-create dialog is 440px of one decision: write the thing down. Four
 * labelled fields under a title turn that into a form; four pills keep the
 * title the subject and let the rest be answered in passing — which is the
 * whole reason the comp draws this preset separately.
 */
import { MetaPill, Popover, PopoverContent, PopoverTrigger } from '@adminium/ui';
import { CalendarDays, Flag, Hash, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type { ControlOption } from '../controls/index.js';
import type { CrudApi } from '../crud-api.js';

/** What a pill holds, which decides its icon and its menu. */
export type PillKind = 'date' | 'choice' | 'reference' | 'boolean';

export interface QuickPill {
  key: string;
  kind: PillKind;
  /** The field's name — what the pill says when nothing is chosen. */
  placeholder: string;
  /** What is chosen now, as the pill shows it. */
  label?: string | undefined;
  value: unknown;
  /** The menu's rows. Empty for a boolean, which has no menu (F19). */
  options: readonly ControlOption[];
  onChange: (next: unknown) => void;
  /** "No date", "Unassigned" — only for a column that may be empty. */
  clearLabel?: string | undefined;
  /**
   * A control rendered INSIDE the menu, under the rows.
   *
   * Two things need it and both are in the comp: the date pill's sixth row is
   * a real date input ("Pick a date", DP12 — the comp stores a label, the
   * product must store a date), and a reference over a big table needs the
   * picker's own search rather than a list of the first twenty rows (F14).
   */
  menu?: ReactNode | undefined;
  /**
   * A reference pill's target, so the menu can be the target's own rows.
   *
   * The rows are fetched when the pill is first opened — never before, because
   * a quick-create dialog with four pills would otherwise fire four searches
   * at a person who may set none of them. Past the cap the menu carries the
   * PICKER instead (F14): twenty rows of a table with four thousand is a list
   * that looks complete and is not.
   */
  reference?: { table: string; column: string; display?: string | undefined; lookup: CrudApi['lookup']; picker: ReactNode } | undefined;
}

/** Past this, a reference's menu is a search rather than a list (F14). */
export const QUICK_REFERENCE_ROWS = 20;

const ICONS: Record<PillKind, ReactNode> = {
  date: <CalendarDays className="size-[13px]" />,
  choice: <Flag className="size-[13px]" />,
  reference: <User className="size-[13px]" />,
  boolean: <Hash className="size-[13px]" />,
};

export interface QuickLayoutProps {
  title: ReactNode;
  detail?: ReactNode | undefined;
  /** Fields that cannot be a pill, in the ordinary anatomy (F20). */
  rest?: ReactNode | undefined;
  pills: readonly QuickPill[];
}

export function QuickLayout({ title, detail, rest, pills }: QuickLayoutProps) {
  return (
    <div className="flex flex-col gap-3" data-part="quick">
      {title}
      {detail}
      {rest}
      {pills.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5" data-testid="quick-pills">
          {pills.map((pill) => (
            <PillControl key={pill.key} pill={pill} />
          ))}
        </div>
      )}
    </div>
  );
}

function PillControl({ pill }: { pill: QuickPill }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ControlOption[] | null>(null);
  const reference = pill.reference;

  useEffect(() => {
    if (!open || reference === undefined || rows !== null || reference.lookup === undefined) return;
    let alive = true;
    void reference
      .lookup(
        { table: reference.table, column: reference.column, ...(reference.display === undefined ? {} : { display: reference.display }) },
        '',
      )
      .then(
        (loaded) => {
          if (alive) {
            setRows(
              loaded
                .slice(0, QUICK_REFERENCE_ROWS + 1)
                .map((option) => ({ value: option.value, label: option.label })),
            );
          }
        },
        () => {
          // A target this caller cannot read leaves the menu to the picker,
          // which says so itself.
          if (alive) setRows([]);
        },
      );
    return () => {
      alive = false;
    };
  }, [open, reference, rows]);

  // A boolean is a pill with NO menu: pressing it toggles between the two
  // states the comp already draws (F19).
  if (pill.kind === 'boolean') {
    return (
      <MetaPill
        icon={ICONS.boolean}
        placeholder={pill.placeholder}
        {...(pill.value === true ? { value: pill.label ?? pill.placeholder } : {})}
        aria-pressed={pill.value === true}
        onClick={() => pill.onChange(!(pill.value === true))}
        data-testid={`quick-pill-${pill.key}`}
      />
    );
  }

  const chosen = pill.value === null || pill.value === undefined || pill.value === '' ? null : String(pill.value);
  /*
   * A reference's rows, and whether there are too many to be a list. The
   * fetch asks for one more than the cap for exactly this question.
   */
  const overflow = reference !== undefined && (rows?.length ?? 0) > QUICK_REFERENCE_ROWS;
  const options = reference === undefined ? pill.options : overflow ? [] : (rows ?? []);
  const label =
    pill.label ??
    (reference === undefined ? undefined : rows?.find((row) => row.value === chosen)?.label);
  const menu = reference !== undefined && (overflow || (rows?.length ?? 0) === 0) ? reference.picker : pill.menu;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <MetaPill
          icon={ICONS[pill.kind]}
          placeholder={pill.placeholder}
          {...(chosen === null ? {} : { value: label ?? chosen })}
          open={open}
          aria-haspopup="menu"
          data-testid={`quick-pill-${pill.key}`}
        />
      </PopoverTrigger>
      <PopoverContent className="min-w-[190px] p-[5px]">
        <ul>
          {options.map((option) => {
            const current = chosen === option.value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  data-testid={`quick-option-${option.value}`}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[12.5px] ${
                    current ? 'bg-accent-soft font-bold text-accent' : 'text-fg hover:bg-surface-2'
                  }`}
                  onClick={() => {
                    // Re-clicking the chosen value CLEARS it, as the comp says
                    // (611) — the fastest way to undo a pill is the same
                    // gesture that set it.
                    pill.onChange(current ? null : option.value);
                    setOpen(false);
                  }}
                >
                  {option.tone === undefined ? null : (
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[option.tone] ?? 'bg-fg-subtle'}`}
                    />
                  )}
                  <span className="truncate">{option.label ?? option.value}</span>
                </button>
              </li>
            );
          })}
          {menu === undefined ? null : <li className="px-2 py-1.5">{menu}</li>}
          {pill.clearLabel === undefined ? null : (
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-start text-[12.5px] text-fg-muted hover:bg-surface-2"
                onClick={() => {
                  pill.onChange(null);
                  setOpen(false);
                }}
                data-testid={`quick-pill-clear-${pill.key}`}
              >
                {pill.clearLabel}
              </button>
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The 6px dots the comp draws beside a priority row (160, 744). */
const TONE_DOT: Record<string, string> = {
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  accent: 'bg-accent',
  info: 'bg-info',
  muted: 'bg-fg-subtle',
  neutral: 'bg-fg-subtle',
};
