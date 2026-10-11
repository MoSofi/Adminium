<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § A link that opens one row; do not edit -->

# An app's public access: A link that opens one row

An app can share one row by a link that needs no email and no sign-in, such as a handover page a
client forwards to their printer. The row holds an unguessable 16-character code that Adminium
makes; the link carries it, and opening it reaches that row and what the app shows with it,
read-only. The link can have an end date and an off switch in the row.

- The key it is served on is its own, never the guests' key, and everything on it only reads.
- It is checked on every request: once the row is switched off, past its end date, or given a new
  code, the link reaches nothing, at once. An unknown code is `404`; one switched off or expired
  is `410`.
- **Make a new link** writes a fresh code, and the old link never opens anything again. It needs
  the right to change the table: `POST /api/v1/data/<connection>/<table>/<id>/regenerate-code`
  with `{"column": …}`. Nobody types a code, not the desk and not an import.
- Staff who read the table see the code, and the new one when they make a new link, so the desk
  can copy the link it sends: the install marks the link's column as no secret, on a table the app
  made. Someone who may change the table but not read it gets the new link made, not the code.
- Nothing public ever shows the code: not the page the link opens, and no other entry or endpoint
  of the table, anonymous or not. One that shows, filters, searches or orders by it is refused.
- The audit log and the automation logs say `[code]` (and `[new code]` for a link made again), and
  the assistant never reads the code: those are read by people who may not read the table, or leave
  the server.
