# @adminium/add-on-contracts

## 0.3.3

## 0.3.2

## 0.3.1

### Patch Changes

- c440bee: A rendered document's letterhead may now carry the business's tax number,
  how to pay it, and a line for the foot of the page, beside its name, address
  lines and logo. All three are optional: an older server never sends them, and
  an add-on draws each only when it is there.
- 7426bc4: An app's manifest can now describe what an invoicing app needs, and Adminium
  stores it with the app's other rules.
  
  - **Worked-out values.** A column may say `rules.formula`: a line's amount
    from its quantity, rate and discount, a document's tax and total. The
    arithmetic is exact — never through a floating-point number — and rounds
    once, to the column's new `scale` (0–4 decimal places, or `"currency"`:
    the decimals of the row's own currency, so a JPY total has none and a KWD
    total three).
  - **Numbers without gaps.** `sequence.gapless` numbers rows with no gaps and
    none repeated, optionally per parent row (`scope`) and from a setting
    (`startSetting`); `rules.format` writes the number with its prefix
    (`INV-2042`).
  - **Fills from elsewhere.** `rules.default.from` fills a value on create from
    the connection's currency, a column of the app's settings row, or a setting
    of an add-on the app requires.
  - **States.** A table may declare `states`: the moves between them, what
    stays open once a row is locked, child tables tied to its state, and when a
    row may never be deleted.
  - **More stamps.** Today's date on the venue's calendar, the signed-in
    person's own details, a date so many days after another, and a fingerprint
    of the row and its lines. A stamp may also be written when a column is
    first filled.
  - **Add-ons an app needs.** `addOns` lists the add-ons an app requires or
    suggests, and the features that need them; `documents` lists the document
    profiles an app ships for its own tables. An add-on may define `shapes`
    that apps build their tables on (`builtOn`).
  - **Public access.** New claim kinds (a sign-in link emailed to the address,
    and a share link by token), `visibleWith` for child rows that are only as
    visible as their parent, `files` and `documents` a signed-in person may
    open, and conditions that a value is still empty (`null`) or a date is
    today or later (`from-today`).
  - **Held emails.** An app's outbox may hold what it produces until someone
    approves it, date it for later, let a later reminder overtake an earlier
    one, drop reminders that are no longer needed, and change a linked row once
    an email has gone.
  
  The validator now also returns `warnings` beside its issues: advice that
  never refuses a manifest. The first says when a column will be required at
  install because it is neither nullable nor given a default.
  
  Uploading an add-on built for a newer Adminium now says which version it
  needs, instead of refusing its manifest as not valid. An add-on's `attaches`
  range may use any semver range, such as `>=0.2.0`.
  
  The column inspector in Studio describes each of these rules in words.

## 0.3.0

## 0.3.0-rc.4

## 0.3.0-rc.3

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

### Patch Changes

- ab6314e: `describeShippingCarrier` names the inbound direction: quote is
  direction-symmetric — the same route reversed still quotes — and the refusal is
  end-symmetric, so a carrier that would refuse an address as a recipient refuses it
  as a sender. No interface member changes shape; a return is the same contract with
  the route reversed, and the suite now says so executably.
- 8fb86bf: The contract registry gains a fourth entry: `document-render@1` (bought
  2026-09-02), with two implementations in the same wave — `invoices` and `barcode-labels`
  — which is what gate asks of a new contract.
  
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
- ce438a0: The closed slot registry gains a thirteenth id: `shell.overlay` (bought
  2026-09-01). Surface `customer`, fill `multi`, payload `ShellOverlayPayload`.
  
  It is the first slot on a **customer shell** rather than inside one of its
  flows. Every other customer id in the registry is a place inside something — a
  product being configured, a basket line, a checkout's delivery step, a dispatch
  being read. This one is the layer above the page: a floating affordance a
  visitor can reach from any screen, and the panel it opens.
  
  Its dossier is FOUR exhibits where `record.actions` had seven, and one of the
  four is an absence — ten customer-side apps with no way to reach the operator
  from the shell. The entry says so in those words rather than dressing four up
  as enough. What it has that the twelfth did not is the condition the registry's
  own header sets: it ships **with** its fill, `live-chat`, in the same wave, so
  "a slot nobody fills is a guess" is satisfied on the day the id lands instead of
  being owed to a later one.
  
  No existing id, surface, fill rule or payload changes. A manifest that names
  `shell.overlay` needs this release plus a refreshed lockfile before it
  validates — that ordering is deliberate, and a manifest test going red in
  between is the mechanism working.

## 0.2.5

## 0.2.4

## 0.2.3

### Patch Changes

- 78cf75f: The closed slot registry gains a twelfth id, `record.actions` — one opening on
  the screen where somebody is already looking at ONE record, to do a thing to it.
  `surface: 'both'`, `fill: 'multi'`, payload "what kind of record it is, the
  record, and a way to write back".
  
  **Patch and not minor, deliberately.** The `fixed: [["@adminium/*"]]` group
  forces the highest pending bump onto all twenty workspaces, so a `minor` here
  would promote the whole monorepo for a change that adds one entry to one array.
  Nothing that exists stops working: the registry is additive, `SlotId` widens,
  and every consumer that enumerated eleven ids still enumerates eleven of the
  twelve.
  
  It arrives with **no fill anywhere**, which is worth stating in a changelog
  rather than leaving a reader to discover. The registry has refused an unfilled
  slot before, on the grounds that one nobody fills is a guess about a future
  add-on. This one is not a guess: it carries seven exhibits with a file and a
  line each, gathered by five independent surveys of the fifteen example apps and
  held to an adversarial pass, and the entry itself sets out the difference at
  length. Its first consumer is a paperwork add-on that has not been built yet.
  
  Consumers who mirror the registry — every example app vendors a copy at
  `src/testing/manifest/slots.ts` — pick this up by re-running
  `scripts/sync-manifest-validator.mjs`, not by hand.

## 0.2.2

## 0.2.2-rc.0

## 0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
