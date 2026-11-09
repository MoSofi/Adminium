---
'@adminium/server': patch
---

A record page no longer gets a 403 from `GET /api/v1/documents/profiles` for a person without the manifests permission (an app's owner): the route answers everyone signed in, and such a person gets the switched-on mappings they could draw (they read every table the document reads), each by its name only. The record page's Make button now shows for them, as `POST /documents/render` already allowed; setting mappings up stays with `manifests.manage`.
