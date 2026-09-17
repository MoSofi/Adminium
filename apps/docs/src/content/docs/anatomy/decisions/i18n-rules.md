---
title: The i18n rules
description: Eight locales from day one, English as the source of truth, and a key that exists in seven of the eight is a failing build — plus why parity is not the same as translation.
---

## The situation

Retrofitting internationalisation is one of the more expensive things a
codebase can be asked to do. Every literal has to be found, every
string-concatenation has to be unpicked because word order differs, every
`ml-4` has to be re-examined for right-to-left, and every date and number has
to be re-routed through a formatter. It is a rewrite of the presentation layer
performed by whoever drew the short straw.

So Adminium ships eight locales — `en-US`, `de-DE`, `fr-FR`, `cs-CZ`,
`da-DK`, `zh-CN`, `zh-TW`, `ar-EG` — from the first release, with Arabic
present specifically so that right-to-left is never a future project.

## The decision

**No literals in components.** Every user-visible string is a key:

```tsx
t('orders.title', 'Orders')
```

**English is the source of truth**, in `packages/i18n/locales/en-US/`. Keys are
added there first. There are five namespaces — `common`, `ui`, `studio`,
`generated`, `errors` — one per surface.

**A key must exist in all eight locales with a real translation.** The parity
test fails on a missing *or* extra key, so a half-translated key cannot be
merged quietly. It also checks that every message parses as ICU, that argument
names match English exactly, that plural branches use only the categories the
language actually has and always include `other`, and that `zh-CN` and `zh-TW`
have not been collapsed into each other.

**The JSON is canonical; the TypeScript is generated.**
`locales/<tag>/<ns>.json` is what translators and tooling read;
`src/resources/<tag>/<ns>.ts` is a generated mirror, regenerated with
`pnpm --filter @adminium/i18n gen:resources`. English is bundled statically
because it is the fallback and must never be async; every other locale is a
dynamic `import()`, one chunk each.

**Messages are ICU, never concatenation.** Word order differs per language, so
`t('a') + ' ' + t('b')` is wrong in some locale you are not testing in.

**Formatting goes through the `Intl` layer.** Dates, numbers and currencies are
never hand-formatted. Digits have a policy: locale digits are correct in prose
(Arabic-Indic in `ar-EG`), Latin digits are correct in a monospaced data cell,
and `@adminium/i18n/format` is what knows the difference.

## Parity is not translation

This is the part worth internalising: parity proves every locale has every
*key*. A bundle of machine drafts and a bundle a native speaker signed off on
look identical on disk.

`locales/<tag>/.meta.json` records, per key, whether the translation is a draft
(`mt`) or `reviewed`, plus a hash of the English it was made from. Staleness is
**derived, never stored** — an entry is outdated exactly while the current
English hashes differently. Storing a flag instead would be lossy: an
edit-then-revert of the source could never clear it, because the record of what
the translator actually read would already be gone.

## What it means for a contributor

- Adding a string is: the English key, the same key in the other seven locales,
  then regenerate the mirrors. The parity gate runs in `pnpm test` and in CI.
- Use logical CSS properties, always —
  [tokens only, no `style` props](/anatomy/decisions/tokens-only/) covers why a
  physical direction is a bug in Arabic.
- Some things are never translated: `Adminium`, `Studio`, SQL keywords,
  `adminium_*` table names, HTTP methods, format badges, keyboard shortcuts.
- A string that names something the user can act on may also need an accessible
  name. Those keys are on a list the server refuses to blank, checked by
  `pnpm a11y-keys-check`.

`packages/i18n/TRANSLATIONS.md` is the working reference: plural categories per
language, the per-language typographic conventions, and how to add a ninth
locale.
