---
'@adminium/widgets': patch
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/i18n': patch
---

Fix the Email Templates builder rendering an empty canvas for every stored template.

The surface was non-functional in both directions on every install, and had been
since it shipped. `apps/server/src/email/render.ts` owns a closed six-kind
vocabulary — `email.heading`, `email.text`, `email.button`, `email.divider`,
`email.spacer`, `email.footer` — and that is what `seedBuiltinEmailTemplates`
writes to `adminium_email_templates` at every boot and what `renderEmail` turns
into MIME. The builder canvas knew a different vocabulary entirely: the 22
`block-*` document ids (`block-line-items`, `block-tax-breakdown`,
`block-qr-pay`, …). The intersection was empty.

So `emailDoc.ts` classified every block of every seeded row as `unknown`,
`blockOrder` came out `[]`, and the editor opened on "No blocks yet" for all 24
rows a fresh install seeds (3 built-ins × 8 compiled locales). The reverse trip
failed the same way: the palette could only offer `block-*` ids, `renderEmail`
skips any kind outside its vocabulary, so anything an admin added was saved,
shown as saved, and then silently dropped on send.

**Neither half ever failed loudly, and that is why CI stayed green.** An
unrecognised kind is *skipped* on both sides — deliberately on the server, where
throwing would turn a stale row into a 500 on the password-reset path and lock
someone out of their own account. The only coverage the surface had fed it
hand-written docs made of `block-highlight-box` / `block-contact`, ids the canvas
already knew and the mail renderer never did, so the one broken thing was the one
thing nothing exercised.

**The canvas moved to `email.*`, not the other way round.** The stored
vocabulary is the wire format of a production table and of sent mail; the
`block-*` set is a UI list. Changing code is free, migrating seeded rows in every
install is not. A mapping between the two was never an option either: the 22
document blocks contain no heading, paragraph, button, divider, spacer or footer,
so nothing could express a transactional email, and a lossy round trip would have
written `block-*` into stored rows — upgrading a broken editor into one that
blanks real password-reset mail. The Email Templates comp settles it too: its
inspector is Heading / Body paragraphs / Call-to-action / Footer text, and the
five ecommerce modules that `DOC_TYPE_BLOCKS.email` used to hold are the comp's
*optional* rail. They are still there, one click down the palette.

Six canvas blocks back the kinds (`BlockEmail.tsx`). They read the stored payload
bare rather than through `rowOf`, because that payload is the template entry's own
`data` object and wrapping it would mean rewriting what the server sends.
`email.button` renders as a styled span plus its destination in mono, not an
`<a href>`: this is a preview inside an editor, a real link would navigate away on
the click meant to select the block, and the href is usually an unresolved
`{{resetUrl}}`. The heading renders as a weighted `<p>` carrying `data-level` —
the canvas already emits an `<h3>` block label, so a real `<h1>` inside it would
invert heading order on every template.

**Payloads are now keyed by instance id, not block id.** Repeated kinds are the
ordinary case here — `password-reset` has an `intro` paragraph and a `notice`
paragraph, both `email.text` — and block-keyed storage collapses the two, showing
one sentence twice while the other is unreachable. `blockDataForInstance` reads
the instance id first and falls back to the block id, so no existing invoice or
report doc changes shape. For the same reason the canvas now emits
`blockInstanceOrder` alongside `blockOrder`: two instances of one kind produce an
identical sequence of block ids, so "swap the two paragraphs" was a silent no-op.

Because `apps/server` may not import `@adminium/widgets` and there is no runtime
package both depend on, the vocabulary crosses that boundary the way the LLM
allow-lists already do — declared on each side, held identical by
`scripts/check-email-block-vocab.mjs` in CI. The gate compares both lists in
order, checks each kind actually reaches a renderer on both sides, and checks
that `BLOCK_IDS` still spreads `EMAIL_BLOCK_KINDS`: an earlier draft that compared
only the two lists passed happily while `isBlockId` rejected all six kinds, which
is the exact failure being fixed.

Regression coverage runs a row copied verbatim out of a seeded install's meta
store through `emailDoc.ts` into the rendered page, and asserts six block
instances, two distinct paragraphs, a byte-identical round trip, and no empty
state. The server side asserts every vocabulary kind renders non-empty HTML, that
the real `builtins.ts` seed emits only vocabulary kinds in all eight compiled
locales, and that an unknown kind is still skipped rather than thrown on.
