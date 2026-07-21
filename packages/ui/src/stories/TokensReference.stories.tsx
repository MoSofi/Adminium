/**
 * Living design-tokens reference — the exemplar port of the UI Kit "Design
 * tokens" section (designs/Adminium UI Kit.dc.html, M1-T05). Semantic color
 * values are read live via getComputedStyle for BOTH themes (the effect stamps
 * `data-theme` light→dark on the root inside one synchronous block — no paint
 * in between — then restores the toolbar value), so the table always shows the
 * real resolved values, accent included. The accent row re-derives
 * `--accent-soft` at runtime per swatch with the canonical 10%/12% color-mix
 * recipe (research/design-system.md §1.1).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ACCENTS, VIZ_PALETTE, accentHex, type Accent } from '@adminium/tokens';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Card } from '../components/card/index.js';
import { MonoText } from '../components/mono-text/index.js';
import { cn } from '../lib/cn.js';
import { TONES, toneSoftClasses, toneSolidClasses, type Tone } from '../lib/tones.js';
import { useTheme } from '../theme/index.js';

/* ------------------------------------------------------------------ */
/* Live token reading                                                   */
/* ------------------------------------------------------------------ */

interface SemanticTokenSpec {
  name: string;
  /** Token utility used for the swatch (tokens-only styling). */
  swatch: string;
  role: string;
}

const SEMANTIC_TOKENS: readonly SemanticTokenSpec[] = [
  { name: '--bg', swatch: 'bg-bg', role: 'App / page background' },
  { name: '--surface', swatch: 'bg-surface', role: 'Card / panel / raised control' },
  { name: '--surface-2', swatch: 'bg-surface-2', role: 'Input fill, headers-in-cards, hover rows' },
  { name: '--surface-3', swatch: 'bg-surface-3', role: 'Wells, tracks, neutral chips' },
  { name: '--border', swatch: 'bg-border', role: 'Hairline border' },
  { name: '--border-strong', swatch: 'bg-border-strong', role: 'Input borders, emphasized dividers' },
  { name: '--fg', swatch: 'bg-fg', role: 'Primary text' },
  { name: '--fg-muted', swatch: 'bg-fg-muted', role: 'Secondary text' },
  { name: '--fg-subtle', swatch: 'bg-fg-subtle', role: 'Tertiary text, labels, placeholders' },
  { name: '--accent', swatch: 'bg-accent', role: 'Brand / action color (user-switchable)' },
  { name: '--accent-fg', swatch: 'bg-accent-fg', role: 'Text on accent' },
  { name: '--accent-soft', swatch: 'bg-accent-soft', role: 'Tinted accent background (derived)' },
  { name: '--pos', swatch: 'bg-pos', role: 'Success' },
  { name: '--pos-soft', swatch: 'bg-pos-soft', role: 'Success tint background' },
  { name: '--warn', swatch: 'bg-warn', role: 'Warning' },
  { name: '--warn-soft', swatch: 'bg-warn-soft', role: 'Warning tint background' },
  { name: '--danger', swatch: 'bg-danger', role: 'Danger / destructive' },
  { name: '--danger-soft', swatch: 'bg-danger-soft', role: 'Danger tint background' },
  { name: '--info', swatch: 'bg-info', role: 'Informational' },
  { name: '--info-soft', swatch: 'bg-info-soft', role: 'Info tint background' },
];

type TokenValues = Record<'light' | 'dark', Record<string, string>>;

/**
 * Reads every semantic token's computed value under BOTH themes. The root's
 * `data-theme` is flipped and restored synchronously within the effect, so
 * nothing ever paints mid-read; re-runs when the toolbar theme/accent change.
 */
function useLiveTokenValues(): TokenValues | null {
  const { theme, accent } = useTheme();
  const [values, setValues] = useState<TokenValues | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const original = root.getAttribute('data-theme');
    const read = (): Record<string, string> => {
      const computed = getComputedStyle(root);
      return Object.fromEntries(
        SEMANTIC_TOKENS.map((token) => [token.name, computed.getPropertyValue(token.name).trim()]),
      );
    };
    root.setAttribute('data-theme', 'light');
    const light = read();
    root.setAttribute('data-theme', 'dark');
    const dark = read();
    if (original === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', original);
    setValues({ light, dark });
  }, [theme, accent]);

  return values;
}

function SemanticColorTable() {
  const values = useLiveTokenValues();
  const { theme } = useTheme();
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="border-b border-border">
            {(
              [
                { key: 'swatch', label: '' },
                { key: 'token', label: 'Token' },
                { key: 'role', label: 'Role' },
                { key: 'light', label: 'Light' },
                { key: 'dark', label: 'Dark' },
              ] as const
            ).map((heading) => (
              <th
                key={heading.key}
                scope="col"
                className="px-2 py-2 text-start text-micro uppercase text-fg-subtle"
              >
                {heading.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SEMANTIC_TOKENS.map((token) => (
            <tr key={token.name} className="border-b border-border last:border-b-0">
              <td className="px-2 py-1.5">
                <span
                  aria-hidden="true"
                  className={cn('inline-block size-6 rounded-md border border-border-strong align-middle', token.swatch)}
                />
              </td>
              <td className="px-2 py-1.5">
                <MonoText className="text-caption font-semibold text-fg">{token.name}</MonoText>
              </td>
              <td className="px-2 py-1.5 text-fg-muted">{token.role}</td>
              <td className={cn('px-2 py-1.5', theme === 'light' ? 'text-fg' : 'text-fg-subtle')}>
                <MonoText className="text-caption">{values?.light[token.name] ?? '…'}</MonoText>
              </td>
              <td className={cn('px-2 py-1.5', theme === 'dark' ? 'text-fg' : 'text-fg-subtle')}>
                <MonoText className="text-caption">{values?.dark[token.name] ?? '…'}</MonoText>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Specimens                                                            */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mb-3.5 text-micro uppercase text-fg-subtle">{children}</div>;
}

const TYPE_SPECIMENS: readonly { label: string; className: string; sample: string }[] = [
  { label: 'display', className: 'text-display', sample: 'Query your data' },
  { label: 'title', className: 'text-title', sample: 'Page heading' },
  { label: 'modal', className: 'text-modal', sample: 'Modal title' },
  { label: 'section', className: 'text-section', sample: 'Section / card heading' },
  { label: 'body', className: 'text-body', sample: 'The quick brown fox jumps over 13 lazy dogs.' },
  { label: 'body-sm', className: 'text-body-sm text-fg-muted', sample: 'Secondary body copy for supporting rows.' },
  { label: 'caption', className: 'text-caption text-fg-muted', sample: 'Supporting metadata and helper text' },
  { label: 'micro', className: 'text-micro uppercase text-fg-subtle', sample: 'Eyebrow label' },
];

function TypographyCard() {
  return (
    <Card>
      <Eyebrow>Typography — Manrope + JetBrains Mono</Eyebrow>
      <div className="flex flex-col gap-3.5">
        {TYPE_SPECIMENS.map((specimen) => (
          <div key={specimen.label} className="flex items-baseline gap-3.5">
            <MonoText className="w-[70px] shrink-0 text-caption text-fg-subtle">{specimen.label}</MonoText>
            <span className={specimen.className}>{specimen.sample}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-3.5 border-t border-border pt-3">
          <MonoText className="w-[70px] shrink-0 text-caption text-fg-subtle">numerals</MonoText>
          <MonoText className="text-[20px] font-bold tabular-nums tracking-[-0.02em]">
            1,284,905 · 99.94% · $48.2k
          </MonoText>
        </div>
      </div>
    </Card>
  );
}

const RADII: readonly { label: string; value: string; className: string }[] = [
  { label: 'sm', value: '6px', className: 'rounded-sm' },
  { label: 'md', value: '10px', className: 'rounded-md' },
  { label: 'lg', value: '14px', className: 'rounded-lg' },
  { label: 'xl', value: '20px', className: 'rounded-xl' },
  { label: 'full', value: '999px', className: 'rounded-full' },
];

const SPACING: readonly { label: string; className: string }[] = [
  { label: '4', className: 'h-1' },
  { label: '8', className: 'h-2' },
  { label: '12', className: 'h-3' },
  { label: '16', className: 'h-4' },
  { label: '24', className: 'h-6' },
  { label: '32', className: 'h-8' },
];

function RadiiSpacingCard() {
  return (
    <Card>
      <Eyebrow>Radius &amp; spacing</Eyebrow>
      <div className="mb-5 flex items-end gap-2.5">
        {RADII.map((radius) => (
          <div key={radius.label} className="text-center">
            <div className={cn('size-10 border border-accent bg-accent-soft', radius.className)} />
            <MonoText className="mt-1.5 block text-micro text-fg-subtle">
              {radius.label} {radius.value}
            </MonoText>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        {SPACING.map((step) => (
          <div key={step.label} className="text-center">
            <div className={cn('w-5 rounded-[3px] bg-accent', step.className)} />
            <MonoText className="mt-1 block text-micro text-fg-subtle">{step.label}</MonoText>
          </div>
        ))}
      </div>
    </Card>
  );
}

const ELEVATIONS: readonly { label: string; className: string }[] = [
  { label: 'card · --shadow', className: 'shadow-card' },
  { label: 'menu · --shadow-md', className: 'shadow-menu' },
  { label: 'modal · --shadow-lg', className: 'shadow-modal' },
];

function ElevationCard() {
  return (
    <Card>
      <Eyebrow>Elevation</Eyebrow>
      <div className="flex gap-3.5">
        {ELEVATIONS.map((elevation) => (
          <div
            key={elevation.label}
            className={cn(
              'flex h-[52px] flex-1 items-center justify-center rounded-md border border-border bg-surface',
              elevation.className,
            )}
          >
            <MonoText className="text-micro text-fg-subtle">{elevation.label}</MonoText>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TonePairsCard() {
  return (
    <Card>
      <Eyebrow>Tone pairs — soft bg + strong fg</Eyebrow>
      <div className="flex flex-col gap-2">
        {TONES.map((tone: Tone) => (
          <div key={tone} className="flex items-center gap-3">
            <MonoText className="w-[70px] shrink-0 text-caption text-fg-subtle">{tone}</MonoText>
            <span className={cn('rounded-md px-2.5 py-1 text-caption font-bold', toneSoftClasses[tone])}>
              soft
            </span>
            <span className={cn('rounded-md px-2.5 py-1 text-caption font-bold', toneSolidClasses[tone])}>
              solid
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-caption text-fg-muted">
        Every semantic color ships as a strong/soft pair — pills, badges, banners and icon tiles
        always render the soft background with the strong foreground.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Accents                                                              */
/* ------------------------------------------------------------------ */

/**
 * Per-swatch runtime derivation: `--accent` is overridden locally and
 * `--accent-soft` is re-derived from it with the canonical recipe
 * (10% alpha in light, 12% in dark — the 12% tint ceiling accents.css measures) — the
 * same color-mix the tokens package
 * applies globally on `data-accent` switches.
 *
 * The hex shown is per-theme: every accent has two (`--accent-light`/`--accent-dark` in
 * accents.css), and for `black` they are worlds apart (#111111 vs #c9c9d4). Printing the light
 * hex under a dark swatch would make this reference page contradict the tokens it documents.
 */
function AccentSwatch({ name }: { name: Accent }) {
  const { theme, accent } = useTheme();
  const hex = accentHex(name, theme === 'dark' ? 'dark' : 'light');
  const softMix = theme === 'dark' ? '12%' : '10%';
  return (
    <div
      style={{
        '--accent': hex,
        '--accent-soft': `color-mix(in srgb, var(--accent) ${softMix}, transparent)`,
      }}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-lg border p-3',
        accent === name ? 'border-accent ring-[3px] ring-accent-soft' : 'border-border',
      )}
    >
      <span className="flex gap-1.5">
        <span aria-hidden="true" className="size-7 rounded-md bg-accent" />
        <span aria-hidden="true" className="size-7 rounded-md border border-border bg-accent-soft" />
      </span>
      <span className="text-caption font-bold text-fg">{name}</span>
      <MonoText className="text-micro text-fg-subtle">{hex}</MonoText>
    </div>
  );
}

function AccentsCard() {
  const { theme, accent } = useTheme();
  const [derived, setDerived] = useState('');
  useEffect(() => {
    setDerived(getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim());
  }, [theme, accent]);
  return (
    <Card>
      <Eyebrow>Accent palettes — 8, runtime-derived soft</Eyebrow>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        {(Object.keys(ACCENTS) as Accent[]).map((name) => (
          <AccentSwatch key={name} name={name} />
        ))}
      </div>
      <p className="mt-4 text-caption text-fg-muted">
        Everything accent-derived is computed from the single hex — switching{' '}
        <MonoText>data-accent</MonoText> changes exactly one value. Current derivation:{' '}
        <MonoText className="text-fg">--accent-soft = {derived === '' ? '…' : derived}</MonoText>
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Data-viz                                                             */
/* ------------------------------------------------------------------ */

const VIZ_SWATCH_CLASSES = [
  'bg-viz-1',
  'bg-viz-2',
  'bg-viz-3',
  'bg-viz-4',
  'bg-viz-5',
  'bg-viz-6',
  'bg-viz-7',
  'bg-viz-8',
] as const;

const RAMP_SWATCH_CLASSES = [
  'bg-[var(--viz-ramp-1)]',
  'bg-[var(--viz-ramp-2)]',
  'bg-[var(--viz-ramp-3)]',
  'bg-[var(--viz-ramp-4)]',
  'bg-[var(--viz-ramp-5)]',
  'bg-[var(--viz-ramp-6)]',
] as const;

function VizCard() {
  return (
    <Card>
      <Eyebrow>Data-viz categorical + accent ramp</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {VIZ_SWATCH_CLASSES.map((swatch, index) => (
          <div key={swatch} className="text-center">
            <span aria-hidden="true" className={cn('block size-[22px] rounded-[7px]', swatch)} />
            <MonoText className="mt-1 block text-micro text-fg-subtle">{VIZ_PALETTE[index]}</MonoText>
          </div>
        ))}
      </div>
      <div className="mt-4 flex overflow-hidden rounded-md border border-border">
        {RAMP_SWATCH_CLASSES.map((swatch) => (
          <span key={swatch} aria-hidden="true" className={cn('h-6 flex-1', swatch)} />
        ))}
      </div>
      <p className="mt-2 text-caption text-fg-muted">
        Sequential ramp: the accent at alphas .12 · .28 · .45 · .65 · .85 · 1 — follows the accent
        axis automatically.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

function TokensReferencePage() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-4 text-fg">
      <header className="mb-2">
        <h1 className="text-title">Design tokens</h1>
        <p className="mt-1.5 max-w-[600px] text-body text-fg-muted">
          A near-neutral scale carries the UI; one accent does the heavy lifting. Every token has
          a first-class dark counterpart — toggle the theme up top to preview. Values below are
          read live from the DOM via <MonoText>getComputedStyle</MonoText>.
        </p>
      </header>

      <Card>
        <Eyebrow>Semantic colors — live values</Eyebrow>
        <SemanticColorTable />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <TypographyCard />
        <div className="flex flex-col gap-4">
          <RadiiSpacingCard />
          <ElevationCard />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TonePairsCard />
        <VizCard />
      </div>

      <AccentsCard />
    </div>
  );
}

const meta = {
  title: 'DesignSystem/Tokens',
  parameters: { layout: 'padded', a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reference: Story = { render: () => <TokensReferencePage /> };
