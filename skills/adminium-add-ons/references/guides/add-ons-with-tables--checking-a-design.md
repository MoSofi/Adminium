<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § Checking a design; do not edit -->

# Add-ons that keep tables of their own: Checking a design

An add-on that keeps designs may answer the question an order line asks before it is ordered:
does this design stand, and which priced features does it use? It declares
[`addOn.checker`](https://docs.adminium.dev/reference/manifest/#the-design-question) and provides the contract
`design-check`, version 1, as one more method of the same kind of file: `module.exports = { check }`,
pure, at most 250 ms, run only from a package this server can vouch for. An app asks it with a
[`check`](https://docs.adminium.dev/reference/manifest/#a-design-an-add-on-checks) rule on its order lines.

`check(input)` is called once for the save's lines (and once for the dry run, the same way):

- `mode`: `save` or `dry`;
- `lines`: for each line that names a design, its `key`, the `design` row, the `rows` of each
  declared read by its `id`, the feature codes the line pays for (`paid`, each once, sorted), and
  the design's `files`: `{ column, kind, size }` for each file a file column of the design holds
  (`kind` its type as stored, `size` in bytes; `""` and `0` for a file that is not there), never
  its bytes;
- `settings`: the add-on's settings row; `version`: its installed version.

It answers `{ lines: [{ key, ok, used, refusals }] }`: one entry for each line and no other, the
features the design `used`, and `refusals` (`{ part?, reason }`, from the closed list) exactly
when `ok` is false. The answer is checked before it is read; a fault in it refuses the save.
Adminium then holds each line to it: a refusal refuses the save, and the features used must be
the features paid for, both ways. There are no fonts: a rule about how much text fits is
arithmetic on the sizes the design declares (its most characters at its base size, scaled by the
size chosen), the same arithmetic the browser runs.

The contracts package ships `designCheckConformance` (in its testing entry, beside
`priceAdjustConformance`) for an add-on's own tests to run over its case table — the answer's
shape, every line answered once, a dry run answered as the save, the same answer twice — and
`checkQuestion` to build a question the way Adminium puts one.
