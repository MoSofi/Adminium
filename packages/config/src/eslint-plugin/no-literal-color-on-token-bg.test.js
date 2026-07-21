import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-literal-color-on-token-bg.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-literal-color-on-token-bg', rule, {
  valid: [
    // The paired foreground tokens — the whole point of the rule.
    'const el = <div className="bg-accent text-accent-fg" />;',
    'const el = <div className="bg-danger text-accent-fg hover:brightness-105" />;',
    'const el = <div className="bg-pos-soft text-pos" />;',
    'const el = <div className="bg-surface-3 text-fg-muted" />;',
    // Literal colour on a NON-token background: frozen brand artwork (avatar /
    // card gradients, translucent white chips). No token to pair with.
    'const el = <div className="bg-[linear-gradient(135deg,#6366f1,#a855f7)] text-white" />;',
    'const el = <div className="bg-white/25 text-white" />;',
    'const el = <div className="bg-black text-white" />;',
    // Token background with no literal colour at all.
    'const el = <div className="bg-accent shadow-glow" />;',
    'const el = <div className="text-danger hover:bg-danger/15" />;',
    // Literal colour with no background in the same string.
    'const el = <div className="font-bold text-white" />;',
    // `bg-` arbitrary values are not tokens.
    'const c = "bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] text-white";',
    // Look-alike token names that are not backgrounds in the map.
    'const el = <div className="bg-border text-white" />;',
    'const el = <div className="bg-viz-1 text-white" />;',
    // Two strings inside ONE cn() argument are alternatives, not a pair.
    'const c = cn(on ? "bg-accent" : "text-white");',
    // Not a class-merging call.
    'const c = format("bg-accent", "text-white");',
    // cva() base + variant strings are never unioned (mutually-exclusive
    // variants would false-positive); each string is still scanned on its own.
    'const v = cva("inline-flex text-white", { variants: { tone: { pos: "bg-pos" } } });',
    // Documented blind spot: composition through a variable is not resolved.
    'const brand = "bg-accent"; const c = cn("text-white", brand);',
  ],
  invalid: [
    // The exact regression this rule exists for.
    {
      code: 'const el = <div className="bg-accent text-white" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Solid semantic tones (the tones.ts / Button / Stepper shape).
    {
      code: 'const map = { pos: "bg-pos text-white", danger: "bg-danger text-white" };',
      errors: [{ messageId: 'literalColorOnTokenBg' }, { messageId: 'literalColorOnTokenBg' }],
    },
    // Variant prefixes and opacity modifiers are stripped before matching.
    {
      code: 'const el = <div className="hover:bg-warn/90 dark:text-white/80" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    {
      code: 'const el = <div className="group-data-[selected]:bg-accent text-white" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Tailwind palette colours and literal hex, not just white/black.
    {
      code: 'const el = <div className="bg-info text-slate-100" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    {
      code: 'const el = <div className="bg-surface-2 text-black" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    {
      code: 'const el = <div className="bg-bg text-[#ffffff]" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Soft tints are backgrounds too — white on bg-pos-soft is unreadable.
    {
      code: 'const el = <div className="bg-danger-soft text-white" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Every quasi of one template literal concatenates.
    {
      code: 'const c = `bg-accent ${size} text-white`;',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Every argument of a class-merging call concatenates.
    {
      code: 'const c = cn("bg-accent", on ? "text-white" : "text-fg");',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    {
      code: 'const c = clsx({ "bg-warn": on }, "text-white");',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Member-expression callees resolve by property name.
    {
      code: 'const c = utils.twMerge("bg-info", "text-white");',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // Extra helper names come from the `functions` option.
    {
      code: 'const c = joinClasses("bg-accent", "text-white");',
      options: [{ functions: ['joinClasses'] }],
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
    // One literal colour against two token backgrounds = two reports.
    {
      code: 'const el = <div className="bg-accent bg-surface text-white" />;',
      errors: [{ messageId: 'literalColorOnTokenBg' }, { messageId: 'literalColorOnTokenBg' }],
    },
    // A single-string pair inside a cn() argument is reported exactly once
    // (the string scan owns it; the call-site scan only crosses arguments).
    {
      code: 'const c = cn("bg-accent text-white", extra);',
      errors: [{ messageId: 'literalColorOnTokenBg' }],
    },
  ],
});
