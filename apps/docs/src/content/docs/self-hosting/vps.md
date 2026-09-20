---
title: A VPS without Docker
description: Run the npm package as a systemd service on a plain Linux server, pinned to one version, with Caddy in front for HTTPS.
sidebar:
  order: 2
---

This page sets Adminium up on a Linux server with no Docker: a DigitalOcean
droplet, a GoDaddy VPS, or any other machine that runs systemd. At the end,
systemd runs one pinned version of the npm package, starts it at boot and
restarts it if it crashes. Caddy serves it over HTTPS.

It is the same process the [Docker image](/getting-started/docker/) runs. The
image's command is `node /app/dist/cli/index.js start`, and the service below
runs that same file from `/opt/adminium`.

Deploying a [project](/projects/) this way instead? Follow this page, with the
three differences in
[Deploy a project](/projects/deploy/#a-vps-without-docker).

| | Where it lives |
|---|---|
| The code | `/opt/adminium`, owned by root |
| The settings, including the secret | `/etc/adminium/adminium.env`, readable by root only |
| The data directory | `/var/lib/adminium`, owned by the service user |
| The logs | the systemd journal: `journalctl -u adminium` |

The commands are for Debian and Ubuntu. On another distribution, only the
package installs differ.

## What you need

- A Linux server with systemd, and an account that can use `sudo`, with **at
  least 1 GB of memory** — enough for Adminium, PostgreSQL and Caddy together.
  512 MB is not: Adminium alone peaks around 220 MB on its first boot, and on a
  box that size a reverse proxy, a database and the distribution's own daemons
  leave it no headroom. Droplets and most small VPSes ship without swap, so
  there is nothing to absorb the spike.
- A domain name whose DNS record points at the server, with ports 80 and 443
  open. Caddy needs both to get a certificate.
- A database for Adminium's own tables, the meta store. This page puts
  PostgreSQL on the same server. A managed database works the same way; only
  `ADMINIUM_META_URL` changes. See
  [Where to put the meta store](/self-hosting/meta-store/).

## 1. Install Node.js

Adminium needs **Node.js 22.14 or newer**. The distributions ship older
versions (Debian 12 has Node.js 18), so install it from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt-get install -y nodejs
node -v
```

This installs `node` at `/usr/bin/node`, the path the service uses. If you
install Node.js another way, use the path that `command -v node` prints.

## 2. Create the meta database

```bash
sudo apt-get install -y postgresql
sudo -u postgres createuser --pwprompt adminium
sudo -u postgres createdb --owner=adminium adminium_meta
```

Use a password made of letters and digits only (`openssl rand -hex 24` makes
one). It goes into a URL in step 4, where other characters would need escaping.

## 3. Install Adminium at a fixed version

Create the user the service runs as:

```bash
sudo useradd --system --home-dir /var/lib/adminium --shell /usr/sbin/nologin adminium
```

Then install the package into `/opt/adminium`:

```bash
VERSION=$(npm view @adminiumjs/adminium version)   # the newest release
sudo npm install --prefix /opt/adminium --save-exact "@adminiumjs/adminium@$VERSION"
```

To install another release, set `VERSION` to it instead. `--save-exact` writes
that exact version into `/opt/adminium/package.json`. Without it, npm saves a
range such as `^0.3.0-rc.0`, which `npm update` is allowed to move. The version on
this server now changes only when you run this command again.

The install usually takes less than a minute and uses about 230 MB of disk.
You do not need a compiler on x64 or arm64: the two native modules, the SQLite
driver and argon2, include prebuilt binaries.

The files belong to root. The service can read them but not change them.

:::caution[Do not run a server with plain `npx`]
`npx @adminiumjs/adminium start` with no version in the spec checks the registry
each time it runs. When a newer release is out, it installs that release. Under systemd
there is no terminal, so it does not ask first: npm only logs a warning.

`start` then applies any new meta migrations. They cannot be undone, so from
then on the version you meant to run refuses to start against that meta store
(exit code 78). A service should change version only when you change it, which
is what the install above gives you.
:::

## 4. Write the settings

Create the settings file, readable by root only. systemd reads it before it
starts the service, so the service user never needs to.

```bash
sudo mkdir -p /etc/adminium
sudo touch /etc/adminium/adminium.env
sudo chmod 600 /etc/adminium/adminium.env
```

Generate the secret:

```bash
openssl rand -hex 32
```

Open the file (`sudo nano /etc/adminium/adminium.env`) and write these lines,
with your own values:

```bash title="/etc/adminium/adminium.env"
ADMINIUM_SECRET=paste-the-openssl-output-here
ADMINIUM_META_URL=postgres://adminium:the-password-from-step-2@127.0.0.1:5432/adminium_meta
ADMINIUM_DATA_DIR=/var/lib/adminium
HOST=127.0.0.1
PORT=4600
ADMINIUM_TRUST_PROXY=on
```

What each line is for:

- **`ADMINIUM_SECRET`** encrypts every stored connection string and API key.
  Keep a copy somewhere safe. If you lose it, those values cannot be
  decrypted. See [Security hardening](/self-hosting/security/).
- **`ADMINIUM_META_URL`** is the database from step 2.
- **`ADMINIUM_DATA_DIR`** must be set on a service. Without it, the CLI chooses
  a directory based on where it was started: `./data` inside a project,
  `~/.adminium` otherwise.
- **`HOST=127.0.0.1`** keeps port 4600 off the network. Only programs on this
  server, such as Caddy, can reach it.
- **`ADMINIUM_TRUST_PROXY=on`** tells Adminium that a proxy sits in front. It
  is safe because of `HOST=127.0.0.1`. See
  [Behind a reverse proxy](/self-hosting/reverse-proxy/).

To use the embedded SQLite store instead of PostgreSQL, leave out
`ADMINIUM_META_URL`. The store is then `/var/lib/adminium/meta.db`, and that
directory is your database: back it up like one.

## 5. Create the service

```ini title="/etc/systemd/system/adminium.service"
[Unit]
Description=Adminium
Documentation=https://docs.adminium.dev/self-hosting/vps/
Wants=network-online.target
After=network-online.target postgresql.service

[Service]
User=adminium
Group=adminium
EnvironmentFile=/etc/adminium/adminium.env
ExecStart=/usr/bin/node /opt/adminium/node_modules/@adminiumjs/adminium/dist/cli/index.js start
WorkingDirectory=/var/lib/adminium
StateDirectory=adminium
StateDirectoryMode=0750
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=78
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

What the lines do:

- **`ExecStart`** runs the CLI's entry file with `start`. `start` applies any
  pending meta migrations, then serves.
- **`StateDirectory=adminium`** creates `/var/lib/adminium` and gives it to the
  `adminium` user. Because of `ProtectSystem=strict`, it is the only place the
  service can write.
- **`After=postgresql.service`** starts Adminium after a PostgreSQL on the same
  server is up. If your meta store is elsewhere, the line has no effect.
- **`Restart=on-failure`** starts Adminium again if it crashes.
- **`RestartPreventExitStatus=78`** makes one exception. Adminium exits with
  code 78 when it refuses to start because of its setup, for example a meta
  store already migrated by a newer version. A restart cannot fix that, so
  systemd stops and shows the error instead of retrying every five seconds.

Start the service now and at every boot. It takes a moment to start
listening, so wait a few seconds before you check it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now adminium
sleep 5
curl -s http://127.0.0.1:4600/api/v1/healthz
```

The answer should contain `"ok":true`:

```json
{"ok":true,"version":"0.3.0-rc.0","uptime":5.03}
```

If `curl` prints nothing, wait a little longer and run it again. If it still
fails, the reason is in the journal:

```bash
systemctl status adminium
journalctl -u adminium -n 50
```

## 6. Put Caddy in front

Install Caddy from its own package repository, following the Debian and
Ubuntu steps at
[caddyserver.com/docs/install](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
The package runs Caddy as a systemd service.

Replace `/etc/caddy/Caddyfile` with:

```text title="/etc/caddy/Caddyfile"
admin.example.com {
	reverse_proxy 127.0.0.1:4600
}
```

Load it and check it:

```bash
sudo systemctl reload caddy
curl -s https://admin.example.com/api/v1/healthz
```

Caddy requests a certificate for the name as soon as it loads the file, and
renews it on its own, so the `curl` can fail for a few seconds at first. Caddy
also redirects HTTP to HTTPS. Open `https://admin.example.com` and create the
first super admin.

## Running `adminium` commands

A command such as `adminium migrate` has to run with the service's settings
and as the service's user. This small script does both. Save it as
`/usr/local/bin/adminium`:

```sh title="/usr/local/bin/adminium"
#!/bin/sh
# Runs an adminium command as the service user, with the service's settings.
exec systemd-run --quiet --wait --pipe --collect \
  --uid=adminium --gid=adminium \
  --working-directory=/var/lib/adminium \
  --property=EnvironmentFile=/etc/adminium/adminium.env \
  /usr/bin/node /opt/adminium/node_modules/@adminiumjs/adminium/dist/cli/index.js "$@"
```

```bash
sudo chmod 755 /usr/local/bin/adminium
sudo adminium --version
sudo adminium migrate --status
```

systemd reads the settings file exactly as it does for the service, and the
script exits with the command's own exit code.

## Upgrading

Read the [release notes](https://github.com/MoSofi/Adminium/releases) for the
version you are moving to, then:

```bash
# 1. Back up the meta store.
sudo -u postgres pg_dump adminium_meta > meta-backup-$(date +%F).sql

# 2. Stop the service.
sudo systemctl stop adminium

# 3. Move the pin.
VERSION=$(npm view @adminiumjs/adminium version)   # or the release you want
sudo npm install --prefix /opt/adminium --save-exact "@adminiumjs/adminium@$VERSION"

# 4. Apply the new release's meta migrations.
sudo adminium migrate

# 5. Start it again, and check it once it is listening.
sudo systemctl start adminium
sleep 5
curl -s http://127.0.0.1:4600/api/v1/healthz
```

Stop the service before step 3. The install replaces files that the running
process may still load.

`start` would apply the migrations too. Running `adminium migrate` first shows
you each migration it applied, and if one fails, the service is still stopped
while you restore the backup. With the embedded SQLite store, it also saves a
snapshot to `/var/lib/adminium/backups` before it changes anything.

Going back takes more than moving the pin back. If the new release applied
migrations, the older version refuses to start against them and exits with
code 78. Restore the backup from step 1, then install the older version again.

[Upgrading](/self-hosting/upgrades/) covers the backup commands for the other
databases, and the migration checks.

## Backups

Back up three things together, and test the restore:

- the meta store: `pg_dump`, as in step 1 of the upgrade;
- `/var/lib/adminium`: uploaded files and exports, and the meta store itself
  if it is SQLite;
- `/etc/adminium/adminium.env`, or at least the secret in it. A meta store
  backup is unreadable without it.

More in [Self-hosting Adminium](/self-hosting/#backups).
