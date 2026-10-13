---
title: Telemetry
description: Adminium sends nothing anywhere unless you turn it on. What ADMINIUM_TELEMETRY does, and what it does not.
sidebar:
  order: 8
---

## It is off

A default Adminium install makes no outbound requests to Adminium. No analytics,
no license check, no phone-home, no "anonymous usage statistics" that are on
until you find the setting.

This is not a preference we hope you keep. It is the default because the product
is AGPL-3.0 software running on your infrastructure, and software on your
infrastructure should not report to its author unless you asked it to.

## The two controls

Telemetry has **one switch with two places to set it**, and the environment
outranks the screen:

| Control | Where | Wins? |
|---|---|---|
| **Share anonymous usage data** | The first-run wizard, or `PUT /api/v1/settings/telemetry` | Only when `ADMINIUM_TELEMETRY` is unset |
| `ADMINIUM_TELEMETRY` | The process environment | **Always, when set** |

### Turning it on

Answer **yes** on the first-run consent screen. That is the normal path, and it
is all a single self-hosted instance needs.

### Enforcing an answer for the whole deployment

```bash
ADMINIUM_TELEMETRY=off   # nothing is ever sent, whatever anyone clicks
ADMINIUM_TELEMETRY=on    # always sent, without waiting for the wizard
```

Accepts `on`, `true`, `1` (and `off`, `false`, `0`). **Leave it unset** unless
you mean to override the consent screen — unset is not "off", it is "let the
answer stand", and that is what you want on a normal install.

Set it if you are the operator of a fleet and the answer is not the wizard's to
give: `ADMINIUM_TELEMETRY=off` in your compose file or unit file is a hard veto
that a user clicking "yes" cannot lift.

## What Adminium connects to when telemetry is off

Worth stating explicitly, because "off" should mean off:

| | Connects out? |
|---|---|
| Telemetry | **No** |
| License / activation check | **No — there is none** |
| Fonts, icons, assets | **No** — all bundled, no CDN |
| Looking a town up by name | **No** — the list of places ships with Adminium |
| Map pictures | **Yes, from each viewer's browser, while maps are on.** See below. |
| Routes along roads | Only if switched on in Settings → Maps. See below. |
| Your source database | Yes, obviously |
| Your meta store | Yes |
| An LLM provider | Only if **you** configured a key, and never on the [BYO path](/guides/llm-assist/byo-prompt/) |
| Update check | Only if enabled |

An air-gapped Adminium is a supported configuration, not a workaround.

### Maps

Maps are the one thing here that is **on until you turn it off**, so it is said plainly.

**Map pictures.** A page that draws a map makes the **browser of the person looking at it**
fetch that map's pictures from the map server (`https://tiles.openfreemap.org` unless you set
[`ADMINIUM_MAP_SERVER`](/self-hosting/env-vars/#adminium_map_server)). The screens that do it:
a dashboard or page with a map widget, a record or a form with a place or an area on it, and
Settings → Maps (its preview). The map server learns the viewer's IP address and which part of
the world they looked at. It is never sent a row, a name, or where your pins are. Your Adminium
server itself sends it nothing.

Turn it off for everybody in **Settings → Maps → Show maps**, or for the install with
`ADMINIUM_MAP_SERVER=off`. While it is off, the Content-Security-Policy names no outside server,
so no page can fetch from one. The desktop app shows no outside map.

While maps are on, that policy names the map server's host on every page the server sends, the
sign-in page included: the dashboard is one page, loaded before anybody signs in, and its
policy is the one a map is later drawn under. So somebody who is not signed in can read which
map server you chose, which is no secret. The dashboard's files never hold the address: the
server hands it to the dashboard only while maps are on, and with maps off nothing names it.

**Routes along roads.** Off by default. Once somebody switches **Settings → Maps → Routes along
roads** on, your **server** asks the routing server (`https://router.project-osrm.org` unless
you set [`ADMINIUM_ROUTING_SERVER`](/self-hosting/env-vars/#adminium_routing_server)) for a
route when a page shows one. It is sent the ordered positions of the route's stops: no name, no
row, and not the viewer's address. Turn it off with the same switch, with
`ADMINIUM_ROUTING_SERVER=off`, or with `ADMINIUM_NETWORK_FEATURES=off`.

→ [Maps, places and routes](/guides/apps/maps/)

## The AGPL and the About screen

Adminium is AGPL-3.0. Section 13 requires that users interacting with a modified
version over a network can obtain its source. The About screen carries the
version, the license, and the source offer — which is how a self-hosted instance
satisfies that obligation for its own users.

If you modify Adminium and let others use it over a network, that offer needs to
point at **your** source. Do not remove the About screen; it is doing a job.

## Update checks are a separate consent

A self-hosted instance can check whether a newer version exists and show a
notice on the About screen. That is a network request — to
`api.github.com`, disclosing this instance's public IP and its version — and it
has its **own** switch, which telemetry does not govern:

| | Setting | Default | Asked where |
|---|---|---|---|
| Telemetry | `telemetry.enabled` | off | First-run consent screen |
| Update check | `updates.checkEnabled` | off | First-run consent screen (separate question) |

Both are off by default and each is answered on its own. Turning telemetry
**off** does **not** turn the update check off — if you answered yes to the
update question, the check keeps running. They are separate because they
disclose different things to different parties, so inheriting one consent from
the other would be assuming an answer nobody gave.

Both are revisited on the same endpoint, which writes both keys at once — so
turning one off means sending the other's current value with it:

```bash
# both off
curl -X PUT https://your-instance/api/v1/settings/telemetry \
  -H 'content-type: application/json' \
  -d '{"telemetry": false, "updateCheck": false}'
```

Requires the `settings.manage` permission, and the change is written to the
audit log.

`ADMINIUM_TELEMETRY` does **not** cover the update check — it is the telemetry
switch, exactly as its name says. `updates.checkEnabled` is the only control for
the update check.

Nothing is ever downloaded or installed automatically, whichever way these are
set. Upgrades are yours to perform: [Upgrading](/self-hosting/upgrades/).

## LLM providers are a separate question

If you configure a provider key, Adminium calls that provider — that is what you
configured it to do. That is unrelated to telemetry and is not governed by
`ADMINIUM_TELEMETRY`.

If you want AI assist with no network I/O at all, the
[BYO round-trip](/guides/llm-assist/byo-prompt/) is exactly that: Adminium
writes a prompt to a file and stops.
