<!-- produced from apps/docs/src/content/docs/guides/add-ons/offers.md § Offer rules; do not edit -->

# The Offers & gift cards add-on: Offer rules

**Offer rules** lists what your tables have to do with offers: which table takes discounts, which
takes a gift card as payment, which sells or tops up a gift card, which sells a voucher. An app
that builds on Offers brings its rules with it; they are shown locked and can be switched off.

For a table of your own, **Add a rule** asks which table, which columns hold the price, the
quantity and what is sold, and when a row is final. Where the table has no column for a part,
"Make it" lets Adminium add what is missing; it first lists what it will add.

A rule added here listens to its own row: when the row is made, or when one of its own columns
is set or takes a value (a payment's "voided at", a line's status). A rule that has to wait for
another row — a line that counts when its **order** is paid — is an app's rule, written in the
app's manifest; it is shown here and changed there.

Changing a rule changes what a table means, so it needs the right to change the schema
(`system:schema:remap`), and "Make it" also needs the right to add columns. The manager role alone
reads the rules and cannot change them.
