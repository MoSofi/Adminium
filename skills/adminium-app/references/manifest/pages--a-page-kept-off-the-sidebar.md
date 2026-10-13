<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages — A page kept off the sidebar; do not edit -->

# Manifest spec: Pages — A page kept off the sidebar

### A page kept off the sidebar

An app with many tables has many pages, and its sidebar section need not list them all. A page
whose `nav` says `"offRail": true` is left out of the sidebar and is a page in every other way:

```json
{ "ref": "crm-stages", "template": "page-crud", "title": { "key": "mft.crm.page.stages", "fallback": "Stages" },
  "nav": { "group": "selling", "icon": "milestone", "order": 1, "offRail": true },
  "bindings": { "rows": "stages" } }
```

It opens at its address (`/p/crm-stages`), a record of its table opens on it, and search, the
command palette and the assistant's "where is" find it, for whoever may view it
(`page:@crm-stages:view`). Somebody who may not view it finds it nowhere, as with any page: the
key hides a page from the menu and from nobody's reach. A heading of the section whose every page
is kept off the sidebar is not drawn. The only value is `true`; leave the key out for a page on
the sidebar. An owner who edits the page keeps their edit and this key stays the app's to say.
Needs Adminium 0.3.28.
