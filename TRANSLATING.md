# Translating Adminium

Adminium ships in eight languages: English, German, French, Czech, Danish,
Simplified Chinese, Traditional Chinese and Arabic (with a full right-to-left
layout). Every non-English string was **drafted by machine translation and has
not yet been read by a native speaker**. Until a language has been reviewed, the
language picker labels it "(community draft)".

If you speak one of these languages, reviewing a small batch of strings is one
of the most useful contributions you can make, and a good first pull request.
You don't need to know TypeScript or React.

## How review works

Each string in a non-English bundle has a review status:

| Status | Meaning |
|---|---|
| `mt` | Machine-drafted, never read by a person |
| `src` | Still identical to the English. Either nobody translated it, or it is a word that really is the same (a brand, "OK", "PDF") |
| `outdated` | The English changed after the translation was made |
| `reviewed` | A native speaker read it and signed it off |

A language leaves "community draft" when the `common`, `ui` and `errors`
namespaces are 100% reviewed and the rest are at least 95%.

## Review a batch in six steps

Pick an issue labelled [`translation`](../../issues?q=is%3Aissue+is%3Aopen+label%3Atranslation),
comment which batch you are taking so nobody else does the same one, then:

**1. Get the code.** Fork the repository and clone your fork. Reviewing needs
only Node.js 22 or newer. Installing dependencies is only needed for steps 5
and 6.

**2. Print the review sheet** for your language and batch:

```sh
node packages/i18n/scripts/review-sheet.mjs --locale de-DE --prefix common.nav
```

It prints a table with the key, the English, the current translation and its
status. Add `--status outdated` to see only the strings whose English changed.

**3. Fix what's wrong** in `packages/i18n/locales/<locale>/<namespace>.json`.
For `--prefix common.nav` that file is `packages/i18n/locales/de-DE/common.json`,
under the `nav` key. Things to watch for:

- **Keep placeholders exactly as they are.** `{count}`, `{name}` and `{date}` are
  filled in by the app. Translate the words around them, never the name inside
  the braces.
- **Keep the plural structure.** A string like
  `{count, plural, one {# row} other {# rows}}` must keep `plural` and `#`,
  with a branch for each form your language needs. Arabic uses `zero`, `one`,
  `two`, `few`, `many` and `other`. Don't collapse them into one branch.
- **Keep angle-bracket placeholders** such as `<app>` or `<date>` untranslated.
  They stand for a value in a path or filename.
- **Don't translate** product and brand names (Adminium, PostgreSQL, MySQL,
  SQLite, GitHub, curl) or code identifiers.
- **Match the tone.** Adminium's interface is short, plain and direct. Keep the
  form of address the rest of the language already uses (German uses *Sie*),
  and point out any string that breaks it.
- **Short beats literal.** Labels sit on buttons and in narrow sidebars.

**4. Sign off the strings you actually read.**

```sh
node packages/i18n/scripts/meta.mjs review --locale de-DE --ns common.nav --all
```

`--ns` takes the same prefix as the sheet, so `--all` only marks that batch. To
sign off individual keys instead, use `--keys common.nav.home,common.nav.account`.
Only sign off strings you have read. The status is what tells everyone the
language is ready.

**5. Regenerate the generated files.** From the repository root, after
`corepack enable` and `pnpm install`:

```sh
node packages/i18n/scripts/gen-resources.mjs
node packages/i18n/scripts/meta.mjs gen
pnpm --filter @adminium/i18n test
```

**6. (Optional) See it in the app.** `pnpm dev`, open http://localhost:4600,
then change **Language** in your preferences. Check that the text
fits on buttons and in the sidebar.

## Open the pull request

- Title: `i18n(de-DE): review common.nav`
- One batch per pull request. Small PRs get reviewed and merged quickly.
- Mention anything you were unsure about in the description. "I wasn't sure
  whether *Arbeitsbereich* or *Workspace* is more common here" is useful.
- You don't need to add a changeset; the maintainer will.

## Adding a new language

That's bigger than a review, since a new compiled locale touches types, fonts
and tests. Open a [discussion](../../discussions) first so we can plan it together.
