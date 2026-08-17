// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * TRACK TABLES-CAL-BOARDS — the `boards` family M7 Wave-4 TAIL (annex §6):
 * board-card (now registered under its own annex id, no longer only a private
 * sub-component of kanban-board) and inline-compose-card.
 *
 * The generic properties every widget shares (four states, determinism,
 * config-fuzz, registry parity, chunk budget) are covered once for the whole
 * registry by the `qa/` harness. What is tested here is what only THIS slice
 * knows: the single-`record` projection + visible-field allow-list, the
 * composer's Enter/Escape machine and its whitespace guard, and the
 * annex-mandated INSERT-intent contract.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardCard, BoardCardWidget, boardCardOf } from './BoardCard.js';
import { InlineComposeCard, InlineComposeCardWidget } from './InlineComposeCard.js';
import {
  boardCardConfigSchema,
  boardCardDemoData,
  inlineComposeCardConfigSchema,
  inlineComposeCardDemoData,
} from './boards-config.js';
import { bindingSourceOf } from './board-lib.js';
import { boardsTrackDefinitions } from './boards-track.definitions.js';

afterEach(cleanup);

const parse = <T,>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T =>
  schema.parse(overrides);

const BOUND = {
  connectionId: 'c1',
  source: { schema: 'public', name: 'tasks' },
  shape: 'record-list',
};

// ── board-card ──────────────────────────────────────────────────────────────

describe('board-card projection (annex §6)', () => {
  it('projects the `record` envelope ({ row }) the host’s isEmpty predicate reads', () => {
    const card = boardCardOf(boardCardDemoData(7), parse(boardCardConfigSchema));
    expect(card).not.toBeNull();
    expect(card?.title).toBeTruthy();
  });

  it('returns null for a missing/!object row, so the widget empty-states', () => {
    const config = parse(boardCardConfigSchema);
    expect(boardCardOf(undefined, config)).toBeNull();
    expect(boardCardOf({ row: null }, config)).toBeNull();
    expect(boardCardOf({ row: [] }, config)).toBeNull();
  });

  it('also accepts a `data`-keyed envelope', () => {
    expect(boardCardOf({ data: { id: 'X-1', title: 'T' } }, parse(boardCardConfigSchema))?.title).toBe('T');
  });

  it('renders every slot when no allow-list is configured', () => {
    const card = boardCardOf(
      { row: { id: 'PRJ-1', title: 'T', tag: 'Feature', points: 5, client: 'Acme', pct: 40, owner: 'Ada Lovelace', due: '7/20' } },
      parse(boardCardConfigSchema),
    );
    expect(card?.tag).toBe('Feature');
    expect(card?.points).toBe(5);
    expect(card?.pct).toBe(40);
  });

  it('drops the fields the allow-list omits (annex "visible fields")', () => {
    const card = boardCardOf(
      { row: { id: 'PRJ-1', title: 'T', tag: 'Feature', points: 5, client: 'Acme', pct: 40, owner: 'Ada Lovelace', due: '7/20' } },
      parse(boardCardConfigSchema, { fields: ['tag', 'owner'] }),
    );
    expect(card?.tag).toBe('Feature');
    expect(card?.owner).toBe('Ada Lovelace');
    // Hiding a field drops the VALUE — the presentational card renders each slot
    // only when its value is defined, so there is one code path, not two.
    expect(card?.points).toBeUndefined();
    expect(card?.pct).toBeUndefined();
    expect(card?.client).toBeUndefined();
    expect(card?.due).toBeUndefined();
    expect(card?.id).toBe(''); // `id` is not in the allow-list
  });

  it('honours a titleField override for a differently-named schema', () => {
    const card = boardCardOf({ row: { id: 1, summary: 'From Jira' } }, parse(boardCardConfigSchema, { titleField: 'summary' }));
    expect(card?.title).toBe('From Jira');
  });

  it('hides the grip on a standalone card — it advertises no drag that exists', () => {
    const card = boardCardOf(boardCardDemoData(7), parse(boardCardConfigSchema));
    render(<BoardCard card={card!} showGrip={false} />);
    expect(document.querySelector('[data-part="board-card-grip"]')).toBeNull();
  });

  it('keeps the grip inside a board (the kanban callers’ default)', () => {
    const card = boardCardOf(boardCardDemoData(7), parse(boardCardConfigSchema));
    render(<BoardCard card={card!} />);
    expect(document.querySelector('[data-part="board-card-grip"]')).not.toBeNull();
  });

  it('empty-states rather than rendering a blank frame when unbound', () => {
    render(
      <BoardCardWidget
        config={parse(boardCardConfigSchema, { emptyState: { titleKey: 'No card' } })}
        data={undefined}
        instanceId="card-1"
        onEvent={vi.fn()}
      />
    );
    expect(screen.getByText('No card')).toBeTruthy();
  });

  it('emits a drill-through on linkTarget when clicked', () => {
    const onEvent = vi.fn();
    render(
      <BoardCardWidget
        config={parse(boardCardConfigSchema, { linkTarget: '/tasks/PRJ-1' })}
        data={{ row: { id: 'PRJ-1', title: 'Ship it' } }}
        instanceId="card-2"
        onEvent={onEvent}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/tasks/PRJ-1' });
  });

  it('renders inert (no dead button) with no link configured', () => {
    render(
      <BoardCardWidget
        config={parse(boardCardConfigSchema)}
        data={{ row: { id: 'PRJ-1', title: 'Ship it' } }}
        instanceId="card-3"
        onEvent={vi.fn()}
      />
    );
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });
});

// ── inline-compose-card ─────────────────────────────────────────────────────

describe('inline-compose-card (annex §6)', () => {
  it('starts behind the add affordance, and opens on click', () => {
    render(<InlineComposeCard />);
    expect(document.querySelector('[data-part="compose-open"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-part="compose-open"]') as HTMLElement);
    expect(document.querySelector('[data-part="compose-card"]')).not.toBeNull();
  });

  it('starts expanded in a dedicated compose slot', () => {
    render(<InlineComposeCard defaultOpen />);
    expect(document.querySelector('[data-part="compose-card"]')).not.toBeNull();
  });

  it('commits on Enter (annex "Enter/Escape handling")', () => {
    const onAdd = vi.fn();
    render(<InlineComposeCard defaultOpen onAdd={onAdd} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New card' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('New card');
  });

  it('cancels on Escape, clearing the draft', () => {
    const onCancel = vi.fn();
    render(<InlineComposeCard defaultOpen onCancel={onCancel} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Half typed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-part="compose-card"]')).toBeNull();
  });

  it('refuses a whitespace-only draft — that is not a card', () => {
    const onAdd = vi.fn();
    render(<InlineComposeCard defaultOpen onAdd={onAdd} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('trims the committed title', () => {
    const onAdd = vi.fn();
    render(<InlineComposeCard defaultOpen onAdd={onAdd} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Padded  ' } });
    fireEvent.click(document.querySelector('[data-part="compose-add"]') as HTMLElement);
    expect(onAdd).toHaveBeenCalledWith('Padded');
  });

  it('disables Add while the draft is empty', () => {
    render(<InlineComposeCard defaultOpen />);
    expect((document.querySelector('[data-part="compose-add"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays open after adding for rapid entry (keepOpen, the default)', () => {
    render(<InlineComposeCard defaultOpen onAdd={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'One' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(document.querySelector('[data-part="compose-card"]')).not.toBeNull();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('closes after adding when keepOpen is off', () => {
    render(<InlineComposeCard defaultOpen keepOpen={false} onAdd={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'One' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(document.querySelector('[data-part="compose-card"]')).toBeNull();
  });

  it('stops Enter/Escape propagating — the column’s drag handler must not see them', () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <InlineComposeCard defaultOpen onAdd={vi.fn()} />
      </div>
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('lets other keys through untouched', () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <InlineComposeCard defaultOpen />
      </div>
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('emits an INSERT intent with the column defaults — it never writes', () => {
    const onEvent = vi.fn();
    render(
      <InlineComposeCardWidget
        config={parse(inlineComposeCardConfigSchema, {
          binding: BOUND,
          defaults: { status: 'todo', points: 1 },
        })}
        data={undefined}
        instanceId="compose-1"
        onEvent={onEvent}
      />
    );
    fireEvent.click(document.querySelector('[data-part="compose-open"]') as HTMLElement);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New card' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'insert',
      connectionId: 'c1',
      table: 'public.tasks',
      values: { status: 'todo', points: 1, title: 'New card' },
    });
  });

  it('never lets a stale defaults.title clobber what the user typed', () => {
    const onEvent = vi.fn();
    render(
      <InlineComposeCardWidget
        config={parse(inlineComposeCardConfigSchema, { binding: BOUND, defaults: { title: 'STALE' } })}
        data={undefined}
        instanceId="compose-2"
        onEvent={onEvent}
      />
    );
    fireEvent.click(document.querySelector('[data-part="compose-open"]') as HTMLElement);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ values: { title: 'Typed' } }));
  });

  it('routes the draft into a configured titleField', () => {
    const onEvent = vi.fn();
    render(
      <InlineComposeCardWidget
        config={parse(inlineComposeCardConfigSchema, { binding: BOUND, titleField: 'summary' })}
        data={undefined}
        instanceId="compose-3"
        onEvent={onEvent}
      />
    );
    fireEvent.click(document.querySelector('[data-part="compose-open"]') as HTMLElement);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Jira-shaped' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ values: { summary: 'Jira-shaped' } }));
  });

  it('emits nothing when unbound — no table to insert into', () => {
    const onEvent = vi.fn();
    render(
      <InlineComposeCardWidget
        config={parse(inlineComposeCardConfigSchema)}
        data={undefined}
        instanceId="compose-4"
        onEvent={onEvent}
      />
    );
    fireEvent.click(document.querySelector('[data-part="compose-open"]') as HTMLElement);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New card' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('rejects a non-primitive default at the schema boundary (no smuggled objects)', () => {
    // A stored config must never be able to slip a nested object into an INSERT.
    expect(inlineComposeCardConfigSchema.safeParse({ defaults: { nested: { a: 1 } } }).success).toBe(false);
    expect(inlineComposeCardConfigSchema.safeParse({ defaults: { s: 'a', n: 1, b: true, z: null } }).success).toBe(true);
  });

  it('threads its seed through the demo draft', () => {
    expect(JSON.stringify(inlineComposeCardDemoData(1))).not.toBe(JSON.stringify(inlineComposeCardDemoData(9)));
  });
});

// ── binding descriptor ──────────────────────────────────────────────────────

describe('binding source (04 §5.1)', () => {
  it('qualifies the table from binding.source.name (+ schema), not a flat binding.table', () => {
    expect(bindingSourceOf({ connectionId: 'c1', source: { schema: 'public', name: 'tasks' } })).toEqual({
      connectionId: 'c1',
      table: 'public.tasks',
    });
    expect(bindingSourceOf({ connectionId: 'c1', source: { name: 'tasks' } })).toEqual({
      connectionId: 'c1',
      table: 'tasks',
    });
  });

  it('returns null when unbound', () => {
    expect(bindingSourceOf(undefined)).toBeNull();
  });
});

// ── definitions ─────────────────────────────────────────────────────────────

describe('boards definitions (annex §6)', () => {
  it('registers all four §6 ids — the family is complete', () => {
    expect(boardsTrackDefinitions.map((d) => d.id).sort()).toEqual([
      'board-card',
      'inline-compose-card',
      'kanban-board',
      'kanban-swimlane-grid',
    ]);
  });

  it('declares board-card a single `record`, placed inline as a board child', () => {
    const card = boardsTrackDefinitions.find((d) => d.id === 'board-card');
    expect(card?.dataContract).toBe('record');
    expect(card?.placement).toBe('inline');
  });

  it('declares inline-compose-card a form-state draft that edits data', () => {
    const compose = boardsTrackDefinitions.find((d) => d.id === 'inline-compose-card');
    expect(compose?.dataContract).toBe('form-state');
    expect(compose?.capabilities?.editsData).toBe(true);
  });

  it('fits page-board.json’s 4×4 `compose` slot', () => {
    const sizing = boardsTrackDefinitions.find((d) => d.id === 'inline-compose-card')?.sizing;
    expect(sizing?.minW).toBeLessThanOrEqual(4);
    expect(sizing?.minH).toBeLessThanOrEqual(4);
  });
});
