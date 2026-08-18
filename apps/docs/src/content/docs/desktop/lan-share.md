---
title: Share it on your network
description: Let a phone, a tablet, or a colleague on the same network reach your desktop Adminium — and what you are accepting when you do.
---

By default the desktop app binds `127.0.0.1`: it is reachable from your machine
and nowhere else. LAN share rebinds it to every interface so other devices on the
same network can open it.

## Turning it on

**Settings → Desktop → Share on this network.** Pick a port — 4600 by default —
and the app shows you the URLs that actually reach it, one per network interface:

```
http://192.168.1.24:4600     en0
http://10.13.37.5:4600       utun3
```

Those are the addresses to type into the other device. The list is IPv4 and
non-loopback only, deliberately: `127.0.0.1` works when *you* test it and fails
for everyone you send it to, and a link-local IPv6 address is not typeable into
another device's browser without a zone index that means something different on
every machine.

If the port is already taken, the app says so before restarting anything and
offers the next one up.

Changing the setting restarts the background server, and the window reloads onto
the new address. That takes a second or two.

## What you are accepting

:::caution[Plain HTTP, on whatever network you are on]
LAN share serves **HTTP, not HTTPS**. Anything on the network path can read the
traffic, including session cookies and the rows you are looking at. Turn it on
for your own network; do not turn it on at a café, a conference, or a hotel.
:::

Two more things follow from that, and both are worth doing before you flip the
toggle:

1. **Turn off "Skip login on this computer"** (Settings → Desktop → Require login
   on this device). With login skipped, anyone who reaches the URL is you. That is
   a fine trade on a machine only you can touch, and the wrong one the moment the
   machine is reachable from a phone in the next room.
2. **Give other people their own accounts**, with roles. Settings → Users →
   Invite. A shared login has no audit trail worth the name — every row in the
   audit log would say the same person did everything.

Your operating system firewall will probably ask whether to allow incoming
connections the first time. It has to be allowed for this to work.

## Turning it off

Same toggle. The server rebinds to `127.0.0.1` and the other devices stop
resolving it immediately — there is no lingering listener.

## If you need this permanently

A desktop app that is always on so other people can use it is really a server. At
that point run [the Docker image](/getting-started/docker/) or
[the npm package](/getting-started/quickstart/) on a machine that stays up, put
it [behind a reverse proxy](/self-hosting/reverse-proxy/) with TLS, and let the
desktop app go back to being yours.
