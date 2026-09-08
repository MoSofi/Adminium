# Deploy manifests

One-click / managed-platform deploy configs for the published Adminium image
(`ghcr.io/mosofi/adminium:latest`). Docker Compose (the repo-root
`docker-compose.yml`) remains the reference deployment; these adapt it to hosts
that provision and bill the infrastructure for you.

| File | Platform | Meta store | Files | `ADMINIUM_SECRET` |
|------|----------|-----------|-------|-------------------|
| [`render.yaml`](render.yaml) | Render | SQLite on a 1 GB disk | the disk | generated once (`generateValue`) |
| [`fly.toml`](fly.toml) | Fly.io | SQLite on a volume | the volume (one machine, one region), or Tigris | `fly secrets set` (one-time) |
| [`do-app.yaml`](do-app.yaml) | DigitalOcean App Platform | managed Postgres (no local disk) | **a destination is required** | app-level secret (one-time) |

Three invariants hold on every platform:

- **`ADMINIUM_SECRET` must be stable forever.** It derives the encryption key for
  every stored DSN and API key; change it and all stored secrets become
  undecryptable. Where the platform can generate-and-persist it (Render), it does;
  otherwise you set it once with `openssl rand -hex 32`.
- **The meta store must be durable.** Platforms with a persistent disk keep the
  embedded SQLite store on the mounted volume; platforms without one (App
  Platform) wire `ADMINIUM_META_URL` to a managed Postgres/MySQL.
- **Files need a durable home too, and it is a separate decision.** Uploads,
  record attachments, export artifacts, the branding logo and imported schema
  files all go through one storage seam, which writes to
  `ADMINIUM_DATA_DIR/files` — this server's own disk — unless a destination is
  configured. On a platform with a disk or a volume, that is the disk or the
  volume, and there is nothing to set. **On App Platform there is no local disk,
  so a destination is required**, and it has to exist before the first boot:
  point `ADMINIUM_STORAGE_URL` at a DigitalOcean Space, any other S3-compatible
  bucket, or a WebDAV server. Fly is the special case — `fly storage create`
  provisions Tigris and writes the five secrets Adminium's first-boot seed
  reads, so nothing else is needed there. Grammar and per-host recipes:
  [environment variables](https://docs.adminium.dev/self-hosting/env-vars/).

**Not supported — and why:** Netlify and Vercel run functions/serverless, not a
long-lived process with a persistent meta store, so Adminium-the-server does not
run there. (The marketplace *example frontends* are static SPAs and deploy to
either fine — that is separate.)

**Status:** these are correct-by-construction drafts written against the published
image. A live one-click deploy on each platform (workplan 17-T17) and the
affiliate-tagged listing links (17-T09/T10/T11) are owner steps and are not yet
done — so the repo README presents Docker/Compose as the verified path and the
managed options as "bring your own account, config here."
