# @adminium/add-on-contracts

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
