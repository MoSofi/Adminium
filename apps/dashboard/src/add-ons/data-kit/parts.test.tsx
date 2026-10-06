// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The data kit's own parts: a grid with a side column, a bar at the foot of
 * the page, a single on/off chip, a menu, and a table that turns to cards
 * when its box is narrow.
 */
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToggleChip } from './fields.js';
import { Grid, Sheet, StickyBar } from './layout.js';
import { Menu, MenuItem } from './menu.js';
import { DataTable } from './table.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the kit\'s layout parts', () => {
  it('a grid with an aside is a main column and a side column that follows the page', () => {
    const { container } = render(
      <Grid columns={2} aside={<p>Try it</p>}>
        <p>One</p>
        <p>Two</p>
      </Grid>,
    );
    const side = container.querySelector('aside')!;
    expect(side.textContent).toBe('Try it');
    expect(side.className).toContain('lg:sticky');
    // Under the breakpoint it is one column, the aside after the main one.
    const frame = container.querySelector('[data-part="kit-grid-aside"]')!;
    expect(frame.className).toContain('grid-cols-1');
    expect(frame.lastElementChild).toBe(side);
    expect(frame.firstElementChild!.textContent).toBe('OneTwo');
  });

  it('a grid without one is the project kit\'s own', () => {
    const { container } = render(
      <Grid columns={3}>
        <p>One</p>
      </Grid>,
    );
    expect(container.querySelector('aside')).toBeNull();
    expect(container.firstElementChild!.className).toContain('xl:grid-cols-3');
  });

  it('a bar at the foot of the page is solid, named, and holds a start, an end and a line across', () => {
    render(
      <StickyBar aria-label="Totals" start="3 lines" end={<button type="button">Save</button>}>
        <p role="alert">Not enough left</p>
      </StickyBar>,
    );
    const bar = screen.getByRole('group', { name: 'Totals' });
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('bottom-0');
    // A solid surface: a tint would read differently over whatever scrolls behind it.
    expect(bar.className).toMatch(/\bbg-surface\b/);
    expect(bar.className).not.toMatch(/bg-[a-z-]+\/\d/);
    expect(within(bar).getByText('3 lines')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(bar).getByRole('alert').textContent).toBe('Not enough left');
  });
});

describe('the kit\'s sheet', () => {
  it('is the dashboard\'s own dialog, and under 640 px sits at the foot of the screen, as tall as what it holds', () => {
    render(
      <Sheet open aria-describedby={undefined}>
        <p>New item</p>
      </Sheet>,
    );
    const panel = screen.getByRole('dialog');
    expect(panel.textContent).toBe('New item');
    for (const part of ['max-sm:self-end', 'max-sm:flex-none', 'max-sm:rounded-b-none']) expect(panel.className, part).toContain(part);
  });
});

describe('a toggle chip', () => {
  it('is one button that says whether it is pressed, and asks to be the other', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const { rerender } = render(<ToggleChip pressed={false} onPressedChange={changed}>Mon</ToggleChip>);
    const chip = screen.getByRole('button', { name: 'Mon' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await user.click(chip);
    expect(changed).toHaveBeenCalledExactlyOnceWith(true);
    rerender(<ToggleChip pressed onPressedChange={changed}>Mon</ToggleChip>);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await user.keyboard(' ');
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it('does nothing while disabled', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<ToggleChip pressed={false} disabled onPressedChange={changed}>Tue</ToggleChip>);
    await user.click(screen.getByRole('button', { name: 'Tue' }));
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('a menu', () => {
  it('opens from its own button, runs the item chosen and marks the one that cannot be taken back', async () => {
    const user = userEvent.setup();
    const [close, cancel] = [vi.fn(), vi.fn()];
    render(
      <Menu label="More">
        <MenuItem onSelect={close}>Close</MenuItem>
        <MenuItem onSelect={cancel} danger>
          Cancel the order
        </MenuItem>
        <MenuItem onSelect={() => undefined} disabled>
          Reopen
        </MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu', { name: 'More' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Close', 'Cancel the order', 'Reopen']);
    expect(items[1]!.hasAttribute('data-destructive')).toBe(true);
    expect(items[2]!.getAttribute('aria-disabled')).toBe('true');
    await user.click(items[1]!);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('takes a trigger of the page\'s own', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="Row actions" trigger={<button type="button" aria-label="Row actions">…</button>}>
        <MenuItem onSelect={() => undefined}>Print</MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Print' })).toBeTruthy();
  });
});

describe('the kit\'s table', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'left', label: 'Left', render: (row: { left: string }) => <strong>{row.left} kg</strong> },
    { key: 'note', label: 'Note' },
  ];
  const rows = [
    { id: 1, name: 'Flour', left: '12.500', note: null },
    { id: 2, name: 'Sugar', left: '3.000', note: 'Order more' },
  ];
  const width = (px: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: px, height: 10, top: 0, left: 0, right: px, bottom: 10, x: 0, y: 0, toJSON: () => ({}) });

  it('draws each row as a card while its box is narrower than the page says: a label and its value to a line', () => {
    width(390);
    const opened = vi.fn();
    const { container } = render(<DataTable columns={columns} rows={rows} cardsBelow={720} onRowClick={opened} />);
    expect(container.querySelector('[data-part="kit-table"]')!.getAttribute('data-layout')).toBe('cards');
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const first = within(cards[0]!);
    expect(first.getAllByRole('term').map((term) => term.textContent)).toEqual(['Name', 'Left', 'Note']);
    // A column's own render draws its value; an empty one reads as a dash, never as nothing.
    expect(first.getAllByRole('definition').map((value) => value.textContent)).toEqual(['Flour', '12.500 kg', '—']);
    // The row opens from its first line.
    first.getByRole('button', { name: 'Flour' }).click();
    expect(opened).toHaveBeenCalledExactlyOnceWith(rows[0]);
  });

  it('is the grid at the width it has room for, and whenever no width is named', () => {
    width(1200);
    const wide = render(<DataTable columns={columns} rows={rows} cardsBelow={720} />);
    expect(wide.container.querySelector('[data-part="kit-table"]')!.getAttribute('data-layout')).toBe('grid');
    expect(wide.container.querySelector('ul')).toBeNull();
    wide.unmount();
    width(390);
    const plain = render(<DataTable columns={columns} rows={rows} />);
    expect(plain.container.querySelector('[data-part="kit-table"]')).toBeNull();
    expect(plain.container.querySelector('ul')).toBeNull();
  });

  it('an empty table says so at any width', () => {
    width(390);
    render(<DataTable columns={columns} rows={[]} cardsBelow={720} empty={<p>Nothing counted yet</p>} />);
    expect(screen.getByText('Nothing counted yet')).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });
});
