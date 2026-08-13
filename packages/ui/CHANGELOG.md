# @adminium/ui

## 0.2.1

### Patch Changes

- @adminium/tokens@0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- 1d7c7b4: Cancel `TwoPhaseModal`'s deferred reset timer on unmount.

  The component defers `flow.reset()` past the exit animation so the success phase never flashes back to the form while closing, but cleared that timer only if the modal was closed again before it fired. An unmount in between left it running, so the reset landed on a component that no longer existed — a setState-after-unmount in the app, and in CI a load-sensitive failure where the timer fired after the test environment had been torn down.

  The clear-on-reclose behaviour is unchanged; the two are complementary.

- Updated dependencies [1d7c7b4]
  - @adminium/tokens@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/tokens@0.1.0
