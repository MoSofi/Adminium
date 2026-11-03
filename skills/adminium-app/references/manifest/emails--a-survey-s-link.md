<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — A survey's link; do not edit -->

# Manifest spec: Emails — A survey's link

### A survey's link

A forms add-on that keeps invitations (`addOn.forms.invitations`) names the kinds whose template
prints `{{survey_link}}` in `surveyLinks`. Every producer of such a kind reads the invitations table
itself (no `via`), so the message's link names the invitation. Adminium fills the link when the
mail goes, and only then:

- a **named** survey's link carries a new one-use token; the invitation keeps only its SHA-256
  (`token_hash`) and when it stops (`expires_at`, the invitation's `invited_at` plus the survey's
  "stop taking answers N days after each invitation"). The token is in the sealed mail and nowhere
  else; a mail sent again makes a new token and the old link stops working;
- an **anonymous** survey's link is its open address, with no token, and nothing is written;
- the mail is not sent, and its row says why, when the invitation was answered already, when its
  days are over, when the survey is not live, when the mail would go to another address than the
  invitation's, and while the server has no public address (`system.publicOrigin`).

The link is `{public address}/x/forms/<slug>?t=<token>`. Only an add-on that declares forms with
invitations may say `surveyLinks`. Needs the floor `0.3.40`.

Opening the link spends nothing (a mail scanner opens every link it is sent): the page greets the
invitee by first name, where the survey links answers to names, and says what the survey is about,
by the name of the record the invitation names (`record_table`, `record_key`). The answer sent with
the token spends it, once: a second send is told the survey was answered already; an unknown token,
or one past its days, does not work; a named survey with no token is not there. The answer keeps
`invitation_id` and the invitee's address and name, or none of the three while "Link answers to
names" is off. A named survey whose answer becomes a row fills that table's link columns that the
app's `forms` entry opens and that point at the invitation's record (the job a feedback row is
about), from the invitation and never from a question; when such a column is unique and the record
has its row already, the answer is "already answered" and nothing is written.

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
