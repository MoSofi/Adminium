---
'@adminium/dashboard': patch
'@adminium/ui': patch
'@adminium/i18n': patch
---

The sidebar can be brought back at any window size. A menu button now leads the top bar on every screen. On a window 1024 px wide or more it hides and shows the sidebar beside the page, and the browser remembers the choice for the next visit. On a narrower window, where the sidebar used to disappear with no way back, it opens the sidebar as a drawer over the page, which closes on Esc, on a click outside it, on following one of its links, and when the window grows wide enough for the sidebar again. ⌘B does the same as the button. The drawer loads the first time it is opened, so the first page load is no heavier for it. `Drawer` in `@adminium/ui` gains `side="start"`, a `DrawerTitle` for a drawer without a header, and `aria-describedby` for a drawer with no description.
