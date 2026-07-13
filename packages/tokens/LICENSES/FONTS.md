# Font licenses

The fonts vendored into `src/fonts/` (copied from the `@fontsource*` npm packages by
`scripts/copy-fonts.mjs` at build time) are licensed under the **SIL Open Font License 1.1**:

| Family | Upstream | License |
|---|---|---|
| Manrope (variable) | <https://github.com/sharanda/manrope> | OFL-1.1 |
| JetBrains Mono (variable) | <https://github.com/JetBrains/JetBrainsMono> | OFL-1.1 |
| IBM Plex Sans Arabic | <https://github.com/IBM/plex> | OFL-1.1 |

The full OFL-1.1 text ships inside each `@fontsource` package (`node_modules/@fontsource*/…/LICENSE`)
and applies to the copies in `src/fonts/`. The fonts are unmodified upstream builds; the OFL
permits bundling and redistribution with attribution and prohibits selling the fonts standalone.

CJK locales (`zh_CN`/`zh_TW`) intentionally use system font stacks (see `src/fonts.css`) and vendor
no CJK fonts — see workplan/02-design-system.md §2.4 and workplan/11-electron.md Open decisions.
