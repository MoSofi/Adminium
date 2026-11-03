<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — Marketing or service; do not edit -->

# Manifest spec: Emails — Marketing or service

### Marketing or service

Mail to a contact is marketing or service. **Marketing** (a newsletter, a thank-you that gives a
code for the next order) is not sent to an address on the install's do-not-email list, and carries
an unsubscribe link. **Service** (a quote, a booking confirmation, a receipt, a sign-in link) is
always sent: a person who said no to marketing still gets their receipt.

An outbox says each kind's class in `classes`, beside `kinds`:

```json
"kinds":   { "quote-sent": "crm-quote-sent", "referral-thanks": "crm-referral-thanks" },
"classes": { "quote-sent": "service",        "referral-thanks": "marketing" }
```

A rule's e-mail to an address of its record (`to: { "kind": "field" }`) says it with `class`:

```json
{ "kind": "email", "templateKey": "crm-note", "to": { "kind": "field", "column": "email" }, "class": "service" }
```

From `minAdminiumVersion` `0.3.38` every kind, and every rule's e-mail to an address of its record,
must say which: the validator refuses a gap and names the kind or the rule. That is every kind
written to somebody outside the business: the outbox's person, a supplier, an address somebody
typed (a friend a ticket is offered to, a copy of a signed sheet), and a kind sent only by hand. A
kind whose every producer writes to the house's own address (`recipient: { "setting" }`) is mail to
staff: it needs no class, and one it says is taken. A manifest with an
older floor says no class, and all its mail is read as service, as it was sent before. A class
needs the floor `0.3.38`.
