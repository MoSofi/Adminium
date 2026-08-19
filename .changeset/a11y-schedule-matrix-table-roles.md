---
'@adminium/widgets': patch
---

Give ScheduleMatrix's `role="table"` the header and cell roles the role requires
— baseline 53 → 49.

A table's rows must contain header/cell roles. Column 1 of the header row was a
bare `<span>`, the resource cell had no `rowheader`, and the coverage cells had
no `cell`, so a screen reader announced the first column as nothing and the
coverage row as unstructured text.

The fix is a verbatim port from the twin file `ShiftMatrix`, which already had
the correct treatment — and the twin got the two pieces IT was missing
(`columnheader` on its own leading span, `aria-hidden` on its Avatar), so the
fork stops drifting further apart.

The Avatar needed hiding either way: its `aria-label` repeats the name rendered
beside it, so the rowheader's accessible name was doubling to
"Ana Trujillo Ana Trujillo, Manager · 32h".

`calendar-widgets.test.tsx`'s weekStart case took the first `[role="columnheader"]`
as the first DAY column. "Resource" is legitimately a columnheader now, so the
selector moves to index 1 with an assertion pinning why.
