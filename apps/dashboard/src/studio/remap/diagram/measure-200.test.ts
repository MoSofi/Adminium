// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The 200-table measurement — criterion 20.
 *
 * Not a behaviour test: it is the recorded measurement the done-when asks for,
 * kept as a test so the numbers are re-taken rather than remembered, and so a
 * regression that makes the ceiling path quadratic fails CI instead of being
 * discovered on a customer's schema.
 *
 * The model is the REAL one — 200 tables and 158 declared foreign keys,
 * introspected from a generated Postgres database, exported from the snapshot
 * table and committed beside this file. A synthetic model would not carry the
 * column counts, the type spread or the relation shape that make the numbers
 * mean anything.
 *
 * ─── Why the numbers are taken in Node and not in a browser ────────────────
 *
 * They were taken in the in-app browser pane first and every one came back
 * exactly 1000 ms — a hidden pane clamps `setTimeout` to about a second and
 * never ticks `requestAnimationFrame`, so the figure measured the pane, not the
 * product. `buildGraph` and `layoutGraph` are pure and are the parts that scale
 * with the schema; they are what is worth measuring, and they need no DOM. The
 * BEHAVIOUR (ceiling engaged and named, search bringing a hidden table in, list
 * parity, keyboard traversal) was verified in the browser, where timing does
 * not matter.
 */
import { describe, expect, it } from 'vitest';

// A plain JSON import: vitest resolves it relative to this file, and
// `import.meta.url` is not a file URL under the browser-ish test environment
// this workspace runs in.
import fixture from './__fixtures__/big-schema-200.json' with { type: 'json' };

import { buildGraph, DEFAULT_NODE_CEILING, matchTables } from './graph.js';
import { layoutGraph } from './layout.js';
import type { EffectiveModel } from '../model.js';

const model = fixture as unknown as EffectiveModel;

/** Median of `runs` timings, in ms — a median, because one GC pause is not the cost. */
function median(runs: number[]): number {
  const sorted = [...runs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(fn: () => unknown, runs = 9): number {
  fn(); // warm
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

describe('a 200-table connection', () => {
  it('is the fixture it claims to be', () => {
    expect(model.tables).toHaveLength(200);
    expect(model.relations.length).toBeGreaterThanOrEqual(150);
  });

  it('engages the ceiling and keeps the hubs', () => {
    const graph = buildGraph(model);
    expect(graph.nodes).toHaveLength(DEFAULT_NODE_CEILING);
    expect(graph.omittedTables).toBe(200 - DEFAULT_NODE_CEILING);
    // Ranked by connectedness: the eight hubs every entity points at are in.
    const kept = new Set(graph.nodes.map((n) => n.name));
    for (const hub of ['hub_01', 'hub_02', 'hub_03', 'hub_04']) expect(kept.has(hub)).toBe(true);
    // …and an edge is only drawn when BOTH ends survived.
    for (const edge of graph.edges) {
      expect(kept.has(graph.nodes.find((n) => n.id === edge.source)!.name)).toBe(true);
      expect(kept.has(graph.nodes.find((n) => n.id === edge.target)!.name)).toBe(true);
    }
  });

  it('brings a hidden table in when it is searched for', () => {
    const plain = buildGraph(model);
    expect(plain.nodes.some((n) => n.name === 'lookup_150')).toBe(false);

    const focus = matchTables(model, 'lookup_150');
    expect(focus).toEqual(['public.lookup_150']);
    const focused = buildGraph(model, { focus });
    expect(focused.nodes.some((n) => n.name === 'lookup_150')).toBe(true);
    // The ceiling is a budget, not a filter that grows.
    expect(focused.nodes).toHaveLength(DEFAULT_NODE_CEILING);
  });

  /*
   * ─── The recorded measurement ────────────────────────────────────────────
   *
   * Taken 2026-09-04 on an Apple M-series laptop, Node 22, median of nine runs
   * after a warm-up. The budgets are deliberately ~20× the observed figure:
   * they are there to catch an ALGORITHMIC regression — a ceiling that starts
   * sorting per node, a layout that starts re-measuring per edge — not to pin a
   * machine's speed, and a test that fails when CI is busy teaches people to
   * ignore it.
   */
  it('builds and lays out inside a budget that only an algorithmic regression breaks', () => {
    const build = time(() => buildGraph(model));
    const graph = buildGraph(model);
    const layout = time(() => layoutGraph(graph, { manual: {} }));
    const search = time(() => matchTables(model, 'lookup_1'));

    console.log(
      `200 tables / ${String(model.relations.length)} relations → ` +
        `buildGraph ${build.toFixed(1)}ms · layoutGraph ${layout.toFixed(1)}ms · ` +
        `matchTables ${search.toFixed(2)}ms · ${String(graph.nodes.length)} nodes, ` +
        `${String(graph.edges.length)} edges, ${String(graph.omittedTables)} hidden`,
    );

    expect(build).toBeLessThan(250);
    expect(layout).toBeLessThan(500);
    expect(search).toBeLessThan(100);
  });

  it('measures what the ceiling actually saves, rather than asserting it', () => {
    /*
     * The argument FOR a ceiling, as a number. Drawing all 200 is not merely
     * ugly — the layout is where the cost lands, and dagre is superlinear in
     * the node and edge count.
     */
    const capped = buildGraph(model);
    const all = buildGraph(model, { nodeCeiling: 1000 });
    expect(all.nodes).toHaveLength(200);

    const cappedMs = time(() => layoutGraph(capped, { manual: {} }), 5);
    const uncappedMs = time(() => layoutGraph(all, { manual: {} }), 5);
    console.log(
      `layout: ${String(capped.nodes.length)} nodes ${cappedMs.toFixed(1)}ms vs ` +
        `${String(all.nodes.length)} nodes ${uncappedMs.toFixed(1)}ms ` +
        `(${(uncappedMs / cappedMs).toFixed(1)}× for ${(200 / capped.nodes.length).toFixed(1)}× the nodes)`,
    );
    // Even uncapped it is not pathological — the ceiling is about READABILITY
    // first and cost second, and saying otherwise would be the wrong reason to
    // keep it. The budget is here to catch a superlinear regression.
    expect(uncappedMs).toBeLessThan(2000);
  });
});
