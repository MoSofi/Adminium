---
'@adminium/server': patch
---

A trial can now run an operator's project on the visitor's own database. With `ADMINIUM_OPERATOR_PROJECT=on` the project is built from the environment, and `ADMINIUM_YOUR_DATABASE` names the visitor's Postgres or MySQL database (its address, what it is for, which tables, read-only, a label and notes). It connects after the server is listening, so a database that is down never holds up the start, and it is reached only at the one host `ADMINIUM_DATABASE_USER_HOST` allows, never at an address in `ADMINIUM_DATABASE_DENY_ADDRESSES` or a reserved range.

- `adminium check-source` reads a database address from its input and says whether this server would connect to it, and if not, why.
- `adminium archive create` and `archive restore` work beside a stopped trial with an operator project. `--without-your-database` leaves the visitor's address out of the archive; the restored database waits as a draft until its address is given again.
- `ADMINIUM_AI_BUILD_API_KEY` is a second key for the AI server that Designer builds and the schema assistant use, so their spending can be told apart. The Designer's start prompt (`ADMINIUM_DESIGNER_START_PROMPT_B64` or `_FILE`) runs once for the owner, and waits by itself when the AI server is busy.
- Once the visitor's database is connected and the owner's account exists, the schema assistant runs once with the visitor's notes and applies what it is sure of. It can be undone later. If the AI server is busy it waits and tries again, and it never runs twice, even after a restore.
