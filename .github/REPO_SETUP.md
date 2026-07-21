# GitHub repository setup (apply when the remote is created)

Branch protection, labels, and milestones require a live GitHub repository. For `MoSofi/Adminium`, apply exactly the following. Everything here is one-time setup; keep this file updated if the required checks change.

## 1. General settings

- Default branch: `main`.
- Merge options: **squash merge only** — disable merge commits and rebase merging.
- Default squash commit message: "Pull request title" (PR titles follow Conventional Commits; enforced by lint from M0 per 15-T18).
- Automatically delete head branches: **on**.
- Discussions: **on** (linked from `.github/ISSUE_TEMPLATE/config.yml`).

## 2. Branch protection — `main`

Settings → Branches → Add rule (or a repository ruleset) for `main`:

- Require a pull request before merging; require 1 approving review.
- Require status checks to pass before merging, **strict** (branch must be up to date):
  - `verify` (from `ci.yml`)
  - `dep-graph` (from `ci.yml`)
- Require conversation resolution before merging.
- Do not allow force pushes or deletions.
- Include administrators.

When later milestones add jobs (`e2e`, `vrt`, `bundle`, `codeql` — see `workplan/15-quality.md` §11), add them to the required-check list in the same PR that makes them real.

Equivalent CLI:

```sh
gh api -X PUT repos/MoSofi/Adminium/branches/main/protection \
  -f required_status_checks[strict]=true \
  -f 'required_status_checks[contexts][]=verify' \
  -f 'required_status_checks[contexts][]=dep-graph' \
  -f enforce_admins=true \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -f restrictions=null \
  -F allow_force_pushes=false -F allow_deletions=false
```

## 3. Code scanning

Enable CodeQL default setup (Settings → Code security → Code scanning), then replace the stub `.github/workflows/codeql.yml` with the real analyze + `pnpm audit` jobs (PR + weekly schedule per `workplan/01-architecture.md` §11).

## 4. Labels

Delete the GitHub defaults that overlap, then create:

**Type:** `bug` (#d73a4a), `enhancement` (#a2eeef), `docs` (#0075ca), `ci` (#ededed), `security` (#b60205), `triage` (#fbca04), `good first issue` (#7057ff), `blocked` (#000000), `P0` (#b60205), `P1` (#d93f0b), `P2` (#fbca04).

**Area:** `area:engine`, `area:adapters`, `area:ui`, `area:widgets`, `area:charts`, `area:server`, `area:dashboard`, `area:meta`, `area:llm`, `area:i18n`, `area:desktop`, `area:docs`, `area:tokens` (all #c5def5).

**Milestone labels** `M0` … `M15` (all #bfd4f2), one per roadmap milestone:

```sh
for i in $(seq 0 15); do
  gh label create "M$i" --color bfd4f2 --description "Milestone M$i (workplan/16-milestones.md)"
done
```

## 5. Milestones

Create GitHub milestones `M0 — Foundation` through `M15 — Full audit / v1.0`, titles and scope from `workplan/16-milestones.md` (one GitHub milestone per roadmap milestone; due dates from the current schedule):

```sh
gh api repos/MoSofi/Adminium/milestones -f title="M0 — Foundation" -f description="See workplan/16-milestones.md"
# ... repeat for M1..M15 with their §-heading titles
```

## 6. Secrets (added as milestones need them)

None needed for M0. Later: npm token with provenance (M10), ghcr push (M10), Electron signing/notarization certs (M11), docs deploy token (M10) — each documented in the PR that introduces the consuming workflow.
