---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

A webhook step's header value — the token an `Authorization` header carries — is now kept secret. It was stored exactly as typed, in a field named `headerValueEncrypted`, and every read of the rule — the rule list and the editor — carried it back. It is now sealed with AES-256-GCM under a key derived from `ADMINIUM_SECRET` when the rule is saved, and opened only when the request goes out; replies say whether a value is set (`headerValueSet`) and never what it is. The step editor gains the value field it was missing: a password field that shows dots when a value is saved, keeps the saved one when left empty, and replaces it when typed in. Clearing the header name drops the value, and so does pointing the step at another host without typing the value again, so that editing a rule cannot send its token somewhere else. A step that sends a header value must name its host: one filled in from a record's data is refused when the step runs. An API client sends a new value as `headerValue`; plain text sent in `headerValueEncrypted` by a client written before that is sealed the same way. Values stored in plain text before this release are sealed once when the server starts.
