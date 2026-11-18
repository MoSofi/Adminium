<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Live chat; do not edit -->

# Manifest spec: Add-on manifests — Live chat

The entry says the words a forms entry may: `table`, `methods` (only `["POST"]`), `key`,
`writable` (at least one), `writableValues`, `defaults`, `requires`, `agrees`, `anonymous`
(required), `requireSetting` and `module`. It names no `source`. One `chat` entry per table, and no
entry lets anyone read that table's rows. A table may carry both a `forms` and a `chat` entry. The
app's key and the table's ref, as `<app>:<table>`, fit in 64 characters. No browser key is named
`chat`, and the public API never serves the entry. A manifest that uses it sets
`compatibility.minAdminiumVersion` to `0.3.64` or later. Under an older floor `chat` is not
reserved: an app written for an earlier Adminium that named one of its own keys `chat` keeps it as
an ordinary key.

A chat entry has no map of its own: the row's columns are found by name among `writable`. The
question goes into the first of `message`, `text`, `question` or `body`; the visitor's name into
`name` or `person`; their e-mail into `email`. The entry's `defaults` are written over whatever the
visitor typed, so `"source": "chat"` marks the row. An entry that opens none of the question's
columns takes no question: the question is kept as a conversation in the chat alone. Adminium never
mails the address a visitor types, and records no consent for it.
