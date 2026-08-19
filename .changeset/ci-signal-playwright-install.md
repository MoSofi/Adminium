---
'@adminium/server': patch
---

Stop an apt outage from taking required CI checks down with it, and stop the VRT
job from reddening `ci` while it cannot detect anything.

`playwright install --with-deps chromium` stalled on an unreachable Ubuntu mirror
on 2026-08-18 and ran to the 30-minute job timeout in three jobs at once — `ci`'s
vrt, and e2e's postgres and mysql legs, two of which are required checks. The
runs reported as `cancelled`, which reads like "superseded by a newer push", so
main sat with no green run at HEAD and the summary did not say why.

Caching the browsers is not the fix and `e2e.yml` proves it: it already cached
`~/.cache/ms-playwright` and hung anyway, because `--with-deps` shells out to apt
on every run regardless of whether the browser is present. A new composite action
splits the two halves — apt is one bounded, best-effort attempt that warns and
continues, and the browser install is required but apt-free and left unwrapped,
since Playwright's downloader already retries across mirrors and fails fast on
its own. All seven install sites use it, bounded from the caller.

The vrt job now checks for committed baselines before spending anything. It used
to install dependencies, install a browser and build the workspace to reach a
step whose only action at zero baselines is to print a warning — so a job that is
not a required check, and that cannot detect a regression, was the sole reason
`ci` was red.

Adds a contract test over `.github/actions/*/action.yml`. `timeout-minutes` is
not a legal key on a composite-action step and the runner rejects the entire
manifest when it sees one, so a single bad key breaks every workflow using the
action. A draft of this change had exactly that and would have hard-failed five
required checks. Nothing caught it: `actionlint` never visits `.github/actions/`,
and pointed at an `action.yml` it parses the file as a workflow and exits 0.
