---
'@adminium/widgets': patch
'@adminium/server': patch
---

A record's panel (Peek) shows the whole record and names its tabs in words. It showed only the columns the list shows, so an order opened from a list of names and totals had no number and no status, and an enquiry had no note; the panel now lists the list's columns first, as the page set them, then the rest of the table's. Its related tabs read "ordering_order_items"; they now carry the table's own name where it has one (an app's, or the operator's rename: "Order items") and plain words where it has none. `GET /data/:connection/:table/:id?include=inboundCounts` and the references preflight answer that name as `label` on each entry.
