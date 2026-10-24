<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — A notice in the reader's language; do not edit -->

# Manifest spec: Automations — A notice in the reader's language

### A notice in the reader's language

A notice's `title` and `body` may each be given in several languages, `en-US` among them, as an
email template's `locales` are. The install keeps them all on the rule, beside the text in the
workspace's language, and each person is told in their own language as the notice is written: their
language's text (`de-DE`), else another of the same language (`de-AT` reads `de-DE`), else the
rule's own text in the workspace's language. Their bell shows what they were told, and an email
copy of the notice says the same. A notice already in the bell keeps the words it was told in when
the person later changes language.

```json
{ "kind": "notification", "to": { "roles": ["manager"] },
  "title": { "en-US": "{{record.name}} is running low", "de-DE": "{{record.name}} wird knapp" },
  "body": { "en-US": "Order more.", "de-DE": "Bitte nachbestellen." } }
```

A title and a body both given in several languages give the same ones (a reader is never told half
a notice in theirs); one text on either side is the same for everybody. Each language's text is
held to the same placeholders. The rules page shows that a step carries other languages; a title or
message changed there is one text for everybody from then on. Needs Adminium 0.3.35 to be told per
language; an older server tells everybody in the workspace's language.
