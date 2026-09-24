---
title: Deploy a project
description: Build the project's Docker image on the official one, or run a checkout with Node — on Docker, Render, Fly.io, App Platform, Railway or a plain VPS.
sidebar:
  order: 7
---

A project deploys like any other Node application, in one of two shapes:

- **the image the project's own `Dockerfile` builds**, which is the official
  Adminium image plus your folder. Every host below takes it;
- **a checkout with Node**: `npm ci`, `npm run build`, `npm start`, under
  systemd or whatever runs your other services.

Either way the folder is read-only in production: a server applies the page
files it was deployed with and never writes them. Edits people make in Studio on
that server are kept and flagged, so you can
[pull them back](/projects/pull-and-check/) into the repository.

## What every host needs

| | |
|---|---|
| `ADMINIUM_SECRET` | Required. It derives the key encrypting every stored connection string and API key. Generate it once per server (`openssl rand -hex 32`) and **never change it**. |
| `DATABASE_URL` | Whatever `adminium.config.ts` reads for each database — `DATABASE_URL` for `main`, plus one variable per other key. |
| A durable data folder **or** a meta store | Adminium's own tables go to `/data/meta.db` in the image unless you set `ADMINIUM_META_URL` to a PostgreSQL or MySQL database. On a host with no disk, the managed database is the only durable option. |
| Somewhere for files | Uploads, attachments, exports and the branding logo are written under the data folder unless `ADMINIUM_STORAGE_URL` points at an S3-compatible bucket or WebDAV server. [Where your files are stored](/guides/files/storage-destinations/). |
| One instance | Keep the service at a single replica: a disk belongs to one machine, and live updates are shared inside one process. |

The image listens on `PORT` (4600 by default) as the `node` user, answers
`/api/v1/healthz` for liveness and `/api/v1/readyz` for readiness — the latter
checks the meta store, so it is the one a load balancer should watch.

:::caution[`localhost` means the container]
Inside a container, a database URL on `localhost` or `127.0.0.1` points at the
container itself, and the image refuses one outright. Use the database's own
host name or address.
:::

## Docker

`adminium new` writes the `Dockerfile`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /project
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx --no-install adminium build && rm -rf node_modules

FROM ghcr.io/mosofi/adminium:0.3.0
COPY --from=build --chown=node:node /project/ /project/
ENV ADMINIUM_PROJECT_DIR=/project
```

The first stage installs the project and builds it. The second is the official
image — the server, the dashboard, the bundled add-ons, the unprivileged user,
the `/data` volume and the health check — with your folder copied in and
`ADMINIUM_PROJECT_DIR` pointing at it. Nothing of the build stage's
`node_modules` survives: your hooks and actions are bundled with the npm
packages they import.

```bash
docker build -t my-admin .
docker run -p 4600:4600 \
  -e ADMINIUM_SECRET=$(openssl rand -hex 32) \
  -e DATABASE_URL=postgres://user:password@db.internal:5432/shop \
  -v my-admin-data:/data \
  my-admin
```

With Compose:

```yaml title="compose.yaml"
services:
  admin:
    build: .
    ports: ['4600:4600']
    environment:
      ADMINIUM_SECRET: ${ADMINIUM_SECRET:?generate one with openssl rand -hex 32}
      DATABASE_URL: ${DATABASE_URL:?set the database the admin is built from}
    volumes:
      - admin-data:/data
volumes:
  admin-data:
```

Compose reads those `${…}` values from the shell or from a `.env` file beside
`compose.yaml`. Keep the image tag in the `Dockerfile` equal to the Adminium
version in `package.json`; `npm run check` compares them.

:::note[Packages with native code stay out of the image]
A hook or action that imports a package with native code (a database driver,
for example) is not bundled — the import stays, and nothing installs it in the
image. Keep such packages out of code you deploy this way, or add a stage that
installs them into `/project/node_modules`.
:::

## Render

Commit a Blueprint next to the project and create the service from it:

```yaml title="render.yaml"
services:
  - type: web
    name: my-admin
    runtime: docker
    dockerfilePath: ./Dockerfile
    plan: starter
    healthCheckPath: /api/v1/readyz
    envVars:
      - key: ADMINIUM_SECRET
        generateValue: true
      - key: DATABASE_URL
        sync: false
    disk:
      name: adminium-data
      mountPath: /data
      sizeGB: 1
```

`generateValue` mints the secret once and keeps it stable across deploys, which
is the one property the meta store's encryption depends on. `sync: false` makes
Render ask you for the database URL instead of keeping it in the repository. The
disk holds Adminium's own database, your files and any installed apps and
add-ons; keep it even if you move the meta store to a managed PostgreSQL.

## Fly.io

```bash
fly launch --no-deploy          # writes fly.toml; it finds the Dockerfile
fly volumes create adminium_data --size 1
fly secrets set ADMINIUM_SECRET=$(openssl rand -hex 32) \
  DATABASE_URL=postgres://user:password@host:5432/shop
fly deploy
```

```toml title="fly.toml"
app = "my-admin"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[[mounts]]
  source = "adminium_data"
  destination = "/data"

[http_service]
  internal_port = 4600
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1

[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  grace_period = "40s"
  method = "get"
  path = "/api/v1/readyz"
```

A Fly volume is attached to one machine in one region and is not replicated.
Scale to a second machine and it gets its own empty volume, so stay at one — or
move the meta store to a managed database and the files to a bucket.
`fly storage create` provisions Tigris and writes the credentials Adminium's
first boot reads, with nothing else to configure.

## DigitalOcean App Platform

App Platform containers have **no persistent disk**, so the meta store has to be
a managed database and files need a bucket:

```yaml title=".do/app.yaml"
spec:
  name: my-admin
  services:
    - name: admin
      github:
        repo: you/my-admin
        branch: main
        deploy_on_push: true
      dockerfile_path: Dockerfile
      http_port: 4600
      instance_size_slug: basic-xxs
      instance_count: 1
      health_check:
        http_path: /api/v1/readyz
      envs:
        - key: ADMINIUM_SECRET
          scope: RUN_TIME
          type: SECRET
        - key: DATABASE_URL
          scope: RUN_TIME
          type: SECRET
        - key: ADMINIUM_STORAGE_URL
          scope: RUN_TIME
          type: SECRET
        - key: ADMINIUM_META_URL
          scope: RUN_TIME
          value: ${adminium-meta.DATABASE_URL}
  databases:
    - name: adminium-meta
      engine: PG
      production: false
```

Create it with `doctl apps create --spec .do/app.yaml`, and set the three
secrets in the control panel. `${adminium-meta.DATABASE_URL}` is DigitalOcean's
own binding for the managed database above — never point a source database at
it.

`ADMINIUM_STORAGE_URL` is required here, not optional, and it has to exist
before the first boot: point it at a Space or any other S3-compatible bucket.
One more thing the missing disk costs you: **apps and add-ons you install are
lost on every deploy**, because their packages live in the data folder. Studio
still lists them and the boot log names each one. If you install any, use a host
with a disk, or build your own image carrying those packages —
[`deploy/README.md`](https://github.com/MoSofi/Adminium/blob/main/deploy/README.md)
has the recipe.

## Railway

There is no config file for Railway; set the service up in its dashboard:

1. **New project → Deploy from GitHub repo**, pointing at the project. Railway
   builds the `Dockerfile` it finds at the root.
2. Attach a **volume** to the service with the mount path `/data`.
3. Add the variables: `ADMINIUM_SECRET` (generated once), `DATABASE_URL`, and
   `RAILWAY_RUN_UID=0` — Railway mounts volumes as root, and the image runs as
   an unprivileged user that could not write to the volume otherwise.
4. Generate a public domain. Railway sets `PORT`, and Adminium listens on it.

For a PostgreSQL meta store instead of the volume's SQLite, add Railway's
Postgres and set `ADMINIUM_META_URL=${{Postgres.DATABASE_URL}}`. Keep the volume
anyway: installed apps and add-ons live on it.

## A VPS without Docker

Follow [A VPS without Docker](/self-hosting/vps/) for Node, the meta database,
the settings file, the service and Caddy. Three things differ for a project.

**Install the project, not the package:**

```bash
sudo git clone https://github.com/you/my-admin.git /opt/my-admin
cd /opt/my-admin
sudo npm ci
sudo npm run build
```

The folder belongs to root and the service only reads it. The build has to run
on the server (or be copied there): `.adminium/` is not in git.

**Name the project in the settings file**, since the service does not start in
the folder, and add the database the admin is built from:

```bash title="/etc/adminium/adminium.env"
ADMINIUM_PROJECT_DIR=/opt/my-admin
DATABASE_URL=postgres://user:password@127.0.0.1:5432/shop
ADMINIUM_SECRET=…
ADMINIUM_META_URL=postgres://adminium:…@127.0.0.1:5432/adminium_meta
ADMINIUM_DATA_DIR=/var/lib/adminium
HOST=127.0.0.1
PORT=4600
ADMINIUM_TRUST_PROXY=on
```

`ADMINIUM_DATA_DIR` matters more here than it does without a project: unset, a
project keeps its data inside the folder, which is exactly where a deploy should
not write.

**Run the CLI from the project's own `node_modules`:**

```ini
ExecStart=/usr/bin/node /opt/my-admin/node_modules/@adminiumjs/adminium/dist/cli/index.js start
```

To deploy a change: `sudo git pull`, `sudo npm ci`, `sudo npm run build`,
`sudo systemctl restart adminium`, all in `/opt/my-admin`.

## Before a deploy, pull what changed

A deploy never overwrites a page somebody edited on the server — it keeps the
server's copy and shows a conflict instead. So the habit worth having is:

```bash
npm run pull -- --from https://admin.example.com
git diff                     # review, merge if you had changed the same page
git commit -am "pull server edits"
```

Then deploy. Once the deployed files match, the flags clear by themselves.
Details: [Pull and check](/projects/pull-and-check/).

## Upgrading Adminium

The version is pinned in two places, and they must agree:

```bash
npm install --save-exact @adminiumjs/adminium@0.3.0
# then change the Dockerfile's FROM tag to 0.3.0
npm run check                # this is what compares the two
npm run build
```

Meta-store migrations run when the new version starts and cannot be undone, so
back the meta store up first and read [Upgrading](/self-hosting/upgrades/). A
build made by another Adminium version is refused: the deploy rebuilds it.

:::note[These host recipes have not been tried on live accounts yet]
They are written against each platform's documented settings and against the
same manifests in [`deploy/`](https://github.com/MoSofi/Adminium/tree/main/deploy)
that the published image uses. Docker and Compose, and the systemd setup above,
are the paths that get exercised. If a platform needs something different,
please [open an issue](https://github.com/MoSofi/Adminium/issues).
:::
