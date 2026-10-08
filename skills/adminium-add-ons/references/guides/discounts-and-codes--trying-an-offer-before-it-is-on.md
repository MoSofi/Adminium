<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § Trying an offer before it is on; do not edit -->

# Discounts, codes and refunds worked out by Adminium: Trying an offer before it is on

`POST /data/:connectionId/:table/try` prices a **saved** order with other codes in place of its
own, as a guest or as a signed-in customer, and with an offer that is not saved yet — and writes
nothing. Asked to `explain`, it answers a reason for every offer that did not apply. It is what an
add-on's own "try it" pane calls; no price is ever made up on a page.
