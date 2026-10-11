<!-- produced from apps/docs/src/content/docs/guides/apps/phone-app.md § The app key; do not edit -->

# A phone app for an app: The app key

A phone app is a program, not a web page: it sends no `Origin`. So an app with a phone side gets a
key of its own kind beside its customer key, an **app key** (`adm_app_…`):

- It is accepted with no `Origin`, and **refused from a browser** (any `Origin` or `Sec-Fetch-*`
  header). A key taken out of a phone app is useless in a web page.
- It reaches exactly what the customer key reaches, with a visitor's limits and the human check.
  It is never a server key.
- It is made when the app is installed or applied, and only when the app grants public access. An
  update that adds a phone side asks for it like any new access. Revoke it in Studio → API keys
  and no update makes it again. It is a second key: revoking the website's key does not revoke it.
- Switching the app's customer side off stops the phone app too.

It does not make the public API safer against a program: a program can already send the header a
browser key asks for. It gives the phone app a key of its own, replaced without touching the
website.

In the Designer's "Open on a phone", the phone app is given the key and the address by itself. A
phone app you build for a store reads them from three values at build time:

| Value | What |
|---|---|
| `EXPO_PUBLIC_ADMINIUM_URL` | The address of the Adminium the app is installed on, as a phone reaches it |
| `EXPO_PUBLIC_ADMINIUM_KEY` | The app key: Studio → API keys → the app's "phone app" key → reveal |
| `EXPO_PUBLIC_ADMINIUM_TABLES` | Optional. A JSON object, short table name → public name, when the app's tables are not named `<key>_<table>` |

That server needs the public API on (`ADMINIUM_PUBLIC_API_ORIGINS`, for example `self`) and an
address a phone can reach over https.
