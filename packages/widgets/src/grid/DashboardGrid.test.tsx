// @vitest-environment happy-dom
/**
 * DashboardGrid edit-mode tests (04-widget-registry.md §6.2). dnd-kit's pointer
 * sensor needs real layout rects (unavailable in happy-dom), so — exactly as the
 * boards family does — the drag-move behaviour is exercised through the widget's
 * own LOGICAL keyboard path, which funnels through the SAME `applyMove` +
 * `compactVertical` machinery a pointer drop uses. The pure recompaction /
 * findFirstFit / resize-floor invariants are proven directly in
 * layout-edit.test.ts.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardGrid } from './DashboardGrid.js';
import type { RenderItemContext } from './DashboardGrid.js';
import { GridDragHandle } from './grid-edit.js';
import type { MinSize } from './layout-schema.js';
import type { LayoutItem, PageLayout } from './layout-schema.js';

afterEach(cleanup);

function item(i: string, x: number, y: number, w: number, h: number, title = i): LayoutItem {
  return { i, widget: 'kpi-stat-card', x, y, w, h, config: { title } };
}

function renderItem(entry: LayoutItem, ctx: RenderItemContext) {
  return (
    <div data-widget-body={entry.i}>
      <span>{String(entry.config['title'])}</span>
      {ctx.editMode ? <GridDragHandle /> : null}
    </div>
  );
}

function grip(title: string): HTMLElement {
  return screen.getByRole('button', { name: `Drag to move ${title}` });
}

describe('DashboardGrid static mode (backward compatible)', () => {
  it('renders each item once, position-sorted, with no drag affordances', () => {
    const layout: PageLayout = { version: 1, items: [item('b', 0, 3, 6, 3), item('a', 0, 0, 6, 3)] };
    const { container } = render(<DashboardGrid layout={layout} renderItem={renderItem} testId="grid" />);
    const ids = [...container.querySelectorAll('[data-grid-item]')].map((el) => el.getAttribute('data-grid-item'));
    expect(ids).toEqual(['a', 'b']);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DashboardGrid edit mode — render affordances', () => {
  it('renders a drag grip (host-placed) and a resize handle per item', () => {
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 6, 3, 'Alpha')] };
    render(<DashboardGrid layout={layout} renderItem={renderItem} editMode onLayoutChange={() => {}} />);
    expect(grip('Alpha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize Alpha' })).toBeTruthy();
  });

  it('places the resize handle with the LOGICAL inline-end class, never physical right', () => {
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 6, 3, 'Alpha')] };
    render(<DashboardGrid layout={layout} renderItem={renderItem} editMode />);
    const handle = screen.getByRole('button', { name: 'Resize Alpha' });
    expect(handle.className).toContain('end-0');
    // No physical inline direction (regex avoids a flagged string literal).
    expect(handle.className).not.toMatch(/right-/);
  });
});

describe('DashboardGrid keyboard move (drives the same path as a pointer drop)', () => {
  it('grab → arrows → Enter recompacts and emits the settled layout', () => {
    const onChange = vi.fn();
    // A on top, B beneath it in the same columns.
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 4, 2, 'A'), item('b', 0, 2, 4, 2, 'B')] };
    render(<DashboardGrid layout={layout} renderItem={renderItem} editMode onLayoutChange={onChange} />);
    const el = grip('B');
    el.focus();
    fireEvent.keyDown(el, { key: 'ArrowUp' }); // draft y 2 → 1 (auto-grab)
    fireEvent.keyDown(el, { key: 'ArrowUp' }); // draft y 1 → 0 (onto A)
    fireEvent.keyDown(el, { key: 'Enter' }); // commit
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as PageLayout;
    const byId = Object.fromEntries(next.items.map((it) => [it.i, it]));
    // Clean swap: B on top, A pushed beneath — no overlap.
    expect(byId.b!.y).toBe(0);
    expect(byId.a!.y).toBe(2);
  });

  it('Escape reverts the draft without emitting a change', () => {
    const onChange = vi.fn();
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 4, 2, 'A'), item('b', 0, 2, 4, 2, 'B')] };
    const { container } = render(
      <DashboardGrid layout={layout} renderItem={renderItem} editMode onLayoutChange={onChange} />,
    );
    const el = grip('B');
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-grid-liveregion]')!.textContent).toContain('returned');
  });

  it('announces grab and move through the polite live region', () => {
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 4, 2, 'Alpha')] };
    const { container } = render(<DashboardGrid layout={layout} renderItem={renderItem} editMode />);
    const live = container.querySelector('[data-grid-liveregion]')!;
    const el = grip('Alpha');
    fireEvent.keyDown(el, { key: 'Enter' }); // grab
    expect(live.textContent).toContain('Grabbed');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(live.textContent).toContain('moved to');
  });

  it('renders a live dashed-accent ghost outline while a session is active', () => {
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 4, 2, 'Alpha')] };
    const { container } = render(<DashboardGrid layout={layout} renderItem={renderItem} editMode />);
    expect(container.querySelector('[data-grid-ghost]')).toBeNull();
    const el = grip('Alpha');
    fireEvent.keyDown(el, { key: 'Enter' }); // grab → draft becomes active
    const ghost = container.querySelector('[data-grid-ghost="a"]')!;
    expect(ghost).not.toBeNull();
    expect(ghost.className).toContain('border-dashed');
    expect(ghost.className).toContain('border-accent');
    fireEvent.keyDown(el, { key: 'Escape' }); // revert clears the ghost
    expect(container.querySelector('[data-grid-ghost]')).toBeNull();
  });
});

describe('DashboardGrid keyboard resize', () => {
  it('Shift+ArrowRight grows the width; Enter commits it', () => {
    const onChange = vi.fn();
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 3, 2, 'Alpha')] };
    render(<DashboardGrid layout={layout} renderItem={renderItem} editMode onLayoutChange={onChange} />);
    const el = grip('Alpha');
    fireEvent.keyDown(el, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(el, { key: 'Enter' });
    const next = onChange.mock.calls[0]![0] as PageLayout;
    expect(next.items.find((it) => it.i === 'a')!.w).toBe(4);
  });

  it('never resizes below the registry minW × minH floor', () => {
    const onChange = vi.fn();
    const getSizing = (): MinSize => ({ minW: 3, minH: 2 });
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 3, 2, 'Alpha')] };
    render(
      <DashboardGrid
        layout={layout}
        renderItem={renderItem}
        editMode
        getSizing={getSizing}
        onLayoutChange={onChange}
      />,
    );
    const el = grip('Alpha');
    fireEvent.keyDown(el, { key: 'ArrowLeft', shiftKey: true }); // try to shrink below minW
    fireEvent.keyDown(el, { key: 'ArrowUp', shiftKey: true }); // try to shrink below minH
    fireEvent.keyDown(el, { key: 'Enter' });
    const next = onChange.mock.calls[0]![0] as PageLayout;
    const a = next.items.find((it) => it.i === 'a')!;
    expect(a.w).toBe(3);
    expect(a.h).toBe(2);
  });
});

describe('DashboardGrid RTL keyboard semantics', () => {
  it('ArrowRight moves reading-forward — inline-start (x−1) under RTL', () => {
    const onChange = vi.fn();
    const layout: PageLayout = { version: 1, items: [item('a', 5, 0, 3, 2, 'Alpha')] };
    render(<DashboardGrid layout={layout} renderItem={renderItem} editMode dir="rtl" onLayoutChange={onChange} />);
    const el = grip('Alpha');
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect((onChange.mock.calls[0]![0] as PageLayout).items.find((it) => it.i === 'a')!.x).toBe(4);
  });

  it('LTR ArrowRight moves inline-end (x+1) — the mirror of the RTL case', () => {
    const onChange = vi.fn();
    const layout: PageLayout = { version: 1, items: [item('a', 5, 0, 3, 2, 'Alpha')] };
    render(<DashboardGrid layout={layout} renderItem={renderItem} editMode dir="ltr" onLayoutChange={onChange} />);
    const el = grip('Alpha');
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect((onChange.mock.calls[0]![0] as PageLayout).items.find((it) => it.i === 'a')!.x).toBe(6);
  });

  it('keeps the resize handle at the logical inline-end in both directions', () => {
    const layout: PageLayout = { version: 1, items: [item('a', 0, 0, 6, 3, 'Alpha')] };
    const ltr = render(<DashboardGrid layout={layout} renderItem={renderItem} editMode dir="ltr" />);
    expect(within(ltr.container).getByRole('button', { name: 'Resize Alpha' }).className).toContain('end-0');
    ltr.unmount();
    const rtl = render(<DashboardGrid layout={layout} renderItem={renderItem} editMode dir="rtl" />);
    const handle = within(rtl.container).getByRole('button', { name: 'Resize Alpha' });
    expect(handle.className).toContain('end-0');
    expect(handle.className).not.toMatch(/right-/);
  });
});
