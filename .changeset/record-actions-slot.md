---
'@adminium/add-on-contracts': patch
---

The closed slot registry gains a twelfth id, `record.actions` — one opening on
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
