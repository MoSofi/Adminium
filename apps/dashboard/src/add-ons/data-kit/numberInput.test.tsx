// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A decimal figure is text from the row to the field and back: three
 * decimals for a quantity, four for a unit cost, none for a count of packs —
 * and never a JS number on the way.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { NumberInput, decimalText, settledDecimal, type NumberInputProps } from './fields.js';

function Held(props: Omit<NumberInputProps, 'value' | 'onChange'> & { start?: string; seen: string[] }): ReactNode {
  const { start = '', seen, ...rest } = props;
  const [value, setValue] = useState(start);
  return (
    <NumberInput
      {...rest}
      value={value}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

describe('what a decimal field keeps of what is typed', () => {
  it('three decimals in, text out', () => {
    expect(decimalText('12.375', { decimals: 3 })).toBe('12.375');
    expect(decimalText('12.3756', { decimals: 3 })).toBeNull();
    expect(decimalText('0.1', { decimals: 3 })).toBe('0.1');
    // Never a number: what was typed is what is kept, digit for digit.
    expect(decimalText('0.30000000000000004', { decimals: 3 })).toBeNull();
    expect(decimalText('007.50', { decimals: 3 })).toBe('007.50');
  });

  it('four decimals for a cost, and no more', () => {
    expect(decimalText('1.2345', { decimals: 4 })).toBe('1.2345');
    expect(decimalText('1.23456', { decimals: 4 })).toBeNull();
    expect(decimalText('1.23456', { decimals: 9 })).toBeNull();
  });

  it('whole refuses a point, whatever decimals says', () => {
    expect(decimalText('12', { whole: true })).toBe('12');
    expect(decimalText('12.', { whole: true })).toBeNull();
    expect(decimalText('12.5', { whole: true, decimals: 3 })).toBeNull();
    expect(decimalText('12.5')).toBeNull();
  });

  it('a comma is the point; letters, a second point and a sign nobody asked for are refused', () => {
    expect(decimalText('1,5', { decimals: 2 })).toBe('1.5');
    expect(decimalText(' 1 000 ', { decimals: 2 })).toBe('1000');
    expect(decimalText('1.5.2', { decimals: 3 })).toBeNull();
    expect(decimalText('1e3', { decimals: 3 })).toBeNull();
    expect(decimalText('-2', { decimals: 3 })).toBeNull();
    expect(decimalText('-2.5', { decimals: 3, negative: true })).toBe('-2.5');
    expect(decimalText('', { decimals: 3 })).toBe('');
  });

  it('settles what is left half typed when the field is left', () => {
    expect(settledDecimal('12.')).toBe('12');
    expect(settledDecimal('.5')).toBe('0.5');
    expect(settledDecimal('-.5')).toBe('-0.5');
    expect(settledDecimal('.')).toBe('');
    expect(settledDecimal('-')).toBe('');
    expect(settledDecimal('1.50')).toBe('1.50');
  });
});

describe('the number field', () => {
  it('takes a figure key by key and refuses the key that would make it none', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Held seen={seen} decimals={3} label="Quantity" unit="kg" />);
    const field = screen.getByLabelText('Quantity') as HTMLInputElement;
    await user.type(field, '1.2x345');
    expect(field.value).toBe('1.234');
    expect(seen).toEqual(['1', '1.', '1.2', '1.23', '1.234']);
    expect(screen.getByText('kg')).toBeTruthy();
    expect(field.getAttribute('inputmode')).toBe('decimal');
    expect(field.type).toBe('text');
  });

  it('a count of packs takes no point', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Held seen={seen} whole aria-label="Packs" />);
    const field = screen.getByLabelText('Packs') as HTMLInputElement;
    await user.type(field, '3.5');
    expect(field.value).toBe('35');
    expect(field.getAttribute('inputmode')).toBe('numeric');
  });

  it('settles a half-typed figure when it is left, and says an error on the field', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Held seen={seen} decimals={2} label="Cost" error="Too much" start="" />);
    const field = screen.getByLabelText('Cost') as HTMLInputElement;
    await user.type(field, '.5');
    await user.tab();
    expect(field.value).toBe('0.5');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Too much')).toBeTruthy();
  });
});
