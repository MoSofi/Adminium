---
title: Pictures on public pages
description: How an app shows staff-uploaded pictures, such as a show's poster or a dish's photo, to every visitor, what Adminium cleans out of them first, and what a page puts in an img tag.
---

A box office shows each show's poster, and a restaurant's menu shows each dish. Staff upload the
picture in the staff screens, and every visitor sees it on the app's public pages. An `<img>` sends
no key and no session, so these pictures are served by a route of their own. It asks for neither,
and serves a picture only when the app declared it public and the row it belongs to is one anyone
may read.

## Declaring them

A picture lives in an **image column**: a text column with `"semantic": "image"`, which holds the
file Adminium keeps for it.

```json
{ "ref": "poster", "type": "text", "maxLength": 400, "nullable": true, "semantic": "image" }
```

A read-only entry of the guests' key names its image columns in `pictures`:

```json
{ "table": "events", "methods": ["GET"], "select": ["id", "name", "starts_at", "poster"], "pictures": ["poster"] }
```

The validator refuses `pictures` unless all of these hold:

| Field | Rule |
|---|---|
| `pictures` | 1 to 4 columns of the entry's table. |
| The entry | Only reads rows: `methods` is `["GET"]`, and it is not an availability entry. |
| The entry | Is for every visitor: no `claim`, `claimedBy` or `visibleWith`. A signed-in person's own files are `files` ([Files and documents](/guides/apps/public-access/#files-and-documents)). |
| `key` | The app's `customer` key. |
| Each column | Text with `semantic: "image"`. |
| Each column | In `select`, when the entry has one. |
| Each column | Not written by the entry (`writable` or `defaults`). |
| Each column | Not in the entry's `files`. |
| Each column | Not kept from readers: not a secret, not a code, not a shared link's code. |
| Each column | Not personal data (`personal: true`). |

See the [manifest reference](/reference/manifest/#pictures).

## What a page puts in `<img src>`

`/public/config` says where the key's pictures are, and which columns of each entry are pictures:

```json
{ "data": { "pictures": "/api/v1/public/pictures/pbk_01J9Z6Q4M2V8XK3T7B5N0R4WQE", "refs": { "boxoffice_events": { "pictures": ["poster"] } } } }
```

The address is built from the key's id, never its token. An app that runs as several instances has
a key for each, so each instance's pictures have their own addresses. A picture's full address
names the entry, the row, the column and the file:

```text
GET /api/v1/public/pictures/{keyId}/{ref}/{rowId}/{column}/{fileId}
```

The row's column holds the file, either as its id (`file_…`) or as its content address
(`…/api/v1/files/file_…/content`). `@adminiumjs/public-client` turns the value into the address:

```ts
import { pictureUrl } from '@adminiumjs/public-client';

const config = await client.config();
const { data: events } = await client.list('boxoffice_events');
for (const event of events) {
  const src = pictureUrl(baseUrl, config, 'boxoffice_events', event.id, 'poster', event.poster);
  // null: no picture Adminium keeps (empty, or a link elsewhere). Show the page's own tile.
}
```

`pictureUrl` answers null when the entry shows no picture in that column, or the value names no
file Adminium keeps.

## When a picture is served

The file id alone is never enough: ids are handed out in order, so a neighbour's is easy to guess.
A picture is served only when all of these hold at the time it is asked for:

- **The key** is live, is the app's customer key, and is not bound to a staff screen.
- **The entry** is one of the key's reads that shows this column as a picture to every visitor.
- **The row** is read through the entry's own filters: a show not yet published or a dish off
  the menu is no row at all. Its column names exactly this file, so the address of a picture
  since replaced answers nothing.
- **The file** is live, on the key's own database, and attached to this very row. Adminium
  attaches a file to the row whose column is saved with it, through the staff screens or the data
  API. A file id another row's column was made to name is nothing.
- **The bytes** are a picture, within the sizes [below](#sizes-and-types).

Every refusal is the same `404` `PUBLIC_REF_NOT_FOUND`: which rule said no is nobody's business.

While the public API, the app or its customer side is off, the answer is `503`
(`PUBLIC_API_DISABLED`, `APP_DISABLED`, `SURFACE_OFF`), and `PUBLIC_KEY_OFF` while the key's switch
in the settings row is off.

## Cleaned once, and kept

Staff upload what their camera made. Before a stranger's browser gets it, Adminium reads the file
again and takes out what the camera wrote beside the picture: where it was taken (a kitchen, a
home), the device, comments and XMP.

| Type | What is kept |
|---|---|
| JPEG | The image, its JFIF block, colour profile and Adobe colour block. Nothing after the image's end, and between the scans of a progressive picture the same blocks go as before the first. |
| PNG | Its pixels, palette, transparency, colour chunks, physical size and an animation's frames. Any other chunk goes, including text, time, Exif, a content credential and private chunks: a chunk Adminium does not know is one it cannot vouch for. |
| WebP | Its image (lossy, lossless, alpha), extended header, animation and colour profile. Exif, XMP and any unknown chunk go. |
| GIF | Its frames and its loop. Comments and other application blocks go. |

A picture is cleaned **once**, the first time anyone asks for it. The cleaned copy is kept beside
the original file, in the same storage, and served from there after that, even after a restart or
from another server. It goes when the original does. The original is never changed.

At most two pictures are cleaned at once on a server, and one for any one visitor. A request past
that is answered `503` `PUBLIC_UPSTREAM_UNAVAILABLE` with `Retry-After: 1`.

## Caching

A picture is served for any page to show, and for browsers and caches to keep:

| Header | Value |
|---|---|
| `cache-control` | `public, max-age=604800, immutable`: a week |
| `etag` | `"p2-"` and a SHA-256 of the bytes served, never of the original |
| `content-disposition` | `inline`, named after the column (`poster.jpg`), never the name staff gave the file |
| `access-control-allow-origin` | `*` |
| `cross-origin-resource-policy` | `cross-origin` |
| `content-security-policy` | `default-src 'none'; sandbox` |
| `x-content-type-options` | `nosniff` |
| `referrer-policy` | `no-referrer` |

A browser that sends the tag back in `If-None-Match` gets `304`, answered before the picture is
opened and without counting against the key. The address never changes for a given picture: a new
picture is a new file, and so a new address.

The `p2-` prefix is the version of the cleaning. When the cleaning changes, the prefix changes, and
browsers fetch each picture once more.

## Sizes and types

| Rule | Limit |
|---|---|
| Type | PNG, JPEG, WebP or GIF, by what the file's bytes are. SVG is never served: it can carry script. |
| File size | 2 MiB at most. |
| Picture size | 8192 pixels a side at most. |
| Frames | 500 at most in an animation (or scans in a progressive JPEG). Every frame lies inside the picture. |

A picture outside these is not served, and answers `404`. A photo resized for the web is far
smaller than any of them.

## Rate limits

| What | Limit |
|---|---|
| One visitor | 1,200 pictures a minute, counted before the key is looked up |
| The whole key | 6,000 pictures a minute, every visitor together. A `304` does not count. |

Over a limit, the answer is `429` `PUBLIC_RATE_LIMITED` with `Retry-After`. An address that keeps
naming keys that do not exist is refused before the lookup. See the
[REST API reference](/reference/rest-api/) and the [errors reference](/reference/errors/).

## Upgrading

Pictures cleaned by an earlier version carry an older tag, so each browser fetches each picture
once more after the upgrade.
