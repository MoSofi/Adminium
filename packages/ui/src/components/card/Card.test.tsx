// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card, CardBody, CardFooter, CardHeader } from './Card.js';

afterEach(cleanup);

describe('Card', () => {
  it('renders children on a surface with border, radius 14 and card shadow', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.textContent).toBe('Content');
    for (const cls of ['bg-surface', 'border-border', 'rounded-lg', 'shadow-card']) {
      expect(card.classList.contains(cls)).toBe(true);
    }
  });

  it('applies density padding by default and removes it with padded={false}', () => {
    const { container } = render(
      <>
        <Card data-testid="padded">a</Card>
        <Card data-testid="unpadded" padded={false}>
          b
        </Card>
      </>,
    );
    expect(screen.getByTestId('padded').classList.contains('p-[var(--card-pad)]')).toBe(true);
    expect(screen.getByTestId('unpadded').classList.contains('p-[var(--card-pad)]')).toBe(false);
    void container;
  });

  it('adds the nb-lift hover class when hoverable', () => {
    const { container } = render(<Card hoverable>a</Card>);
    expect((container.firstElementChild as HTMLElement).classList.contains('nb-lift')).toBe(true);
  });

  it('marks the selected state with accent border, ring and data-selected', () => {
    const { container } = render(<Card selected>a</Card>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.hasAttribute('data-selected')).toBe(true);
    for (const cls of ['border-accent', 'ring-[3px]', 'ring-accent-soft']) {
      expect(card.classList.contains(cls)).toBe(true);
    }
  });

  it('renders as its child with asChild (card-as-link)', () => {
    render(
      <Card asChild>
        <a href="/records/1">Open record</a>
      </Card>,
    );
    const link = screen.getByRole('link', { name: 'Open record' });
    expect(link.classList.contains('bg-surface')).toBe(true);
  });

  it('renders header/body/footer slots with the footer on surface-2', () => {
    render(
      <Card padded={false}>
        <CardHeader data-testid="header">H</CardHeader>
        <CardBody data-testid="body">B</CardBody>
        <CardFooter data-testid="footer">F</CardFooter>
      </Card>,
    );
    expect(screen.getByTestId('header').classList.contains('border-b')).toBe(true);
    expect(screen.getByTestId('body').classList.contains('p-[var(--card-pad)]')).toBe(true);
    expect(screen.getByTestId('footer').classList.contains('bg-surface-2')).toBe(true);
  });
});
