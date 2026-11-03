<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — A kind's purpose; do not edit -->

# Manifest spec: Emails — A kind's purpose

### A kind's purpose

A kind may say the consent purpose it is sent for, in `purposes` beside `classes`:

```json
"classes":  { "invite-marketing": "marketing", "invite-service": "service" },
"purposes": { "invite-marketing": "surveys",   "invite-service": "surveys" }
```

A **marketing** kind with a purpose is judged by the person's latest answer for that purpose in the
consent log, not the newsletter's. A **service** kind with a purpose is still sent to an address on
the do-not-email list (service mail is never stopped by it), but is skipped for a person whose
latest answer for that purpose is "no", by their address or by their row: a survey invitation sent
as service mail never reaches someone who said no to surveys. Both are asked again right before
the mail is handed to the mail server. A kind with no purpose is judged as before. Needs the floor
`0.3.40`.
