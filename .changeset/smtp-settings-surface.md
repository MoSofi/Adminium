---
'@adminium/i18n': patch
---

Give SMTP a screen, so the transport behind password reset and invites is not curl-only.

`GET|PUT /api/v1/settings/email` had a Zod schema, an RBAC gate, an audit
marker, a host guard and encryption at rest — and no surface anywhere in the
product. The transport that gates password resets, user invites, the
notification `email` channel and scheduled report delivery could be set only by
hand-writing the PUT or importing a config bundle. The docs said so in a
"what's absent" bullet, which is now no longer true and has been corrected.

Email (SMTP) is a third card on the workspace settings form, on the same terms
as Security: one Save button, one review-then-confirm modal, three independent
section-puts underneath.

The password is the part worth reading about. The GET returns no password in any
form — not the value, not a masked copy, not a last-4 — so the field starts
empty on every load and empty means "keep the stored one", which is what stops a
port change from making an admin retype a production secret. Typing one replaces
it. Emptying the USERNAME sends `pass: ''` and clears it, because a secret an
open relay cannot use is one nobody will remember to revoke. The review modal
lists the field as "Replaced" and never shows a value.

Host, port and from-address bounds mirror the route's, including
`assertSmtpHostAllowed`'s bare-hostname rule, so a pasted `smtp://host:587` is
refused under the field instead of coming back as a 422 over a save that also
carried a logo. An unconfigured workspace opens with empty boxes, a suggested
port and a note saying what cannot be sent — not three red fields.

`{smtp: null}`, the route's own way of spelling "no relay", is reachable through
a staged Remove that mirrors the logo's. And `/studio/settings` now has e2e
coverage at all: the form's stub-driven unit tests could only ever prove what
body it builds, not that the server accepts it.
