<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Variables — The person a staff column names; do not edit -->

# An app's emails: Variables — The person a staff column names

### The person a staff column names

A site visit names its rep in a staff column, and the customer's mail can say who is coming:

```text
{{recipient.first_name}}, {{visit.rep_id.name}} will see you on {{visit.starts_at.date}}.
```

`{{visit.rep_id.name}}` is the rep's name as the people list shows it, and nothing else of them:
the mail never carries their address or their id through it. It reads the same way as it was
before a change (`{{was.rep_id.name}}`, with `rep_id` among the producer's `was`), and on each row
of a list (`{{row.rep_id.name}}`). Somebody suspended, only invited or removed, and an id that is
nobody's, read empty: put the name in a block of its own with `onlyWith`, and the mail goes
without that line. A template that names a person this way needs Adminium 0.3.28; an older release
fails the message, naming the variable.
