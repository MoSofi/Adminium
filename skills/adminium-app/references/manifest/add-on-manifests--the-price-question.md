<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — The price question; do not edit -->

# Manifest spec: Add-on manifests — The price question

### The price question

An add-on that keeps offers declares `addOn.adjuster` and provides the contract `price-adjust`
(`provides: [{ "contract": "price-adjust", "version": 1, "server": "dist/server.js" }]`). Adminium
reads what the adjuster names, asks the add-on's code, and writes the answer. From Adminium 0.3.19.

| Field | Rule |
|---|---|
| `offers` | Up to 6 reads of the add-on's own tables, in order: `{ "as", "table", "by": [{ "column", "from" }], "where"?, "limit"? }`. `from` is `now`, `input.codes` (the keys of the code rows the typed codes found), `setting.<name>` or `<as>.<column>` of an earlier read. The first read's table is the table of offers. |
| `codes` | `{ "table", "column", "where"?, "reserved"? }`: discount codes. `reserved`: 1–8 words of 2–4 capital letters no discount code may start with (a voucher's and a gift card's routing words). |
| `vouchers` | `{ "table", "column", "prefixes" }`: vouchers and packs, found by the typed text with its prefix cut (`VC-`). |
| `applied` | Where Adminium keeps what was applied: `table`, `source` (`table`, `row`, `line`), `columns` (`offer`, `code`, `voucher`, `name`, `kind`, `amount`, `reason`, `typed`, `at`). |
| `person` | Optional, read only for a proved customer: `groups` (`table`, `member`, `group`), `uses` (`table`, `customer`, `offer`, `state`, `counted`), `orders?`. |
| `ceilings` | Optional: `{ "table", "role", "maxPercent", "maxAmount", "comp"? }` — what each role may take off by hand. |
| `customerKey` | `"hash"`: a customer reaches the add-on as a keyed hash, never as an address. |

The codes and the vouchers are two tables. A discount code written with a reserved start is refused
(`VALIDATION_FAILED`, the code column `reserved`), whichever way it is written; a code Adminium
makes for that column never has one.
