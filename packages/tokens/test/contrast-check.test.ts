// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-ESM audit script, intentionally untyped (it is also the CI entry point)
import * as audit from '../scripts/contrast-check.mjs';

const { parseColor, parseRules, resolveState, expandVars, matchSelector, over, luminance, ratio, runAudit, GROUPS } =
  audit as {
    parseColor: (v: string) => number[];
    parseRules: (css: string) => { selectors: string[]; decls: Map<string, string>; order: number }[];
    resolveState: (
      rules: ReturnType<typeof parseRules>,
      state: { theme: string; accent: string; scope?: string }
    ) => { tokens: Map<string, string>; resolved: Map<string, string>; ignored: string[] };
    expandVars: (v: string, tokens: Map<string, string>) => string;
    matchSelector: (sel: string, state: { theme: string; accent: string }) => unknown;
    over: (fg: number[], bg: number[]) => number[];
    luminance: (c: number[]) => number;
    ratio: (a: number[], b: number[]) => number;
    runAudit: (o?: { strict?: boolean; css?: string }) => {
      themes: string[];
      accents: string[];
      scopes: string[];
      rows: {
        group: string;
        theme: string;
        accent: string;
        scope: string;
        fg: string;
        bg: string;
        actual: number;
        min: number;
        pass: boolean;
        gated: boolean;
      }[];
      failures: unknown[];
      warnings: unknown[];
      ignoredRules: string[];
    };
    GROUPS: Record<string, { gated: boolean; label: string; reason?: string }>;
  };

const near = (n: number) => Math.round(n * 100) / 100;

describe('colour parsing', () => {
  it('parses hex in 3/4/6/8-digit forms', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#141419')).toEqual([20, 20, 25, 1]);
    expect(parseColor('#00000080')[3]).toBeCloseTo(0.502, 3);
  });

  it('parses rgb()/rgba()', () => {
    expect(parseColor('rgba(255,107,107,.14)')).toEqual([255, 107, 107, 0.14]);
    expect(parseColor('rgb(0 0 0)')).toEqual([0, 0, 0, 1]);
  });

  it('evaluates color-mix(in srgb, …) alpha-premultiplied, per css-color-5', () => {
    // 10% of an opaque colour with `transparent` keeps the colour, drops alpha to 0.1
    expect(parseColor('color-mix(in srgb, #4f46e5 10%, transparent)')).toEqual([79, 70, 229, 0.1]);
    // 82% with black darkens each channel to 0.82x
    const hover = parseColor('color-mix(in srgb, #4f46e5 82%, #000)');
    expect(hover.map(Math.round)).toEqual([65, 57, 188, 1]);
  });

  it('rejects colour spaces it cannot evaluate rather than guessing', () => {
    expect(() => parseColor('color-mix(in oklch, #fff 50%, #000)')).toThrow(/in srgb/);
  });
});

describe('WCAG maths', () => {
  it('matches the reference luminance of white and black', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 10);
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 10);
  });

  it('computes the canonical 21:1 and known token ratios', () => {
    expect(near(ratio([0, 0, 0, 1], [255, 255, 255, 1]))).toBe(21);
    // --fg #191920 on --surface #ffffff — the body-text pair
    expect(ratio(parseColor('#191920'), parseColor('#ffffff'))).toBeGreaterThan(15);
  });

  it('composites translucent foregrounds before measuring', () => {
    const soft = parseColor('rgba(255,255,255,0.5)');
    expect(over(soft, [0, 0, 0, 1]).slice(0, 3)).toEqual([127.5, 127.5, 127.5]);
  });
});

describe('cascade replay', () => {
  const css = `
    :root, [data-accent="indigo"] { --accent: #4f46e5; --soft: color-mix(in srgb, var(--accent) 10%, transparent); }
    [data-accent="teal"] { --accent: #0d9488; }
    [data-theme="dark"][data-accent="indigo"] { --accent: #8b85f0; }
    [data-theme="dark"] [data-accent="rose"] { --accent: #ff0000; }
  `;

  it('resolves the highest-specificity declaration for the state', () => {
    const rules = parseRules(css);
    expect(resolveState(rules, { theme: 'light', accent: 'indigo' }).tokens.get('--accent')).toBe('#4f46e5');
    expect(resolveState(rules, { theme: 'light', accent: 'teal' }).tokens.get('--accent')).toBe('#0d9488');
    // compound [data-theme][data-accent] beats the single-attribute rule
    expect(resolveState(rules, { theme: 'dark', accent: 'indigo' }).tokens.get('--accent')).toBe('#8b85f0');
  });

  it('reports descendant-combinator rules as ignored instead of silently honouring them', () => {
    const { ignored, tokens } = resolveState(parseRules(css), { theme: 'dark', accent: 'rose' });
    expect(tokens.get('--accent')).toBe('#4f46e5'); // the :root default still applies
    expect(ignored.join(' ')).toContain('combinator');
  });

  it('expands var() chains before parsing the colour', () => {
    const { tokens } = resolveState(parseRules(css), { theme: 'light', accent: 'teal' });
    expect(parseColor(expandVars(tokens.get('--soft')!, tokens))).toEqual([13, 148, 136, 0.1]);
  });

  it('does not match a selector whose attribute constraint contradicts the state', () => {
    expect(matchSelector('[data-accent="teal"]', { theme: 'light', accent: 'indigo' })).toBeNull();
  });
});

describe('the gate itself', () => {
  const result = runAudit();

  it('covers both themes and all eight accents from the real CSS', () => {
    expect(result.themes).toEqual(['light', 'dark']);
    expect(result.accents).toEqual(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']);
  });

  it('measures every load-bearing group', () => {
    const groups = new Set(result.rows.map((r) => r.group));
    expect([...groups].sort()).toEqual(
      [
        'accent-button',
        'accent-hover',
        'accent-soft',
        'accent-soft-deep',
        'accent-text',
        // The AuthLayout brand panel. It is here because nothing else can see
        // it: the panel is `aria-hidden`, so the axe sweep skips the subtree
        // while a sighted low-vision user reads all of it.
        'brand-panel',
        // The pre-composited chip tints. A chip that gets re-parented onto a tinted row cannot
        // be reasoned about surface-by-surface, so its tint is frozen into the token instead.
        'chip-solid',
        'code-ink',
        'focus-ring',
        'semantic',
        // ::selection, whose backdrop the USER picks by dragging — the extreme of the same
        // composition problem as `chip-solid`, and the one axe can never witness.
        'selection',
        'state-fill',
        'text',
        'text-on-soft',
        'text-on-tint',
      ].sort()
    );
  });

  it('applies 3:1 to the non-text indicators and 4.5:1 to every text pair', () => {
    const nonText = ['focus-ring', 'state-fill'];
    expect(result.rows.filter((r) => nonText.includes(r.group)).every((r) => r.min === 3)).toBe(true);
    expect(result.rows.filter((r) => !nonText.includes(r.group)).every((r) => r.min === 4.5)).toBe(true);
  });

  it('replays the exception scopes as their own subtrees', () => {
    expect(result.scopes).toEqual(['.adm-always-dark', '.adm-always-light']);
    // exceptions.css re-declares the whole token set, so every scope carries the full matrix …
    for (const scope of result.scopes) expect(result.rows.some((r) => r.scope === scope)).toBe(true);
    // … including the syntax colours that exist only inside the always-dark code surfaces.
    const codeInk = result.rows.filter((r) => r.group === 'code-ink');
    expect(codeInk.length).toBeGreaterThan(0);
    expect(new Set(codeInk.map((r) => r.scope))).toEqual(new Set(['.adm-always-dark']));
  });

  it('ignores no token rule in the shipped CSS', () => {
    expect(result.ignoredRules).toEqual([]);
  });

  it('carries a written reason for every non-gated group (02-T15 exemption list)', () => {
    for (const [name, g] of Object.entries(GROUPS)) {
      if (!g.gated) expect(g.reason, name).toMatch(/EXEMPT/);
    }
  });

  it('catches a regression rather than passing everything', () => {
    // Same shape as the real files, with --fg-subtle put back to the pre-audit #9a9aa5.
    const regressed = runAudit({
      css: `
        :root {
          --bg: #f6f6f8; --surface: #ffffff; --surface-2: #fafafa; --surface-3: #f1f1f4;
          --fg: #191920; --fg-muted: #5a5a65; --fg-subtle: #9a9aa5; --accent-fg: #ffffff;
          --pos: #0b7d59; --pos-soft: #e6f5ee; --warn: #a95800; --warn-soft: #fbf0e2;
          --danger: #cf273c; --danger-soft: #fdecec; --info: #2260e8; --info-soft: #e7edfd;
          /* Every wash owes a pre-composited twin (vocabulary() refuses an orphan), so the
             fixture carries them too - it is meant to be the same SHAPE as the real files,
             with one value regressed. NB: this CSS lives in a template literal, so no
             backticks in here. */
          --pos-soft-solid: var(--pos-soft); --warn-soft-solid: var(--warn-soft);
          --danger-soft-solid: var(--danger-soft); --info-soft-solid: var(--info-soft);
        }
        [data-accent="indigo"] { --accent: #4f46e5; }
        [data-accent="black"]  { --accent: #111111; }
        :root {
          --accent-soft: color-mix(in srgb, var(--accent) 10%, transparent);
          --accent-soft-solid: color-mix(in srgb, var(--accent) 10%, var(--surface));
        }
      `,
    });
    const plain = regressed.failures.filter(
      (f) => (f as { fg: string; group: string }).fg === '--fg-subtle' && (f as { group: string }).group === 'text'
    );
    expect(plain.length).toBe(4); // one per surface
    expect(near((plain[0] as { actual: number }).actual)).toBe(2.58); // #9a9aa5 on --bg
    // …and the same grey is caught again on every tint it can be painted over.
    expect(
      regressed.failures.some(
        (f) => (f as { fg: string; group: string }).fg === '--fg-subtle' && (f as { group: string }).group === 'text-on-soft'
      )
    ).toBe(true);
  });

  it('every gated pair meets its WCAG 2.1 AA threshold', () => {
    const summary = result.failures
      .map(
        (f) =>
          f as { fg: string; bg: string; theme: string; accent: string; scope: string; actual: number; min: number }
      )
      .map((f) => `${f.fg} on ${f.bg} [${f.theme}/${f.accent}/${f.scope}] ${near(f.actual)}:1 < ${f.min}:1`);
    expect(summary).toEqual([]);
  });

  it('stays gated when CI runs it: the package script passes --strict', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.contrast).toContain('--strict');
    expect(pkg.scripts.test).toContain('contrast');
  });
});

/*
 * The holes an adversarial pass found in the first version of this gate. Each test here is the
 * repro that proved the hole, kept as the thing that stops it reopening.
 */
describe('gate hardening', () => {
  const base = (extra = '') => `
    :root {
      --bg: #f6f6f8; --surface: #ffffff; --surface-2: #fafafa; --surface-3: #f1f1f4;
      --fg: #191920; --fg-muted: #4a4a54; --fg-subtle: #5a5a65; --accent-fg: #ffffff;
      ${extra}
    }
    [data-accent="indigo"] { --accent: #4f46e5; }
  `;

  it('the baseline fixture passes, so a failure below is the injected fault', () => {
    expect(runAudit({ css: base() }).failures).toEqual([]);
  });

  it('refuses tokens declared inside a conditional at-rule instead of hoisting them', () => {
    // The flat-regex parser could not see nested braces: it resumed INSIDE the @media block and
    // captured the inner `:root {…}` as a TOP-LEVEL rule, so the condition vanished and the
    // declarations joined the cascade unconditionally — last in source order, therefore winning.
    const css = `${base()}\n@media (prefers-contrast: less) { :root { --fg-subtle: #d0d0d5; } }`;
    expect(() => runAudit({ css })).toThrow(/conditional at-rule/);
    expect(() => runAudit({ css })).toThrow(/@media \(prefers-contrast: less\)/);
  });

  it('refuses tokens in a rule that also nests rules', () => {
    expect(() => runAudit({ css: `${base()}\n:root { --fg-muted: #4a4a54; &:hover { --fg-muted: #eee; } }` })).toThrow(
      /nested/
    );
  });

  it('covers a NEW foreground token automatically instead of ignoring the name', () => {
    // Adding --fg-faint at 1.5:1 used to produce zero failures: the vocabulary was a literal list.
    const { failures } = runAudit({ css: base('--fg-faint: #d0d0d5;') });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => (f as { fg: string }).fg === '--fg-faint')).toBe(true);
  });

  it('refuses a colour token whose role it cannot recognise', () => {
    expect(() => runAudit({ css: base('--brand: #d0d0d5;') })).toThrow(/unclassified colour token/);
    // …but a non-colour token (a shadow) is not a text/background pair and stays silent.
    expect(() => runAudit({ css: base('--halo: 0 2px 8px rgba(0,0,0,.4);') })).not.toThrow();
  });

  it('fails CLOSED when a split text/fill accent token appears', () => {
    // The old hook was "use --accent-ink if it exists", which silently moved four groups off
    // --accent (68 failures -> 8 in the repro). Presence alone is now an error until INK_ROLE
    // is set deliberately.
    expect(() => runAudit({ css: base('--accent-ink: #4f46e5;') })).toThrow(/INK_ROLE/);
  });

  it('measures --accent-hover, so the dark-hover regression cannot come back green', () => {
    // The historic bug, restored exactly: the light-tuned accent reused on dark surfaces, with a
    // hover that mixes toward #000. accents.css records the number this produced — 2.22:1 against
    // --surface — and the gate had NO check that could see it.
    const dark = `
      :root { --bg: #0a0a0d; --surface: #141419; --surface-2: #1a1a20; --surface-3: #24242c;
              --fg: #f4f4f6; --fg-muted: #b7b7c3; --fg-subtle: #a1a1ad; --accent-fg: #0f0f14;
              --accent-hover: color-mix(in srgb, var(--accent) 82%, #000); }
      [data-accent="indigo"] { --accent: #4f46e5; }
    `;
    const rows = runAudit({ css: dark }).failures as { fg: string; bg: string; group: string; actual: number }[];
    const fill = rows.filter((r) => r.group === 'state-fill' && r.fg === '--accent-hover');
    expect(fill.length).toBeGreaterThan(0);
    expect(near(fill.find((r) => r.bg === '--surface')!.actual)).toBe(2.22);
  });

  it('measures the exception scopes, including a value that drifts from tokens.css', () => {
    const css = `${base()}\n.adm-always-dark { --surface: #0f0f14; --surface-2: #1a1a20; --surface-3: #24242c;
        --bg: #0e0e13; --fg: #f4f4f6; --fg-muted: #b7b7c3; --fg-subtle: #6c6c76; --accent-fg: #0f0f14; }`;
    const { scopes, failures } = runAudit({ css });
    expect(scopes).toEqual(['.adm-always-dark']);
    // a light-theme grey left behind in the dark scope is 2.4:1 there, and is now caught
    const drifted = failures as { fg: string; scope: string }[];
    expect(drifted.some((f) => f.fg === '--fg-subtle' && f.scope === '.adm-always-dark')).toBe(true);
  });

  it('catches a translucent ::selection tint, including on the accent fill', () => {
    // The regression this group exists for, restored exactly: --accent-selection as a WASH. Over a
    // plain surface it looks fine, which is why it survived two passes; over the primary button's
    // own fill — draggable text, not a page background — the theme --fg measured 2.78:1 on this
    // fixture's indigo, and 1.080:1 on the monochrome accent the real palette also ships. axe
    // cannot see any of it, because it does not evaluate ::selection at all.
    const wash = base('--accent-selection: color-mix(in srgb, var(--accent) 12%, transparent);');
    const rows = runAudit({ css: wash }).failures as { group: string; bg: string; actual: number }[];
    const onFill = rows.filter((r) => r.group === 'selection' && r.bg.endsWith('on --accent'));
    expect(onFill.length).toBeGreaterThan(0);
    expect(near(onFill[0]!.actual)).toBe(2.78);
    // …and the pre-composited token that shipped instead passes the same check.
    const solid = base('--accent-selection: color-mix(in srgb, var(--accent) 12%, var(--surface));');
    expect((runAudit({ css: solid }).failures as unknown[]).length).toBe(0);
  });

  it('resolves a scope-inherited token against the value computed on the ROOT', () => {
    // var() inside a custom property is substituted on the element that DECLARES it; the computed
    // result then inherits. A scope that re-declares --accent but not --accent-selection therefore
    // inherits the ROOT accent's tint, which is exactly the pair that has to be measured.
    const rules = parseRules(`
      :root { --accent: #4f46e5; --accent-selection: color-mix(in srgb, var(--accent) 12%, transparent); }
      .adm-always-dark { --accent: #99a5ff; }
    `);
    const scoped = resolveState(rules, { theme: 'light', accent: 'indigo', scope: '.adm-always-dark' });
    expect(scoped.resolved.get('--accent')).toBe('#99a5ff');
    expect(scoped.resolved.get('--accent-selection')).toBe('color-mix(in srgb, #4f46e5 12%, transparent)');
  });
});
