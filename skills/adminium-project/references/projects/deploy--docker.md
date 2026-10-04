<!-- produced from apps/docs/src/content/docs/projects/deploy.md § Docker; do not edit -->

# Deploy a project: Docker

`adminium new` writes the `Dockerfile`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /project
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx --no-install adminium build && rm -rf node_modules

FROM ghcr.io/mosofi/adminium:0.3.17
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

> **Note: Packages with native code stay out of the image**
> A hook or action that imports a package with native code (a database driver,
> for example) is not bundled — the import stays, and nothing installs it in the
> image. Keep such packages out of code you deploy this way, or add a stage that
> installs them into `/project/node_modules`.
