---
'@adminium/server': patch
---

SQL text a change carries into a statement (an expression default, a kept column type, a check a SQLite rebuild restates) is now read the way its own database reads it. On Postgres the JSON operators `#>>`, `#>` and `#-` are taken, and `#` is a comment on MySQL only; a backquote quotes nothing on Postgres, and on SQLite a bracketed name is read as one, so a `;`, comment or comma inside either is refused where the database would see it.
