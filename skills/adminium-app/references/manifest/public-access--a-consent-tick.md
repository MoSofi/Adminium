<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — A consent tick; do not edit -->

# Manifest spec: Public access — A consent tick

### A consent tick

A public entry that takes a tick ("Email me about new shows") says so with `consent`:

```json
{ "table": "orders", "methods": ["PATCH"], "writable": ["opt_in"], "claimedBy": { "table": "customers", "column": "customer_id" },
  "consent": { "column": "opt_in", "purpose": "newsletter",
               "wording": { "version": 2, "text": { "en-US": "Email me about new shows", "de-DE": "Schreibt mir zu neuen Shows" } } } }
```

`column` is a `bool` of the entry's table that the entry writes (`writable`), on a create or a
change. `purpose` is `newsletter` or `surveys`. `wording` is the sentence shown beside the box, in
several languages with `en-US` among them, and its `version` (raise it when the words change): the
consent log keeps the version and the language shown, never a text the request sends. The tick is
kept for the person the entry finds by address (`identity`), whose rows it writes (`claimedBy`), or
the row itself on a [people](https://docs.adminium.dev/reference/manifest/#people) table's own entry; that table is declared in `people`. A box
left unticked writes nothing: it takes back no earlier yes. Needs Adminium 0.3.37.

A tick given (a create with it, or a change that turns it on) adds one row to the consent log from
the form: the sentence in the person's language (their `people` `language` column, else the
browser's languages, else `en-US`) and its version, the network address and the browser. It is the
person's, never the order's, and then sets their `consent` column when it mirrors the same
purpose. A signed-in guest's tick is always their own: their create is linked to them whatever
address they type.
