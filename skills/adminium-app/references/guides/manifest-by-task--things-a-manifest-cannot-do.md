<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Things a manifest cannot do; do not edit -->

# A manifest, task by task: Things a manifest cannot do

- **No server code.** An app package is a manifest, sample data and browser screens. Nothing in it
  runs on the server. A project's hooks and actions stay in the project and are not packed.
- **No payments.** Nothing in a manifest charges a card. `payments` in `capabilities` is a label
  on the app's card and does nothing else. Record a payment as a row staff enter.
- **Not an empty app.** A manifest needs at least one table, one page and one `frontends` entry.
  An app with no screens of its own still declares one, of kind `none`:

```json
"frontends": [{ "side": "staff", "kind": "none" }]
```

Reference: [Frontends](https://docs.adminium.dev/reference/manifest/#frontends), [Validation](https://docs.adminium.dev/reference/manifest/#validation).
