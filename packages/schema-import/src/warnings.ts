// SPDX-License-Identifier: AGPL-3.0-only
import type { ModelWarning } from '@adminium/engine';

/**
 * Warning collector shared by every parser. Parsers must NEVER throw on an
 * unsupported construct inside an otherwise-parseable file — they record a
 * warning here and move on. `addCount` aggregates high-volume skips (INSERT
 * statements in a dump, unknown builder methods) into one warning per kind.
 */
export class WarningList {
  private readonly items: ModelWarning[] = [];
  private readonly counts = new Map<string, { code: string; label: string; count: number }>();

  add(code: string, message: string, tableId: string | null = null): void {
    this.items.push({ code, message, tableId });
  }

  /** Aggregate repeated skips: one warning per (code,label) with a count. */
  addCount(code: string, label: string): void {
    const key = `${code}\x00${label}`;
    const entry = this.counts.get(key);
    if (entry) entry.count += 1;
    else this.counts.set(key, { code, label, count: 1 });
  }

  toModelWarnings(): ModelWarning[] {
    const aggregated: ModelWarning[] = [...this.counts.values()].map(({ code, label, count }) => ({
      code,
      message: count === 1 ? label : `${label} (x${count})`,
      tableId: null,
    }));
    return [...this.items, ...aggregated];
  }

  messages(): string[] {
    return this.toModelWarnings().map((w) => w.message);
  }
}
