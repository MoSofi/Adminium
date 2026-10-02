<!-- produced from apps/docs/src/content/docs/projects/apps.md § Try it, then pack it; do not edit -->

# An app in your project: Try it, then pack it

```bash
npx @adminiumjs/adminium app try
```

[`adminium app try`](https://docs.adminium.dev/reference/cli/#app-try) proves the app installs. It packs it, starts a fresh
Adminium in a temp folder with an empty SQLite database, and installs the package through the same
routes Studio uses. Then it opens each side, reads a table as the signed-in person, and asks the
public API for what `access.json` grants and for what it does not:

```
✓ the package uploads (repairs-0.1.0.tgz, 9 files)
✓ the table check passes (2 table(s) to create)
✓ it installs: tables, pages, roles
✓ the sample data loads
✓ the staff side is served at /apps/repairs/staff/ (2 file(s) it names)
✓ the customer side can read "items", as access grants
✓ the customer side cannot read "requests", which access does not grant
✓ the customer side cannot read a table outside the app
```

A refusal is printed in the server's own words. Nothing listens on a port, and nothing in your
project or its database is touched.

```bash
npx @adminiumjs/adminium app pack
```

[`adminium app pack`](https://docs.adminium.dev/reference/cli/#app-pack) writes `.adminium/packs/<key>-<version>.tgz` and
its fingerprint beside it. Install it on any Adminium from **Studio → Hosted apps → Install an
app**: upload the file and paste the fingerprint
([Installing apps](https://docs.adminium.dev/self-hosting/installing-apps/)). The project's hooks and actions are not part of
the package: they stay in the project.
