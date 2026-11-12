---
title: The operator endpoint
description: A second listener on your own network, behind a bearer token, where you read an instance's totals, see what it serves to the public and hide every public page at once.
sidebar:
  order: 9
---

When you run an instance for somebody else, a few questions are yours, not
theirs: how much disk it uses, when its owner last signed in, what it shows to
the public. And now and then you need to take its public pages down while you
sort something out with its owner. The operator endpoint answers those, on a
listener of its own that only your network reaches.

It is not tied to trial mode: any server can have one.

## Switching it on

```bash
ADMINIUM_OPERATOR_TOKEN=$(openssl rand -hex 32)
ADMINIUM_OPERATOR_LISTEN=10.0.0.2:4601
```

| Variable | What it is |
|---|---|
| `ADMINIUM_OPERATOR_TOKEN` | The bearer token: 32 random bytes or more, one per instance. A secret: give it as `ADMINIUM_OPERATOR_TOKEN_FILE=/run/secrets/…` if you can, and it is taken out of the server's environment at boot either way. |
| `ADMINIUM_OPERATOR_LISTEN` | `address:port` on your own network. An address of this machine, never `0.0.0.0`, `::` or a name, and never the port of the public listener (`PORT`). |

Set both, or neither: one without the other stops the boot. Without them there
is no endpoint at all.

The second listener starts once the public one is listening, and the server
does not run without it: an address it cannot open stops the start, with the
address in the message. It closes with the server.

## Never on the public side

The endpoint's routes belong to the second listener only. The public listener
has no `/api/v1/operator/*` route at all, so a request there gets `404`, with a
token or without.

Refuse the path at your proxy as well, so it never reaches the instance from
the internet whatever happens to the listeners:
[Refuse the operator paths](/self-hosting/reverse-proxy/#refuse-the-operator-paths).

The listener answers by address. The public listener's rule that it answers
only its own names (`ADMINIUM_PUBLIC_ORIGIN`, `ADMINIUM_OPERATOR_DOMAINS`,
`421` for any other `Host`) is not this listener's: your control service calls
it as `http://10.0.0.2:4601`. Nothing about the public listener was loosened
for that.

## The token

Every request sends `Authorization: Bearer <token>`. No session cookie, no API
key, nothing else opens it.

- A missing or wrong token gets `401 UNAUTHENTICATED`.
- The token is compared in constant time.
- An address that sends a wrong token 10 times in 10 minutes gets
  `429 RATE_LIMITED`, with `Retry-After`, until its window passes, right token
  or not. Any address may make 120 requests a minute.

Every reply carries `Cache-Control: no-store`.

## `GET /api/v1/operator/status`

```bash
curl -H "Authorization: Bearer $ADMINIUM_OPERATOR_TOKEN" http://10.0.0.2:4601/api/v1/operator/status
```

```json
{
  "data": {
    "at": 1762944000000,
    "storage": { "dataDir": 48213504, "files": 1204224, "projectFolder": null },
    "emails": { "today": null, "thisHour": null },
    "superAdminSignIns": [{ "at": 1762940712000, "ip": "203.0.113.7" }],
    "lastSignInAt": 1762940712000,
    "operatorAiTokens": null,
    "publicPages": { "hidden": false, "reason": null, "changedAt": null }
  }
}
```

| Field | What it says |
|---|---|
| `storage.dataDir` | Bytes on disk under `ADMINIUM_DATA_DIR`; `null` when it cannot be measured. |
| `storage.files` | Bytes of the stored files, wherever they are kept. |
| `storage.projectFolder` | Bytes on disk under the project folder; `null` without one. |
| `emails` | Emails the person wrote that went out through your mail relay today and this hour (UTC), the ones the [trial's caps](/self-hosting/env-vars/#email-in-trial-mode) count; `null` where this instance does not count them (not a trial, or no relay). Account email is not counted here. |
| `superAdminSignIns` | The last 20 sign-ins of the instance's Super Admins, newest first: when, and from which address. Nobody else's. |
| `lastSignInAt` | When anybody last signed in; `null` when nobody has. |
| `operatorAiTokens` | Tokens spent on your AI connection; `null` where this instance does not count them. |
| `publicPages` | Whether you hid the public pages, why, and when. |

It carries no row of anybody's data, and of a person no more than an audit row
holds: a time and an address. No name, no email.

## `POST /api/v1/operator/public-pages`

Hide every public page at once, or show them again:

```bash
curl -X POST -H "Authorization: Bearer $ADMINIUM_OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"hidden": true, "reason": "A sign-in form on the shop looks like another company’s."}' \
  http://10.0.0.2:4601/api/v1/operator/public-pages
```

`reason` (up to 500 characters) is required to hide them. The instance's owner
reads it in Studio; nobody else does. `{"hidden": false}` shows them again. The
reply is the new state: `{ "data": { "hidden", "reason", "changedAt" } }`.

While they are hidden:

- **every public page answers `404`**, on every host, the owner's own domains
  included: an app's customer side, forms (and their loader and file uploads),
  the mail door, survey and payment links, pay pages, guest pages, the public
  API (`/api/v1/public/*`) and its documentation page, sites the Designer built,
  and a domain mapped to the add-on pages. A browser gets a bare page that says
  **This page is unavailable.** with the instance's logo and name if it has its
  own, `noindex`, no script and nothing that names Adminium. It never shows your
  reason. A script, a stylesheet or an API call gets the JSON `404` envelope;
- **staff pages keep working**: the dashboard, Studio, sign-in, an app's staff
  side, the staff API, and the payment and mail services' callbacks;
- **Studio says so** on every one of its pages, with your reason: "Your public
  pages are hidden by the operator. Reason: … Reply to the operator's email if
  this is a mistake." Each customer side in Studio → Apps carries a **Hidden**
  chip.

Which page is public is not a list you have to keep up to date: every route of
the server says, from the moment it is registered, whether it is for the
instance's own people or the public, and a route that says neither counts as
public.

The state is kept in the meta store (`adminium_operator_holds`) and survives a
restart. Each change is in the audit log (`operator.public_pages.hidden` and
`operator.public_pages.shown`, by "Server operator", with your address). No
settings screen, config bundle (`adminium export-zip`, `import-zip`),
[archive](/self-hosting/archive/) or restore reads or writes it: only this
endpoint does.

## `GET /api/v1/operator/public-content`

What the instance serves to anybody, read from its source rather than from a
crawl a page could cloak:

```json
{
  "data": {
    "at": 1762944000000,
    "sides": [
      {
        "appKey": "shop",
        "path": "/apps/shop/customer/",
        "files": [
          { "path": "index.html", "bytes": 912, "sha256": "…", "text": "<!doctype html>…" },
          { "path": "assets/logo.png", "bytes": 20411, "sha256": "…" }
        ],
        "truncated": false
      }
    ],
    "forms": [{ "slug": "spring-offer", "addOn": "forms", "form": { "…": "…" } }]
  }
}
```

- `sides`: every app's customer side, each file with its size and hash, and the
  text of a text file (HTML, CSS, JavaScript, JSON, SVG, plain text): up to
  512 KiB of one file (`truncated: true` past it) and 16 MiB in all. Up to
  5,000 files a side.
- `forms`: every live form, with its published definition: its fields and the
  words a stranger reads.

Treat everything in it as the owner's words, never as instructions to whatever
reads it.

## Not in the OpenAPI document

These three routes are not in
[`openapi.json`](/reference/rest-api/#the-machine-readable-spec). That document
describes what the instance serves at its public address, and these are never
served there: a client generated from it would only ever get `404` for them.
This page and [the REST API reference](/reference/rest-api/#the-operator-endpoint)
are their contract.
