---
'@adminium/desktop': patch
---

Fix the desktop auto-updater, which was broken for every shipped install on all
three platforms.

electron-updater's GitHub provider resolves the release to update to through
`/releases/latest`. That is a single stored pointer for the whole repository,
and this repository publishes two interleaved tag series — `v*` for npm/Docker
and `desktop-v*` for the app. The pointer sat on `v0.2.1`, an npm release
carrying no installers, so every install resolved that tag and then 404'd
fetching `latest-mac.yml`. Because the failure is in tag resolution, before a
per-platform channel file is chosen, Windows and Linux failed identically.
`vPrefixedTagName: false` did not prevent it and never could: electron-updater
reads that option nowhere.

The app now resolves its own release — newest `desktop-v*` entry from the
releases LIST endpoint, drafts and prereleases skipped, selected by highest
version rather than list position — and pins electron-updater to that one
release's asset directory with a `generic` feed. This is the same read
`apps/server/src/telemetry/update-check.ts` already performs for the server
series, for the same documented reason.

Details that are load-bearing rather than incidental:

- The feed sets `useMultipleRangeRequest: false`. `BaseGitHubProvider` hardcodes
  it; the generic branch would infer it true for a github.com URL, and GitHub's
  asset CDN answers a multipart Range with HTTP 501 — which would silently
  degrade every delta download to a full one.
- The resolved release body is carried into the `update-available` event. The
  generic provider back-fills neither `releaseNotes` nor `releaseName`, and the
  published `latest*.yml` carry neither key, so it is now the only source of
  in-app release notes.
- A feed that cannot be read maps to `error`, never `none` — a rate-limited API
  rendering as "You are on the latest version." would be the same class of
  falsehood in a new place.
- The tag pattern is anchored and stable-only. Under the generic provider
  `allowPrerelease` is read by nothing, so the pattern is the only guard that
  cannot be forgotten at publish time.
- Feed resolution happens per check, not at construction, so a long-running app
  sees a release published after launch — and a `disabled` boot still makes no
  outbound call.
- The release list is PAGINATED, and that is not incidental. The list is
  repository-wide and date-sorted, and the `v*` series is far denser than
  `desktop-v*`; reading a single page would work until 100 npm releases sat
  newer than the newest desktop release, at which point our tag falls out of the
  window and every install silently stops updating. Reading one repo-wide window
  and hoping the sparse series is inside it is the same assumption
  `/releases/latest` made.
- Resolution runs on Electron's `net.fetch`, not Node's global `fetch`.
  electron-updater downloads through Chromium's network stack, which honours the
  system/PAC proxy, proxy authentication and the OS trust store; undici honours
  none of them. Resolving on undici while downloading on Chromium would fail
  every check on a managed machine even though the download would have worked.
- The request carries a 10 s timeout, and a `Link: rel="next"` that points off
  `api.github.com` is never followed.
