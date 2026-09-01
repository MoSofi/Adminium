---
'@adminium/server': patch
---

An add-on can be connected with an API key, and disconnecting proves what it
promised.

`POST /api/v1/add-ons/:key/connect` takes the add-on's own `secret: true`
setting values, encrypts them under the add-on credential key, and reports the
add-on connected. `DELETE` on the same path removes them. Both are behind
`manifests.manage`, both audited.

**The manifest decides which fields a credential has.** A key it does not
declare is refused rather than stored, and so is a partial set — a credential
store that accepts whatever it is sent is one nobody can audit, and a typo'd
field would otherwise sit there forever looking like a configured secret. A
non-secret setting sent as a credential is the same mistake and gets the same
answer: `demo_transport` is configuration, not a key.

The two kinds that are not `api-key` fail differently on purpose. An add-on
declaring `connect.kind: "none"` is told it needs no connection and works as
soon as it is enabled — that is a fact about the add-on, not a problem with the
request. An `oauth2` add-on is told this build cannot complete the flow yet,
which is a different thing from bad input and should not read as one.

**Disconnect is one delete against a table that holds only secrets.** Nothing
touches the data source, the manifest row, or its attachments, which is what
makes "disconnecting keeps your data" a property of the code rather than a
promise in a dialog. The reply says both halves back, and the add-on stays
installed and attached with `connected: false`.

The audit row for a connection records the field NAMES and never the values.
It exists to say a connection was made — not to write the secret a second time,
into a table with different retention.

**One gap closed on the way past.** Install was calling `addOnManifestSchema`
rather than `validateManifest`, so it checked the manifest's shape and skipped
the policy layer — which meant the publisher gate (24 D13 / 26 D4, the control
those rulings actually name) was not running at install, and neither was
`FRONTEND_SECRET_LEAK`, the rule standing between a credential and a browser.
Both run now, on the real installed manifest rather than only in the add-on
repo's CI.
