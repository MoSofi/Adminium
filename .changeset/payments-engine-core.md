---
'@adminium/add-on-contracts': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Adminium can now take payments. Your shop stays the seller: you connect your own payment service, and Adminium holds no account, no key of its own and no money.

- **Studio → Payments** sets it up: whether customers can reach this server, the payment services and their test and live keys, the ways to pay (online, or by hand: bank transfer, cash on delivery and your own), which tables can be paid and where each payment is written, and the pay page's name, logo, contact and address. Three new permissions: "Set up payments", "See payment activity and export it" and "Give refunds".
- **A record's Payment panel** shows the balance and every payment, makes the record's pay link (one current link, 30 days), emails it, and records a payment that arrived another way, a card on your own terminal included. A full card number is refused in every payment field.
- **The pay page** (`/pay/…`) shows the shop, the number, the amount due and the ways to pay, never the customer's name, in the customer's language. Test links open only for staff, and every test link offers a demo service that needs no account.
- **Payments are written once**, whether the webhook, the return page or the safety check finds them first, against the record's own payments table or kept by Adminium. A payment that cannot be written is shown in Activity for a person to decide, never refunded by itself. A nightly check flags recorded payments whose row has gone.
- **Refunds** in two steps, refunds made at the service recorded and flagged, disputes marked and notified, all listed in **Activity** with a CSV export.
- **Emails and documents** can carry the record's pay link (`{{pay_url}}`) and print it with a code to scan.
- **Invoices made on the Invoices page** take payments too once they name their currency's code: Paid then follows the balance.

**On upgrade:** an email template of your own whose key was `payment-link` or `payment-receipt` moves to `payment-link-2` / `payment-receipt-2` (automations that send it follow), because those keys are now built-in emails.

Card payments (Stripe) and Wallet payments (PayPal) come as add-ons in the next add-ons release. The new add-on contract is `payment-provider@1`.
