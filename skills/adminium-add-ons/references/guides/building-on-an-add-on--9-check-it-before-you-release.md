<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 9. Check it before you release; do not edit -->

# Building on an add-on: 9. Check it before you release

Run `validateManifest` from the `@adminiumjs/manifest` package in your CI. It reads your manifest
alone, and refuses one whose names do not add up: a rule's column the table lacks, a formula
reading a column that holds no number, a state that is not a value of the state column, a
`builtOn` whose add-on the app does not require. It also returns `warnings`, advice that never
refuses a manifest; see [Validation](https://docs.adminium.dev/reference/manifest/#validation).
