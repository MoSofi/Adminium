<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Personal columns on an entry anyone may call; do not edit -->

# Guests, their details and their own links: Personal columns on an entry anyone may call

An entry anyone may call (no claim, no parent, no session asked, or a create a session is optional
on) never shows personal data. The validator refuses one that selects a column marked
`personal: true`, or one the install would read as personal by its name: an email address, a phone
number, a street address, a birth date, an ID or account number, and a first, last or full name on
a table of people. An entry with no `select` is read as the install reads it: every column but
codes and secrets.

A column whose name only looks personal says so with `personal: false`:

```json
{ "ref": "venue_phone", "type": "text", "maxLength": 32, "nullable": true, "rules": { "personal": false } }
```
