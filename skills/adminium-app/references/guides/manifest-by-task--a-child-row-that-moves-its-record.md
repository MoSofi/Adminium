<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § A child row that moves its record; do not edit -->

# A manifest, task by task: A child row that moves its record

When making a row of one table is what finishes another (a sign-off made on site signs its job
off), say so on the child under the record's `states.children`, with `moveOnCreate`:

```json title="manifest/tables/jobs.json"
"states": {
  "column": "state", "initial": "open",
  "moves": {
    "open": ["installed"],
    "installed": [{ "to": "signed-off", "requires": { "children": { "sign_offs": 1 } } }]
  },
  "children": {
    "sign_offs": { "via": "job_id", "createIn": ["open", "installed", "signed-off"], "moveOnCreate": "signed-off" }
  }
}
```

- The record moves by its own listed move, judged with the new row counted, in the same save. The
  person who makes the child needs no right on the record: whoever may create a sign-off signs the
  job off.
- A record already in the state stays as it is, and the child is made (a correction later).
- A record in a state with no listed move there, or whose move's conditions fail, refuses the save.
- The rules that run on the record's move run, as for any move. Imports and sample data move
  nothing.
- It needs `"minAdminiumVersion": "0.3.30"`.

Reference: [A new child moves its parent](https://docs.adminium.dev/reference/manifest/#a-new-child-moves-its-parent).
