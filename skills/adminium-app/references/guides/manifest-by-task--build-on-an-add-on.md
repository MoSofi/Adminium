<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Build on an add-on; do not edit -->

# A manifest, task by task: Build on an add-on

`add-ons.json` names the add-ons the app needs. Use one that exists rather than building the same
thing again: invoices and holiday calendars are add-ons.

```json title="manifest/add-ons.json"
{
  "suggests": [
    { "key": "holiday-calendars", "range": ">=1.0.6", "checked": true,
      "reason": { "en-US": "Marks public holidays on the calendar." } }
  ],
  "features": [
    { "id": "holidays", "label": { "en-US": "Public holidays" }, "requires": ["holiday-calendars"] }
  ]
}
```

- `requires` (same shape, without `checked`) is installed with the app, and the install is refused
  when it cannot be had. `suggests` is offered, ticked when `checked`.
- A `features` entry may only require an add-on the app requires or suggests. A page with
  `"feature": "holidays"` stays hidden until that add-on is there.
- `reason` and `label` are keyed by language and must include `en-US`. `range` is a semver range.

Reference: [Add-ons](https://docs.adminium.dev/reference/manifest/#add-ons), [Build on an add-on](https://docs.adminium.dev/guides/building-on-an-add-on/).
