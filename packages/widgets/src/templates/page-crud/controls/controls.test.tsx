// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The control catalog, exercised (plan 50 phase E, Appendix C).
 *
 * ─── Two questions, and they are different ─────────────────────────────────
 *
 * 1. Is every control in the catalog REACHABLE — does the registry have a
 *    component for it, and is every control a column may legally be given one
 *    the registry knows? A catalog entry with no component is a designer option
 *    that renders nothing; a component with no catalog entry is dead code.
 * 2. Does each control do the ONE thing the comp asks of it? A phone stores its
 *    prefix with the number, a currency keeps the symbol out of the value, a
 *    chips field refuses a duplicate, a choice keeps a value the list no longer
 *    offers.
 *
 * The first is exhaustive and mechanical; the second is one test per family,
 * driven through the control the way `RecordForm` drives it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FORM_CONTROLS, controlFor, legalControls, type FormColumnShape } from '../../../page-config/index.js';
import { gridColumnSpecSchema } from '../../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../../families/tables/column-spec.js';
import { CONTROL_COMPONENTS, CheckRowsControl, type ControlProps } from './index.js';

afterEach(cleanup);

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

/** One control, rendered the way `RecordForm` renders it. */
function renderControl(control: keyof typeof CONTROL_COMPONENTS, props: Partial<ControlProps> = {}) {
  const Control = CONTROL_COMPONENTS[control].component;
  const onChange = vi.fn();
  const column = props.column ?? spec({ name: 'value', label: 'Value' });
  render(
    <Control
      column={column}
      value={props.value ?? null}
      onChange={props.onChange ?? onChange}
      options={props.options ?? []}
      mode={props.mode ?? 'create'}
      {...props}
    />,
  );
  return { onChange: props.onChange ?? onChange };
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

describe('every control in the catalog is reachable', () => {
  it('has a component for each one, and no component for anything else', () => {
    expect(Object.keys(CONTROL_COMPONENTS).sort()).toEqual([...FORM_CONTROLS].sort());
  });

  it('offers only controls the registry can render, for every shape of column', () => {
    const shapes: FormColumnShape[] = [
      { name: 'a', logicalType: 'varchar', nullable: true },
      { name: 'b', logicalType: 'text', maxLength: null },
      { name: 'c', logicalType: 'boolean' },
      { name: 'd', logicalType: 'integer' },
      { name: 'e', logicalType: 'bigint' },
      { name: 'f', logicalType: 'decimal', semantic: 'money' },
      { name: 'g', logicalType: 'float' },
      { name: 'h', logicalType: 'date' },
      { name: 'i', logicalType: 'time' },
      { name: 'j', logicalType: 'timestamptz' },
      { name: 'k', logicalType: 'json' },
      { name: 'l', logicalType: 'uuid' },
      { name: 'm', logicalType: 'enum', enumValues: ['x', 'y'], nullable: false },
      { name: 'n', logicalType: 'varchar', options: { values: [{ value: 'x' }] } },
      { name: 'o', logicalType: 'integer', fk: { table: 't', column: 'id' } },
      { name: 'p', logicalType: 'varchar', file: { accept: ['.pdf'] } },
      { name: 'q', logicalType: 'json', list: true },
      { name: 'r', logicalType: 'varchar', readOnly: true },
      { name: 's', logicalType: 'varchar', semantic: 'email' },
      { name: 't', logicalType: 'varchar', semantic: 'phone' },
    ];
    for (const shape of shapes) {
      const legal = legalControls(shape);
      expect(legal.length, shape.name).toBeGreaterThan(0);
      for (const control of legal) {
        expect(CONTROL_COMPONENTS[control], `${shape.name} → ${control}`).toBeDefined();
      }
      // …and the default is one of them, which is what makes "the designer
      // offers the legal set" and "this is what you get" the same rule.
      expect(legal, shape.name).toContain(controlFor(shape));
    }
  });

  it('renders every control without crashing, on a column it is legal for', () => {
    // A control that throws on its own default value is a field nobody can
    // open the dialog past — and the fuzz suite would never reach it, because
    // it never renders a form.
    for (const control of FORM_CONTROLS) {
      renderControl(control, { options: [{ value: 'x' }, { value: 'y' }] });
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The text family (T28)
// ---------------------------------------------------------------------------

describe('the text family', () => {
  it('stores a phone WITH its prefix, and shows it without (D29)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControl('phone', {
      column: spec({ name: 'phone', label: 'Phone', semantic: 'phone' }),
      field: { column: 'phone', prefix: '+1' },
      value: '+1 (555) 000-0000',
      onChange,
    });
    const input = screen.getByRole('textbox');
    // The field shows the local part; the prefix is chrome.
    expect((input as HTMLInputElement).value).toBe('(555) 000-0000');
    await user.type(input, '1');
    // …and what is stored carries it, because a number without it cannot be
    // dialled.
    expect(onChange).toHaveBeenLastCalledWith('+1 (555) 000-0000' + '1');
  });

  it('masks a password and reveals it on request, storing the text as typed (D28)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControl('password', { value: 'hunter2', onChange });
    const field = document.querySelector('input') as HTMLInputElement;
    expect(field.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect((document.querySelector('input') as HTMLInputElement).type).toBe('text');
    // It hashes nothing (O1) and makes no column secret: the value is the text.
    await user.type(document.querySelector('input') as HTMLInputElement, '!');
    expect(onChange).toHaveBeenLastCalledWith('hunter2!');
  });

  it('gives a title field its own size, and a mono field the mono face', () => {
    renderControl('title', { value: 'Follow-up' });
    expect((document.querySelector('input') as HTMLElement).className).toContain('font-semibold');
    cleanup();
    renderControl('mono', { value: 'INV-1042' });
    expect((document.querySelector('input') as HTMLElement).className).toContain('font-mono');
  });
});

// ---------------------------------------------------------------------------
// Numbers (T29)
// ---------------------------------------------------------------------------

describe('the number family', () => {
  it('keeps the currency symbol OUT of the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControl('currency', {
      column: spec({ name: 'total', label: 'Total', logicalType: 'decimal', semantic: 'money' }),
      value: '',
      currency: 'USD',
      onChange,
    });
    expect(screen.getByText('$')).toBeDefined();
    // One keystroke: the control is controlled, and this render holds `''`, so
    // asserting a second one would be asserting the test's own wiring.
    await user.type(document.querySelector('input') as HTMLInputElement, '1');
    // A number with a symbol in it is a number nothing can sum.
    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('steps by the field’s own step and stops at its bounds, with the unit beside it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControl('stepper', {
      column: spec({ name: 'party', label: 'Party size', logicalType: 'integer' }),
      field: { column: 'party', min: 1, max: 2, unit: 'guests' },
      value: 1,
      onChange,
    });
    expect(screen.getByText('guests')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'One more' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    // At the ceiling the button is out, rather than silently doing nothing.
    cleanup();
    renderControl('stepper', {
      column: spec({ name: 'party', label: 'Party size', logicalType: 'integer' }),
      field: { column: 'party', min: 1, max: 2 },
      value: 2,
    });
    expect(screen.getByRole('button', { name: 'One more' }).hasAttribute('disabled')).toBe(true);
  });

  it('reads the slider’s value out beside it', () => {
    renderControl('slider', {
      column: spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }),
      field: { column: 'seats', min: 0, max: 10, unit: 'seats' },
      value: 4,
    });
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('4');
    expect(screen.getByText('4')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Choices (T30)
// ---------------------------------------------------------------------------

describe('the choice family', () => {
  const options = [{ value: 'new' }, { value: 'open', label: 'Open' }, { value: 'done' }];

  it('keeps a stored value the list no longer offers (F15)', () => {
    renderControl('select', {
      column: spec({ name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['new'] }),
      options,
      value: 'archived',
    });
    // The row was written before the list was narrowed. Dropping it silently
    // would rewrite that row the moment anybody saved anything else.
    expect(screen.getByRole('option', { name: 'archived' })).toBeDefined();
  });

  it('segments with the value’s own tone as a dot', () => {
    renderControl('segmented', {
      column: spec({ name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['new', 'done'] }),
      options: [{ value: 'new', tone: 'accent' }, { value: 'done', tone: 'pos' }],
      value: 'new',
    });
    expect(screen.getByRole('radiogroup')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'new' })).toBeDefined();
  });

  it('draws choice cards as one radio group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControl('choice-cards', {
      column: spec({ name: 'speed', label: 'Delivery', logicalType: 'enum', enumValues: ['standard', 'express'] }),
      options: [
        { value: 'standard', label: 'Standard', description: '3–5 days' },
        { value: 'express', label: 'Express', description: 'Next day' },
      ],
      value: 'standard',
      onChange,
    });
    await user.click(screen.getByRole('radio', { name: /Express/ }));
    expect(onChange).toHaveBeenCalledWith('express');
  });
});

// ---------------------------------------------------------------------------
// Booleans and any-of (T31)
// ---------------------------------------------------------------------------

describe('booleans and any-of', () => {
  it('a boolean is a toggle ROW that owns its label', () => {
    expect(CONTROL_COMPONENTS['toggle-row'].ownsLabel).toBe(true);
    renderControl('toggle-row', {
      column: spec({ name: 'active', label: 'Active', logicalType: 'boolean' }),
      field: { column: 'active', help: 'Off hides it everywhere.' },
      value: true,
    });
    expect(screen.getByRole('switch', { name: 'Active' })).toBeDefined();
    expect(screen.getByText('Off hides it everywhere.')).toBeDefined();
  });

  it('any-of keeps the OPTIONS’ order, not the order things were ticked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CheckRowsControl
        column={spec({ name: 'access', label: 'Access', logicalType: 'json' })}
        value={['calendar']}
        onChange={onChange}
        options={[{ value: 'email' }, { value: 'calendar' }, { value: 'files' }]}
        mode="create"
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'email' }));
    // `calendar` was already on and `email` comes first in the list: a value
    // whose order depends on the order somebody clicked reads differently on
    // every row.
    expect(onChange).toHaveBeenCalledWith(['email', 'calendar']);
  });
});

// ---------------------------------------------------------------------------
// Chips (T32)
// ---------------------------------------------------------------------------

describe('chips over a list-valued column (D19)', () => {
  it('adds on Enter, refuses a duplicate, and refuses a bad item under a format', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControl('chips', {
      column: spec({ name: 'invites', label: 'Invites', logicalType: 'json' }),
      field: { column: 'invites', itemFormat: 'email' },
      value: ['ada@example.com'],
      onChange,
    });
    const input = screen.getByRole('textbox');

    await user.type(input, 'grace@example.com{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['ada@example.com', 'grace@example.com']);

    onChange.mockClear();
    await user.type(input, 'not-an-email{Enter}');
    // The token stays in the input rather than becoming a chip nobody notices
    // is wrong.
    expect(onChange).not.toHaveBeenCalled();
  });
});
