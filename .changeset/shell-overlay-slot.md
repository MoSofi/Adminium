---
'@adminium/add-on-contracts': patch
---

The closed slot registry gains a thirteenth id: `shell.overlay` (33 O1 → D17,
bought 2026-09-01). Surface `customer`, fill `multi`, payload
`ShellOverlayPayload`.

It is the first slot on a **customer shell** rather than inside one of its
flows. Every other customer id in the registry is a place inside something — a
product being configured, a basket line, a checkout's delivery step, a dispatch
being read. This one is the layer above the page: a floating affordance a
visitor can reach from any screen, and the panel it opens.

Its dossier is FOUR exhibits where `record.actions` had seven, and one of the
four is an absence — ten customer-side apps with no way to reach the operator
from the shell. The entry says so in those words rather than dressing four up
as enough. What it has that the twelfth did not is the condition the registry's
own header sets: it ships **with** its fill, `live-chat`, in the same wave, so
"a slot nobody fills is a guess" is satisfied on the day the id lands instead of
being owed to a later one.

No existing id, surface, fill rule or payload changes. A manifest that names
`shell.overlay` needs this release plus a refreshed lockfile before it
validates — that ordering is deliberate, and a manifest test going red in
between is the mechanism working.
