// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lenient narrowing for the §3 envelopes the part-to-whole & hierarchy charts
 * (04-T09) consume beyond `categorical` (which lib/shapes.ts already covers):
 * `matrix` (radar), `flows` (chord), and `hierarchy/tree` (sunburst). Kept in
 * this family folder so the shared lib/shapes barrel stays untouched while
 * parallel chart tracks land. A malformed payload returns null; the widget
 * wrapper renders its own fallback rather than throwing (04 §3).
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

// --- matrix (radar: rowKeys = axes, colKeys = series) ------------------------

export interface MatrixData {
  rowKeys: string[];
  colKeys: string[];
  cells: (number | null)[][];
}

export function asMatrix(data: unknown): MatrixData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.rowKeys) || !Array.isArray(r.colKeys) || !Array.isArray(r.cells)) {
    return null;
  }
  const rowKeys = r.rowKeys.map((k) => String(k));
  const colKeys = r.colKeys.map((k) => String(k));
  const cells: (number | null)[][] = r.cells.map((row) =>
    Array.isArray(row) ? row.map((c) => num(c) ?? null) : [],
  );
  if (rowKeys.length === 0 || colKeys.length === 0) return null;
  return { rowKeys, colKeys, cells };
}

// --- flows (chord: symmetric from/to/weight links) ---------------------------

export interface FlowsData {
  nodes: { id: string; label: string }[];
  links: { from: string; to: string; weight: number }[];
}

export function asFlows(data: unknown): FlowsData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.nodes) || !Array.isArray(r.links)) return null;
  const nodes: FlowsData['nodes'] = [];
  for (const entry of r.nodes) {
    const node = rec(entry);
    if (node === null || typeof node.id !== 'string') return null;
    nodes.push({ id: node.id, label: typeof node.label === 'string' ? node.label : node.id });
  }
  const links: FlowsData['links'] = [];
  for (const entry of r.links) {
    const link = rec(entry);
    const weight = num(link?.weight);
    if (link === null || typeof link.from !== 'string' || typeof link.to !== 'string' || weight === undefined) {
      return null;
    }
    links.push({ from: link.from, to: link.to, weight });
  }
  if (nodes.length === 0) return null;
  return { nodes, links };
}

// --- hierarchy/tree (sunburst: 2-level parents → children) -------------------

export interface TreeParentData {
  label: string;
  children: { label: string; value: number }[];
}

/**
 * Two-level projection of a `hierarchy/tree` envelope ({ roots: TreeNode[] }).
 * Each root becomes a parent; its direct children carry a numeric `value`
 * (from `value` or `meta.value`). Deeper levels are ignored (sunburst is 2-ring).
 */
export function asTwoLevelTree(data: unknown): TreeParentData[] | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.roots)) return null;
  const parents: TreeParentData[] = [];
  for (const rootEntry of r.roots) {
    const root = rec(rootEntry);
    if (root === null) return null;
    const label = typeof root.label === 'string' ? root.label : String(root.id ?? '');
    const rawChildren = Array.isArray(root.children) ? root.children : [];
    const children: TreeParentData['children'] = [];
    for (const childEntry of rawChildren) {
      const child = rec(childEntry);
      if (child === null) continue;
      const meta = rec(child.meta);
      const value = num(child.value) ?? num(meta?.value);
      if (value === undefined) continue;
      children.push({ label: typeof child.label === 'string' ? child.label : String(child.id ?? ''), value });
    }
    parents.push({ label, children });
  }
  return parents.length > 0 ? parents : null;
}
