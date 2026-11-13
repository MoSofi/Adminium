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

It is not tied to trial mode: any server can have one. While it is awake, the
instance can also tell you what changed, by itself:
[Signed instance events](#signed-instance-events).

## Switching it on

```bash
ADMINIUM_OPERATOR_TOKEN=$(openssl rand -hex 32)
ADMINIUM_OPERATOR_LISTEN=10.0.0.2:4601
```

| Variable | What it is |
|---|---|
| `ADMINIUM_OPERATOR_TOKEN` | The bearer token: 32 random bytes or more, one per instance. A secret: give it as `ADMINIUM_OPERATOR_TOKEN_FILE=/run/secrets/…` if you can, and it is taken out of the server's environment at boot either way. |
| `ADMINIUM_OPERATOR_LISTEN` | `address:port` on your own network. An address of this machine, never `0.0.0.0`, `::` (however written, `[::ffff:0.0.0.0]` included) or a name, and never the port of the public listener (`PORT`). |

The listener without the token stops the boot, and so does the token with
neither the listener nor [`ADMINIUM_OPERATOR_EVENTS_URL`](#signed-instance-events)
(the token alone would be used nowhere). Without the listener there is no
endpoint at all.

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
| `operatorAiTokens` | Tokens spent on your AI connection over the instance's life, every feature together; `null` where this instance does not count them (none of `ADMINIUM_AI_OPERATOR_ONLY`, `_SCOPE` or `_BUDGET_TOKENS` is set). |
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
restart. Until the server has read it once at boot, every public page counts as
hidden: a boot that cannot read it keeps serving the staff pages, logs an error,
and reads again every 30 seconds until it can. Each change is in the audit log (`operator.public_pages.hidden` and
`operator.public_pages.shown`, by "Server operator", with your address). No
settings screen, config bundle (`adminium export-zip`, `import-zip`),
[archive](/self-hosting/archive/) or restore reads or writes it: only this
endpoint does, and `adminium archive restore --hold`, which restores with it on.

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
  512 KiB of one file and 16 MiB in all, the HTML pages read first. A text
  file cut short, or left without its text once the 16 MiB are spent, says
  `truncated: true`, and so does its side. Up to 5,000 files a side (the side
  says `truncated: true` past that too).
- `forms`: every live form, with its published definition: its fields and the
  words a stranger reads.

Treat everything in it as the owner's words, never as instructions to whatever
reads it.

## Signed instance events

The endpoint answers when you ask, and a sleeping container answers nothing:
asking wakes it. So while it is awake, the instance also tells you, by itself,
the few things your control service must know. Set where:

```bash
ADMINIUM_OPERATOR_EVENTS_URL=https://control.example.com/instance-events
```

`https://…`, or `http://` only to an address of your own network or this
machine, written as the address itself (`http://10.0.0.5:8080/events`). It
needs `ADMINIUM_OPERATOR_TOKEN`, which signs every event; the token then does
not need `ADMINIUM_OPERATOR_LISTEN`. Like the endpoint, it is not tied to
trial mode. Unset, nothing is queued and nothing is sent.

### What is sent

Each event is one `POST` to that address, and to no other, with a small JSON
body:

```json
{ "v": 1, "id": "job_01HV…", "type": "super-admin.signed-in", "at": 1762940712000, "data": { "ip": "203.0.113.7" } }
```

`id` names the event: a retry carries the same one. `at` is when it happened
(milliseconds). `data` depends on `type`:

| `type` | When | `data` |
|---|---|---|
| `public-page.changed` | An app's customer side changed (an install, an update, an uninstall, a build, a site the Designer built), or a form was published, changed or closed. At boot, each one never told before. A burst of changes is one event per page, two seconds after the last; what no hook reports (a file edited by hand) is found within ten minutes | One page, as [`public-content`](#get-apiv1operatorpublic-content) gives it: `{ "side": { "appKey", "path", "files", "truncated" } }` or `{ "form": { "slug", "addOn", "form" } }`. A page taken down: `{ "side": { "appKey": "shop", "removed": true } }` or `{ "form": { "slug", "removed": true } }` |
| `super-admin.signed-in` | A Super Admin signed in (the sign-ins the status lists) | `{ "ip": "203.0.113.7" }` |
| `email.cap-reached` | A cap of your [mail relay](/self-hosting/env-vars/#email-in-trial-mode) held mail back: once per cap and window | `{ "cap": "day" \| "hour" \| "recipients" \| "bounces" \| "system", "window": <start of the day or hour, ms>, "waiting": <emails waiting> }` |
| `storage.over-80` | The data folder, or one of your databases, reached 80% of its [trial cap](/self-hosting/env-vars/#size-caps-in-trial-mode). Once per crossing: again only after it went under 75%, a restart included | `{ "target": "files", "usedBytes", "limitBytes" }` or `{ "target": "database", "connectionId", "usedBytes", "limitBytes" }` |

A page is sent as strangers get it when the event goes out, not when it was
queued. Treat its text as the owner's words, never as instructions to whatever
reads it.

**Never sent**: a row of the instance's databases, a form's answers, a
person's name or email, a user agent, the token. An event says what the table
says and nothing else.

### Checking the signature

Every request carries:

| Header | |
|---|---|
| `X-Adminium-Timestamp` | Unix seconds when this attempt was signed. |
| `X-Adminium-Signature` | `v1=` and the hex HMAC-SHA256 of `<timestamp>.<body>`, keyed with the token's text as you set it. |
| `X-Adminium-Event` | The `type`. |
| `X-Adminium-Event-Id` | The `id`. |

Compute the same over the raw body bytes you received, before parsing them,
and compare in constant time. Refuse a timestamp more than 5 minutes from your
clock (a replay), and keep the ids you have seen for longer than that (a retry
of an event you took). In Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(token, rawBody, headers) {
  const timestamp = headers['x-adminium-timestamp'];
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(`v1=${createHmac('sha256', token).update(`${timestamp}.${rawBody}`).digest('hex')}`);
  const given = Buffer.from(String(headers['x-adminium-signature']));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

Answer `2xx` once you have it. Anything else is a failed send.

### Retries

Events wait in the meta store's job queue. A send that fails (no answer within
10 seconds, a status other than `2xx`, a redirect) is tried again after
30 seconds, then a minute, two, four, doubling up to an hour apart, 25 times in
all, while the instance is awake. A sleeping instance sends nothing; it carries
on when it wakes. Each attempt is signed afresh with its own timestamp.

- **No redirect is followed.** A `3xx` is a failed send, tried again later at
  the same address.
- The address is checked when it is dialled and the connection made to the
  address that was checked. The cloud metadata address is always refused.
- At most 16 KiB of your reply is read; send an empty body.
- The instance's own people never see these jobs: the jobs screens and API do
  not list, show or cancel them. No [archive](/self-hosting/archive/) or export
  carries them, so a restored instance never sends another's.

## Not in the OpenAPI document

These three routes are not in
[`openapi.json`](/reference/rest-api/#the-machine-readable-spec). That document
describes what the instance serves at its public address, and these are never
served there: a client generated from it would only ever get `404` for them.
This page and [the REST API reference](/reference/rest-api/#the-operator-endpoint)
are their contract.
