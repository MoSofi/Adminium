<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § On a record; do not edit -->

# Take payments: On a record

A payable record has a **Payment panel**:

- **Balance due**, and every payment taken, with how and when, and who recorded it.
- **Copy pay link** makes the record's pay link. A record has one current link: making a new one
  ends the old one. A link works for 30 days, and stops when the record is paid, voided or deleted,
  or when you **Revoke** it.
- **Email pay link** sends the link to the email address the record holds, in a built-in email.
- **Record a payment** records one that arrived another way: the amount (the balance, to start
  with), the way it was paid, the date and a note. A card payment on a standalone terminal takes the
  approval code and the last four digits. A full card number is refused in every payment field.

A draft invoice cannot be paid: "Send the invoice first."

### In emails and printed invoices

An email template can use `{{pay_url}}`, and an invoice made with the Invoices add-on can print its
pay link and a QR code for it. Both are the record's current live link. They are left empty when
the record cannot be paid online.
