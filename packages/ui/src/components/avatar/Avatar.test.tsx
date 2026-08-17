// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AVATAR_GRADIENTS,
  Avatar,
  avatarGradientClasses,
  avatarGradientIndex,
  getInitials,
} from './Avatar.js';

afterEach(cleanup);

describe('getInitials', () => {
  it('takes the first grapheme of the first and last words, uppercased', () => {
    expect(getInitials('Ava Reyes')).toBe('AR');
    expect(getInitials('omar el farouk')).toBe('OF');
    expect(getInitials('Cher')).toBe('C');
    expect(getInitials('  padded   name  ')).toBe('PN');
    expect(getInitials('')).toBe('');
  });
});

describe('avatarGradientIndex', () => {
  it('is deterministic and within the 5 fixed gradients', () => {
    expect(AVATAR_GRADIENTS).toHaveLength(5);
    for (const initials of ['AR', 'OF', 'LC', 'NP', 'MH', 'ZQ']) {
      const idx = avatarGradientIndex(initials);
      expect(idx).toBe(avatarGradientIndex(initials));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(5);
    }
    // frozen hash regression pins (31-multiply over char codes):
    expect(avatarGradientIndex('AR')).toBe((('A'.charCodeAt(0) * 31 + 'R'.charCodeAt(0)) >>> 0) % 5);
  });
});

describe('Avatar', () => {
  it('renders initials with the deterministic gradient class and accessible name', () => {
    render(<Avatar name="Ava Reyes" />);
    const avatar = screen.getByRole('img', { name: 'Ava Reyes' });
    expect(avatar.textContent).toBe('AR');
    const expected = avatarGradientClasses[avatarGradientIndex('AR')] as string;
    expect(avatar.classList.contains(expected)).toBe(true);
  });

  it('renders the same gradient for the same name across renders', () => {
    const a = render(<Avatar name="Lina Chen" data-testid="a" />);
    const first = screen.getByTestId('a').dataset['gradient'];
    a.unmount();
    render(<Avatar name="Lina Chen" data-testid="b" />);
    expect(screen.getByTestId('b').dataset['gradient']).toBe(first);
  });

  it('shows the image when src is given and falls back to initials on error', () => {
    render(<Avatar name="Ava Reyes" src="https://example.test/ava.png" />);
    const avatar = screen.getByRole('img', { name: 'Ava Reyes' });
    const img = avatar.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent).toBe('AR');
  });

  it('renders circle by default and per-size radius for square', () => {
    const { container } = render(
      <>
        <Avatar name="Ava Reyes" data-testid="circle" />
        <Avatar name="Ava Reyes" shape="square" size="lg" data-testid="square" />
      </>,
    );
    expect(screen.getByTestId('circle').classList.contains('rounded-full')).toBe(true);
    expect(screen.getByTestId('square').classList.contains('rounded-[10px]')).toBe(true);
    void container;
  });

  it('renders a presence dot only when presence is set', () => {
    render(<Avatar name="Ava Reyes" presence="pos" />);
    const dot = screen.getByTestId('avatar-presence');
    expect(dot.classList.contains('bg-pos')).toBe(true);
    expect(dot.classList.contains('ring-surface')).toBe(true);
    cleanup();
    render(<Avatar name="Ava Reyes" />);
    expect(screen.queryByTestId('avatar-presence')).toBeNull();
  });

  it('prefers the explicit label over the name for the accessible name', () => {
    render(<Avatar name="Ava Reyes" label="Account owner" />);
    expect(screen.getByRole('img', { name: 'Account owner' })).toBeDefined();
  });
});
