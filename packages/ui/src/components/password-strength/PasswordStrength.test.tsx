import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PasswordStrength, defaultPasswordScore } from './PasswordStrength.js';

afterEach(cleanup);

const LABELS = ['Weak', 'Fair', 'Good', 'Strong'] as const;

describe('defaultPasswordScore', () => {
  it('scores by length, case mix, digits and symbols', () => {
    expect(defaultPasswordScore('')).toBe(0);
    expect(defaultPasswordScore('abc')).toBe(1);
    expect(defaultPasswordScore('abcdefgh')).toBe(1);
    expect(defaultPasswordScore('Abcdefgh')).toBe(2);
    expect(defaultPasswordScore('Abcdefg1')).toBe(3);
    expect(defaultPasswordScore('Abcdef1!')).toBe(4);
  });
});

describe('PasswordStrength', () => {
  it('exposes meter semantics and fills segments per score', () => {
    const { container } = render(
      <PasswordStrength value="Abcdefg1" label="Password strength" labels={LABELS} />,
    );
    const meter = screen.getByRole('meter', { name: 'Password strength' });
    expect(meter.getAttribute('aria-valuenow')).toBe('3');
    expect(meter.getAttribute('aria-valuetext')).toBe('Good');
    expect(container.querySelectorAll('[data-filled]')).toHaveLength(3);
    expect(screen.getByText('Good')).toBeDefined();
  });

  it('renders empty for an empty password', () => {
    const { container } = render(
      <PasswordStrength value="" label="Password strength" labels={LABELS} />,
    );
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelectorAll('[data-filled]')).toHaveLength(0);
  });

  it('accepts an injected scoring function', () => {
    render(
      <PasswordStrength value="whatever" score={() => 4} label="Password strength" labels={LABELS} />,
    );
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('4');
    expect(screen.getByText('Strong')).toBeDefined();
  });
});
