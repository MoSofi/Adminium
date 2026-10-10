<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — What an add-on tells the assistant; do not edit -->

# Manifest spec: Add-on manifests — What an add-on tells the assistant

### What an add-on tells the assistant

`addOn.assistant` is text, in two parts, and either may be left out:

```json
"assistant": {
  "tables": {
    "vouchers": { "is": "A single-use code issued to one person.", "columns": { "uses_left": "How many times it can still be used." } }
  },
  "questions": [
    { "key": "unused", "text": { "en-US": "Which vouchers were never used?", "…": "…" } },
    { "key": "batch", "page": "offers-voucher-batches", "text": { "…": "…" } }
  ]
}
```

| Part | Rule |
|---|---|
| `tables` | One of the add-on's own tables → `is`, one English line (200 characters) on what a row of it is, and `columns`, a line (160) for a column that needs one. The assistant is given them with the schema, as the add-on's words about its table, wherever it looks at that table. |
| `questions` | Up to 8 questions a person might ask, in every one of the eight languages (120 characters). Shown as starters in the assistant's panel on the add-on's pages, under the add-on's name. With `page` (one of the add-on's page refs, generated or its own) a question is shown on that page only. |

It names no tool, grants no read and switches nothing on. A reader who may not read a table is
told nothing of it; the lines travel as data inside the schema tool's answer, never as
instructions; and no other key is accepted. A manifest that uses it sets
`compatibility.minAdminiumVersion` to `0.3.22` or later.
