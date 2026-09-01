---
'@adminium/server': patch
---

Fix: the add-on list and bundle routes were unauthenticated.

`GET /api/v1/add-ons` and `GET /api/v1/add-ons/:key/bundle/*` both carried a
docblock saying they were authenticated. Neither carried a guard. This server
has no ambient auth hook — every route guards itself, and a route that names no
guard has none — so the prose was the entire control.

Anonymously, the first returned every installed add-on: its key and version,
**whether a credential is stored for it**, the exact hostnames it is permitted
to contact, and the URL of every bundle it ships. The second then served those
bundles. Together that is a map of an operator's integrations, and the code
behind them, handed to anyone who asked for it.

Nothing could have caught it. The route-tree test sees a route's URL and verb
and never its guards; the RBAC suites test what a guard does rather than which
routes wear one; and every route exercised in the add-on suite passes through a
request the harness has already authenticated. It was found by the wave's
acceptance round trip, on its first real run against a spawned server — which is
the argument that plan's D6 makes for having one.

Both routes now say `requireAuth`, and the gap is closed two ways rather than
one: a sweep over the registered route options fails if any add-on route
declares no guard at all, and an anonymous request to each of the two routes a
connected host reads expects a 401. The first is the ratchet, the second is the
behaviour.

This is also why connected add-on mode is a hosted build only. A standalone
build carries a publishable key and no session; only an app Adminium serves
itself is on an origin where the operator's session cookie applies.

Three more fixes ride along, all found the same way — by asking a running server
rather than a suite.

`AddOnOAuthError` is a plain `Error` and no route mapped it, so every OAuth
refusal rendered as a 500, including "this add-on's manifest points its
authorize URL at a host it never declared" — sending an operator to read server
logs for a problem in a manifest. All six of its reasons are client-visible and
actionable, and they are 422s now.

`GET /add-ons` used to read and re-hash every bundle of every installed add-on
to produce an integrity value the unpack-time pin already held. Two costs, one
of them serious: a full read plus a SHA-256 per bundle on a route a host calls
on every page load, and — because the store's error type is also a plain `Error`
— a single tampered or truncated file rendered as 500 INTERNAL and took the
whole list down with it, for every add-on and every user. "Somebody edited a
package on the data volume" is the one signal that check exists to raise, and it
was arriving as an internal fault. The list reads the pin now and reports a
bundle it cannot vouch for by omitting it; the bundle route still re-hashes the
bytes it actually serves, which is where "checked on read" means something.

`POST /add-ons/upload` buffered up to 32 MB before any guard ran. Body parsing
precedes `preValidation` and `preHandler`, so both the permission check and the
CSRF check saw those bytes only after they were in the heap — and the route sat
in the general API bucket at 300/min rather than the file-bytes bucket at
30/hour, giving the largest upload in the server the loosest budget in it. It
now carries an `onRequest` guard, which is the only phase available before the
parser, and the right bucket.

And the round-trip script itself is added, so the next person does not have to
build one to find the next defect of this shape.
