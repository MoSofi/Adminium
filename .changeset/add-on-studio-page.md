---
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Add-ons have a Studio page: browse, consent, connect, enable per host, uninstall.

Thirteen tasks of server work become something an operator can use.
`/studio/add-ons` presents them in the order they actually matter — what is
available, what installing would do, what is installed — and the design input
(`designs/Integrations.dc.html`) supplies the shapes while this supplies the
data story behind them.

**Browsing is a disk read, and the page says so.** A fresh install lists what
came with the build, with no network call at all, so it is useful before anyone
decides whether to switch the online catalogue on. When that switch is off there
is no "check for newer" button to press — an action that could only fail is
worse than an absent one — and the copy states plainly that nothing here has
contacted the internet. When it is on, checking is a visible action rather than
something the page does on load.

**The consent dialog is the security surface, so it shows the plan first.**
26 §7 calls it that explicitly, and what it shows is the real server-computed
plan: the tables an add-on will use, the tables installing will CREATE, the
hosts it may contact, and — when the answer is no — the reason, in a sentence
naming the missing table. Install is not offered for a plan that cannot be
applied. The one schema case that stays refused is a table that exists but
lacks columns the add-on needs, and the honest surface for that is the plan
naming those columns, not a button that would fail.

**Three outcomes get three sentences.** Disable keeps everything and is one
click to undo. Disconnect deletes the keys and keeps every table and every row.
Uninstall additionally removes the files from the server, and still keeps every
table and every row. A shared "are you sure?" would make the safest of the three
read like the most destructive, so each confirm says what it actually does — and
each says the data survives, because that is the promise 24 D16 makes and the
dialog is where a person either believes it or does not.

Fifty-one keys across all eight locales, German and French translated, the rest
drafted from English and marked for review the way the i18n gate expects.
