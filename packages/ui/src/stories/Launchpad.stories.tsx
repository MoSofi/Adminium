/**
 * Storybook launchpad — the design-system exemplar port of designs/Home.dc.html
 * (M1-T05, 16-milestones.md §5 "porting a comp"). The comp's surface
 * index becomes a nav-card grid over the Storybook areas; the brand header,
 * card hover behavior (nb-card lift + nb-arrow slide) and the palette swatch
 * row are kept. Fixture copy lives here (a story, not a component) — the
 * i18n-agnostic rule applies to components only.
 *
 * Navigation: @storybook/addon-links is not installed, so cards are plain
 * anchors to `./?path=/story/<id>` with `target="_top"` (the story renders in
 * iframe.html; `_top` swaps the whole manager page — the linkTo() equivalent).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowUpRight,
  BellRing,
  Command,
  Component,
  Hexagon,
  Inbox,
  Layers,
  MousePointerClick,
  Palette,
  Shapes,
  Sparkles,
  SwatchBook,
  TextCursorInput,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../components/button/index.js';
import { Card } from '../components/card/index.js';
import { IconTile } from '../components/icon-tile/index.js';
import { Kbd } from '../components/kbd/index.js';
import { cn } from '../lib/cn.js';
import { glassBar, type Tone } from '../lib/tones.js';

/** Manager-relative story link (resolves /iframe.html → /?path=…). */
const storyHref = (id: string) => `./?path=/story/${id}`;

interface NavCardSpec {
  title: string;
  description: string;
  icon: ReactNode;
  tone: Tone;
  storyId: string;
}

const foundationCards: NavCardSpec[] = [
  {
    title: 'Design tokens',
    description: 'Colors, typography, radii, shadows and spacing — read live from the active theme.',
    icon: <SwatchBook />,
    tone: 'accent',
    storyId: 'designsystem-tokens--reference',
  },
  {
    title: 'Icon set',
    description: 'Lucide at stroke-width 2 — the only icon source, sized 12–26px.',
    icon: <Shapes />,
    tone: 'info',
    storyId: 'tier1-icon--matrix',
  },
  {
    title: 'Tone system',
    description: 'Six semantic tones as soft/strong pairs shared by every tinted component.',
    icon: <Palette />,
    tone: 'pos',
    storyId: 'tier1-badge--tones-matrix',
  },
];

const tierCards: NavCardSpec[] = [
  {
    title: 'Tier 1 · Primitives',
    description: 'Buttons, badges, avatars, icon tiles, pills — the atomic vocabulary.',
    icon: <Component />,
    tone: 'accent',
    storyId: 'tier1-button--matrix',
  },
  {
    title: 'Tier 2 · Form controls',
    description: 'Inputs, selects, switches, sliders, steppers — every field type, all states.',
    icon: <TextCursorInput />,
    tone: 'pos',
    storyId: 'tier2-input--matrix',
  },
  {
    title: 'Tier 3 · Composites',
    description: 'Modals, drawers, toasts and palettes — the working interaction patterns.',
    icon: <Layers />,
    tone: 'info',
    storyId: 'tier3-modal--playground',
  },
];

const patternCards: NavCardSpec[] = [
  {
    title: 'Empty states',
    description: 'An icon, a headline, a line of guidance, and a primary action.',
    icon: <Inbox />,
    tone: 'accent',
    storyId: 'designsystem-empty-states--gallery',
  },
  {
    title: 'Interaction patterns',
    description: 'Two-phase modals, undo toasts, type-to-confirm, bulk actions.',
    icon: <MousePointerClick />,
    tone: 'info',
    storyId: 'designsystem-interaction-patterns--two-phase-modal-flow',
  },
  {
    title: 'Command palette',
    description: '⌘K everywhere — grouped results, fully keyboard driven.',
    icon: <Command />,
    tone: 'pos',
    storyId: 'tier3-commandpalette--playground',
  },
  {
    title: 'Toast queue',
    description: 'Max four visible, FIFO overflow, undo actions, resolve-in-place.',
    icon: <BellRing />,
    tone: 'warn',
    storyId: 'tier3-toastqueue--playground',
  },
];

/** Home.dc.html `.nb-card`: hover lift + accent-mixed border + sliding `.nb-arrow`. */
function NavCard({ card }: { card: NavCardSpec }) {
  return (
    <Card
      asChild
      hoverable
      className="group block cursor-pointer transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]"
    >
      <a href={storyHref(card.storyId)} target="_top">
        <div className="flex items-center justify-between">
          <IconTile size="lg" tone={card.tone} icon={card.icon} />
          <ArrowUpRight
            aria-hidden="true"
            className={cn(
              'size-[17px] text-fg-subtle opacity-40 transition-[transform,opacity] duration-150',
              'group-hover:translate-x-[3px] group-hover:opacity-100',
              'rtl:-scale-x-100 rtl:group-hover:-translate-x-[3px]',
            )}
          />
        </div>
        <div className="mt-4 text-section text-fg">{card.title}</div>
        <div className="mt-1 text-body-sm text-fg-muted">{card.description}</div>
      </a>
    </Card>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3.5 text-micro uppercase text-fg-subtle">{children}</h2>;
}

/** Footer palette row — accent + 4 semantics + fg, as in the Home comp. */
const paletteSwatches = ['bg-accent', 'bg-pos', 'bg-warn', 'bg-danger', 'bg-info', 'bg-fg'] as const;

function LaunchpadPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      {/* Brand header (sticky translucent bar per the comp) */}
      <header className={cn(glassBar, 'flex items-center gap-3 px-7 py-4')}>
        <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-accent text-accent-fg">
          <Hexagon className="size-4" aria-hidden="true" />
        </span>
        <span className="text-[16px] font-extrabold tracking-[-0.02em]">Adminium</span>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <span className="hidden text-body-sm font-medium text-fg-muted sm:inline">
          From database to dashboard in minutes.
        </span>
        <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold text-fg-subtle">
          Design system
        </span>
        <a
          href={storyHref('designsystem-interaction-patterns--command-palette-k')}
          target="_top"
          className="ms-auto flex items-center gap-2 text-caption font-semibold text-fg-muted hover:text-fg"
        >
          Command palette
          <Kbd>⌘K</Kbd>
        </a>
      </header>

      <div className="mx-auto max-w-[1080px] px-7 pb-16 pt-12">
        {/* Hero */}
        <div className="mb-11 max-w-[640px]">
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-caption font-bold text-accent">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Postgres → Dashboard
          </span>
          <h1 className="text-display text-fg">A modern SaaS UI kit &amp; admin dashboard.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            Sixty components across three tiers, built on one token set — clean, minimal, and
            modern, with first-class dark mode. Pick an area to explore, and flip the theme,
            accent, density and direction from the toolbar above: every story renders through the
            real ThemeProvider.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Button asChild>
              <a href={storyHref('designsystem-tokens--reference')} target="_top">
                <SwatchBook aria-hidden="true" className="size-4" />
                Explore the tokens
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={storyHref('tier1-button--matrix')} target="_top">
                Browse components
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={storyHref('designsystem-empty-states--gallery')} target="_top">
                Empty states
              </a>
            </Button>
          </div>
        </div>

        {/* Nav-card grid */}
        <SectionLabel>Foundations</SectionLabel>
        <div className="mb-9 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {foundationCards.map((card) => (
            <NavCard key={card.title} card={card} />
          ))}
        </div>

        <SectionLabel>Component tiers</SectionLabel>
        <div className="mb-9 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {tierCards.map((card) => (
            <NavCard key={card.title} card={card} />
          ))}
        </div>

        <SectionLabel>Patterns &amp; states</SectionLabel>
        <div className="mb-11 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {patternCards.map((card) => (
            <NavCard key={card.title} card={card} />
          ))}
        </div>

        {/* Palette swatch row */}
        <Card className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <div className="text-section text-fg">One design system, three tiers</div>
            <div className="text-body-sm text-fg-muted">
              Neutral-forward palette · single accent · Manrope + JetBrains Mono · comfortable /
              compact density · light &amp; dark · LTR / RTL.
            </div>
          </div>
          <div className="flex gap-2">
            {paletteSwatches.map((swatch) => (
              <span key={swatch} aria-hidden="true" className={cn('size-[22px] rounded-[7px]', swatch)} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

const meta = {
  title: 'Welcome',
  parameters: { layout: 'fullscreen', a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Launchpad: Story = { render: () => <LaunchpadPage /> };
