---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A table can now say its rows take a resource for a time. `occupies` names the resource and the time (a start with its minutes or its end, or a whole day): no two counted rows of one resource overlap, so a room booked from two to three is not booked again at half past two. With `hours`, a table of the weekdays each resource works, a row on a day off is refused, and a timed row must lie inside the opening times; with `shared`, rows may share the time and only the hours are judged. It is the plain rule beside `booking`, with no kinds of visit, grid or window, and it is refused with the same codes. Needs Adminium 0.3.27.
