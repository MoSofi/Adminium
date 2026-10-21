# Figma fixtures

Real answers of Figma's REST API, for the Designer's Figma tests (`designer-figma-*.test.ts`).

Each `.json.gz` file is one `GET /v1/files/:key/nodes` answer for one frame: the frame's `document`, and
the `styles`, `components` and `componentSets` it refers to, cut from a whole-file export
(`GET /v1/files/:key`) of the GOV.UK Design System's Figma file. Nothing in a node was changed; the
answer was minified and gzipped.

| File | Frame | Nodes |
|---|---|---|
| `confirmation-page.json.gz` | `20304:13162` `/confirmation-page` | 244 |
| `cookies.json.gz` | `20304:14003` `/cookies` | 358 |
| `step-by-step.json.gz` | `20366:24256` `/step-by-step-navigation` | 559 |
| `radios-group.json.gz` | `15143:3273` `Building blocks/Radios/Group` (3.4 MB unpacked, past every cap) | 3,633 |

The export comes from `example-figma-files/gov-uk-design-system.json` in
https://github.com/ccouzens/figma-rust at commit `81ea1bbb735ee4c101c66c9744865f209be5f57d`,
MIT licence, Copyright (c) 2022 Chris Couzens. The design file is the GOV.UK Design System's own.
