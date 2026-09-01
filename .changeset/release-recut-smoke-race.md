---
'@adminium/server': patch
---

No functional change — a re-cut of v0.2.4, whose image never promoted: the
release's with-meta smoke used `docker compose up --wait`, which fails the
moment the app's first boot exits on a not-yet-ready Postgres — the exact
startup race `docker-compose.yml` documents as covered by
`restart: unless-stopped` (the container was healthy, migrated, and had seeded
all six bundled add-ons two seconds after the verdict). The smoke now polls
readiness on the design's own terms, and this release is the first whose image
carries the bundled add-on set on `:latest`.
