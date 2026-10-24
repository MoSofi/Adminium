<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Documents — A kind the add-on does not draw yet; do not edit -->

# Manifest spec: Documents — A kind the add-on does not draw yet

### A kind the add-on does not draw yet

An app may name a document `kind` that the add-on attached to it does not draw yet: the app was
released for the add-on's next version, and the installed one is older. The install and the update
go through all the same (Adminium 0.3.35; an older release refused them). That document is left
off, and so is the attachment a message makes of it: a template whose `attach` is `optional` goes
without it, and one whose `attach` is not fails as for any document that cannot be drawn. The reply
of `POST /api/v1/apps/install` and the `app` of `POST /api/v1/apps/<key>/update` say which documents
wait, in `documents.waiting` (`[{ "kind", "table", "addOn", "addOnName", "name", "reason" }]`), and
the console shows it on the install's last screen and under the update's notice. When the add-on is
updated to a version that draws the kind, the document is made then, with nothing to do in the
app. A profile already made for it is kept meanwhile.
