<!-- produced from apps/docs/src/content/docs/projects/deploy.md § Railway; do not edit -->

# Deploy a project: Railway

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
