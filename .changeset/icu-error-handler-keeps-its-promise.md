---
'@adminium/i18n': patch
---

**A message missing one of its arguments no longer takes the render down.**

`IcuFormat`'s default error handler exists to make a broken message harmless:
warn the developer, record the failure for the Translations editor, and return
the raw string so something still renders. Its comment says "Never throw at
render time". It threw.

The handler passed the raw error object to `console.warn`. Under plain node
that is fine. Under a console that serialises its arguments eagerly — vitest's
does — a `MissingValueError`, which is what an unsupplied argument produces and
the most ordinary failure on this path, took **8 seconds** to serialise and
then threw `RangeError: Invalid string length` from inside the handler. So the
one path whose entire job was to absorb a formatting failure turned it into a
crash, and reported the wrong culprit while doing it.

The object is not large: `node:util` inspects it to 1,189 characters at any
depth. Some console implementations walk further, and a reporting path cannot
know which one is listening — so it now hands over a bounded string. The
failure ring two lines below already did exactly that; the two agree now.

The same pattern in `bumpI18nRevision`'s subscriber guard is bounded for the
same reason.

Nothing pinned the promise before. `icu-format.test.ts` now drives the handler
through a console that refuses anything but a string, which is the only kind of
test that would have caught this.
