<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § Updating; do not edit -->

# Add-ons that keep tables of their own: Updating

An update may add tables, columns and indexes to the add-on's own tables. Studio shows what it
adds first when it changes a table or would open something new to the public. While an update
runs the add-on does nothing; when it stops part way, press Update again.

An add-on installed on several databases (one copy for each app's database) runs one version
everywhere: **Update** on the Add-ons page updates every copy in turn, each through its own check
named by its database. An app whose new version needs a newer add-on is updated after every copy
of that add-on is.

A version that would let visitors see more through an endpoint they already use (its entry shows
one more column, say) lists each such endpoint on the check, and the update waits until you tick
**Allow it**. Through the API, send `"publicWider": true`; without it the update is refused with
`PUBLIC_WIDER` before anything moves.

What you changed is kept: a page you edited, a rule you changed, a role you narrowed.
