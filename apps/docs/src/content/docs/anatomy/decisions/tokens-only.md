---
title: Tokens only, no `style` props
description: Every colour, space, radius and shadow is a CSS custom property, the JSX `style` prop is banned by a lint rule, and there is exactly one escape hatch.
---

## The situation

Adminium renders the same components under four independent axes: a light or
dark **theme**, one of several **accents**, a comfortable or compact
**density**, and left-to-right or right-to-left **direction**. Every one of
those is a runtime choice made by the person using the admin panel, not a build
flag.

A single hard-coded colour breaks one of the four. It will look right in the
mode it was written in and wrong in the other three, and nothing will fail —
which is why this has to be a lint rule and not a review habit.

## The decision

**Every visual value comes from `@adminium/tokens` as a CSS custom property**,
consumed through a Tailwind utility. No raw hex, no off-scale spacing, no
`box-shadow` written out.

**The JSX `style` prop is banned repo-wide** by the custom ESLint rule
`adminium/no-style-prop`. There is no autofix, because the fix is a decision:
map the literal to the token utility that means the same thing.

**One escape hatch**, for values that genuinely cannot be a class — chart
geometry, a progress percentage, a stagger index. An inline object is allowed
when *every* key is a string-literal CSS custom property, and the class consumes
it:

```tsx
// rejected by lint
<div style={{ width: pct + '%' }} />

// allowed: set a variable, read it from a utility
<div
  className="h-1.5 rounded-full bg-accent w-[var(--adm-progress)]"
  style={{ '--adm-progress': pct + '%' }}
/>
```

Spread elements and computed keys are always reported. Where the rule is
configured with `allowVars`, the hatch narrows further to a named allowlist, and
extending that list is a reviewed change to `@adminium/config`.

## Two adjacent rules, same reason

**Logical properties only.** `ms-*` / `me-*` / `ps-*` / `pe-*` / `start-*` /
`end-*`, never `ml-*` / `mr-*`. A physical direction is a bug in Arabic. The
block-axis utility is `inset-y-*`; `inset-block-*` is **not** a Tailwind
utility and silently emits nothing.

**A class that does not exist emits nothing.** Tailwind does not warn about a
misspelled or invented utility — it just produces no CSS, and the result looks
deliberate. `pnpm check-tailwind-utilities` reads every `className` in the
repository and fails on a name that would not compile.

## What it means for a contributor

- Reach for a token utility first; if none fits, the gap is in
  `@adminium/tokens`, and that is where the change goes.
- A design mockup is authored with inline styles, because that is what design
  tools emit. Never copy its markup — port it.
- `pnpm lint` and `pnpm check-tailwind-utilities` both run in CI, and the second
  is in `pnpm preflight --quick` because it costs under a second and no other
  gate can see what it sees.
