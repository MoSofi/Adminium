import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MonoText } from './MonoText.js';

describe('MonoText', () => {
  it('renders a span with mono + tabular-nums classes', () => {
    render(<MonoText>1234</MonoText>);
    const el = screen.getByText('1234');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('tabular-nums');
  });

  it('merges the consumer className', () => {
    render(<MonoText className="text-fg-muted">id_1</MonoText>);
    const el = screen.getByText('id_1');
    expect(el.className).toContain('text-fg-muted');
    expect(el.className).toContain('font-mono');
  });

  it('supports asChild polymorphism', () => {
    render(
      <MonoText asChild>
        <code>SELECT 1</code>
      </MonoText>,
    );
    const el = screen.getByText('SELECT 1');
    expect(el.tagName).toBe('CODE');
    expect(el.className).toContain('tabular-nums');
  });
});
