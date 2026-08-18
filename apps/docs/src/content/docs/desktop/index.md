---
title: Install the desktop app
description: Download Adminium for macOS, Windows, or Linux — what each installer is, what your operating system will say about it, and how updates work.
---

The desktop app is the same Adminium as the server, wrapped in an Electron
shell: `@adminium/server` runs in a background process, the dashboard is served
over loopback, and nothing leaves your machine. No Docker, no Node, no terminal.

Download it from the
[Releases page](https://github.com/MoSofi/Adminium/releases) — desktop builds
are tagged `desktop-vX.Y.Z`, separately from the server's `vX.Y.Z` tags.

## Which file

| Platform | Download | Notes |
|---|---|---|
| macOS (Apple silicon) | `adminium-<version>-mac-arm64.dmg` | Signed with a Developer ID, notarized and stapled |
| macOS (Intel) | `adminium-<version>-mac-x64.dmg` | Same |
| Windows | `adminium-<version>-win-x64.exe` | NSIS installer. **Unsigned** — see below |
| Linux | `.AppImage`, `.deb`, `.rpm` | Unsigned; verify with `SHA256SUMS.txt` |

The `.zip` files next to the macOS `.dmg`s are what the auto-updater consumes.
You do not need to download them by hand.

## What your operating system will say

**macOS** — nothing. The app is signed with a Developer ID, notarized by Apple,
and the notarization ticket is stapled to the disk image, so it opens without a
Gatekeeper prompt and without a network round-trip to Apple.

**Windows** — SmartScreen will warn you that the publisher is unknown, because
the installer is not code-signed. This is a recorded decision for v1, not an
oversight: choose **More info → Run anyway**. Check the file against
`SHA256SUMS.txt` first if you want the assurance a signature would have given
you.

```powershell
Get-FileHash .\adminium-0.2.1-win-x64.exe -Algorithm SHA256
```

**Linux** — the `.AppImage` needs the executable bit:

```bash
chmod +x adminium-0.2.1-linux-x86_64.AppImage
./adminium-0.2.1-linux-x86_64.AppImage
```

Verify any download against the checksums file published with the release:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Updates

The app checks for updates and tells you when one is available; it does not
install anything behind your back. Three modes, in **Settings → Desktop**:

| Mode | What happens |
|---|---|
| `notify` (default) | Checks in the background, tells you when a release is out |
| `manual` | Never checks on its own — **Help → Check for Updates…** does |
| `disabled` | No checking at all |

The update check is separate from the [telemetry opt-in](/self-hosting/telemetry/)
and is governed by its own setting.

## Where everything lives

Two directories, and they are not the same one:

| | macOS | Windows | Linux |
|---|---|---|---|
| **App config** — `config.json`, including the master secret | `~/Library/Application Support/Adminium` | `%APPDATA%\Adminium` | `~/.config/Adminium` |
| **Your data** — the meta store, local SQLite databases, backups | Chosen on first run; defaults to `<config>/data` | Same | Same |

`config.json` holds `ADMINIUM_SECRET`, and every saved connection string and LLM
key in the meta store is encrypted with it. **A backup of your data directory
without that secret is not restorable.** The app keeps the secret in the OS
keychain where one is available (macOS Keychain, Windows DPAPI, the Linux
keyring); where none is, it falls back to plaintext in `config.json` and the
About screen says so.

## Next

- [First run](/desktop/first-run/) — the four-step setup
- [Backups](/desktop/backups/) — automatic, manual, and restoring
- [Share it on your network](/desktop/lan-share/) — let a phone or a colleague reach it
