<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Marketing or service mail; do not edit -->

# A manifest, task by task: Marketing or service mail

Each kind of mail the outbox sends is marketing (a newsletter, an offer) or service (a booking
confirmation, a receipt). Say which in `emails.json`, beside `kinds`:

```json title="manifest/emails.json (part)"
"kinds":   { "job-done": "repairs-job-done", "spring-offer": "repairs-spring-offer" },
"classes": { "job-done": "service",          "spring-offer": "marketing" }
```

- From `"minAdminiumVersion": "0.3.37"` every kind needs a class, and so does a rule's e-mail to an
  address of its record (`"class": "service"` on the step in `automations.json`). The check names
  each one that has none.
- A mail to staff (`to.kind` `staff` or `listed`) takes no class: it is never stopped.
- Marketing mail is not sent to an address on the do-not-email list. Mark a mail service only when
  the person needs it whatever they said about offers.

`automations.json` holds up to 32 rules; more than 24 also needs `0.3.37`.

Reference: [Marketing or service](https://docs.adminium.dev/reference/manifest/#marketing-or-service).
