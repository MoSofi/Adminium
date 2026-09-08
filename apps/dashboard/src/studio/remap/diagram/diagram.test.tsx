// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The diagram — 35-schema-authoring.md 35-T20/T21/T23/T24, D15, D16.
 *
 * The graph mapping and the layout are pure, so most of this needs no canvas.
 * What DOES need one is the a11y contract (D16): the text-equivalent view has
 * to expose the same tables and relations in DOM order, because a pan-and-zoom
 * canvas is invisible to a screen reader and hiding it would trade a violation
 * for a feature nobody can reach.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildGraph, matchNodes, matchTables, DEFAULT_NODE_CEILING } from './graph.js';
import { layoutGraph, NODE_WIDTH } from './layout.js';
import { SchemaOutline } from './SchemaOutline.js';
import type { EffectiveModel } from '../model.js';

// ---------------------------------------------------------------------------

const table = (name: string, over: Record<string, unknown> = {}) => ({
  id: `public.${name}`,
  schema: 'public',
  name,
  kind: 'table' as const,
  comment: null,
  columns: [
    { name: 'id', logicalType: 'integer', dbType: 'integer', isPrimaryKey: true, nullable: false, isUnique: false, isGenerated: false, enumRef: null, maxLength: null, numericPrecision: null, numericScale: null, isArray: false, comment: null, references: null, semantics: null, ordinal: 1, default: null },
  ],
  primaryKey: ['id'],
  uniques: [], checks: [], indexes: [],
  rowCountEstimate: null, rowCountExact: false, sizeBytes: null,
  activity: null, rls: null, system: false, semantics: null,
  ...over,
});

const relation = (from: string, to: string, over: Record<string, unknown> = {}) => ({
  id: `fk:public.${from}(x)->public.${to}(id)`,
  kind: 'declared-fk' as const,
  cardinality: 'one-to-many' as const,
  from: { tableId: `public.${from}`, columns: ['x'] },
  to: { tableId: `public.${to}`, columns: ['id'] },
  through: null, onDelete: null, onUpdate: null,
  selfReferential: false, confidence: 1, constraintName: null,
  ...over,
});

const model = (tables: unknown[], relations: unknown[] = []): EffectiveModel =>
  ({
    irVersion: 1,
    dialect: 'postgres',
    name: 't',
    defaultSchema: 'public',
    tables,
    relations,
    enums: [],
  }) as unknown as EffectiveModel;

// ---------------------------------------------------------------------------

describe('buildGraph — the three kinds of edge (35-T21)', () => {
  const m = model(
    [table('orders'), table('customers'), table('notes'), table('tags')],
    [
      relation('orders', 'customers'),
      relation('notes', 'orders', { kind: 'inferred-name', confidence: 0.7, id: 'inferred:1' }),
      relation('tags', 'orders', { kind: 'override', id: 'override:1' }),
    ],
  );

  it('distinguishes declared, inferred and virtual — they are different claims', () => {
    const graph = buildGraph(m);
    expect(graph.edges.map((e) => e.kind).sort()).toEqual(['declared', 'inferred', 'virtual']);
  });

  it('carries confidence for the inferred one and nothing for the others', () => {
    const graph = buildGraph(m);
    const byKind = Object.fromEntries(graph.edges.map((e) => [e.kind, e]));
    expect(byKind['inferred']?.confidence).toBe(0.7);
    expect(byKind['declared']?.confidence).toBeNull();
    expect(byKind['virtual']?.confidence).toBeNull();
  });

  it('uses the effective label, so an operator’s rename shows on the map', () => {
    const graph = buildGraph(model([table('orders', { label: 'Purchase orders' })]));
    expect(graph.nodes[0]?.label).toBe('Purchase orders');
    expect(graph.nodes[0]?.name).toBe('orders');
  });

  it('omits excluded tables — they are not part of the app, so not of its map', () => {
    const graph = buildGraph(model([table('orders'), table('scratch', { excluded: true })]));
    expect(graph.nodes.map((n) => n.name)).toEqual(['orders']);
  });

  it('marks foreign-key columns on the node they leave from', () => {
    const withFk = table('orders', {
      columns: [
        ...table('orders').columns,
        { ...table('orders').columns[0], name: 'x', isPrimaryKey: false },
      ],
    });
    const graph = buildGraph(model([withFk, table('customers')], [relation('orders', 'customers')]));
    const orders = graph.nodes.find((n) => n.name === 'orders')!;
    expect(orders.columns.find((c) => c.name === 'x')?.isForeignKey).toBe(true);
  });
});

describe('large schemas (35-T23)', () => {
  const many = Array.from({ length: 200 }, (_, i) => table(`t${i}`));

  it('engages the ceiling rather than drawing 200 unreadable boxes', () => {
    const graph = buildGraph(model(many));
    expect(graph.nodes).toHaveLength(DEFAULT_NODE_CEILING);
    expect(graph.omittedTables).toBe(200 - DEFAULT_NODE_CEILING);
  });

  it('keeps the most connected tables, and whatever the operator focused', () => {
    const hub = table('hub');
    const relations = many.slice(0, 30).map((t) => relation(t.name, 'hub'));
    const graph = buildGraph(model([...many, hub], relations), { nodeCeiling: 5, focus: ['public.t199'] });
    const names = graph.nodes.map((n) => n.name);
    expect(names).toContain('t199'); // focused
    expect(names).toContain('hub'); // most connected
  });

  it('matchTables searches the WHOLE model, not the ceilinged graph', () => {
    // The distinction the bug turned on: `matchNodes` can only find what
    // survived, so it can never be what brings a hidden table back.
    const hidden = table('needle_table');
    const graph = buildGraph(model([...many, hidden]));
    expect(matchNodes(graph, 'needle_table')).toEqual([]);
    expect(matchTables(model([...many, hidden]), 'needle_table')).toEqual(['public.needle_table']);
  });

  it('drops edges whose endpoints did not survive the ceiling', () => {
    const graph = buildGraph(
      model([table('a'), table('b'), table('c')], [relation('a', 'c')]),
      { nodeCeiling: 1, focus: ['public.a'] },
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });

  it('collapses columns past the threshold but never a key or a foreign key', () => {
    const wide = table('wide', {
      columns: Array.from({ length: 30 }, (_, i) => ({
        ...table('wide').columns[0],
        name: i === 0 ? 'id' : `c${i}`,
        isPrimaryKey: i === 0,
      })),
    });
    const graph = buildGraph(model([wide]), { columnLimit: 5 });
    const node = graph.nodes[0]!;
    expect(node.columns).toHaveLength(5);
    expect(node.hiddenColumns).toBe(25);
    expect(node.columns[0]?.isPrimaryKey).toBe(true);
  });
});

describe('search-to-focus', () => {
  const graph = buildGraph(model([table('orders'), table('customers')]));

  it('matches a table name, a label and a column', () => {
    expect(matchNodes(graph, 'ord')).toEqual(['public.orders']);
    expect(matchNodes(graph, 'id')).toHaveLength(2);
  });

  it('matches nothing for an empty query rather than everything', () => {
    expect(matchNodes(graph, '   ')).toEqual([]);
  });
});

describe('layout (35-T22)', () => {
  const graph = buildGraph(model([table('a'), table('b')], [relation('a', 'b')]));

  it('positions every node', () => {
    const positions = layoutGraph(graph);
    expect(Object.keys(positions).sort()).toEqual(['public.a', 'public.b']);
  });

  it('never recomputes a position the operator moved by hand (D21)', () => {
    const manual = { 'public.a': { x: 999, y: 111 } };
    const positions = layoutGraph(graph, { manual });
    expect(positions['public.a']).toEqual({ x: 999, y: 111 });
    // …and the rest is still laid out around it.
    expect(positions['public.b']).toBeDefined();
  });

  it('converts dagre’s centre origin to xyflow’s top-left', () => {
    const positions = layoutGraph(graph);
    // A left-to-right rank puts `a` left of `b`; both are corner coordinates,
    // so neither is negative by half a node width.
    expect(positions['public.a']!.x).toBeLessThan(positions['public.b']!.x);
    expect(positions['public.b']!.x - positions['public.a']!.x).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('tolerates a self-reference, which dagre cannot rank', () => {
    const selfRef = buildGraph(
      model([table('employees')], [relation('employees', 'employees', { selfReferential: true })]),
    );
    expect(() => layoutGraph(selfRef)).not.toThrow();
  });
});

describe('the text equivalent (D16, 35-T24)', () => {
  const graph = buildGraph(
    model([table('orders'), table('customers')], [relation('orders', 'customers')]),
  );

  it('exposes the same tables and relations in DOM order', () => {
    render(<SchemaOutline graph={graph} onOpenTable={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('button').textContent).toBe('orders');
    expect(items[0]!.textContent).toContain('public.customers');
    expect(items[1]!.textContent).toContain('public.orders');
  });

  it('is reachable and actionable by keyboard, not merely present', async () => {
    const onOpenTable = vi.fn();
    render(<SchemaOutline graph={graph} onOpenTable={onOpenTable} />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'orders' }));
    await userEvent.keyboard('{Enter}');
    expect(onOpenTable).toHaveBeenCalledWith('public.orders');
  });

  it('states the counts, so the list is not just a wall of names', () => {
    render(<SchemaOutline graph={graph} onOpenTable={() => {}} />);
    expect(screen.getByText(/2 tables and 1 relations/)).toBeDefined();
  });
});

describe('the canvas actually renders (35-T20, §8.1)', () => {
  /**
   * The trap this guards: React Flow measures nodes through `ResizeObserver`,
   * which happy-dom does not implement — so without the stubs in
   * `src/test/setup.ts` the canvas MOUNTS AND RENDERS NOTHING and a test that
   * only checked "it did not throw" would pass while the feature was blank.
   * This asserts a node's real content is on screen.
   */
  it('draws a node per table, with its columns', async () => {
    const { DiagramMode } = await import('./DiagramMode.js');
    render(
      <DiagramMode
        connectionId="conn_1"
        model={model([table('orders'), table('customers')], [relation('orders', 'customers')])}
        savedPositions={{}}
        onOpenTable={() => {}}
        canSaveLayout
      />,
    );
    expect(screen.getByText('orders')).toBeDefined();
    expect(screen.getByText('customers')).toBeDefined();
    // The column rows are real DOM, not canvas paint.
    expect(screen.getAllByText('id').length).toBeGreaterThan(0);
  });

  it('offers the list view as a real alternative, not a hidden canvas', async () => {
    const { DiagramMode } = await import('./DiagramMode.js');
    render(
      <DiagramMode
        connectionId="conn_1"
        model={model([table('orders')])}
        savedPositions={{}}
        onOpenTable={() => {}}
        canSaveLayout
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Show as list/ }));
    expect(screen.getByText(/1 tables and 0 relations/)).toBeDefined();
  });

  it('BRINGS IN a hidden table when it is searched for — the ceiling copy is a promise', async () => {
    /*
     * The line under the toolbar reads "…140 more are hidden — search to bring
     * one in", and the product could not do it. `buildGraph(model)` was called
     * with no options, so `focus` — the entire mechanism for keeping a named
     * table when the ceiling engages — never received anything; and
     * `matchNodes` searches the BUILT graph, which is the ceilinged one, so a
     * hidden table could not match at any point. Typing one of the hidden names
     * changed nothing at all.
     *
     * Found on a generated 200-table connection (§9.7), not by this suite: the
     * unit tests passed `focus` themselves, which is exactly the caller the
     * product did not have.
     */
    const { DiagramMode } = await import('./DiagramMode.js');
    // 80 tables, and `needle_table` is the LEAST connected — last out of the
    // degree sort, so only focus can save it.
    const many = Array.from({ length: 80 }, (_, i) => table(`t${i}`));
    const hidden = table('needle_table');
    const relations = many.map((t) => relation(t.name, 't0'));
    render(
      <DiagramMode
        connectionId="conn_1"
        model={model([...many, hidden], relations)}
        savedPositions={{}}
        onOpenTable={() => {}}
        canSaveLayout
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/more are hidden/);
    // Not on screen while the ceiling holds it back…
    await userEvent.click(screen.getByRole('button', { name: /Show as list/ }));
    expect(screen.queryByText('needle_table')).toBeNull();

    // …and on screen the moment it is named.
    await userEvent.type(screen.getByRole('searchbox', { name: /Find a table/ }), 'needle_table');
    await waitFor(() => expect(screen.getByText('needle_table')).toBeDefined());
  });

  it('gives every NODE an accessible name, not just every edge', async () => {
    /*
     * React Flow gives a node `role="group"` + `aria-roledescription="node"`
     * and no name; its edges get "Edge from x to y" for free. So a keyboard
     * user tabbing a 200-table diagram reached 60 nodes and 103 edges — every
     * edge announced, every node announced as "node, group". Measured in a
     * browser on a real 200-table connection (§9.7), which is the only place
     * the asymmetry is visible.
     */
    const { DiagramMode } = await import('./DiagramMode.js');
    const { container } = render(
      <DiagramMode
        connectionId="conn_1"
        model={model([table('customers'), table('orders')], [relation('orders', 'customers')])}
        savedPositions={{}}
        onOpenTable={() => {}}
        canSaveLayout
      />,
    );
    const nodes = [...container.querySelectorAll('.react-flow__node')];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.getAttribute('aria-label')).toMatch(/\w+ \(\w+\), \d+ columns?/);
      // …and tabbable, so the name is reachable.
      expect((node as HTMLElement).tabIndex).toBe(0);
    }
  });

  it('names the ceiling on screen when it engages, rather than silently truncating', async () => {
    const { DiagramMode } = await import('./DiagramMode.js');
    render(
      <DiagramMode
        connectionId="conn_1"
        model={model(Array.from({ length: 80 }, (_, i) => table(`t${i}`)))}
        savedPositions={{}}
        onOpenTable={() => {}}
        canSaveLayout
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/most connected tables/);
  });
});
