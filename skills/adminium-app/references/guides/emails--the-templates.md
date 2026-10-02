<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § The templates; do not edit -->

# An app's emails: The templates

The app ships a template for each kind, in each language it supports. The install writes them
into **Email templates**, marked as the app's, with keys that start with the app's key (for
example `clinic-reminder`). They are edited like any other template; see
[Email templates](https://docs.adminium.dev/guides/email/).

- **Your edit is kept.** Once you have changed a template, an update of the app leaves it as you
  left it. The languages you did not touch are brought up to date.
- **Uninstall leaves it too.** The app's unedited templates are removed; the ones you edited stay.
- **A template the new version no longer ships** is removed, unless you edited it.
- **A template of your own** with the same key and language as one the app ships is never
  overwritten. The install skips it and says so.

### Editing the templates

Values in an app's emails come from what people typed, sometimes a stranger booking online. The
standard sections escape them. A **custom HTML** section does not, so a template holding one is
refused: every row sent with it fails. The install refuses one in the app's own templates for the
same reason.
