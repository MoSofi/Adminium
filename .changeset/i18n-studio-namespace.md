---
'@adminium/i18n': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/server': patch
---

The Studio's messages are their own namespace, and nobody downloads them until
they open the Studio.

`10-i18n-theming.md` §2.4 has always specified `studio` as a namespace that
loads "lazily when a Studio route mounts", and §2.5's own example key is
`studio:connect.wizard.testCta`. The build never did it. All 971 console
messages lived in `common.studio.*` and `common.studioPages.*`, and every en-US
namespace was imported statically into the caller's main chunk — so the connect
wizard, the schema remap editor, the LLM review screens and the workspace
settings hub were downloaded, in English, by every user on every route, on top
of their own locale's copy of the same text.

Nothing caught it. The cross-locale parity gate proves the eight bundles agree
with each other, and agreeing about the wrong namespace is still agreement.

They are `studio:*` and `studio:pages.*` now, in all eight locales, fetched by
the Studio through the same spinner its lazy route bodies already showed. The
dashboard's entry chunk drops **15 KiB gzipped**, which is the difference
between a build that was over its size ratchet and one that is 60 KiB under the
v1.0 target.

Three things had to come with them, and each is the kind of thing that would
have been found in production rather than in CI.

**The inline fallback became load-bearing.** `t('studio:hub.title', 'Data
connections')` renders its second argument until the chunk lands, and in every
unit test that never boots i18next. While the catalogue was always present that
argument was decoration; now it is the text on screen for a moment. All 1,057
were compared against the bundle and one had drifted — a settings helper still
describing a control that had been reworded. A test now compares every one of
them, character for character, so the next drift fails a build instead of
flickering on a page.

**A deferred namespace cannot be read outside the surface that loads it.** The
topbar titled its two Studio menu items from `studio.hub.title` and
`studio.settingsHub.title`, and the topbar paints on every route — after the
move it would have shown English to a German admin until they opened the Studio.
Those two items have their own `topbar.*` keys, and a test fails the build on
any `studio:` key read from outside `src/studio`.

**And the overrides had to move with the messages.** An operator who reworded a
Studio string through the Translations editor had a row filed under
`(common, studio.hub.title)`, and a row is addressed by namespace and key — so
the rewording would have stopped resolving the moment the message answered to a
new address. Not with an error: the string would simply revert to the compiled
English, on the one surface whose users are the people who did the rewording.
Meta migration 0022 re-files those rows. It also *copies* rather than moves an
override on the two keys the topbar gave up, so an operator who renamed "Data
connections" does not end up with a menu item and the page it opens disagreeing.

The client half is the same problem one layer up: the boot path fetches override
rows for the eagerly-bundled namespaces only, which was correct while every
Studio key was a `common` key. The Studio now fetches its own overrides
alongside its compiled bundle, and the server's per-locale override budget
counts the namespace — deferring bytes is not the same as not sending them.

One note for anyone reading the bundle numbers. Moving the keys, on its own,
made the entry chunk *larger*. `@adminium/i18n`'s barrel re-exported the
complete en-US catalogue, and a re-export keeps its module statically reachable
— which in turn pinned the override layer's *dynamic* import of that same module
into the entry, because a module the bundler can reach statically cannot be
split out. The note directly above that export had predicted this about two
other modules. Deleting the one line is essentially the entire 15 KiB.

`EN_US_RESOURCES` is therefore no longer exported from `@adminium/i18n`; import
it from `@adminium/i18n/resources`, which is where every consumer in this repo
already got it. `NAMESPACES` keeps its meaning (all five), and
`EAGER_NAMESPACES` / `DEFERRED_NAMESPACES` are exported alongside it so which
side of the split a namespace is on is a declaration rather than a comment.
