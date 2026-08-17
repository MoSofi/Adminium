// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthLayout, AuthTestimonial } from './AuthLayout.js';

afterEach(cleanup);

describe('AuthLayout', () => {
  it('renders the form column content inside a main landmark', () => {
    render(
      <AuthLayout>
        <div data-testid="form">form</div>
      </AuthLayout>,
    );
    expect(screen.getByRole('main').querySelector('[data-testid="form"]')).not.toBeNull();
  });

  it('split variant renders the decorative brand panel with all slots', () => {
    const { container } = render(
      <AuthLayout
        logo={<span data-testid="logo">Adminium</span>}
        headline="Turn any database into a dashboard."
        description="Connect Postgres."
        testimonial={<AuthTestimonial quote="Great." name="Dana K" role="Northwind" />}
        trustBadges={<span>SOC 2 Type II</span>}
      >
        <div>form</div>
      </AuthLayout>,
    );
    const panel = container.querySelector('[data-part="auth-brand-panel"]');
    expect(panel).not.toBeNull();
    // Decorative: hidden from the accessibility tree.
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(panel?.textContent).toContain('Turn any database into a dashboard.');
    expect(panel?.textContent).toContain('SOC 2 Type II');
    expect(container.querySelector('[data-part="auth-testimonial"]')?.textContent).toContain(
      'Dana K · Northwind',
    );
  });

  it('single variant renders no brand panel', () => {
    const { container } = render(
      <AuthLayout variant="single" headline="unused">
        <div>form</div>
      </AuthLayout>,
    );
    expect(container.querySelector('[data-part="auth-brand-panel"]')).toBeNull();
  });

  it('renders footer and corner slots on the form side', () => {
    const { container } = render(
      <AuthLayout
        variant="single"
        corner={<button type="button">theme</button>}
        footer="Protected by enterprise-grade encryption"
      >
        <div>form</div>
      </AuthLayout>,
    );
    expect(screen.getByRole('button', { name: 'theme' })).toBeDefined();
    expect(container.querySelector('[data-part="auth-footer"]')?.textContent).toContain(
      'Protected by enterprise-grade encryption',
    );
  });
});
