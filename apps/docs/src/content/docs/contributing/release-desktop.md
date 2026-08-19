---
title: Release the desktop app
description: Cut a desktop-v* tag, let CI build, sign, and notarize the installers, then review and publish the draft GitHub Release.
---

The desktop app (`@adminium/desktop`) releases on its own tags, separate from the
server's release channels (the Docker image, and the npm package once it is
published). Pushing a `desktop-vX.Y.Z` tag runs
`.github/workflows/desktop-release.yml`, which builds on macOS, Windows, and
Linux, signs and notarizes the macOS artifacts, and uploads everything —
installers, the auto-update feed files, and a checksums file — to a **draft**
GitHub Release. **A human reviews and publishes it. CI never makes a release
public.**

## Cut a release

```bash
# 1. Bump the version (must match the tag you are about to push)
#    apps/desktop/package.json → "version": "0.1.0"

# 2. Commit, then tag and push
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

The workflow refuses to build if the tag and `apps/desktop/package.json`
`version` disagree — the auto-update feed files encode the package version, and a
mismatch would advertise a version whose assets do not exist.

To validate a build **without** cutting a tag, run the workflow manually
(`workflow_dispatch`): it builds the full matrix and stops, touching no Release.

## What CI produces

| Platform | Artifacts | Signed? |
|---|---|---|
| macOS | `.dmg` (human download) + `.zip` (what the updater consumes), x64 + arm64 | Yes — Developer ID, hardened runtime, notarized |
| Windows | `.exe` (NSIS installer) | **No — unsigned for v1** (see below) |
| Linux | `.AppImage`, `.deb`, `.rpm` | No (unsigned; checksums only) |

Alongside the installers, the release carries the electron-updater feed files
(`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) and `SHA256SUMS.txt`. Only
`desktop-v*` releases are allowed to carry `latest*.yml` files, so nothing else
in the repo may attach a file with that name.

The app finds those files by reading the releases **list** and picking the newest
`desktop-v*` entry itself, then pinning the updater to that one release's asset
directory. It deliberately does not use GitHub's "latest release", because that
is a single pointer for the whole repository and the `v*` npm series can hold it
— which is what silently broke updates on every platform for 0.2.1. Installs
already in the field cannot be changed, and they *do* resolve through that
pointer, which is why publishing a desktop release must also claim it.

## Publishing the draft

1. Open the draft Release CI created for the tag.
2. Read the body CI seeded. It is already real release notes — the version, the
   unsigned-Windows/SmartScreen warning, how to verify a download against
   `SHA256SUMS.txt`, and a link to the changelog — so publishing it untouched
   gives users a correct page rather than a placeholder. Add a short summary of
   *what changed* above it if the version deserves one, and **flag any version
   that carries a meta-store migration** — migrations are forward-only, so there
   is no downgrade path once a user updates.

   Your checklist is **not** in the body; it is in the workflow run's job
   summary. That split is deliberate: while the two were one string the body
   opened with "Draft — review before publishing" and a list of TODOs, and
   desktop-v0.2.1 was published with them still there.
3. On a clean Mac, confirm the signed app passes Gatekeeper before publishing:
   ```bash
   spctl -a -vv /Applications/Adminium.app
   ```
4. Publish it **and claim the Latest pointer, in one command**:
   ```bash
   gh release edit desktop-vX.Y.Z --repo MoSofi/Adminium --draft=false --latest
   ```
   The `--latest` is not decoration. Every install already in the field resolves
   its update feed through GitHub's Latest pointer, so a published desktop
   release that does not hold it is invisible to all of them. Publishing through
   the web UI works too — tick **Set as the latest release** — but the two steps
   are one command here so the release is never briefly public without it.

   **Stable tags only.** For a release candidate (`desktop-vX.Y.Z-rc.N`) publish
   with `--draft=false` and *no* `--latest`: GitHub refuses the pointer to a
   prerelease, and handing it to an rc would point every stable install at a
   release candidate. The job summary on the run that built the draft prints the
   right command for the tag, so follow the one it gives you.
5. Confirm the pointer actually moved, and that the feed file it now implies is
   reachable:
   ```bash
   gh api repos/MoSofi/Adminium/releases/latest --jq .tag_name
   curl -sIL -o /dev/null -w '%{http_code}\n' \
     https://github.com/MoSofi/Adminium/releases/download/desktop-vX.Y.Z/latest-mac.yml
   ```
   Expect the tag you just published, then `200`. A `v*` tag here means
   `release.yml` reclaimed the pointer and desktop updates are broken again.

## Signing and notarization checklist

Signing secrets live only in a protected GitHub Actions environment
(`desktop-release`) with required reviewers — the workflow pauses for approval
before any signing material is exposed.

- [ ] Apple Developer Program enrollment; **Developer ID Application** certificate
      exported to CI as `CSC_LINK` + `CSC_KEY_PASSWORD`.
- [ ] App Store Connect API key for notarization: `APPLE_API_KEY` (the `.p8`),
      `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- [ ] `entitlements.mac.plist`: hardened runtime on;
      `com.apple.security.cs.allow-unsigned-executable-memory` **not** granted; no
      app sandbox (the app needs arbitrary file access for user-chosen SQLite
      files).
- [ ] Verify on a clean machine: `spctl -a -vv Adminium.app` and a quarantine-bit
      launch test.
- [ ] Linux: no signing; the `SHA256SUMS.txt` file ships alongside the artifacts.

## Windows is unsigned in v1

No Windows code-signing certificate is owned yet, so **Windows installers ship
unsigned**. State this plainly to users rather than burying it:

- On download, SmartScreen shows **"Windows protected your PC"**. The user must
  click **More info → Run anyway** to install.
- SmartScreen reputation builds over time even for signed apps, so a fresh
  certificate would not remove the warning immediately — this is expected, not a
  bug.
- The `SHA256SUMS.txt` file is the only integrity signal an unsigned installer
  has. Users who want to verify a download should check it against that file.

The signing path is built but disabled: the workflow's Windows signing step is
gated on a `WIN_CSC_LINK` secret that does not exist. Enabling Windows signing
later is a **secrets change, not a code change** — add `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` to the `desktop-release` environment and the next release
signs itself.
