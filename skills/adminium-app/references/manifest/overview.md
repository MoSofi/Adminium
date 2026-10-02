<!-- produced from apps/docs/src/content/docs/reference/manifest.md; do not edit -->

# Manifest spec

A **manifest** is the `manifest.json` at the root of an app or add-on package. It tells Adminium
what the package is, which tables it needs in the operator's database, and what it adds on top of
them: pages in the sidebar, roles, settings, frontends, the add-ons it needs, documents, emails,
public endpoints and sample data. Adminium validates it before anything is installed, and builds
the install plan from it.

In a [project folder](https://docs.adminium.dev/projects/apps/) the same manifest may be written as a `manifest/` folder of
part files, one per table, per page and per block. Adminium composes them into this one document,
so everything below applies unchanged; only where each field is written differs.

This page describes version 1 of the format, which is what Adminium 0.3 reads. For what an operator
sees when they install a package, see [Installing apps](https://docs.adminium.dev/self-hosting/installing-apps/) and
[Installing add-ons](https://docs.adminium.dev/self-hosting/installing-add-ons/).

There are two kinds of manifest:

- An **app** (`"kind": "app"`) is a whole product: its own tables, its own pages and its own
  staff and customer screens, served at `/apps/<key>/<side>/`. Most of this page is about apps.
- An **add-on** (`"kind": "add-on"`) extends an app or the dashboard with code that runs inside
  Adminium. It shares the identity and table blocks and adds an `addOn` block. See
  [Add-on manifests](https://docs.adminium.dev/reference/manifest/#add-on-manifests).
