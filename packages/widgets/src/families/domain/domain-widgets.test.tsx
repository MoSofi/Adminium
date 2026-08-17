// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * TRACK DOMAIN unit tests (annex §13) — the two M7 exit-criteria widgets.
 *
 * Covers, per the track's definition of done: render, empty, deterministic
 * layout/geometry, the direction rules (org-chart mirrors, gantt does NOT — it
 * is a fixed-LTR island per 10-i18n-theming.md §5.5), and SELF-FK CYCLE SAFETY
 * (a `manager_id` cycle must not infinite-loop). The four-state /
 * determinism / config-fuzz / parity gates run centrally over `qa/delivered.ts`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GanttChart, ganttChartDemoData } from './GanttChart.js';
import { OrgChart, orgChartDemoData } from './OrgChart.js';
import { GANTT_DEMO_TODAY_MS } from './domain-config.js';
import { buildOrgTree, countNodes, dayToPercent, groupSpan, layoutOrgTree, toGanttModel } from './domain-lib.js';
import type { GanttFieldMap, OrgFieldMap } from './domain-lib.js';
import type { OrgNode } from './domain-types.js';

afterEach(cleanup);

const ORG_FIELDS: OrgFieldMap = {
  idField: 'id',
  parentField: 'manager_id',
  labelField: 'name',
  roleField: 'title',
  deptField: 'dept',
};

const GANTT_FIELDS: GanttFieldMap = {
  idField: 'id',
  labelField: 'name',
  startField: 'start_date',
  endField: 'end_date',
  progressField: 'progress',
  phaseField: 'phase',
  ownerField: 'owner',
  milestoneField: 'milestone',
};

const person = (id: string, manager_id: string | null, name = `Person ${id}`) => ({
  id,
  manager_id,
  name,
  title: 'Engineer',
  dept: 'Engineering',
});

// ============================================================================
// org-chart — self-FK adaptation + cycle safety
// ============================================================================

describe('buildOrgTree — self-FK adaptation', () => {
  it('builds a tree from manager_id → id', () => {
    const { roots, total } = buildOrgTree(
      [person('c0', null), person('d1', 'c0'), person('r1', 'd1'), person('r2', 'd1')],
      ORG_FIELDS,
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]?.id).toBe('c0');
    expect(roots[0]?.children.map((n) => n.id)).toEqual(['d1']);
    expect(roots[0]?.children[0]?.children.map((n) => n.id)).toEqual(['r1', 'r2']);
    expect(total).toBe(4);
  });

  it('maps the config-named fields onto the node + its meta', () => {
    const { roots } = buildOrgTree([{ id: 'a', manager_id: null, name: 'Ada', title: 'CTO', dept: 'Eng' }], ORG_FIELDS);
    expect(roots[0]?.label).toBe('Ada');
    expect(roots[0]?.meta?.role).toBe('CTO');
    expect(roots[0]?.meta?.dept).toBe('Eng');
  });

  it('treats a row whose manager does not exist as a root (dangling FK)', () => {
    const { roots } = buildOrgTree([person('a', null), person('b', 'ghost')], ORG_FIELDS);
    expect(roots.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('renders a forest when several rows have no manager', () => {
    const { roots } = buildOrgTree([person('a', null), person('b', null), person('c', 'a')], ORG_FIELDS);
    expect(roots.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('buildOrgTree — CYCLE SAFETY (must never infinite-loop)', () => {
  it('survives a self-managing row (a → a)', () => {
    const { roots, total } = buildOrgTree([person('a', 'a')], ORG_FIELDS);
    expect(roots.map((n) => n.id)).toEqual(['a']);
    expect(roots[0]?.children).toEqual([]);
    expect(total).toBe(1);
  });

  it('survives a two-node cycle (a → b → a) and renders both exactly once', () => {
    const { roots, total } = buildOrgTree([person('a', 'b'), person('b', 'a')], ORG_FIELDS);
    // No row has a surviving "no parent" edge, so the cycle-promotion pass
    // makes the first row a root and the back-edge into it is dropped.
    expect(total).toBe(2);
    expect(countNodes(roots)).toBe(2);
    expect(idsOf(roots).sort()).toEqual(['a', 'b']);
  });

  it('survives a three-node cycle (a → b → c → a)', () => {
    const { roots, total } = buildOrgTree(
      [person('a', 'c'), person('b', 'a'), person('c', 'b')],
      ORG_FIELDS,
    );
    expect(total).toBe(3);
    expect(idsOf(roots).sort()).toEqual(['a', 'b', 'c']);
  });

  it('renders a clean branch alongside a cycle, without losing either', () => {
    const { roots, total } = buildOrgTree(
      [person('root', null), person('kid', 'root'), person('x', 'y'), person('y', 'x')],
      ORG_FIELDS,
    );
    expect(total).toBe(4);
    expect(countNodes(roots)).toBe(4);
    const ids = idsOf(roots).sort();
    expect(ids).toEqual(['kid', 'root', 'x', 'y']);
  });

  it('a cyclic payload still lays out and RENDERS (end-to-end, no hang)', () => {
    render(
      <OrgChart
        data={{ rows: [person('a', 'b', 'Ana'), person('b', 'a', 'Bo')], total: 2 }}
        fields={ORG_FIELDS}
      />,
    );
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bo')).toBeTruthy();
  });

  it('de-duplicates repeated ids rather than double-rendering them', () => {
    const { total } = buildOrgTree([person('a', null), person('a', null)], ORG_FIELDS);
    expect(total).toBe(1);
  });

  it('sanitizes a cyclic hierarchy/tree payload (a node re-listed under itself)', () => {
    // A shared/self-referencing node object in a server-supplied tree.
    const node: OrgNode = { id: 'a', label: 'Ana', children: [] };
    node.children.push(node);
    render(<OrgChart data={{ roots: [node], total: 1 }} fields={ORG_FIELDS} />);
    expect(screen.getAllByText('Ana')).toHaveLength(1);
  });
});

/** Every id in a forest, flattened. */
function idsOf(roots: readonly OrgNode[]): string[] {
  return roots.flatMap((root) => [root.id, ...idsOf(root.children)]);
}

// ============================================================================
// org-chart — deterministic layout geometry
// ============================================================================

describe('layoutOrgTree — deterministic geometry', () => {
  const tree = buildOrgTree(
    [person('c0', null), person('d1', 'c0'), person('d2', 'c0'), person('r1', 'd1'), person('r2', 'd1')],
    ORG_FIELDS,
  ).roots;

  it('is byte-identical across runs (pure geometry)', () => {
    expect(JSON.stringify(layoutOrgTree(tree))).toBe(JSON.stringify(layoutOrgTree(tree)));
  });

  it('lays depth bands out as strict rows', () => {
    const layout = layoutOrgTree(tree, { nodeHeight: 100, vGap: 40 });
    const yByDepth = new Map<number, number>();
    for (const node of layout.nodes) {
      const seen = yByDepth.get(node.depth);
      if (seen === undefined) yByDepth.set(node.depth, node.y);
      else expect(node.y).toBe(seen); // every node at a depth shares one y
    }
    expect(yByDepth.get(0)).toBe(0);
    expect(yByDepth.get(1)).toBe(140);
    expect(yByDepth.get(2)).toBe(280);
  });

  it('centers a parent over the span of its children', () => {
    const layout = layoutOrgTree(tree);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const d1 = byId.get('d1');
    const r1 = byId.get('r1');
    const r2 = byId.get('r2');
    expect(d1?.x).toBeCloseTo(((r1?.x ?? 0) + (r2?.x ?? 0)) / 2, 5);

    const c0 = byId.get('c0');
    const d2 = byId.get('d2');
    expect(c0?.x).toBeCloseTo(((d1?.x ?? 0) + (d2?.x ?? 0)) / 2, 5);
  });

  it('gives leaves non-overlapping slots', () => {
    const layout = layoutOrgTree(tree, { nodeWidth: 100, hGap: 20 });
    const leaves = layout.nodes.filter((n) => !n.hasChildren).sort((a, b) => a.x - b.x);
    for (let i = 1; i < leaves.length; i += 1) {
      const previous = leaves[i - 1] as (typeof leaves)[number];
      const current = leaves[i] as (typeof leaves)[number];
      expect(current.x).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  });

  it('emits one connector per parent→child edge, and none when collapsed', () => {
    expect(layoutOrgTree(tree).connectors).toHaveLength(4); // c0→d1, c0→d2, d1→r1, d1→r2
    const collapsed = layoutOrgTree(tree, { collapsed: new Set(['d1']) });
    expect(collapsed.connectors.map((c) => c.childId).sort()).toEqual(['d1', 'd2']);
  });

  it('connectors are elbows joining the parent bottom-center to the child top-center', () => {
    const layout = layoutOrgTree(tree, { nodeWidth: 100, nodeHeight: 100, vGap: 40 });
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const edge = layout.connectors.find((c) => c.parentId === 'd1' && c.childId === 'r1');
    const d1 = byId.get('d1');
    const r1 = byId.get('r1');
    // M px py L px midY L cx midY L cx cy
    expect(edge?.d).toBe(
      `M ${(d1?.x ?? 0) + 50} ${(d1?.y ?? 0) + 100} L ${(d1?.x ?? 0) + 50} ${(d1?.y ?? 0) + 120} ` +
        `L ${(r1?.x ?? 0) + 50} ${(d1?.y ?? 0) + 120} L ${(r1?.x ?? 0) + 50} ${r1?.y ?? 0}`,
    );
  });

  it('prunes below maxDepth and marks the boundary node collapsed', () => {
    const layout = layoutOrgTree(tree, { maxDepth: 1 });
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['c0', 'd1', 'd2']);
    expect(layout.nodes.find((n) => n.id === 'd1')?.collapsed).toBe(true);
  });

  /**
   * `pruned` distinguishes "the user collapsed this" from "the maxDepth cap
   * collapsed this". Only the former can ever re-open: for a pruned node
   * `isCollapsed` is forced true regardless of the `collapsed` set, so a toggle
   * is a no-op — the card must not render a live expand button or advertise
   * `aria-expanded` it can never satisfy.
   */
  it('marks maxDepth-pruned nodes pruned, and user-collapsed nodes not', () => {
    const capped = layoutOrgTree(tree, { maxDepth: 1 });
    expect(capped.nodes.find((n) => n.id === 'd1')?.pruned).toBe(true);
    // d2 is at the cap too but has no children — nothing to expand, so not pruned.
    expect(capped.nodes.find((n) => n.id === 'd2')?.pruned).toBe(false);

    const userCollapsed = layoutOrgTree(tree, { collapsed: new Set(['d1']) });
    expect(userCollapsed.nodes.find((n) => n.id === 'd1')?.collapsed).toBe(true);
    expect(userCollapsed.nodes.find((n) => n.id === 'd1')?.pruned).toBe(false);
  });

  it('a pruned node cannot be expanded by clearing the collapsed set', () => {
    const layout = layoutOrgTree(tree, { maxDepth: 1, collapsed: new Set() });
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['c0', 'd1', 'd2']);
    expect(layout.nodes.find((n) => n.id === 'd1')?.pruned).toBe(true);
  });

  it('collapsing hides a subtree and shrinks the canvas', () => {
    const open = layoutOrgTree(tree);
    const shut = layoutOrgTree(tree, { collapsed: new Set(['d1']) });
    expect(shut.nodes).toHaveLength(3);
    expect(shut.width).toBeLessThan(open.width);
  });

  it('returns an empty canvas for an empty forest', () => {
    expect(layoutOrgTree([])).toEqual({ nodes: [], connectors: [], width: 0, height: 0 });
  });
});

// ============================================================================
// org-chart — render / empty / interaction / direction
// ============================================================================

describe('OrgChart — render', () => {
  it('renders every person from a seeded tree payload', () => {
    render(<OrgChart data={orgChartDemoData(7)} fields={ORG_FIELDS} />);
    expect(screen.getByText('Ava Reyes')).toBeTruthy();
    expect(screen.getByText('Chief Executive')).toBeTruthy();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(1);
  });

  it('accepts the flat self-FK record-list a real people table returns', () => {
    render(
      <OrgChart
        data={{ rows: [person('c0', null, 'Ada Lovelace'), person('r1', 'c0', 'Alan Turing')], total: 2 }}
        fields={ORG_FIELDS}
      />,
    );
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Alan Turing')).toBeTruthy();
  });

  it('exposes depth as aria-level so the hierarchy reaches AT', () => {
    render(<OrgChart data={{ rows: [person('c0', null), person('r1', 'c0')], total: 2 }} fields={ORG_FIELDS} />);
    expect(screen.getByTestId('org-node-c0').getAttribute('aria-level')).toBe('1');
    expect(screen.getByTestId('org-node-r1').getAttribute('aria-level')).toBe('2');
  });

  it('renders the empty state for an empty tree and an empty record-list', () => {
    const { unmount } = render(
      <OrgChart data={{ roots: [], total: 0 }} fields={ORG_FIELDS} emptyTitle="Nobody here" />,
    );
    expect(screen.getByText('Nobody here')).toBeTruthy();
    unmount();

    render(<OrgChart data={{ rows: [], total: 0 }} fields={ORG_FIELDS} emptyTitle="Still nobody" />);
    expect(screen.getByText('Still nobody')).toBeTruthy();
  });

  it('renders the empty state for a malformed payload rather than throwing', () => {
    render(<OrgChart data={'nonsense'} fields={ORG_FIELDS} emptyTitle="No data" />);
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('collapses and expands a manager branch', () => {
    render(
      <OrgChart
        data={{ rows: [person('c0', null), person('r1', 'c0', 'Report One')], total: 2 }}
        fields={ORG_FIELDS}
      />,
    );
    expect(screen.getByText('Report One')).toBeTruthy();
    fireEvent.click(screen.getByTestId('org-toggle-c0'));
    expect(screen.queryByText('Report One')).toBeNull();
    expect(screen.getByTestId('org-node-c0').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId('org-toggle-c0'));
    expect(screen.getByText('Report One')).toBeTruthy();
  });

  it('gives a maxDepth-pruned node no toggle and no aria-expanded', () => {
    // The node at the cap is permanently collapsed by maxDepth, so its toggle
    // would be a dead control and `aria-expanded="false"` would promise a screen
    // reader an expansion that can never happen.
    render(
      <OrgChart
        data={{ rows: [person('c0', null), person('d1', 'c0'), person('r1', 'd1')], total: 3 }}
        fields={ORG_FIELDS}
        maxDepth={1}
      />,
    );
    // d1 sits at the cap and has a child in the data, but cannot expand.
    expect(screen.queryByTestId('org-toggle-d1')).toBeNull();
    expect(screen.getByTestId('org-node-d1').hasAttribute('aria-expanded')).toBe(false);
    // c0 is above the cap, so it keeps its working toggle.
    expect(screen.getByTestId('org-toggle-c0')).toBeTruthy();
    expect(screen.getByTestId('org-node-c0').getAttribute('aria-expanded')).toBe('true');
  });

  it('honors defaultCollapsed and hides the toggle when collapsible is off', () => {
    const data = { rows: [person('c0', null), person('r1', 'c0', 'Report One')], total: 2 };
    const { unmount } = render(
      <OrgChart data={data} fields={ORG_FIELDS} defaultCollapsed={['c0']} />,
    );
    expect(screen.queryByText('Report One')).toBeNull();
    unmount();

    render(<OrgChart data={data} fields={ORG_FIELDS} collapsible={false} />);
    expect(screen.queryByTestId('org-toggle-c0')).toBeNull();
    expect(screen.getByText('Report One')).toBeTruthy();
  });

  it('interpolates the localized, non-inflecting reports footer', () => {
    render(
      <OrgChart
        data={{ rows: [person('c0', null), person('r1', 'c0'), person('r2', 'c0')], total: 3 }}
        fields={ORG_FIELDS}
        reportsLabel="المرؤوسون · {count}"
      />,
    );
    expect(screen.getByTestId('org-toggle-c0').textContent).toContain('المرؤوسون · 2');
  });
});

describe('OrgChart — direction (§5.5: a hierarchy MIRRORS)', () => {
  const data = { rows: [person('c0', null), person('r1', 'c0')], total: 2 };

  it('positions cards on inset-inline-start, never a physical offset', () => {
    render(<OrgChart data={data} fields={ORG_FIELDS} />);
    const card = screen.getByTestId('org-node-c0');
    // The card consumes canonical-LTR geometry through a logical utility, so the
    // browser mirrors the whole tree under dir="rtl" with no second code path.
    expect(card.className).toContain('start-[var(--node-x)]');
    expect(card.className).not.toMatch(/(^|\s)-?left-/);
    expect(card.className).not.toMatch(/(^|\s)-?right-/);
    expect(card.getAttribute('style')).toContain('--node-x');
  });

  it('mirrors the SVG connector overlay under RTL (it has no logical coords)', () => {
    render(<OrgChart data={data} fields={ORG_FIELDS} />);
    expect(screen.getByTestId('org-chart-connectors').getAttribute('class')).toContain('rtl:-scale-x-100');
  });

  it('emits identical geometry under either direction (the mirror is CSS-side)', () => {
    const { unmount } = render(<OrgChart data={data} fields={ORG_FIELDS} />);
    const ltr = screen.getByTestId('org-node-r1').getAttribute('style');
    unmount();

    render(
      <div dir="rtl">
        <OrgChart data={data} fields={ORG_FIELDS} />
      </div>,
    );
    expect(screen.getByTestId('org-node-r1').getAttribute('style')).toBe(ltr);
  });
});

// ============================================================================
// gantt-chart — time-axis geometry
// ============================================================================

const TASKS = [
  { id: 't1', name: 'Kickoff', phase: 'Discovery', start_date: '2026-07-01', end_date: '2026-07-08', progress: 100 },
  { id: 't2', name: 'Design', phase: 'Design', start_date: '2026-07-08', end_date: '2026-07-18', progress: 40 },
  { id: 't3', name: 'Go live', phase: 'Design', start_date: '2026-07-21', end_date: '2026-07-21', progress: 0 },
];

describe('toGanttModel — time-axis geometry', () => {
  it('anchors the origin at the earliest start and spans to the latest end', () => {
    const model = toGanttModel(TASKS, GANTT_FIELDS);
    expect(model.originMs).toBe(Date.UTC(2026, 6, 1));
    expect(model.totalDays).toBe(20); // Jul 1 → Jul 21
  });

  it('projects start/end onto whole-day offsets', () => {
    const model = toGanttModel(TASKS, GANTT_FIELDS);
    const discovery = model.groups.find((g) => g.key === 'Discovery');
    expect(discovery?.tasks[0]).toMatchObject({ id: 't1', startDay: 0, durDays: 7, pct: 100 });
    const design = model.groups.find((g) => g.key === 'Design');
    expect(design?.tasks[0]).toMatchObject({ id: 't2', startDay: 7, durDays: 10, pct: 40 });
  });

  it('turns a zero-duration row into a milestone', () => {
    const model = toGanttModel(TASKS, GANTT_FIELDS);
    const design = model.groups.find((g) => g.key === 'Design');
    expect(design?.tasks[1]).toMatchObject({ id: 't3', milestone: true, startDay: 20 });
  });

  /**
   * The 0–1-fraction vs 0–100-percentage sniff is a property of the COLUMN, not
   * of a row. Deciding per row read a whole-percentage column's legitimate `1`
   * ("1% done") as the fraction 1.0 — a task 1% in rendered as a full bar
   * labelled 100%, and crossed the pct > 55 threshold that inverts the label.
   */
  it('treats a 0-100 progress column as percentages even when a row reads 1', () => {
    const model = toGanttModel(
      [
        { id: 't1', name: 'Barely started', start_date: '2026-07-01', end_date: '2026-07-11', progress: 1 },
        { id: 't2', name: 'Half way', start_date: '2026-07-01', end_date: '2026-07-11', progress: 50 },
      ],
      GANTT_FIELDS,
    );
    const tasks = model.groups.flatMap((g) => g.tasks);
    expect(tasks.find((t) => t.id === 't1')?.pct).toBe(1);
    expect(tasks.find((t) => t.id === 't2')?.pct).toBe(50);
  });

  it('still scales a 0-1 fraction column to percentages', () => {
    const model = toGanttModel(
      [
        { id: 't1', name: 'Quarter', start_date: '2026-07-01', end_date: '2026-07-11', progress: 0.25 },
        { id: 't2', name: 'Done', start_date: '2026-07-01', end_date: '2026-07-11', progress: 1 },
      ],
      GANTT_FIELDS,
    );
    const tasks = model.groups.flatMap((g) => g.tasks);
    expect(tasks.find((t) => t.id === 't1')?.pct).toBe(25);
    expect(tasks.find((t) => t.id === 't2')?.pct).toBe(100);
  });

  it('honors an explicit milestone field', () => {
    const model = toGanttModel(
      [{ ...TASKS[0], milestone: true }],
      GANTT_FIELDS,
    );
    expect(model.groups[0]?.tasks[0]?.milestone).toBe(true);
  });

  it('groups by the phase FK in first-seen order (deterministic)', () => {
    expect(toGanttModel(TASKS, GANTT_FIELDS).groups.map((g) => g.key)).toEqual(['Discovery', 'Design']);
  });

  it('buckets phase-less rows under the localized ungrouped label', () => {
    const model = toGanttModel(
      [{ id: 'x', name: 'Loose', start_date: '2026-07-01', end_date: '2026-07-03' }],
      GANTT_FIELDS,
      { ungroupedLabel: 'Tâches' },
    );
    expect(model.groups[0]).toMatchObject({ key: '__ungrouped__', name: 'Tâches' });
  });

  it('drops rows with no parseable start, keeps the rest', () => {
    const model = toGanttModel(
      [...TASKS, { id: 'bad', name: 'No start', phase: 'Design', start_date: null, end_date: '2026-07-09' }],
      GANTT_FIELDS,
    );
    expect(model.groups.flatMap((g) => g.tasks).map((t) => t.id)).not.toContain('bad');
  });

  it('clamps an end before the start to a 1-day bar', () => {
    const model = toGanttModel(
      [{ id: 'x', name: 'Backwards', start_date: '2026-07-10', end_date: '2026-07-01' }],
      GANTT_FIELDS,
    );
    expect(model.groups[0]?.tasks[0]?.durDays).toBe(1);
  });

  it('accepts progress as a 0–1 fraction or a 0–100 percentage, clamped', () => {
    const read = (progress: unknown) =>
      toGanttModel([{ id: 'x', name: 'T', start_date: '2026-07-01', end_date: '2026-07-05', progress }], GANTT_FIELDS)
        .groups[0]?.tasks[0]?.pct;
    expect(read(0.25)).toBe(25);
    expect(read(60)).toBe(60);
    expect(read(500)).toBe(100);
    expect(read(-5)).toBe(0);
  });

  it('places the today marker, and hides it outside the window', () => {
    const inside = toGanttModel(TASKS, GANTT_FIELDS, { todayMs: Date.UTC(2026, 6, 11) });
    expect(inside.todayDay).toBe(10);
    const after = toGanttModel(TASKS, GANTT_FIELDS, { todayMs: Date.UTC(2027, 0, 1) });
    expect(after.todayDay).toBeNull();
    const before = toGanttModel(TASKS, GANTT_FIELDS, { todayMs: Date.UTC(2020, 0, 1) });
    expect(before.todayDay).toBeNull();
  });

  it('is byte-identical across runs (pure geometry)', () => {
    const options = { todayMs: Date.UTC(2026, 6, 11) };
    expect(JSON.stringify(toGanttModel(TASKS, GANTT_FIELDS, options))).toBe(
      JSON.stringify(toGanttModel(TASKS, GANTT_FIELDS, options)),
    );
  });

  it('summarizes a group as the span of its tasks', () => {
    const design = toGanttModel(TASKS, GANTT_FIELDS).groups.find((g) => g.key === 'Design');
    expect(groupSpan(design as NonNullable<typeof design>)).toEqual({ startDay: 7, durDays: 14 });
  });

  it('maps day offsets onto clamped axis percentages', () => {
    expect(dayToPercent(0, 20)).toBe(0);
    expect(dayToPercent(10, 20)).toBe(50);
    expect(dayToPercent(40, 20)).toBe(100); // clamped
  });

  it('returns an empty model for no rows', () => {
    expect(toGanttModel([], GANTT_FIELDS).groups).toEqual([]);
  });
});

// ============================================================================
// gantt-chart — render / empty / direction
// ============================================================================

describe('GanttChart — render', () => {
  const demo = ganttChartDemoData(7);

  it('renders grouped task rows over the axis', () => {
    render(<GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />);
    expect(screen.getByText('Kickoff & research')).toBeTruthy();
    expect(screen.getByTestId('gantt-group-Discovery')).toBeTruthy();
    expect(screen.getByTestId('gantt-group-Launch')).toBeTruthy();
  });

  it('renders the today marker only when todayLine is on', () => {
    const { unmount } = render(
      <GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />,
    );
    expect(screen.getAllByTestId('gantt-today-line').length).toBeGreaterThan(0);
    unmount();

    render(<GanttChart data={demo} fields={GANTT_FIELDS} todayLine={false} />);
    expect(screen.queryByTestId('gantt-today-line')).toBeNull();
  });

  it('renders a milestone as a diamond, not a bar', () => {
    render(<GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />);
    const milestone = screen.getByTestId('gantt-milestone-t10');
    expect(milestone.className).toContain('rotate-45');
  });

  it('renders week ticks and the legend, and hides them on request', () => {
    const { unmount } = render(
      <GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />,
    );
    expect(screen.getAllByTestId('gantt-week-tick').length).toBeGreaterThan(0);
    // "Discovery" renders twice: the phase summary row + the legend swatch.
    expect(screen.getAllByText('Discovery')).toHaveLength(2);
    unmount();

    render(
      <GanttChart data={demo} fields={GANTT_FIELDS} weekLabels={false} showLegend={false} todayMs={GANTT_DEMO_TODAY_MS} />,
    );
    expect(screen.queryByTestId('gantt-week-tick')).toBeNull();
    // Legend gone → the phase name survives only on its summary row.
    expect(screen.getAllByText('Discovery')).toHaveLength(1);
  });

  it('renders the empty state for an empty / malformed payload', () => {
    const { unmount } = render(
      <GanttChart data={{ rows: [], total: 0 }} fields={GANTT_FIELDS} emptyTitle="No plan" />,
    );
    expect(screen.getByText('No plan')).toBeTruthy();
    unmount();

    render(<GanttChart data={42} fields={GANTT_FIELDS} emptyTitle="Still no plan" />);
    expect(screen.getByText('Still no plan')).toBeTruthy();
  });

  it('routes the axis dates through the Intl layer with Latin data digits', () => {
    // ar-EG prose uses Arabic-Indic digits, but a gantt DATE HEADER is data
    // context → latn, so the header stays tabular-nums aligned (§4.2).
    render(
      <GanttChart data={demo} fields={GANTT_FIELDS} locale="ar-EG" todayMs={GANTT_DEMO_TODAY_MS} />,
    );
    const first = screen.getAllByTestId('gantt-week-tick')[0];
    expect(first?.textContent ?? '').toMatch(/\d/); // ASCII digits, not ٠١٢
  });
});

describe('GanttChart — direction (§5.5: the time axis is a FIXED-LTR ISLAND)', () => {
  const demo = ganttChartDemoData(7);

  it('declares the timeline canvas an LTR island', () => {
    render(<GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />);
    expect(screen.getByTestId('gantt-canvas').getAttribute('dir')).toBe('ltr');
  });

  it('keeps the island LTR *inside an RTL page* — time never mirrors', () => {
    render(
      <div dir="rtl">
        <GanttChart data={demo} fields={GANTT_FIELDS} locale="ar-EG" todayMs={GANTT_DEMO_TODAY_MS} />
      </div>,
    );
    expect(screen.getByTestId('gantt-canvas').getAttribute('dir')).toBe('ltr');
  });

  it('positions bars identically under LTR and RTL (the axis does not flip)', () => {
    const { unmount } = render(
      <GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />,
    );
    const ltr = screen.getByTestId('gantt-task-t6').getAttribute('data-start-pct');
    unmount();

    render(
      <div dir="rtl">
        <GanttChart data={demo} fields={GANTT_FIELDS} todayMs={GANTT_DEMO_TODAY_MS} />
      </div>,
    );
    expect(screen.getByTestId('gantt-task-t6').getAttribute('data-start-pct')).toBe(ltr);
  });
});

// ============================================================================
// demoData
// ============================================================================

describe('demoData (04 §7.7)', () => {
  it('org-chart: same seed → identical payload; distinct seeds → distinct trees', () => {
    expect(JSON.stringify(orgChartDemoData(7))).toBe(JSON.stringify(orgChartDemoData(7)));
    const shapes = new Set([1, 7, 42, 1234, 65_535].map((s) => JSON.stringify(orgChartDemoData(s))));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('org-chart: always emits a single connected root with staffed VPs', () => {
    for (const seed of [0, 1, 7, 42, 1234, 65_535]) {
      const data = orgChartDemoData(seed);
      expect(data.roots).toHaveLength(1);
      expect(data.roots[0]?.id).toBe('c0');
      expect(data.roots[0]?.children).toHaveLength(3);
      expect(countNodes(data.roots)).toBe(data.total);
      for (const vp of data.roots[0]?.children ?? []) expect(vp.children.length).toBeGreaterThan(0);
    }
  });

  it('gantt-chart: same seed → identical payload; distinct seeds → distinct progress', () => {
    expect(JSON.stringify(ganttChartDemoData(7))).toBe(JSON.stringify(ganttChartDemoData(7)));
    const shapes = new Set([1, 7, 42, 1234, 65_535].map((s) => JSON.stringify(ganttChartDemoData(s))));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('gantt-chart: dates derive from the fixed epoch, never the wall clock', () => {
    const rows = ganttChartDemoData(3).rows;
    expect(rows[0]?.start_date).toBe('2026-07-01');
    // Every row is a well-formed, epoch-anchored, non-reversed date pair.
    for (const row of rows) {
      expect(row.start_date).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(String(row.end_date) >= String(row.start_date)).toBe(true);
    }
    // The whole payload projects cleanly against a pinned today marker.
    const model = toGanttModel(rows, GANTT_FIELDS, { todayMs: GANTT_DEMO_TODAY_MS });
    expect(model.originMs).toBe(Date.UTC(2026, 6, 1));
    expect(model.todayDay).toBe(34);
    expect(model.groups.map((g) => g.key)).toEqual(['Discovery', 'Design', 'Build', 'Launch']);
  });
});

describe('domain chrome localization (ui:widgets.domain.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { widgets: { domain: { orgChart: { emptyTitle: 'Keine Berichtsstruktur', emptyBody: 'Manager-Spalte wählen.' } } } }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <OrgChart data={{ rows: [], total: 0 }} fields={ORG_FIELDS} />
      </I18nProvider>,
    );
    expect(screen.getByText('Keine Berichtsstruktur')).toBeTruthy();

    cleanup();
    render(<OrgChart data={{ rows: [], total: 0 }} fields={ORG_FIELDS} />);
    expect(screen.getByText('No reporting structure')).toBeTruthy();
  });
});
