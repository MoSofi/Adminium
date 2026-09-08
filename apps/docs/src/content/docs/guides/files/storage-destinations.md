---
title: Where your files are stored
description: The default is this server's own disk. When your host has no persistent disk it is not enough — configure a destination on a bucket or your own server, and here is the recipe per host.
---

Every byte Adminium stores goes through one seam: uploaded attachments, export
artifacts, uploaded CSVs waiting to be imported, and the branding logo. A
**destination** is where that seam puts them.

## The default: this server's disk

With nothing configured, files live on the machine Adminium runs on, under
`ADMINIUM_DATA_DIR/files`. Nothing to set up, nothing to pay attention to, and
it is the right answer whenever that directory survives a restart:

- Docker or Compose with a named volume — including a DigitalOcean **Droplet**,
  Hetzner, or your own box
- **Fly.io** with a volume mounted at `/data`
- **Render** with its persistent disk
- The **desktop app**, where the data directory lives with the rest of your
  Adminium data

If that describes your deployment, you can stop reading. The rest of this page
is about the one case where the default loses your files.

## When the default is not enough

Some runtimes give a container **no persistent local disk**. `deploy/do-app.yaml`
says so in its own header for DigitalOcean App Platform: containers there have
no persistent local disk, so anything written to the filesystem is gone at the
next deploy.

:::caution[On a host with no persistent disk, a destination is required]
Without one, every uploaded file, every export artifact and the branding logo
is written to a filesystem that will not exist after the next redeploy — and the
database rows describing them are left pointing at nothing.

This was already true before uploads existed: on App Platform, Adminium silently
lost every export and the uploaded logo on every redeploy. Configuring a
destination is what fixes it, for files of **every** kind.
:::

Set the destination **before the first boot** if you can, with
[`ADMINIUM_STORAGE_URL`](/self-hosting/env-vars/) — the window between "the
container came up" and "somebody opened Studio" is exactly when the first export
runs.

## The three kinds of destination

Configure them in **Studio → Settings → Storage** (`/studio/storage`, needs the
`storage.manage` permission), or seed the first one from the environment.

| Kind | What it is | What it needs |
|---|---|---|
| **A path on this machine** | A directory you choose — a mounted volume, an SMB or NFS mount, a NAS path | **Directory**: an absolute path |
| **S3-compatible bucket** | AWS S3, DigitalOcean Spaces, Cloudflare R2, Tigris, Backblaze B2, Wasabi, MinIO, Garage, Supabase Storage, Google Cloud Storage through HMAC interop | **Endpoint** (blank for AWS itself), **Region**, **Bucket**, optional **Prefix**, **Path-style addressing** on or off, optional **Public base URL**, **Access key ID** + **Secret access key** |
| **WebDAV server** | A NAS, Nextcloud, a Hetzner Storage Box, nginx or Caddy with WebDAV switched on | **Collection URL**, optional **Prefix**, optional **Public base URL**, **Username** + **Password** |

Two fields deserve a note:

- **Prefix** — a key prefix inside the destination. `invoices/` and `avatars/` on
  one bucket are two destinations that differ only here, which is the cheap way
  to share a bucket without sharing a namespace.
- **Public base URL** — a CDN or share URL under which the objects are readable
  *without* Adminium. It is used for exactly one thing: minting the link written
  into your own column when that column stores a link
  ([file columns](/guides/files/#a-file-column)). It is never used to
  render an image in the dashboard, and never as a read path for Adminium
  itself.

Secrets never come back out. A destination you read through the API says
`hasSecret: true` and nothing more; editing a destination sends a key only when
you actually replace it. Configuration bundles do not carry destinations at all
— re-add them on the target instance.

:::caution[Backups do not include your files]
The Adminium backup archive carries the meta store, any local SQLite source
databases, and the desktop config — **not the bytes of stored files**, wherever
they live. Files on this server's disk are backed up by whatever backs up that
directory; files on a bucket or a WebDAV server are that provider's to protect.
:::

## Per-host recipes

:::note[Not yet validated against a live account]
The endpoint strings, regions and addressing flags below are written from each
provider's documented shape and from Adminium's own provider presets. **None has
been confirmed against a live account yet** — a live deploy on at least one host
with no persistent disk is still owed. Treat them as a starting point, press
**Test** (below) before you rely on one, and correct the endpoint from your
provider's console if it differs.
:::

Each recipe is: what to create on the host, then either the values you type into
Studio, or the single `ADMINIUM_STORAGE_URL` that seeds the same thing on first
boot.

### Fly.io + Tigris — nothing to configure

```sh
fly storage create
```

That provisions a Tigris bucket and writes `AWS_ENDPOINT_URL_S3`, `AWS_REGION`,
`BUCKET_NAME`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` into your app's
secrets. Adminium's first-boot seed reads exactly those five when
`ADMINIUM_STORAGE_URL` is unset, so a Fly deploy is zero-config. They are the
only `AWS_*` variables Adminium reads anywhere.

### Fly.io with a volume only

```sh
fly volumes create adminium_data --size 1
```

Already in `deploy/fly.toml`, mounted at `/data`. This server's disk is then
fine — with one caveat: a Fly volume belongs to one machine in one region and is
not replicated, so it holds for a single-machine app. Scale past one machine and
you want Tigris or another bucket.

### DigitalOcean App Platform + Spaces — the one that matters

App Platform has no persistent local disk, so uploads need a Space — and so
does every export artifact and the branding logo. This is the one recipe on this
page that is not optional.

1. Create a **Space** and a **Spaces access key** (an access key ID and a secret).
2. Optionally enable the Space's CDN.
3. Set the variable before the first deploy:

```yaml
ADMINIUM_STORAGE_URL: s3://my-space?endpoint=https://nyc3.digitaloceanspaces.com&region=nyc3&pathStyle=0&accessKey=DO00EXAMPLE&secretKey=...&publicBaseUrl=https://my-space.nyc3.cdn.digitaloceanspaces.com
```

Or, in Studio, choose the **DigitalOcean Spaces** provider preset and fill in:
endpoint `https://<region>.digitaloceanspaces.com`, region `<region>`,
path-style addressing **off**, bucket = the Space's name.

`publicBaseUrl` is optional and only worth setting if the Space is public and
you want your table to carry CDN links rather than Adminium links.

### DigitalOcean Droplet

Nothing to create — the Compose volume is persistent, so this server's disk is
correct. Add a Space later if you want the bytes off the box; the recipe is the
same one above.

### Render

The disk declared in `deploy/render.yaml` is mounted at `/data`, so this
server's disk works. It starts at 1 GB — raise `sizeGB`, or send the bytes to an
S3-compatible bucket or a WebDAV server when the disk is no longer the right home
for them.

### AWS S3

Create a bucket and an IAM user with `s3:PutObject`, `s3:GetObject` and
`s3:DeleteObject` on it. `s3:ListBucket` is **not** needed — Adminium never
lists a bucket.

```yaml
ADMINIUM_STORAGE_URL: s3://my-bucket?region=eu-west-1&accessKey=AKIA...&secretKey=...
```

Leave `endpoint` out: for AWS itself the endpoint is derived from the region as
`https://s3.<region>.amazonaws.com`, and addressing is virtual-host by default.
In Studio this is the **AWS S3** preset, with the endpoint field left blank.

### Cloudflare R2

Create a bucket and an R2 API token.

```yaml
ADMINIUM_STORAGE_URL: s3://my-bucket?endpoint=https://<account-id>.r2.cloudflarestorage.com&region=auto&pathStyle=1&accessKey=...&secretKey=...
```

Region is the literal string `auto`, and path-style addressing is **on** —
unusually for a managed provider, and the endpoint says why. R2's S3 origin is
scoped to your *account* rather than to a bucket, so a bucket is addressed as a
path under `<account-id>.r2.cloudflarestorage.com`; virtual-host addressing
would ask for `<bucket>.<account-id>.r2.cloudflarestorage.com`, which is a
different host. The **Cloudflare R2** preset in Studio sets both the region and
the switch for you.

Add a custom domain as `publicBaseUrl` if the bucket is public.

### Backblaze B2 and Wasabi

Create a bucket and an application key.

```yaml
# Backblaze B2
ADMINIUM_STORAGE_URL: s3://my-bucket?endpoint=https://s3.us-west-004.backblazeb2.com&region=us-west-004&pathStyle=0&accessKey=...&secretKey=...

# Wasabi
ADMINIUM_STORAGE_URL: s3://my-bucket?endpoint=https://s3.eu-central-1.wasabisys.com&region=eu-central-1&pathStyle=0&accessKey=...&secretKey=...
```

The region is part of the endpoint hostname on both, and must match it.

### MinIO, Garage, or any S3 server of your own

One binary, one bucket, one key. This is also the answer for a bare VPS that
only offers SSH — run MinIO on it rather than looking for an SFTP driver, which
Adminium does not have.

```yaml
ADMINIUM_STORAGE_URL: s3://adminium?endpoint=https://minio.example.com&region=us-east-1&pathStyle=1&accessKey=...&secretKey=...
```

Path-style addressing **on**: a self-hosted server issues no per-bucket
hostnames. The region is ignored by the server but still signed, so give it one.

### Supabase Storage

Create a bucket and S3 access keys in the project's settings.

```yaml
ADMINIUM_STORAGE_URL: s3://my-bucket?endpoint=https://<project-ref>.storage.supabase.co/storage/v1/s3&region=<region>&pathStyle=1&accessKey=...&secretKey=...
```

Path-style addressing is **on** here too, and not by taste: the endpoint carries
a path (`/storage/v1/s3`), and virtual-host addressing moves the bucket into the
hostname and keeps only the origin — which would drop that path.

### A NAS, Nextcloud, a Hetzner Storage Box, or nginx

Enable WebDAV and create a user.

```yaml
ADMINIUM_STORAGE_URL: webdavs://user:pass@nas.example.com/adminium
```

`webdavs://` dials HTTPS; `webdav://` dials plain HTTP, which is only reasonable
on a LAN. A handful of lines of nginx are enough to serve one:

```nginx
location /adminium/ {
  dav_methods PUT DELETE MKCOL;
  create_full_put_path on;
  auth_basic "files";
  auth_basic_user_file /etc/nginx/.htpasswd;
  client_max_body_size 2g;
}
```

`client_max_body_size` has to be at least as large as your `files.maxBytes`, or
large uploads fail at the proxy rather than at Adminium.

### Another directory on this machine

A mounted volume, an SMB share, a second disk:

```yaml
ADMINIUM_STORAGE_URL: file:///mnt/storage/adminium
```

Three slashes. `file://mnt/...` reads `mnt` as a host name and is refused.

### Netlify and Vercel

The Adminium server does not run on either — they run functions, not a
long-lived process. The example applications deploy there happily and talk to an
Adminium running elsewhere; the destination is configured on **that** server.

## Testing, defaults, and moving files

### Test

Every destination — including a half-filled one in the editor, before you save
it — has a **Test** button. It writes a 1 KiB probe object, reads it back, and
deletes it. Success shows the round-trip time; failure shows the provider's own
error text verbatim, which is usually the difference between a wrong key and a
wrong endpoint.

A destination that has never been tested says so. One that failed shows
*Unreachable* until it passes.

### Set as default

Exactly one destination is the default. Once one exists, **every new file of
every kind** is written there: attachments, export artifacts, uploaded CSVs, the
branding logo. Files already stored stay exactly where they are.

That "every kind" is the point on a host with no persistent disk — an export
artifact is no safer on a disk that does not survive a deploy than an attachment
is.

### Move files

**Move files…** on the storage page moves existing bytes from one destination to
another, optionally limited to certain kinds of file. It runs in the background
as a job and keeps going if you leave the page; the per-destination counts
change as files arrive.

Per object, it copies, **re-computes the SHA-256 from what actually landed**,
flips the row to the new destination, and only then deletes the source. That
order is deliberate: interrupt it at any point and you get either an orphaned
copy the next run overwrites, or a source object left behind as litter — never a
row pointing at bytes that are not there.

:::caution[A move does not rewrite links already in your tables]
References that are Adminium file ids, or Adminium links, keep resolving after a
move — they name the file, not the place.

A reference minted from a destination's **public base URL** does not: it still
points at the old base. The move counts how many of the files it moved sat on a
destination that publishes one and records that in its result, so the number is
told to you rather than discovered later. Adminium will not write into your own
tables to fix them.

This is the reason to prefer the `id` shape on a file column whose destination
you expect to move.
:::

### Deleting a destination

A destination that still holds files refuses to be deleted, and says how many.
Move them, or delete them, first.

## Reading the usage figures

The storage page shows, per destination, the bytes used and the number of files;
for this server's disk it also shows how much room is available on that disk.
These are facts about your infrastructure, measured from your own rows and your
own filesystem. The only size limit Adminium applies is per file
(`files.maxBytes`); there is no ceiling on the total.

## What is not included

Honest and short:

- **No presigned or direct-to-bucket transfers.** Every byte goes through the
  Adminium server in both directions, so the permission check and the
  content-type gate always apply, and every upload, attach and delete leaves an
  audit record. That costs bandwidth on your server and buys the guarantee that
  no link to your bytes outlives the permission that granted it.
- **No folders.** Files belong to records and tables; there is no folder tree in
  Adminium's own store, and no move-into-folder.
- **No thumbnails generated on the server.** A grid preview is the original
  image drawn small, and only below `files.thumbnailMaxBytes` (2 MB). Nothing is
  resized.
- **No Azure Blob and no native Google Cloud Storage API.** GCS works through its
  S3 HMAC interoperability mode; Azure Blob is not S3-compatible and has no
  driver.
- **No SFTP driver.** Run MinIO on the box instead.
- **No resumable or multipart uploads**, and no virus scanning.
- **No deduplication.** Two uploads of the same bytes are two files.

## Related

- [Attaching files to records](/guides/files/) — the two binding modes
- [`ADMINIUM_STORAGE_URL`](/self-hosting/env-vars/) — the full grammar, and the
  once-only seeding rule
