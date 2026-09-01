# syntax=docker/dockerfile:1.7
#
# The Adminium image (01-architecture.md §4.2) — `ghcr.io/mosofi/adminium`.
#
# Multi-stage (build → node:22-slim runtime), non-root, `dumb-init` as PID 1,
# multi-arch (linux/amd64 + linux/arm64 via buildx). It runs the SAME CLI the
# npm package exposes (§4.1) — `adminium start` — so the container and
# `npx adminium` are one code path with two front doors, not two boot paths.
#
# NO SECRET IS BAKED IN: `ADMINIUM_SECRET` arrives via the environment at run
# time (§7.1). The image ships only code.
#
# Both stages are Debian bookworm, and node:22-slim is bookworm-slim. The reason
# used to be an ABI one: `better-sqlite3` and `argon2` were native modules
# COMPILED in the build stage and loaded in the runtime stage, so the two had to
# share a glibc ABI, and swapping either for Alpine (musl) produced an image that
# built and then died at require().
#
# THAT IS NO LONGER WHY (2026-08-14). Neither module compiles here anymore, and
# both handle musl on their own:
#
#   better-sqlite3 >= 13  N-API, ships prebuilds/{linux,linuxmusl}-{x64,arm64}
#                         and picks one at load time via `isLinuxMusl()`
#                         (process.report … glibcVersionRuntime).
#   argon2 >= 0.44        N-API, ships linux-{x64,arm64,arm} prebuilds tagged
#                         `.glibc.node` / `.musl.node`, picked at load time by
#                         node-gyp-build (LIBC env var, else Alpine detection).
#
# Selection happens independently in whichever stage does the loading, so there is
# no cross-stage ABI to keep aligned. Staying on bookworm is still the right
# default — it is what CI, the npm package and every smoke test exercise, and it
# is a known-good glibc — but it is no longer load-bearing for these two modules.
# An Alpine runtime is now plausible rather than fatal; it is also completely
# untested here, so do not treat the above as a green light.

# ─────────────────────────── build ───────────────────────────
FROM node:22-bookworm AS build

# CI=true keeps pnpm non-interactive (it otherwise aborts on "no TTY" prompts).
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Toolchain for the native modules above. buildx runs this stage on the TARGET
# platform, so anything compiled here already matches the runtime arch and no
# cross-compilation is involved.
#
# On the two platforms this image is built for (linux/amd64, linux/arm64) NOTHING
# is expected to compile anymore — better-sqlite3 13 and argon2 0.44 both resolve
# a bundled glibc prebuild for those tuples, which is why an install that used to
# spend minutes on arm64 under QEMU is now fast. The toolchain stays as the
# fallback that keeps the build honest: node-gyp-build compiles when no prebuild
# matches, so a future dependency, platform, or a dropped prebuild variant fails
# LOUDLY at build time here rather than silently shipping an image that dies at
# require(). Removing it would trade a slower build for a broken release.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# pnpm comes from the `packageManager` field in the root package.json — one
# pinned version for the repo, CI, and this image.
RUN corepack enable

WORKDIR /repo

# The whole workspace is copied before install (rather than the manifests-then-
# sources dance, or `pnpm fetch`) because this image is built on release tags,
# not per commit: reproducing CI's exact, proven `install --frozen-lockfile` is
# worth more here than shaving a cached layer off a build that runs on release.
# .dockerignore keeps the context to sources.
COPY . .

RUN pnpm install --frozen-lockfile

# `--filter=<pkg>...` = the package plus everything it depends on. The dashboard
# is not a server dependency (it is a separate SPA build) so it is named too.
RUN pnpm turbo run build --filter=@adminium/server... --filter=@adminium/dashboard...

# §4.1: the distributable "bundles the server, the dashboard `dist/`, and the
# meta migrations". This copies apps/dashboard/dist → apps/server/dashboard,
# which is on the server package's `files` allow-list. It MUST run before
# `pnpm deploy` below, which honours that allow-list — skip it and the image
# boots API-only and never renders the first-run wizard.
RUN node apps/server/scripts/bundle-dashboard.mjs

# Same deal for the LLM allow-lists (`@adminium/widgets` is not a server
# dependency and cannot be — it is `private: true` — so `pnpm deploy` will not
# inject it). Snapshot the two vocabularies into apps/server/vocabulary, which
# is likewise on the `files` allow-list and is the first path the CLI probes.
# Skip it and `generate-prompt` / `apply-llm-response` die in the container.
# `--check` re-reads what was written, so a silently empty emit fails the build
# here rather than at a user's terminal.
RUN node apps/server/scripts/bundle-allowlists.mjs \
    && node apps/server/scripts/bundle-allowlists.mjs --check

# Resolve the workspace into a self-contained tree: prod deps only, workspace
# packages (@adminium/meta and its migrations, engine, llm, …) injected as real
# directories, every symlink relative to the tree itself. That is what makes the
# single `COPY --from=build` below sufficient.
RUN pnpm deploy --filter=@adminium/server --prod --legacy /app

# The bundled add-on set (32 D3, 32-T12): the six first-party add-on tarballs
# plus their `.integrity` sidecars, fetched from registry.npmjs.org and verified
# against the exact sha512 pins in scripts/release/add-ons-bundle.json before a
# byte lands. Parked at /app/add-ons-bundle because the runtime stage keeps
# WORKDIR /app, so the server's CWD-relative default `./add-ons-bundle`
# (compose.ts BUNDLED_ADD_ONS_DIR) finds it with no env var, and the single
# `COPY --from=build /app /app` below carries it. The layer is keyed by this
# script + pin file like any other build input, so a pin bump — the per-release
# refresh — invalidates it; the boot seed re-verifies every hash again on the
# way into the store, copy-if-absent.
RUN node scripts/release/fetch-add-ons-bundle.mjs /app/add-ons-bundle

# ────────────────────────── runtime ──────────────────────────
FROM node:22-slim AS runtime

# dumb-init reaps zombies and forwards signals, so `docker stop` reaches Fastify
# as a real SIGTERM instead of being swallowed by a PID-1 node process.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ADMINIUM_DATA_DIR=/data \
    PORT=4600 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /app /app

# `adminium <cmd>` for `docker compose exec` / one-shot overrides
# (e.g. `docker run … adminium migrate`). The default CMD stays on the explicit
# `node dist/cli/index.js` path so booting never depends on this symlink.
RUN chmod +x /app/dist/cli/index.js \
    && ln -s /app/dist/cli/index.js /usr/local/bin/adminium

# §4.2: the adminium-data volume mounts here; ADMINIUM_DATA_DIR points at it.
# Created and owned before USER drops, because a non-root process cannot chown
# its own mount point.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# node:22-slim ships an unprivileged `node` user (uid 1000) — no root at runtime.
USER node

EXPOSE 4600

# LIVENESS. The probe hits the REAL API health route, /api/v1/healthz, and
# asserts the JSON body's `ok`.
#
# It deliberately does NOT hit bare /healthz: that path has no route, so the SPA
# history fallback answers it with index.html and HTTP 200 — a check there
# passes as long as the static files exist on disk, whether or not the API is
# running at all. Asserting on parsed JSON is what binds this to the server.
#
# WHAT IT DOES NOT DO: check dependencies. /api/v1/healthz answers `{ok:true}`
# unconditionally, so an instance whose meta store has died stays "healthy"
# here. That is correct for a Docker healthcheck — it drives `restart`, and
# restarting cannot reconnect a dead Postgres; failing here would turn a
# database blip into a crash-loop. Use /api/v1/readyz, which does check the meta
# store and answers 503 when it is unreachable, for load-balancer or
# orchestrator readiness gating.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||4600}/api/v1/healthz`).then(r=>r.ok?r.json():Promise.reject(r.status)).then(b=>process.exit(b.ok===true?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "/app/dist/cli/index.js", "start"]
