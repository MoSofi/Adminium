---
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
---

**Deleting a connection or a public scope that ever had a publishable key works now.**

A connection's public scopes cascade away with it, but a publishable key is
`restrict` on its scope (0014), so the cascade hit the key and the driver
error came back as an unhandled 500 — on every meta dialect, not only
Postgres. The test that claimed "deleting the connection clears both" deleted
the keys by hand first, so it never ran the real path.

The delete now looks at the keys first, in one transaction with the delete:

- A **live** key (not revoked, not expired) refuses the whole delete with a
  `409 PUBLIC_KEYS_LIVE` whose `details.keys` names each key. The migration's
  rule stands: the operator revokes a shipped public surface on purpose, and
  sees what it breaks. It is not a side effect of deleting something else. The
  delete dialog names the keys and points at the Public API page. It no longer
  says "Try again".
- **Revoked or expired** keys break nothing, and nothing else in the product
  can remove their rows, so they are cleared with the connection. Their
  sessions and challenges cascade with them. The `connection.delete` audit row
  lists each cleared key's id and prefix. Their `public-key.revoke` rows are
  unchanged.

Deleting a **scope** had the same dead end in a different form. It refused
while any key row pointed at it, revoked or not. Nothing in the product
removes a key row, so a scope that ever had a key could never be deleted, and
the refusal told the operator to revoke, which did not help. It now follows
the same rule through the same helper: live keys refuse with
`PUBLIC_KEYS_LIVE`, and inert ones go with the scope, named in the
`public-scope.delete` audit row. The Public API page names the blocking keys,
and its delete dialog no longer says "Keys are not deleted".

The FK stays `restrict`, and no migration was needed. The connection's pool is
now released after the row is gone, so a refused delete keeps its pool.
