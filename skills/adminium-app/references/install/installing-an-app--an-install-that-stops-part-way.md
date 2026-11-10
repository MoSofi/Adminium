<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app — An install that stops part way; do not edit -->

# Installing apps: Installing an app — An install that stops part way

### An install that stops part way

MySQL cannot undo a table it has created, so no engine rolls an app install back. Adminium records
each step instead. If one fails, the install answers `409` with the code `APP_INSTALL_INCOMPLETE`
and names the step it stopped at: the tables, reading them back, the pages, the app's starting
rows (`seeds`), or finishing. The
screen shows **The install stopped part way**, what was already made, and what the database said.

**Nothing is removed.** **Try again** runs the same install again and finishes from where it
stopped: tables that were made are recognised as this install's own, and nothing is created twice.
**Back to Schema plan** checks the tables again first. An install that stopped part way is not
served until it finishes.
