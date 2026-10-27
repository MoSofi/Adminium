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

From `minAdminiumVersion` `0.3.37` every kind, and every rule's e-mail to an address of its record,
must say which: the validator refuses a gap and names the kind or the rule. That is every kind
written to somebody outside the business: the outbox's person, a supplier, an address somebody
typed (a friend a ticket is offered to, a copy of a signed sheet), and a kind sent only by hand. A
kind whose every producer writes to the house's own address (`recipient: { "setting" }`) is mail to
staff: it needs no class, and one it says is taken. A manifest with an
older floor says no class, and all its mail is read as service, as it was sent before. A class
needs the floor `0.3.37`.

Mail to staff has no class and is never stopped: a rule's e-mail to [the person on the
row](https://docs.adminium.dev/reference/manifest/#the-person-on-the-row) (`staff`) or to [the people listed on the row](https://docs.adminium.dev/reference/manifest/#the-people-listed-on-the-row)
(`listed`), a [summary](https://docs.adminium.dev/reference/manifest/#a-summary-for-each-person) and a notice. `class` on such a step is refused.
`mailClassOf(manifest, { outboxKind } | { step })` in `@adminiumjs/manifest` answers `marketing`,
`service` or `staff` for one mail.

What a marketing kind or step meets when it is sent:

- **Who it skips.** An address on the do-not-email list; a person whose latest answer in the
  consent log for the newsletter is not a yes (unless the owner turned "existing customers" on for
  their table, the row carries the app's opt-out mark and the person is a customer, and they never
  said no); and, for a rule's second or later mail, a person staff marked "Replied" since the run
  began. The message is written `skipped` with the reason (a rule's step says it in its log), and
  is not tried again.
- **When it is refused.** While the sender has no postal address, sends from a free mailbox
  (Gmail, Outlook), has no DMARC record or no published Adminium signing key (DKIM) for its
  domain, or the server has no public address for the unsubscribe link. An outbox kind is then
  written `skipped` with the reason and the people who manage e-mail are told once; a rule's step
  fails with the reason.
- **What it carries.** The unsubscribe link and the one-click `List-Unsubscribe` headers, a footer
  with the postal address and "Unsubscribe from …" in the reader's language, which the template
  cannot remove, and Adminium's DKIM signature.

A permanent refusal from the mail server while a contact's mail of either class is sent (a `550`
for the address, from your own mail server rather than one of the large mail services) puts the
address on the do-not-email list; a `4xx` is tried again.
