<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § What a page puts in `<img src>`; do not edit -->

# Pictures on public pages: What a page puts in `<img src>`

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
