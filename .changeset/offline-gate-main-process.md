---
'@adminium/desktop': patch
---

The offline-assets gate now scans the Electron main process.

It never did. All three roots it checked — `out/renderer`, `out/dashboard`,
`apps/dashboard/dist` — are renderer output, so everything the gate has ever
looked at runs in Chromium. The main process is where the update check, the
window lifecycle and the utilityProcess supervisor live: the code that actually
makes requests. `updates.mode: 'disabled'` ⇒ "zero non-loopback requests" is the
desktop's headline offline promise, and it rested entirely on a runtime smoke
test, with no build-time check that a remote URL had not been linked into the
process doing the requesting.

Adding the root surfaced exactly what you would expect and forced one honest
decision. `api.github.com` is in there, and it is genuinely fetched — by the
opt-in update check. Every existing allowlist entry certifies that a string is
NEVER FETCHED, so filing a fetched host under that claim to keep the build green
would have quietly converted the entry format into a lie, and every future entry
with it. So `ALLOWED_HOSTS` now has two labelled kinds: *inert*, the original
claim, unchanged; and *opt-in outbound* (`optIn: true`), which must name the
switch that turns the feature off and the runtime test that proves the off-state.
Naming the second category is what keeps the first one strong. The bar is
deliberately high — off by default, individually disableable, runtime-asserted —
and a host that is merely "usually not used" does not qualify.

The remaining literals were loopback and LAN-share URL templates whose host is
filled in at runtime from an address the machine already owns. Their entry is
scoped to the four placeholders that actually exist rather than a blanket
`${...}`, because the entire value of this gate is that a new remote URL fails
it, and `^\$\{.*\}$` would wave through a future `${config.remoteHost}`.

The server is deliberately still not scanned, and should not be. There is no
server bundle — `electron.vite.config.ts` externalizes `@adminium/server` on
purpose so it runs unmodified — and more importantly the server's hostnames fail
this gate's premise wholesale: it legitimately reaches telemetry, the update
feed, and now the add-on catalog, each behind its own switch. That is a different
kind of claim ("off means zero calls", not "this string is inert") and it is
proved where such a claim can be proved, by the network-isolation suites that
replace fetch and node's net/http/https with recording throwers and assert the
recorder stays empty.
