<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Limits on a guest's change; do not edit -->

# Manifest spec: Public access — Limits on a guest's change

### Limits on a guest's change

`limits` holds a change a guest makes, signed in or not, on a `PATCH` entry: a ticket sent on to
a friend's address.

```json
"limits": { "perValue": { "columns": ["pending_email"], "n": 5 }, "plainText": ["pending_name"] }
```

`perValue` (`{ "columns", "n" }`, 1–4 `text` columns, 1–20) allows each value at most `n` changes a
day that write it: an address a ticket is sent on to. `plainText` lists 1–8 writable `text` columns
that hold plain text only: letters, spaces and sentence punctuation (Latin, CJK and Arabic), up to
80 characters, no digits, no web address (a known ending such as `.com`, or a `/`) and no `@`
handle; "Mary.Ann", "J.R.R. Tolkien" and "St. John" pass. A column given as
`{ "column", "digits", "max" }` takes up to `digits` (1–4) digits and `max` (at most 200)
characters. A stranger's create's
[`plainText`](https://docs.adminium.dev/reference/manifest/#limits-on-a-strangers-create) is the same rule. A limit names `perValue`, `plainText`, or both. Over a limit is `409`
`PUBLIC_LIMIT_REACHED`; a value that is not plain text is `400` `PUBLIC_WRITE_REFUSED`.
