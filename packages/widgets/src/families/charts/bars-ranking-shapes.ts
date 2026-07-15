/**
 * Lenient payload narrowing for the "bars & ranking" group's §3 envelopes
 * (04 §3). Widget components receive `data: unknown` (already non-empty per the
 * definition's isEmpty predicate) and narrow it here; a malformed payload
 * returns null so the component renders its own fallback rather than throwing
 * into the error boundary. Pure module — no chart-primitive imports.
 */

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** `record-list` rows ride under `rows` (§3) or `data` (CRUD envelope). */
export function recordRows(data: unknown): Rec[] | null {
  const r = rec(data);
  if (r === null) return null;
  const source = Array.isArray(r.rows) ? r.rows : Array.isArray(r.data) ? r.data : null;
  if (source === null) return null;
  const out: Rec[] = [];
  for (const entry of source) {
    const row = rec(entry);
    if (row === null) return null;
    out.push(row);
  }
  return out;
}

export interface BulletRowData {
  label: string;
  measure: number;
  target: number;
  max?: number;
  bandCutoffs?: number[];
}

export function asBulletRows(data: unknown): BulletRowData[] | null {
  const rows = recordRows(data);
  if (rows === null) return null;
  const out: BulletRowData[] = [];
  for (const row of rows) {
    const measure = num(row.measure);
    const target = num(row.target);
    const label = str(row.label);
    if (label === undefined || measure === undefined || target === undefined) return null;
    const max = num(row.max);
    const bandCutoffs = Array.isArray(row.bandCutoffs)
      ? row.bandCutoffs.map(num).filter((v): v is number => v !== undefined)
      : undefined;
    out.push({
      label,
      measure,
      target,
      ...(max !== undefined ? { max } : {}),
      ...(bandCutoffs !== undefined ? { bandCutoffs } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

export type WaterfallStepType = 'up' | 'down' | 'total';

export interface WaterfallStepData {
  label: string;
  value: number;
  type: WaterfallStepType;
}

function stepType(value: unknown): WaterfallStepType {
  return value === 'down' || value === 'total' ? value : 'up';
}

export function asWaterfallSteps(data: unknown): WaterfallStepData[] | null {
  const rows = recordRows(data);
  if (rows === null) return null;
  const out: WaterfallStepData[] = [];
  for (const row of rows) {
    const label = str(row.label);
    const value = num(row.value);
    if (label === undefined || value === undefined) return null;
    out.push({ label, value, type: stepType(row.type) });
  }
  return out.length > 0 ? out : null;
}

export interface SlopeRecordData {
  label: string;
  a: number;
  b: number;
}

export function asSlopeRecords(data: unknown): SlopeRecordData[] | null {
  const rows = recordRows(data);
  if (rows === null) return null;
  const out: SlopeRecordData[] = [];
  for (const row of rows) {
    const label = str(row.label);
    const a = num(row.a);
    const b = num(row.b);
    if (label === undefined || a === undefined || b === undefined) return null;
    out.push({ label, a, b });
  }
  return out.length > 0 ? out : null;
}

export interface MatrixData {
  rowKeys: string[];
  colKeys: string[];
  cells: number[][];
}

export function asMatrix(data: unknown): MatrixData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.rowKeys) || !Array.isArray(r.colKeys) || !Array.isArray(r.cells)) {
    return null;
  }
  const rowKeys = r.rowKeys.map(String);
  const colKeys = r.colKeys.map(String);
  const cells: number[][] = [];
  for (const rowCells of r.cells) {
    if (!Array.isArray(rowCells)) return null;
    cells.push(rowCells.map((cell) => num(cell) ?? 0));
  }
  if (rowKeys.length === 0 || colKeys.length === 0) return null;
  return { rowKeys, colKeys, cells };
}
