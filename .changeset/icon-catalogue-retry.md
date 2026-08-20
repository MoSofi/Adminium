---
'@adminium/ui': patch
---

Let the icon catalogue retry after a failed chunk fetch, instead of staying wrong for the session.

`loadFullIconSet` memoized the dynamic `import('lucide-react')` and never evicted
a rejected one, so a single stale-deploy 404 or network blip left a permanently
rejected promise that every later call re-returned. Every icon outside the
generated core set then stayed wrong until the tab was reloaded — a placeholder
in this package, and the neutral `File` glyph in the dashboard, which is worse
because it looks like an answer rather than a gap.

The failure is now evicted, exactly as the dashboard's sibling template loader
already evicted a failed template id ("a failed chunk must not poison the id
forever"). The next miss refetches, and because `waiters` is deliberately not
cleared on the error path, the icons that were already on screen when the fetch
failed are notified by whichever later attempt succeeds — one recovery heals the
session.

The handler is a `.catch` after the success handler rather than the second
argument to the same `.then`: the two-argument form cannot see a throw from its
own success handler, so a catalogue that arrived unusable would have memoized
the very promise this exists to prevent.
