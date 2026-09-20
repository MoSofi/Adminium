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

Six invariants hold on every platform:

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
- **Every one of these platforms terminates TLS at its own edge, so every one
  needs `ADMINIUM_TRUST_PROXY=on`.** The platform forwards plain HTTP to your
  container and describes the original request in `X-Forwarded-*`. Adminium does
  not believe those headers until you say a proxy is in front, and the default is
  off because on a directly-reachable process they are attacker-controlled. Left
  off behind one of these edges, `request.protocol` is `http`
  (`apps/server/src/auth/sessions.ts`, `isSecureRequest`), and three things are
  quietly wrong: the session cookie is set **without `Secure`**, the audit log
  records the platform's proxy instead of the client, and every per-IP rate limit
  shares one bucket, so one noisy client throttles everybody. Turning it on is
  safe on all four because the container's port is reachable only through the
  edge. Leave `ADMINIUM_TRUSTED_PROXIES` at its default — `loopback,uniquelocal`
  covers the private address each edge connects from, including Fly's `fdaa::/16`
  — and never set that list while trust is off, which stops the boot on purpose.
  → [Behind a reverse proxy](https://docs.adminium.dev/self-hosting/reverse-proxy/)
- **512 MB is enough on all four of these, and that is a fact about them rather
  than about Adminium.** The size you pick here is the limit on **your container**:
  the platform's orchestrator, its container runtime and its TLS edge run outside
  it and are not charged to you. Adminium is about 165 MB idle and about 220 MB
  during a first boot — 37 meta migrations, introspection and page generation in
  one pass. So the sizes in these files are deliberately the small ones.

  **The 1 GB the docs ask for is for a machine you run yourself.** On a VPS with
  Compose, `dockerd`, `containerd`, a Caddy container and the distribution's own
  daemons all come out of the same memory as the server, which is where 512 MB
  stops working — see [A VPS without Docker](https://docs.adminium.dev/self-hosting/vps/).

  Two reasons to pick a bigger size anyway: a **large schema**, because the first
  boot's cost scales with table and column count rather than row count, and the
  fact that **Node takes its heap ceiling from the memory limit it can see**, so a
  512 MB container caps the old space near 256 MB. None of these instances has swap.

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
   - `ADMINIUM_TRUST_PROXY=on`: Railway's edge terminates TLS and forwards plain
     HTTP, so without it the session cookie loses `Secure` and the audit log
     records the edge — see the fifth invariant above.
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
| **What Studio shows** | Both are listed, marked **Missing**, with a line saying their files are not on this server. The Apps shelf shows that badge in place of the green "Installed"; the installed add-ons list shows it beside the version, where a gone add-on used to read as healthy down to its green "Connected" badge (the credential outlives the volume, the files do not). |
| **What a lost app's URL answers** | `503` with the code `APP_FILES_MISSING`. It used to answer the dashboard's "page not found" page with **HTTP 200**, so an uptime check reading only the status stayed green. A check on `/apps/<key>/<side>/` now goes red, which is the point. |
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

**Not supported — and why:** Netlify and Vercel run functions/serverless, not a
long-lived process with a persistent meta store, so Adminium-the-server does not
run there. (The marketplace *example frontends* are static SPAs and deploy to
either fine — that is separate.)

**Status:** these are correct-by-construction drafts written against the published
image. A live one-click deploy on each platform (workplan) and the
affiliate-tagged listing links are owner steps and are not yet done — so the repo
README presents Docker/Compose as the verified path and the managed options as
"bring your own account, config here."
