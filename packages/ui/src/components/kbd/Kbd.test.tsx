// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Kbd } from './Kbd.js';

describe('Kbd', () => {
  it('renders a <kbd> element', () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText('⌘K').tagName).toBe('KBD');
  });

  it('applies the keycap recipe: mono font, 1px border + 2px bottom, radius 6', () => {
    render(<Kbd>Esc</Kbd>);
    const el = screen.getByText('Esc');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('border-b-2');
    expect(el.className).toContain('border-border-strong');
    expect(el.className).toContain('rounded-sm');
    expect(el.className).toContain('bg-surface-2');
  });

  it('merges the consumer className', () => {
    render(<Kbd className="ms-1">A</Kbd>);
    expect(screen.getByText('A').className).toContain('ms-1');
  });
});
