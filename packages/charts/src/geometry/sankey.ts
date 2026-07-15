/**
 * Pure Sankey flow geometry (research/widget-registry.md §2 `chart-sankey`):
 * layered node rects + cubic-bezier ribbon paths weighted by flow. DOM-free and
 * deterministic (workplan/04 §7.1) so the same ribbon path strings render in
 * Node and the browser (acceptance #10).
 *
 * RTL policy (04 §7.4, explicit): Sankey renders as an LTR island — the flow
 * direction never mirrors. The widget's legend/summary pill mirror at the
 * widget layer via logical CSS.
 */

export interface SankeyNodeInput {
  id: string;
  label: string;
  /** Explicit column (0-based); inferred by longest-path layering when absent. */
  layer?: number;
}

export interface SankeyLinkInput {
  from: string;
  to: string;
  weight: number;
}

export interface SankeyNode {
  id: string;
  label: string;
  layer: number;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  colorVar: string;
}

export interface SankeyLink {
  from: string;
  to: string;
  weight: number;
  width: number;
  path: string;
  sourceColorVar: string;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
  layers: number;
  width: number;
  height: number;
}

export interface SankeyOptions {
  width?: number;
  height?: number;
  nodeWidth?: number;
  /** Vertical gap between stacked nodes in a layer. */
  nodePad?: number;
}

/** Horizontal-band ribbon between two edges — a smooth filled area. */
export function sankeyRibbonPath(
  sx: number,
  tx: number,
  sy0: number,
  sy1: number,
  ty0: number,
  ty1: number,
): string {
  const xc = (sx + tx) / 2;
  const r = (n: number): string => (Math.round(n * 1000) / 1000).toString();
  return (
    `M${r(sx)},${r(sy0)}` +
    `C${r(xc)},${r(sy0)} ${r(xc)},${r(ty0)} ${r(tx)},${r(ty0)}` +
    `L${r(tx)},${r(ty1)}` +
    `C${r(xc)},${r(ty1)} ${r(xc)},${r(sy1)} ${r(sx)},${r(sy1)}` +
    `Z`
  );
}

/** Longest-path column assignment; explicit `node.layer` values win. */
function assignLayers(nodes: readonly SankeyNodeInput[], links: readonly SankeyLinkInput[]): Map<string, number> {
  const layer = new Map<string, number>();
  const explicit = new Set<string>();
  for (const node of nodes) {
    layer.set(node.id, node.layer ?? 0);
    if (node.layer !== undefined) explicit.add(node.id);
  }
  // Relax target = max(target, source+1) until stable (bounded by node count).
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const link of links) {
      if (!layer.has(link.from) || !layer.has(link.to) || explicit.has(link.to)) continue;
      const candidate = (layer.get(link.from) ?? 0) + 1;
      if (candidate > (layer.get(link.to) ?? 0)) {
        layer.set(link.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

/** Lay out a Sankey diagram; nodes keep input order within each column. */
export function sankeyLayout(
  nodesInput: readonly SankeyNodeInput[],
  linksInput: readonly SankeyLinkInput[],
  options: SankeyOptions = {},
): SankeyLayout {
  const { width = 600, height = 300, nodeWidth = 14, nodePad = 12 } = options;

  const links = linksInput.filter(
    (l) => Number.isFinite(l.weight) && l.weight > 0 && l.from !== l.to,
  );
  const layerOf = assignLayers(nodesInput, links);
  const maxLayer = nodesInput.reduce((max, n) => Math.max(max, layerOf.get(n.id) ?? 0), 0);

  // Flow value per node = max(incoming, outgoing) sum.
  const inSum = new Map<string, number>();
  const outSum = new Map<string, number>();
  for (const link of links) {
    outSum.set(link.from, (outSum.get(link.from) ?? 0) + link.weight);
    inSum.set(link.to, (inSum.get(link.to) ?? 0) + link.weight);
  }

  const columns: SankeyNodeInput[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const node of nodesInput) columns[layerOf.get(node.id) ?? 0]?.push(node);

  const valueOf = (id: string): number => Math.max(inSum.get(id) ?? 0, outSum.get(id) ?? 0);

  // Single value→pixel scale so columns share a baseline (min over columns).
  let scale = Infinity;
  for (const column of columns) {
    if (column.length === 0) continue;
    const sum = column.reduce((acc, n) => acc + valueOf(n.id), 0);
    const avail = height - (column.length - 1) * nodePad;
    if (sum > 0) scale = Math.min(scale, avail / sum);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const columnStep = maxLayer > 0 ? (width - nodeWidth) / maxLayer : 0;

  const nodes: SankeyNode[] = [];
  const nodeById = new Map<string, SankeyNode>();
  let globalIndex = 0;
  columns.forEach((column, layerIndex) => {
    let y = 0;
    for (const input of column) {
      const value = valueOf(input.id);
      const h = Math.max(1, value * scale);
      const node: SankeyNode = {
        id: input.id,
        label: input.label,
        layer: layerIndex,
        index: globalIndex,
        x: layerIndex * columnStep,
        y,
        w: nodeWidth,
        h,
        value,
        colorVar: `var(--viz-${(globalIndex % 8) + 1})`,
      };
      nodes.push(node);
      nodeById.set(node.id, node);
      y += h + nodePad;
      globalIndex += 1;
    }
  });

  // Stack link endpoints along each node's outgoing (right) / incoming (left) edge.
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const outLinks: SankeyLink[] = [];
  for (const link of links) {
    const source = nodeById.get(link.from);
    const target = nodeById.get(link.to);
    if (source === undefined || target === undefined) continue;
    const w = Math.max(1, link.weight * scale);
    const so = outOffset.get(source.id) ?? 0;
    const to = inOffset.get(target.id) ?? 0;
    const sy0 = source.y + so;
    const ty0 = target.y + to;
    outLinks.push({
      from: link.from,
      to: link.to,
      weight: link.weight,
      width: w,
      path: sankeyRibbonPath(source.x + source.w, target.x, sy0, sy0 + w, ty0, ty0 + w),
      sourceColorVar: source.colorVar,
    });
    outOffset.set(source.id, so + w);
    inOffset.set(target.id, to + w);
  }

  return { nodes, links: outLinks, layers: maxLayer + 1, width, height };
}
