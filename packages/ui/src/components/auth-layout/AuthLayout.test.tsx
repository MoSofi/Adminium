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

  it('paints the brand panel from --accent-light, not the theme-resolved --accent', () => {
    // THE BUG THIS PINS, and the reason it survived four weeks of a11y work: the
    // panel is `aria-hidden`, so the axe sweep skips the whole subtree — a
    // violation the gate cannot see reads exactly like one that does not exist.
    // `--accent` resolves to the DARK ramp under `data-theme="dark"`, and that
    // ramp is a FOREGROUND colour: it is light. Painted as a full-bleed panel
    // with white copy on it, the eight accents measured 1.64-2.35:1.
    // `--accent-light` is the same variable in both themes, so the panel is one
    // fixed dark brand surface (5.90-18.88:1) that still follows `data-accent`.
    const { container } = render(
      <AuthLayout headline="Turn any database into a dashboard.">
        <div>form</div>
      </AuthLayout>,
    );
    const panel = container.querySelector('[data-part="auth-brand-panel"]');
    const className = panel?.getAttribute('class') ?? '';
    expect(className).toContain('var(--accent-light)');
    expect(className).not.toMatch(/var\(--accent\)/);
  });

  it('uses the white alphas the token contrast gate measures', () => {
    // `packages/tokens/scripts/contrast-check.mjs`'s `brand-panel` group gates
    // these exact alphas against `--accent-light`. It cannot read this file, so
    // dropping one here without changing it there would pass both — this is the
    // join. Alphas: description/badges/quote 90%, attribution 75%, on a
    // `black/15` card. Lowering any of them fails AA on at least one accent.
    const { container } = render(
      <AuthLayout
        headline="h"
        description="d"
        trustBadges={<span>SOC 2</span>}
        testimonial={<AuthTestimonial quote="q" name="n" role="r" />}
      >
        <div>form</div>
      </AuthLayout>,
    );
    const panel = container.querySelector('[data-part="auth-brand-panel"]');
    const markup = panel?.innerHTML ?? '';
    expect(markup).toContain('text-white/90');
    expect(markup).toContain('text-white/75');
    // The alphas the gate measured as failing.
    expect(markup).not.toContain('text-white/60');
    expect(markup).not.toContain('text-white/80');
    // A translucent DARK card, not a light one: white/10 lightened the accent
    // and left the attribution line at 2.8:1.
    expect(markup).toContain('bg-black/15');
    expect(markup).not.toContain('bg-white/10');
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
