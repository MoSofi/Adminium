<!-- produced from apps/docs/src/content/docs/guides/apps/guest-uploads.md § The owner's limits; do not edit -->

# Guests' uploads: The owner's limits

The owner sets how much room guests' files take, in the server settings:

| Setting | Default |
|---|---|
| `publicUploads.quotaBytes` | 2 GB of guests' files waiting to be attached |
| `publicUploads.columnsShare` | 50: the percent of it kept for files for an app's columns; the rest is for forms' files |
| `publicUploads.perAddressDaily` | 30 files from one network address in a day |
| `publicUploads.perAddressDailyBytes` | 500 MB from one network address in a day |

Only files still waiting count against the space: a file an order took is the order's. Past a
limit, uploads are refused and every Super Admin is told once an hour, naming the space that is
full. The server's own `files.maxBytes` still holds every upload.

A 100 MB file has to get through the proxy in front of Adminium too: see
[Behind a reverse proxy](https://docs.adminium.dev/self-hosting/reverse-proxy/#large-uploads).
