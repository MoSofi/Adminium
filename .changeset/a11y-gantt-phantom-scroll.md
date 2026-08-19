---
'@adminium/widgets': patch
---

Clear the gantt canvas's 16 `scrollable-region-focusable` violations by removing
the overflow rather than by making the region focusable — baseline 69 → 53.

The obvious reading is that the timeline is too wide for its card and a keyboard
user cannot scroll to the rest of the project. Measured, that is false: at the
sweep's own viewport the canvas is 746px against a 734px client width. The 12px
comes from ONE absolutely-positioned milestone diamond placed at ~100% with no
clamp, so its rotated bounding box hangs past the right edge.

That distinction decides the fix. Adding `tabIndex` would have put a keyboard
stop — and, in the version first proposed, a landmark — on a region containing
nothing to reach, which satisfies axe while making the product slightly worse to
navigate. The same proposal would have added 38 such stops across four families.
Clamping the marker to `calc(100% - 14px)` removes the phantom scroll, so there
is no scrollable region left to be unreachable.

The today-line marker is clamped the same way (`calc(100% - 2px)`): a project
whose current date lands on the last day would otherwise reintroduce the
identical defect from a different direction.
