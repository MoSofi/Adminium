---
"@adminium/add-on-contracts": minor
"@adminium/i18n": minor
"@adminium/manifest": minor
"@adminium/server": minor
"@adminium/ui": patch
"@adminium/widgets": patch
"@adminium/engine": patch
"@adminium/meta": patch
"@adminium/adapter-postgres": patch
"@adminium/tokens": patch
"@adminium/dashboard": patch
"@adminium/config": patch
---

Runtime translation overrides, add-on contracts, and Studio navigation.

`@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

`@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.
