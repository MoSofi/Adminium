// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from '../../lib/cn.js';

export interface Slot {
  /** `HH:MM` — what is stored, and what is shown. */
  value: string;
  /** Already held; struck through and inert (comp 653–658). */
  taken?: boolean | undefined;
}

export interface SlotGridProps {
  slots: readonly Slot[];
  value: string | null;
  onChange: (slot: string) => void;
  /** Accessible name for the group (i18n: no default). */
  label: string;
  emptyLabel: string;
  className?: string | undefined;
}

/**
 * SlotGrid — the comp's two-column grid of times (`designs/Create Dialogs.dc.html`
 * 342–346, 653–658).
 *
 * A taken slot is `disabled`, not merely struck through: the comp's own
 * `onClick` for one is a no-op function, which looks identical and behaves
 * identically to a broken button for anybody using a keyboard.
 *
 * The grid draws NOTHING rather than an empty frame when a day has no slots —
 * a day outside the opening hours, or one whose slots are all taken and
 * filtered away upstream — because an empty bordered box reads as "loading".
 */
export function SlotGrid({ slots, value, onChange, label, emptyLabel, className }: SlotGridProps) {
  if (slots.length === 0) {
    return (
      <p className="text-body-sm text-fg-subtle" data-testid="slot-grid-empty">
        {emptyLabel}
      </p>
    );
  }
  return (
    <div
      className={cn('grid grid-cols-2 gap-1.5', className)}
      role="group"
      aria-label={label}
      data-testid="slot-grid"
    >
      {slots.map((slot) => {
        const chosen = slot.value === value;
        return (
          <button
            key={slot.value}
            type="button"
            disabled={slot.taken === true}
            aria-pressed={chosen}
            data-testid={`slot-${slot.value}`}
            onClick={() => onChange(slot.value)}
            className={cn(
              'rounded-[10px] border px-1.5 py-2.5 font-mono text-[12.5px] font-bold',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              chosen && 'border-accent bg-accent-soft text-accent',
              !chosen && slot.taken === true && 'border-border-strong bg-surface-3 text-fg-subtle line-through',
              !chosen && slot.taken !== true && 'border-border-strong bg-surface text-fg-muted hover:text-fg',
            )}
          >
            {slot.value}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The slots of one day, from an opening time, a closing time and a step.
 *
 * The last slot STARTS before `end` rather than ending by it: a 09:00–17:00
 * day with 30-minute slots offers 16:30 and not 17:00, because 17:00 is when
 * the day closes, not a time anybody can book.
 */
export function slotsBetween(start: string, end: string, minutes: number): string[] {
  const parse = (text: string): number => {
    const [h, m] = text.split(':');
    return Number(h) * 60 + Number(m ?? 0);
  };
  const from = parse(start);
  const to = parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || minutes <= 0 || to <= from) return [];
  const out: string[] = [];
  for (let at = from; at < to; at += minutes) {
    out.push(`${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`);
  }
  return out;
}
