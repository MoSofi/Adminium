---
'@adminium/dashboard': patch
---

**A page no longer sits on "This page is not in the running build" until you reload.**

The dashboard refreshes `['bootstrap']` only when a realtime `config-changed`
event arrives, and that query never goes stale on its own. `publish` on the
server is fire-and-forget — one emit, no replay — so an event had to find a tab
already subscribed to reach it. Every page load has a gap where it is not:
bootstrap is fetched before the socket is up. Anything published inside that gap
reached nobody, and the payload the page started with was then the payload it
kept for its whole life.

Open `/p/<slug>` while `adminium dev` is rebuilding a project and you could land
in that gap, and the page held "This page is not in the running build"
permanently rather than for a moment — the message even suggests building again
or restarting, neither of which helps, because only a reload did. A project cell
reported as an unknown widget the same way.

The shell now runs the `config-changed` refresh whenever its socket opens, not
only after a dropped connection — the at-least-once floor translations already
had, extended to everything that event feeds. Both orderings are covered: a
build that lands before the subscription is live is caught by the refresh on
open, and one that lands after arrives as the event. The cost is one extra
bootstrap read per socket open, which is once per full page load rather than per
navigation.
