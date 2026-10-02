<!-- produced from apps/docs/src/content/docs/projects/deploy.md § What every host needs; do not edit -->

# Deploy a project: What every host needs

| | |
|---|---|
| `ADMINIUM_SECRET` | Required. It derives the key encrypting every stored connection string and API key. Generate it once per server (`openssl rand -hex 32`) and **never change it**. |
| `DATABASE_URL` | Whatever `adminium.config.ts` reads for each database — `DATABASE_URL` for `main`, plus one variable per other key. |
| A durable data folder **or** a meta store | Adminium's own tables go to `/data/meta.db` in the image unless you set `ADMINIUM_META_URL` to a PostgreSQL or MySQL database. On a host with no disk, the managed database is the only durable option. |
| Somewhere for files | Uploads, attachments, exports and the branding logo are written under the data folder unless `ADMINIUM_STORAGE_URL` points at an S3-compatible bucket or WebDAV server. [Where your files are stored](https://docs.adminium.dev/guides/files/storage-destinations/). |
| One instance | Keep the service at a single replica: a disk belongs to one machine, and live updates are shared inside one process. |

The image listens on `PORT` (4600 by default) as the `node` user, answers
`/api/v1/healthz` for liveness and `/api/v1/readyz` for readiness — the latter
checks the meta store, so it is the one a load balancer should watch.

> **Caution: `localhost` means the container**
> Inside a container, a database URL on `localhost` or `127.0.0.1` points at the
> container itself, and the image refuses one outright. Use the database's own
> host name or address.
