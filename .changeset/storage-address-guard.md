---
'@adminium/server': patch
---

An S3 endpoint or a WebDAV address that points at the cloud metadata service is now refused when the destination is created, edited or tested, and a destination saved with one earlier stops being used. In production, an address on this machine itself (`127.0.0.1`, `localhost`, `[::1]`) is refused too; put the storage service behind its own host name. For S3 the check covers the address the requests really go to, which is built from the region and the bucket when no endpoint is set.
