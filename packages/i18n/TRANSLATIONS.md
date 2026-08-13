# Translation workflow — `@adminium/i18n`

How UI strings flow through the repo, and how to change or add them without
breaking the parity gate. Full policy: `10-i18n-theming.md` (§2–§3).

## Where strings live

```
packages/i18n/
  locales/<tag>/<ns>.json        ← CANONICAL, hand-authored bundles (edit these)
  src/resources/<tag>/<ns>.ts    ← generated mirrors (never edit by hand)
  src/resources/index.ts         ← en-US, bundled statically (fallback text)
  src/resources/lazy.ts          ← per-locale dynamic imports (one Vite chunk each)
  src/resources/parity.test.ts   ← the parity gate (see below)
```

- **Locales (8):** `en-US`, `de-DE`, `fr-FR`, `cs-CZ`, `da-DK`, `zh-CN`,
  `zh-TW`, `ar-EG` — the set locked in `research/BRIEF.md` §2, registered in
  `src/locales.ts` (id, BCP-47 tag, native name, `dir`, font hint). `dir` is
  derived from the locale; `ar-EG` is the only RTL locale today.
- **Namespaces (5):** `common`, `ui`, `studio`, `generated`, `errors` —
  one file per surface, see 10-i18n-theming.md §2.4.
- `en-US` is the **source of truth**: keys are added there first, English text
  is authored there, and every other locale mirrors its key set exactly.

## Changing or adding a key

1. Edit the `en-US` JSON, then add the same key with a real translation to
   **all 7 other locale files** (the parity test fails on any missing or extra
   key — untranslated keys are never merged silently).
2. Regenerate the TS mirrors: `pnpm --filter @adminium/i18n gen:resources`
   (runs `scripts/gen-resources.mjs`).
3. `pnpm --filter @adminium/i18n test` — the parity gate checks:
   - mirror ≡ JSON for every locale/namespace pair;
   - key-set parity with en-US in all locales;
   - every message parses as ICU, with **identical argument names** to en-US;
   - plural branches only use categories the locale has (see below) and always
     include `other`;
   - `zh-CN`/`zh-TW` stay distinct on a sentinel key set.

## ICU rules

- Messages are ICU MessageFormat (`intl-messageformat` via `IcuFormat`); never
  concatenate strings — word order differs per locale.
- Keep argument names identical to en-US (`{count}`, `{total}`, …); rename in
  every locale at once or not at all.
- Numbers/dates inside prose may use `{n, number}` (locale digits apply —
  Arabic-Indic in `ar-EG` prose); anything in a mono data cell goes through
  `@adminium/i18n/format` instead so the latn-digits policy applies (§4.2).
- Cardinal plural categories per language:

  | Locale | Categories to write |
  |---|---|
  | de-DE, da-DK, en-US | `one`, `other` |
  | fr-FR | `one`, `other` (CLDR maps 0 → `one`; `many` exists only for 10⁶+) |
  | cs-CZ | `one` (1), `few` (2–4), `many` (fractions), `other` |
  | ar-EG | `zero`, `one`, `two`, `few` (3–10), `many` (11–99), `other` |
  | zh-CN, zh-TW | `other` only |

## Language-specific conventions

- **zh-TW is translated independently of zh-CN** — never converted
  character-by-character. Terminology genuinely differs (数据库/資料庫,
  软件/軟體, 登录/登入, 用户/使用者, 默认/預設, 保存/儲存).
- **fr-FR** uses typographic apostrophes (’) and a no-break space before
  `? ! : ;`.
- **Never translated:** `Adminium`, `Studio`, SQL keywords, `adminium_*` table
  names, HTTP methods, file-format badges (PDF/CSV/XLSX), keyboard shortcut
  labels (`⌘K`, `G then D`).
- Sentence case in every language that has case.

## Adding a locale

1. Add the registry entry in `src/locales.ts` (id, tag, names, `dir`,
   `fontHint`) — direction and font stacks are data-driven from there.
2. Create `locales/<tag>/` with all 5 namespace files (full key parity).
3. Add the tag to `localeTags` in `scripts/gen-resources.mjs` and run it.
4. Register the 5 lazy loaders in `src/resources/lazy.ts`.
5. If the script needs a new font stack, wire it in `@adminium/tokens`
   `fonts.css` keyed on `html[lang="<tag>"]` (that attribute is stamped by
   `ThemeProvider` and the pre-hydration script).
6. `parity.test.ts` picks the locale up automatically from the registry.

## Runtime shape (why mirrors + lazy loaders)

`en-US` ships in the main JS bundle — it is the fallback text and must never
be async. Every other locale/namespace pair is a literal `import()` in
`src/resources/lazy.ts`, so bundlers emit one chunk per bundle and a `de_DE`
user downloads only German strings. The TS mirrors exist because the runtime
cannot use JSON import attributes portably (browser + NodeNext); the JSON
stays canonical for translators and tooling.

## Review status (`.meta.json`)

Parity proves every locale has every KEY. It says nothing about whether the
translations are any good — a bundle of machine drafts and a bundle a native
speaker signed off look identical on disk. `locales/<tag>/.meta.json` closes
that gap:

```json
{ "common.states.notFound.title": { "status": "mt", "srcHash": "a1b2c3d4e5f6" } }
```

- **`status`** is an intent: `mt` (drafted, unreviewed) or `reviewed`.
- **`srcHash`** pins the *English* the translation was actually made from.

Staleness is **derived, never stored**: an entry is outdated exactly while
`hash(currentEnglish) !== srcHash`. Storing it would be lossy — an
edit-then-revert of the source could never clear the flag, because the record of
what the translator originally read would already be gone.

```sh
pnpm --filter @adminium/i18n i18n:check    # reconcile, report, exit 1 on drift
pnpm --filter @adminium/i18n i18n:meta     # coverage table, read-only
pnpm --filter @adminium/i18n i18n:review -- --locale de-DE --ns ui --all
```

`i18n:check` also regenerates `src/review-status.ts`, the runtime view the
locale picker reads to label a language "(community draft)". `src/review-status.test.ts`
fails if that generated file ever disagrees with the tracked data — otherwise a
stale hand-edit could claim a bundle was reviewed when nobody had read it.

**Ship gate (§3.3).** v1.0 needs `reviewed` = 100% for `common`/`ui`/`errors`
and ≥95% for `studio`/`generated`. Every locale is currently 0% — all 19,439
tracked strings are machine drafts.

## Lint gates

Two rules in `@adminium/config` keep the bundles honest, because both failure
modes are otherwise invisible until a user hits that exact screen in that exact
locale:

- **`adminium/no-literal-strings`** — hardcoded copy in JSX renders English in
  all 8 locales. Scoped to the surfaces that own copy; `@adminium/ui` is exempt
  because every string there arrives as a prop by contract.
- **`adminium/no-dynamic-i18n-key`** — a key assembled at the call site
  (`` t(`op.${x}`) ``) can't be checked against the bundles and renders as a raw
  dotted string on a miss. Use an exhaustive map and index into it. The rule
  flags *fabrication* only; validity of `t(KEYS[x])` is the type checker's job.

Machine-translation bootstrap (`i18n:mt`) and the extraction gate
(`i18n:extract`) remain 10-T14/10-T15 and have not landed.
