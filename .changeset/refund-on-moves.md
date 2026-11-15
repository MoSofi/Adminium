---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A payable may name the moves after which its online money goes back by itself (`refundOn: { moves: [{ from, to, by }], switch, before }`): a show cancelled, a customer's free cancellation. It is judged at the move, by who made it: the customer's own move, Adminium's timed move, or a staff member who may refund. Anyone else's move, or a move while the app's own "refund free cancellations automatically" switch is off, leaves the payment flagged "Refund owed" in Activity for someone who may refund (cleared once it is refunded in full); a move past the app's late window (`before`) refunds nothing. The automatic refund runs once per payment for what is still refundable: Adminium's own refund under the column model, or, under the rows model, the app's own refund row written by Adminium as the system with the app's `auto` values, then sent. Each one tells the payment managers (`payments.auto-refund`).
