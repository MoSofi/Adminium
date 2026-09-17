---
'@adminium/server': patch
---

**On an old Node, the CLI now says so instead of crashing.** On Node 21.5,
`npx @adminiumjs/adminium` → "In your browser" printed `segmentation fault` and
nothing else. The SQLite driver, better-sqlite3 13, ships binaries that need
Node-API 10. Node has Node-API 10 from 22.14, or 23.6 on the 23 line. An older
Node does not report an error when it loads one. It crashes. npm gave no
warning first, because the package declared no Node version and
better-sqlite3's own declaration says `>=22`.

`adminium` now checks the Node version before it loads anything else. On an
older Node it prints the version it found, the minimum (22.14) and how to
upgrade, then exits with code 78. The package also declares
`"engines": { "node": "^22.14.0 || >=23.6.0" }`, so npm warns at install time.
The documented minimum is now Node.js 22.14 everywhere it is stated.
