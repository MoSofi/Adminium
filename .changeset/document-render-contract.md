---
'@adminium/add-on-contracts': patch
'@adminium/manifest': patch
---

The contract registry gains a fourth entry: `document-render@1` (34 D1, bought
2026-09-02), with two implementations in the same wave — `invoices` and
`barcode-labels` — which is what 25 D4's gate asks of a new contract.

It is the first contract an add-on uses to hand Adminium **bytes**. Every other
one describes a conversation with a service: a carrier quotes and books, a
personalizer prices an option, a transport delivers a message. This one takes a
`DocumentSubject` — values only, no database handle, no connection, no clock —
and returns rendered files. The subject is the only door, and it is frozen into
the register row at render time, so a document stays what it was after the row
it was drawn from is edited or deleted.

What the conformance suite (`describeDocumentRenderer`) holds an implementer to:

- every kind it names must `describe()`, with `label` and `help` as **records in
  all eight compiled locales** — never a key. There is no add-on bundle in the
  dashboard to resolve one against, so a `{key, fallback}` label would ship its
  English fallback to eight languages.
- rendering the same subject twice is **byte-identical**. A renderer that stamps
  a clock or a random id fails here rather than on somebody's invoice.
- money arrives as **integer minor units** and percentages as **basis points**;
  the arithmetic law itself belongs to the implementer, not the contract.
- HTML output carries no `<script>`; PDF output is `%PDF-1.4` with a byte-exact
  xref table, asserted by parsing it back over a subject containing `é ß ø €` —
  and a kind declaring `coverage: 'ascii'` must REFUSE those glyphs rather than
  drop them silently.
- a locale the implementer cannot draw refuses with `LATIN_ONLY` and names what
  it `dropped`; a missing required slot refuses `MISSING_SLOT`; an unknown kind
  refuses `UNSUPPORTED_KIND`.

`@adminium/manifest` moves with it: an add-on may now declare
`provides: [{contract: 'document-render', version: 1}]` and be installed, a
setting may carry `help` beside its `label`, and `dashboard` joins the reserved
key set — it is the host an add-on attaching to `*` is mounted under on a
deployment with no host app, so an app of that name would make the attachment
ambiguous.

**No new slots.** `document-render@1` is drawn through the two ids that already
existed, `record.actions` and `settings.add-on.panel`.
