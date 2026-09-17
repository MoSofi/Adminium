# Deploy manifests

One-click / managed-platform deploy configs for the published Adminium image
(`ghcr.io/mosofi/adminium:latest`). Docker Compose (the repo-root
`docker-compose.yml`) remains the reference deployment; these adapt it to hosts
that provision and bill the infrastructure for you.

| File | Platform | Meta store | Files | Installed apps and add-ons | `ADMINIUM_SECRET` |
|------|----------|-----------|-------|----------------------------|-------------------|
| [`render.yaml`](render.yaml) | Render | SQLite on a 1 GB disk | the disk | the disk | generated once (`generateValue`) |
| [`fly.toml`](fly.toml) | Fly.io | SQLite on a volume | the volume (one machine, one region), or Tigris | the volume | `fly secrets set` (one-time) |
| [`do-app.yaml`](do-app.yaml) | DigitalOcean App Platform | managed Postgres (no local disk) | **a destination is required** | **lost on every deploy**, unless [your own image](#apps-and-add-ons-on-a-host-with-no-disk) carries them | app-level secret (one-time) |
| none, [set up by hand](#railway) | Railway | SQLite on a volume, or Railway Postgres | the volume, or a destination | the volume | service variable (one-time) |

Four invariants hold on every platform:

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
- **Installed apps and add-ons live on the disk, and nothing else can hold
  them.** Their packages are kept in `ADMINIUM_DATA_DIR/apps` and
  `ADMINIUM_DATA_DIR/add-ons`. The meta store only remembers that they are
  installed, and a storage destination does not take them. Render, Fly and
  Railway keep them on the disk or volume above.

## Railway

There is no Railway config file yet, so set the service up in the Railway
dashboard:

1. Create a service from the image `ghcr.io/mosofi/adminium:<version>`. Use an
   exact version, never `latest`.
2. Attach a volume to the service and set its mount path to `/data`.
3. Add these service variables:
   - `ADMINIUM_SECRET`: generate it once with `openssl rand -hex 32`, and never
     change it.
   - `ADMINIUM_DATA_DIR=/data`
   - `RAILWAY_RUN_UID=0`: Railway mounts volumes as root, and the image runs as
     the unprivileged `node` user, which could not write to the volume
     otherwise.
4. Generate a public domain. Railway sets `PORT`, and Adminium listens on it.

For a Postgres meta store instead of SQLite, add Railway's Postgres to the
project and set `ADMINIUM_META_URL=${{Postgres.DATABASE_URL}}`. Keep the volume
anyway, because installed apps and add-ons live on it.

Keep the service at one replica. The volume belongs to a single instance, and
live updates are shared inside one running process. This setup has not yet been
tried on a live Railway deploy.

## Apps and add-ons on a host with no disk

App Platform starts every deploy, and every container it replaces, with an
empty data directory. After that:

| | |
|---|---|
| **Comes back by itself** | The add-ons bundled in the image, at the version the image bundles. |
| **Is gone** | Every installed app, and every add-on the image does not carry at that exact version: one you uploaded, one you updated past the image's copy, or one a newer image now bundles at a newer version. In that last case the Add-ons page offers **Upgrade**, which brings it back. |
| **What Studio shows** | Both still listed as installed. A lost app is not served: its `/apps/...` addresses show the dashboard's "page not found" page, with HTTP 200, so an uptime check that reads only the status stays green. A lost add-on shows as on, and none of it loads. |
| **What the log says** | One error per lost package, with its key and version: `installed add-on is not on this server …` or `installed app is not on this server …`. |
| **Kept** | Everything in the managed database (users, settings, pages, the install records), the tables an app created in your database, and files in your storage destination. |

To put a lost add-on back, upload the same package again on the Add-ons page.
To put a lost app back, upload or download the same version and install it
again; its tables are kept and reused. Both steps have to be repeated after
every deploy.

To stop losing them, build your own image from the published one and put the
exact packages you install into the two folders the boot copies from. The
image's working directory is `/app`, so no variable is needed:

```dockerfile
# An exact version, never latest.
FROM ghcr.io/mosofi/adminium:<version>
# <key>-<version>.tgz, each next to a <key>-<version>.tgz.integrity file that
# holds its sha512- fingerprint (shown beside the Download link on
# adminium.dev/marketplace). COPY adds to the add-ons the image already carries.
COPY add-ons-bundle/ /app/add-ons-bundle/
COPY apps-bundle/ /app/apps-bundle/
```

For example, for the Client Portal app:

```bash
mkdir -p apps-bundle
curl -fo apps-bundle/clients-0.1.1.tgz https://downloads.adminium.dev/apps/clients/clients-0.1.1.tgz
echo 'sha512-…' > apps-bundle/clients-0.1.1.tgz.integrity
```

Push that image to a registry App Platform can pull from, point the `image:`
block in `do-app.yaml` at it, and install the app from the shelf as usual.
Each boot then checks every file against its fingerprint and copies it back.
Rebuild the image before you update a package: a version you install that the
image does not carry is lost again at the next deploy.

**0.2.9 and earlier need two more steps after each deploy.** They copy the
packages back, but load add-on code and read the list of served apps before the
copy finishes. So after each deploy, switch any one installed add-on off and on
again, which reloads all of them, and install any one app again at the same
version, which brings back every app the image restored. Later releases wait
for the copy.

**Not supported — and why:** Netlify and Vercel run functions/serverless, not a
long-lived process with a persistent meta store, so Adminium-the-server does not
run there. (The marketplace *example frontends* are static SPAs and deploy to
either fine — that is separate.)

**Status:** these are correct-by-construction drafts written against the published
image. A live one-click deploy on each platform (workplan) and the
affiliate-tagged listing links are owner steps and are not yet done — so the repo
README presents Docker/Compose as the verified path and the managed options as
"bring your own account, config here."
