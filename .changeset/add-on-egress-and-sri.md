---
'@adminium/server': patch
---

Add-on egress is now enforced, and an installed bundle is checked on read.

Both were declared and neither was enforced. 24 D14 rules that an add-on's
outbound access is an exact-hostname allow-list, and until now that list was a
field in a JSON document nothing consulted at runtime — the validator refuses
`outbound-http` without a non-empty list, which makes the declaration
well-formed and stops nothing at the moment a call is made.

**The guard is a predicate, tested as one.** Deciding whether a URL is reachable
is split out from the client that fetches, because that predicate is where a
bypass would live and testing it through a fetch mock hides half the cases. It
refuses a suffix that merely ends with an allowed host and a prefix an allowed
host merely ends with; credentials in the URL, because `https://evil@allowed/`
has hostname `allowed` and a guard reading only the hostname passes it; every
scheme but https; a trailing dot, which is the same host to DNS and would
otherwise be a free bypass of an exact match; a literal IP, by its own name
rather than as an ordinary miss, since D14's grammar bans IPs from the list so
adding one would never help; and a non-default port, because the grammar has no
way to declare one and permitting it would invent an authority the manifest
cannot express.

Redirects are refused rather than followed. That is the load-bearing one: a
hostname check necessarily runs on the URL *before* the request, so `fetch`'s
default would let an allowed host answer `302 Location: https://anywhere` and be
obeyed. Responses are metered while streaming, because the add-on runs in this
process and a body big enough to exhaust memory takes the whole server with it.
Every refusal lands in the audit log as `add-on.egress-refused`, with the add-on
as the actor rather than whoever happened to trigger the code path — that row is
the operator-facing point of the whole guard, since an add-on quietly reaching
for a host it never declared is exactly what nobody would otherwise find out
about.

**What it does not do is stated where it can be read.** §5.5 says an undeclared
call "fails at the socket". It does not, and it cannot while D13 runs server
halves in-process: an add-on can reach `globalThis.fetch` or `node:net`
directly, and nothing short of a process permission model or a child process
would stop it. What exists is a client that refuses, handed to the add-on so it
has no reason to build its own. The control against a *hostile* add-on remains
the first-party publisher gate; this is the control against an honest one with a
bug or a dependency that phones home. Both are worth having, only one is a
sandbox, and neither is called one — including in a test that asserts the limit
so it sits next to the thing that has it.

**Bundle serving pins one hash and re-checks it.** The store already records a
per-file sha256 when a package is unpacked, so that is the hash the SRI value is
derived from *and* the hash the bytes are re-checked against on every read —
one number, so what a host is told to pin and what the server will serve cannot
drift apart. A bundle edited on the data volume after install is refused rather
than served into a host page. Only paths the manifest *declares* are servable,
checked before the store's own containment check sees the request, so asking for
`package.json` is a 404 rather than a served byte.

The route lives inside `/api/v1` rather than at §5.4's `/add-ons/<key>/client.js`.
Everything outside `/api/` in this server is invisible to all three route
ratchets and inherits neither the auth hook nor rate limiting, and since the
bundle URL is *served* in the list reply rather than hardcoded by a host, its
shape was free to choose — so it went where the guarantees are. No CSP change
was needed either: `script-src` is already `'self'` and the bundle is same-origin,
so §5.4's "extends it with the add-on origin" describes an origin that does not
exist.
