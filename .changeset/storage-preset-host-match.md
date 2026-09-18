---
'@adminium/dashboard': patch
---

**Reopening an S3 destination reads the endpoint's host, not any part of its URL.** The storage
editor picks the preset whose provider the endpoint actually addresses. The match used to be a
substring test over the whole endpoint, so `https://minio.internal/?ref=wasabisys.com` reopened as
Wasabi, and so did `https://wasabisys.com.example.net` — a mislabelled dropdown, and the shape
CodeQL flags as `js/incomplete-url-substring-sanitization`.

The endpoint is now parsed, and the question asked of it is whether its host IS the provider's
domain or sits under it. A per-account or per-region subdomain still matches, because that is how
these providers issue endpoints — `nyc3.digitaloceanspaces.com`,
`<account>.r2.cloudflarestorage.com`, `s3.eu-central-1.wasabisys.com`. A lookalike does not. An
endpoint typed without a scheme is still understood, since the field accepts one; an endpoint that
cannot be parsed is MinIO, which is what "some other S3" has always meant here.
