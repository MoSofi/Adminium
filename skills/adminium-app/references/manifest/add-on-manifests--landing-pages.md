<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Landing pages; do not edit -->

# Manifest spec: Add-on manifests — Landing pages

### Landing pages

`addOn.landing` names the add-on's own tables that hold landing pages and their funnels. Adminium
draws a live page for a stranger, from its published copy, and no code of the add-on runs for one.
The add-on brings the tables, the editor and the staff screens. A manifest that declares it sets
`compatibility.minAdminiumVersion` to `0.3.65` or later, files the add-on under the `marketing`
category, and declares neither `forms` nor `chat` beside it. (`addOn.pages` is another word: the
add-on's own staff screens.)

```json
"addOn": {
  "landing": { "pages": "pages", "funnels": "funnels" }
}
```

Both are required, each a table of its own, and each has a numbered key: an `int` or `bigint`
column with `"role": "pk"`. A funnel's step and a link to another page name a page by it. Staff
write both tables: a role or an app's grant may create, update and delete them. No public entry of
the add-on opens either table. A further column is nullable or has a default.

Each table has these columns, by these names. A table may add its own. A `text` column given here a
length takes at least that many characters, or has no `maxLength`. A column marked "empty" is
`nullable`; every other one is not.

**`pages`**, one row per page:

| Column | Type | What it holds |
|---|---|---|
| `name` | `text` 200 | Staff's own name for the page. A stranger never sees it. |
| `slug` | `text` 80 | The last part of its address, `/x/pages/<slug>`. |
| `state` | `enum` `draft`, `live`, `off` | Being written, served to strangers, or switched off. |
| `language` | `text` 10 | The one language the page is written in. |
| `draft` | `json` | The page as staff are writing it. It may carry Milo's marks. |
| `published` | `json`, empty | The page as published. Strangers see only this. |
| `published_at` | `timestamptz`, empty | When the published copy was written. Adminium sets it. |
| `updated_at` | `timestamptz` | When the row last changed. |

**`funnels`**, one row per funnel:

| Column | Type | What it holds |
|---|---|---|
| `name` | `text` 200 | The funnel's name. |
| `steps` | `json` | At most 8 steps, in order: `[{ "kind": "page", "key": "<row key>" }]` for a page, and `{ "kind": "form", "key": "<row key>", "addOn": "<forms add-on key>" }` for a form (two forms add-ons may hold the same row key). |
| `rule_id` | `text` 64, empty | The rule picked as what happens after the funnel. |

**A slug** is lower-case letters, digits and dashes, 1 to 80 characters, with no dash at either
end. It is never one of the addresses' own words (`api`, `assets`) nor a word a sign-in, a code, the
staff side or a bill is known by: `login`, `log-in`, `logon`, `signin`, `sign-in`, `account`,
`password`, `reset`, `verify`, `verification`, `auth`, `oauth`, `sso`, `2fa`, `admin`, `wp-admin`,
`billing`, `payment`, `payments`, `invoice`, `support` or `security`. A page is published only at a
slug no other page of its table holds (judged again under a lock as the row is written, so two
publishes at one moment cannot both take it). When two installs serve the same slug, the oldest
install with a live page at it answers.

**Publishing.** Adminium seals the columns that publish a page, whoever writes the row and through
whatever door. A write that sets `state` to `live`, writes `published` or `published_at`, or moves a
live page to another slug, is refused unless the row it leaves has a `published` copy that is a
whole page document, carries no Milo mark, and has a slug that keeps the rule above and that no
other page holds.
The refusal is a `422` whose `details.reason` is `landing-unparsable`, `landing-marked` or
`landing-slug`. Adminium writes `published_at` itself whenever `published` changes, and ignores a
value the client sends. Switching a page `off`, or back to a `draft`, is always allowed. Milo never
publishes: a change it proposes may write a page's `draft`, and never its `state`, `published` or
`published_at`, whatever the person's own rights (`403`, reason `landing-assistant`). Every block
Milo adds or changes in a `draft` is marked (`"milo": true`) as it is written, so a person looks at
each before the page can be published.

**The page document**, in `draft` and `published`, is read by `@adminium/add-on-contracts/landing`
on both sides:

```json
{ "v": 1, "title": "Open day", "description": "Sit in the new booths and try the desks.",
  "picture": { "file": "<file id>", "alt": "The showroom in Leeds" },
  "blocks": [
    { "id": "intro", "kind": "hero", "heading": "Open day at our Leeds showroom",
      "text": "Thursday 18 September, 10:00 to 19:00.",
      "button": { "label": "Book a time", "link": { "kind": "form" } } },
    { "id": "book", "kind": "form", "form": "7", "addOn": "forms" }
  ] }
```

`title` holds up to 70 characters and `description` up to 200. A page holds at most 60 blocks.
Every block has an `id` of its own on the page (letters, digits, `_` and `-`, up to 40), and Milo
marks a block it drafted with `"milo": true` until a person has looked at it. The blocks:

| Kind | Fields |
|---|---|
| `hero` | `heading` (120), `text` (600), `button` (`label` 60 and `link`), `picture` |
| `heading` | `text` (120). Its level is the page's to decide. |
| `text` | `text` (5000): paragraphs, split at a blank line. |
| `picture` | `picture` |
| `button` | `label` (60), `link` |
| `columns` | `columns`: 2 or 3 of `heading` (120), `text` (2000), `picture` |
| `features` | `title` (120), `items`: 1 to 12 of `icon`, `heading` (120), `text` (600) |
| `quote` | `text` (600), `who` (120) |
| `questions` | `title` (120, written in the page's language, "Questions and answers" by default), `items`: 1 to 20 of `question` (200), `answer` (2000) |
| `spacer` | `size`: `s`, `m` or `l` |
| `form` | `form`, the key of a form in the forms add-on's forms table, and `addOn`, that add-on's key |

`button`, `picture` and `heading` of a column, and a feature's `title` and `icon`, are optional; the
rest are required. A feature's `icon` is one of `check`, `star`, `heart`, `shield-check`, `clock`,
`calendar`, `map-pin`, `phone`, `mail`, `truck`, `leaf`, `sparkles`, `zap`, `wind`, `volume-x`,
`move`, `users`, `wrench`, `thumbs-up` and `lock`. There is no footer block (the page's footer is
Adminium's), no pay link and never a block of code.

Every text is plain text, with no HTML, no markdown and no link inside it. Markup typed into a text
is shown as the characters typed. A text holds no control character, and only `text`, a hero's
`text`, a column's `text`, a feature's `text`, a quote and an answer may hold a line break.

A **link** is one of `{ "kind": "url", "href": "https://…" }` (an absolute `https:` address of up to
2048 characters, with no user or password: `http:`, `javascript:` and `data:` are refused),
`{ "kind": "page", "key": "<row key>" }` (another page of this add-on) or `{ "kind": "form" }` (the
form block on this page, which the page then must have).

A **picture** is `{ "file": "<file id>", "alt": "…" }`, with a description read aloud of up to 300
characters, or `{ "file": "<file id>", "decorative": true }` for one that is only decoration. The
file is one the page owns, named by its id, never an address or a `data:` URL.

The page has one main heading: the first hero's, else the first heading's, else its `title`, drawn
for screen readers only. Every other heading of a block is a section's, and an item under a titled
block is under that section.

A package that declares landing pages serves them only when Adminium can vouch for its bytes, as
forms and chat are.

#### The pages door
