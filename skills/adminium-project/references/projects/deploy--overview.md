<!-- produced from apps/docs/src/content/docs/projects/deploy.md; do not edit -->

# Deploy a project

A project deploys like any other Node application, in one of two shapes:

- **the image the project's own `Dockerfile` builds**, which is the official
  Adminium image plus your folder. Every host below takes it;
- **a checkout with Node**: `npm ci`, `npm run build`, `npm start`, under
  systemd or whatever runs your other services.

Either way the folder is read-only in production: a server applies the page
files it was deployed with and never writes them. Edits people make in Studio on
that server are kept and flagged, so you can
[pull them back](https://docs.adminium.dev/projects/pull-and-check/) into the repository.
