import { cleanup, render, screen } from '@testing-library/react';
import { Database } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { IconTile, toneSoftClasses } from './IconTile.js';

afterEach(cleanup);

describe('IconTile', () => {
  it('renders the icon inside a tinted tile', () => {
    const { container } = render(<IconTile icon={<Database data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeDefined();
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.dataset['tone']).toBe('accent');
  });

  it('is decorative (aria-hidden) when no label is given', () => {
    const { container } = render(<IconTile icon={<Database />} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.getAttribute('role')).toBeNull();
  });

  it('exposes role="img" with the accessible name when label is given', () => {
    render(<IconTile icon={<Database />} label="Database source" />);
    expect(screen.getByRole('img', { name: 'Database source' })).toBeDefined();
  });

  it.each(['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const)(
    'applies the %s tone-soft classes',
    (tone) => {
      const { container } = render(<IconTile tone={tone} icon={<Database />} />);
      const tile = container.firstElementChild as HTMLElement;
      for (const cls of toneSoftClasses[tone].split(' ')) {
        expect(tile.classList.contains(cls)).toBe(true);
      }
      expect(tile.dataset['tone']).toBe(tone);
    },
  );

  it('merges consumer className last', () => {
    const { container } = render(<IconTile icon={<Database />} className="size-11" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.classList.contains('size-11')).toBe(true);
    expect(tile.classList.contains('size-9')).toBe(false);
  });
});
