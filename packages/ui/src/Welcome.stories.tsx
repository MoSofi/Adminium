/**
 * Placeholder launchpad for the @adminium/ui Storybook (M1-T01). The full
 * Home.dc.html exemplar port replaces this in wave 3 (16-milestones.md).
 * Fixture copy lives here (a story, not a component) — the i18n-agnostic rule
 * applies to components only.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon } from './components/icon/index.js';

const axes = [
  { icon: 'SunMoon', label: 'Theme', values: 'light · dark · system' },
  { icon: 'Palette', label: 'Accent', values: '8 palettes, indigo default' },
  { icon: 'Rows3', label: 'Density', values: 'comfortable · compact' },
  { icon: 'Languages', label: 'Direction', values: 'ltr · rtl (ar_EG)' },
] as const;

const tiers = [
  { name: 'Tier1', description: 'Primitives — Button, Badge, Icon, Spinner, …' },
  { name: 'Tier2', description: 'Form controls — Input, Select, Switch, …' },
  { name: 'Tier3', description: 'Composites — Modal, Toast, CommandPalette, …' },
  { name: 'Shells', description: 'Page shells — AppShell, Sidebar, AuthLayout, …' },
] as const;

function WelcomePage() {
  return (
    <main className="mx-auto flex max-w-form flex-col gap-6 py-10 text-fg">
      <header className="flex items-center gap-3">
        <span className="inline-flex size-12 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-glow">
          <Icon name="Hexagon" size={26} />
        </span>
        <div>
          <h1 className="text-title">Adminium UI</h1>
          <p className="text-body text-fg-muted">
            Component library workshop — every story renders through the real ThemeProvider.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-section">Four theming axes (toolbar ↑)</h2>
        <ul className="flex flex-col gap-2">
          {axes.map((axis) => (
            <li key={axis.label} className="flex items-center gap-3">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon name={axis.icon} size={15} />
              </span>
              <span className="w-24 text-body font-semibold">{axis.label}</span>
              <span className="text-body-sm text-fg-muted">{axis.values}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-section">Sections</h2>
        <ul className="flex flex-col gap-2">
          {tiers.map((tier) => (
            <li key={tier.name} className="flex items-baseline gap-3">
              <span className="w-24 text-body font-semibold text-accent">{tier.name}</span>
              <span className="text-body-sm text-fg-muted">{tier.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-caption text-fg-subtle">
        Placeholder launchpad — the Home exemplar port lands in wave 3. Conventions:
        workplan/03-component-library.md.
      </p>
    </main>
  );
}

const meta = {
  title: 'Welcome',
  component: WelcomePage,
  parameters: { layout: 'fullscreen', a11y: { test: 'todo' } },
} satisfies Meta<typeof WelcomePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {};
