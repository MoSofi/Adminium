import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Eyebrow, Label } from './Label.js';

describe('Label', () => {
  it('renders a <label> associated with a control via htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <input id="email" />
      </>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.tagName).toBe('INPUT');
  });

  it('applies the 12px/600 field-label classes', () => {
    render(<Label>Name</Label>);
    const label = screen.getByText('Name');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toContain('text-[12px]');
    expect(label.className).toContain('font-semibold');
    expect(label.className).toContain('text-fg');
  });

  it('merges the consumer className', () => {
    render(<Label className="text-fg-muted">Hint</Label>);
    const label = screen.getByText('Hint');
    expect(label.className).toContain('text-fg-muted');
    expect(label.className).not.toMatch(/(^|\s)text-fg(\s|$)/);
  });
});

describe('Eyebrow', () => {
  it('renders an uppercase micro-label on fg-subtle', () => {
    render(<Eyebrow>Navigation</Eyebrow>);
    const eyebrow = screen.getByText('Navigation');
    expect(eyebrow.tagName).toBe('SPAN');
    expect(eyebrow.className).toContain('uppercase');
    expect(eyebrow.className).toContain('text-micro');
    expect(eyebrow.className).toContain('text-fg-subtle');
  });
});
