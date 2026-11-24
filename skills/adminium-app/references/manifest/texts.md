<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Texts; do not edit -->

# Manifest spec: Texts

An app can send text messages (SMS) through the business's own Twilio or Telnyx account. Every word
below needs Adminium 0.3.76 or later: a manifest that uses one sets
`compatibility.minAdminiumVersion` to `0.3.76`, and an older server refuses it with a message that
names the word. For what the business sees, see [Set up texts](https://docs.adminium.dev/guides/texts/).

A text is a template of its own, never an email template with fields left empty. One outbox kind
has one channel, so "email and text" is two kinds. A text kind is queued, logged and sent through
the same outbox as an email, and the send path checks consent, the do-not-text list, the country,
the words, the length, the sending hours and the daily limit for every text.

```json
"textTemplates": [
  { "key": "clinic-reminder-text", "name": { "en-US": "Visit reminder", "de-DE": "Terminerinnerung" },
    "locales": {
      "en-US": { "body": "{{practice.name}}: your visit is at {{appointment.starts_at.time}}." },
      "de-DE": { "body": "{{practice.name}}: Ihr Termin ist um {{appointment.starts_at.time}}." } } },
  { "key": "clinic-ready-text", "name": "Doctor ready",
    "locales": { "en-US": { "body": "{{practice.name}}: the doctor is ready for you now." } } }
],
"outbox": {
  "recipient": { "via": "patient_id", "table": "patients", "email": "email", "phone": "mobile" },
  "kinds":    { "reminder_text": "clinic-reminder-text", "ready_text": "clinic-ready-text" },
  "channels": { "reminder_text": "sms", "ready_text": "sms" },
  "classes":  { "reminder_text": "service", "ready_text": "service" },
  "waiting":  ["ready_text"]
},
"textReplies": "off"
```

In a project folder, `textTemplates` and `textReplies` are written in `manifest/emails.json`, beside
`outbox` and `emailTemplates`.
