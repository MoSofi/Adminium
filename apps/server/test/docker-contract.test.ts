// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Docker distribution contract (01-architecture.md §4.2, M10-T02).
 *
 * The image and the compose file are the deployment surface: nothing else in the
 * suite fails if `docker-compose.yml` loses its data volume or the Dockerfile
 * starts running as root, and CI cannot build an image on every PR. This pins
 * the §4.2 spec as executable assertions so it cannot drift silently.
 *
 * The healthcheck assertions are the reason this file lives in apps/server
 * rather than next to the YAML: they resolve the probe's path against the
 * server's OWN route table (`API_PREFIX`) and then boot the real app and call
 * it. A healthcheck is the one part of the contract that can look correct and be
 * useless — see the SPA-fallback test below.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { envSchema } from '../src/config/env.js';
import { API_PREFIX } from '../src/routes/index.js';
import { makeEnv } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (name: string): string => readFileSync(join(repoRoot, name), 'utf8');

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

interface ComposeService {
  image?: string;
  ports?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  profiles?: string[];
  healthcheck?: { test?: string[]; interval?: string; timeout?: string; retries?: number };
  depends_on?: unknown;
}
interface ComposeFile {
  services: Record<string, ComposeService>;
  volumes: Record<string, unknown>;
}
const compose = parse(read('docker-compose.yml')) as ComposeFile;

/** Instruction lines, comments and continuations folded away. */
const dockerfileInstructions: string[] = (() => {
  const lines = dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const folded: string[] = [];
  let buffer = '';
  for (const line of lines) {
    buffer += buffer === '' ? line : ` ${line}`;
    if (line.endsWith('\\')) {
      buffer = buffer.slice(0, -1).trimEnd();
      continue;
    }
    folded.push(buffer);
    buffer = '';
  }
  if (buffer !== '') folded.push(buffer);
  return folded;
})();

const instructionIndex = (pattern: RegExp): number =>
  dockerfileInstructions.findIndex((line) => pattern.test(line));

/**
 * The probe's URL path, as written into the image / compose. Pulled back out of
 * the shell one-liner rather than hard-coded so the assertions below are about
 * the file that actually ships.
 */
const HEALTH_PATH = /fetch\(['"`]http:\/\/127\.0\.0\.1:[^/]+(\/[A-Za-z0-9/._-]+)['"`]/;
function healthPathFrom(source: string, label: string): string {
  const match = HEALTH_PATH.exec(source);
  if (match?.[1] === undefined) throw new Error(`no healthcheck fetch URL found in ${label}`);
  return match[1];
}

let app: AdminiumServer | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('docker-compose.yml — 01-architecture.md §4.2', () => {
  it('defines exactly the adminium service and the optional meta-db', () => {
    // The user's source database is ALWAYS external to the compose file (§4.2).
    // A "convenience" source DB appearing here would teach every reader the
    // wrong deployment model.
    expect(Object.keys(compose.services).sort()).toEqual(['adminium', 'meta-db']);
  });

  it('runs the ghcr image the release workflow actually publishes, on 4600:4600', () => {
    // THE BUG THIS PINS. The image was hardcoded to `ghcr.io/adminium/adminium`
    // — a namespace this repo never pushes to (release.yml publishes to
    // ghcr.io/<owner>/<repo>, lowercased) and one owned by an unrelated third
    // party. Every documented `docker compose up` pulled from a stranger, and
    // CI's own with-meta smoke test pulled a tag that could not exist, so the
    // promote step never ran and no release tag was ever created.
    const svc = compose.services.adminium!;
    expect(svc.image).toBe('${ADMINIUM_IMAGE:-ghcr.io/mosofi/adminium}:${ADMINIUM_VERSION:-latest}');
    expect(svc.ports).toEqual(['4600:4600']);
  });

  it('takes ADMINIUM_SECRET and ADMINIUM_META_URL from the env', () => {
    const env = compose.services.adminium!.environment!;
    // Required, and interpolated from the host env — never a literal.
    expect(env.ADMINIUM_SECRET).toMatch(/^\$\{ADMINIUM_SECRET:\?/);
    expect(env.ADMINIUM_META_URL).toBe('${ADMINIUM_META_URL:-}');
  });

  it('passes through no variable the server does not validate', () => {
    // THE BUG THIS PINS. The file forwarded `DATABASE_URL: ${DATABASE_URL:-}`,
    // documented in-file and on two docs pages as a first-boot connection seed
    // that nothing read. A compose file is a promise about what the container
    // does with what you give it, so every key here must be one `envSchema`
    // knows — checked against the schema itself rather than a hand-kept list.
    const passed = Object.keys(compose.services.adminium!.environment!);
    const validated = new Set(Object.keys(envSchema.shape));
    for (const key of passed) {
      expect(validated, `docker-compose.yml passes ${key}, which the server ignores`).toContain(key);
    }
  });

  it('mounts the adminium-data volume at the declared ADMINIUM_DATA_DIR', () => {
    const svc = compose.services.adminium!;
    expect(svc.environment!.ADMINIUM_DATA_DIR).toBe('/data');
    expect(svc.volumes).toContain('adminium-data:/data');
    expect(compose.volumes).toHaveProperty('adminium-data');
  });

  it('gates meta-db behind the with-meta profile on postgres:16 with its own volume', () => {
    const meta = compose.services['meta-db']!;
    expect(meta.profiles).toEqual(['with-meta']);
    expect(meta.image).toBe('postgres:16');
    expect(meta.volumes).toContain('meta-db-data:/var/lib/postgresql/data');
    expect(compose.volumes).toHaveProperty('meta-db-data');
  });

  it('does not make the default deployment depend on the profiled meta-db', () => {
    // `depends_on` a service that is inactive under the default profile breaks
    // plain `docker compose up` for everyone not using --profile with-meta.
    expect(compose.services.adminium!.depends_on).toBeUndefined();
  });

  it('healthchecks the adminium service', () => {
    const health = compose.services.adminium!.healthcheck;
    expect(health).toBeDefined();
    expect(health!.test?.[0]).toBe('CMD');
  });
});

describe('Dockerfile — 01-architecture.md §4.2', () => {
  it('is multi-stage and lands on the node:22-slim runtime', () => {
    const froms = dockerfileInstructions.filter((line) => /^FROM /i.test(line));
    expect(froms.length).toBeGreaterThanOrEqual(2);
    expect(froms.at(-1)).toMatch(/^FROM node:22-slim/i);
  });

  it('builds native modules on a glibc base matching the runtime', () => {
    // better-sqlite3 / argon2 are compiled in the build stage and dlopen'd in the
    // runtime stage: an Alpine/musl base on either side builds fine and then
    // dies at require() time.
    const froms = dockerfileInstructions.filter((line) => /^FROM /i.test(line));
    for (const from of froms) expect(from).not.toMatch(/alpine|musl/i);
  });

  it('runs as a non-root user', () => {
    const user = dockerfileInstructions.filter((line) => /^USER /i.test(line)).at(-1);
    expect(user).toBeDefined();
    expect(user).not.toMatch(/^USER\s+(root|0)\b/i);
  });

  it('drops privileges before the entrypoint', () => {
    // A USER after CMD/ENTRYPOINT would parse fine and still run as root.
    const userAt = instructionIndex(/^USER /i);
    const entrypointAt = instructionIndex(/^ENTRYPOINT /i);
    expect(userAt).toBeGreaterThan(-1);
    expect(entrypointAt).toBeGreaterThan(userAt);
  });

  it('uses dumb-init as PID 1', () => {
    expect(dockerfile).toMatch(/install[^\n]*dumb-init/);
    const entrypoint = dockerfileInstructions.find((line) => /^ENTRYPOINT /i.test(line));
    expect(entrypoint).toMatch(/dumb-init/);
  });

  it('declares the data dir, the port, and a healthcheck', () => {
    expect(dockerfileInstructions.some((l) => /^ENV\b[\s\S]*ADMINIUM_DATA_DIR=\/data/i.test(l))).toBe(true);
    expect(dockerfileInstructions.some((l) => /^EXPOSE\s+4600\b/i.test(l))).toBe(true);
    expect(dockerfileInstructions.some((l) => /^HEALTHCHECK\b/i.test(l))).toBe(true);
  });

  it('bakes no secret into the image', () => {
    // §4.2: ADMINIUM_SECRET arrives via env at run time. An ENV/ARG default here
    // would ship a key that every copy of the image shares.
    for (const line of dockerfileInstructions) {
      if (/^(ENV|ARG)\b/i.test(line)) expect(line).not.toMatch(/ADMINIUM_SECRET/);
    }
    expect(dockerfile).not.toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY/);
  });

  it('bundles the dashboard before resolving the deploy tree', () => {
    // Load-bearing ordering: `pnpm deploy` honours the server package's `files`
    // allow-list, so if bundle-dashboard has not populated apps/server/dashboard
    // by then, the image ships API-only and never renders the first-run wizard —
    // and it fails at runtime, not at build.
    const bundleAt = instructionIndex(/bundle-dashboard\.mjs/);
    const deployAt = instructionIndex(/pnpm deploy/);
    expect(bundleAt).toBeGreaterThan(-1);
    expect(deployAt).toBeGreaterThan(-1);
    expect(deployAt).toBeGreaterThan(bundleAt);
  });

  it('starts the same CLI the npm package exposes', () => {
    // "One code path, two front doors" (16-milestones M10 risk register): the
    // container must not grow its own bespoke boot path.
    const cmd = dockerfileInstructions.find((line) => /^CMD /i.test(line));
    expect(cmd).toMatch(/dist\/cli\/index\.js/);
    expect(cmd).toMatch(/start/);
  });
});

describe('.dockerignore', () => {
  it('keeps host-built artefacts out of the build context', () => {
    // Host node_modules would shadow the in-image install AND carry darwin
    // native binaries into a linux image.
    for (const entry of ['node_modules', 'dist', '.git', 'apps/server/dashboard']) {
      expect(dockerignore).toMatch(new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'));
    }
  });
});

describe('the healthcheck probes a route that actually exists', () => {
  it('targets the API health route in both the image and compose', () => {
    const fromDockerfile = healthPathFrom(dockerfile, 'Dockerfile');
    const fromCompose = healthPathFrom(read('docker-compose.yml'), 'docker-compose.yml');
    // Resolved from the server's own prefix: re-prefixing the API (§8 allows a
    // /api/v2) must fail this test rather than silently leave the image probing
    // a dead path.
    expect(fromDockerfile).toBe(`${API_PREFIX}/healthz`);
    expect(fromCompose).toBe(fromDockerfile);
  });

  it('gets ok:true from the real server on that exact path', async () => {
    app = await buildServer({ env: makeEnv(), logger: false });
    const res = await app.inject({ method: 'GET', url: healthPathFrom(dockerfile, 'Dockerfile') });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>().ok).toBe(true);
  });

  it('asserts the JSON body, so the SPA fallback cannot fake a healthy container', async () => {
    // THE TRAP THIS GUARDS: bare /healthz has no route. With a dashboard build
    // present, the SPA history fallback answers it with index.html and HTTP 200
    // — so a `curl -f /healthz` healthcheck reports "healthy" for a container
    // that is serving static files and no API at all. Verified against a real
    // container: GET /healthz → 200 text/html.
    //
    // Both probes therefore parse the response and require `ok === true`, which
    // index.html can never satisfy.
    //
    // What this does NOT buy, and used to claim it did: dependency checking.
    // `/api/v1/healthz` answers `{ok:true}` unconditionally (see
    // `routes/system/handlers.ts`), so a live instance with a dead meta store
    // still passes. That is the right call for a probe wired to `restart` —
    // `/api/v1/readyz` is the one that checks the store, and the readyz test
    // below covers it.
    for (const [label, source] of [
      ['Dockerfile', dockerfile],
      ['docker-compose.yml', read('docker-compose.yml')],
    ] as const) {
      expect(source, `${label} must not probe bare /healthz`).not.toMatch(
        /fetch\(['"`]http:\/\/127\.0\.0\.1:[^/]+\/healthz/,
      );
      expect(source, `${label} must assert the parsed body`).toMatch(/b\.ok===true|b\.ok === true/);
    }
  });
});

describe('the image carries what `pnpm deploy` cannot inject', () => {
  it('bundles BOTH the dashboard build and the LLM vocabulary before pnpm deploy', () => {
    // `pnpm deploy` honours the package's `files` allow-list and injects only
    // DECLARED workspace deps. Neither `@adminium/dashboard` nor
    // `@adminium/widgets` is a server dependency — widgets cannot be, it is
    // `private: true` — so anything they own has to be snapshotted into the
    // package first. Miss the dashboard step and the image boots API-only with no
    // wizard; miss the vocabulary step and both LLM subcommands die in the
    // container with a `pnpm --filter` hint no container user can act on.
    const dashboardAt = instructionIndex(/bundle-dashboard\.mjs/);
    const vocabularyAt = instructionIndex(/bundle-allowlists\.mjs/);
    const deployAt = instructionIndex(/pnpm deploy/);

    expect(dashboardAt, 'the dashboard must be bundled').toBeGreaterThan(-1);
    expect(vocabularyAt, 'the LLM vocabulary must be bundled').toBeGreaterThan(-1);
    expect(deployAt).toBeGreaterThan(-1);

    // Order is the guarantee: `pnpm deploy` copies what exists at that moment.
    expect(dashboardAt).toBeLessThan(deployAt);
    expect(vocabularyAt).toBeLessThan(deployAt);
  });
});

// ─── the release pipeline ────────────────────────────────────────────────────

describe('the release workflow cannot publish an untested image', () => {
  const release = read('.github/workflows/release.yml');
  const docker = read('.github/workflows/docker.yml');

  it('smoke-tests a staging tag and promotes only after it passes', () => {
    // THE BUG THIS PINS. The build step pushed `:<version>` AND `:latest`, and
    // the smoke test ran AFTERWARDS. A failed smoke test cannot un-publish a
    // tag, so a runtime regression went: image pushed → :latest moves → smoke
    // fails → job red → tags stay. docker-compose.yml defaults to
    // `${ADMINIUM_VERSION:-latest}`, so every `docker compose up` in the wild
    // pulled the broken build while CI showed the failure.
    const buildAt = release.indexOf('Build and push staging image');
    const smokeAt = release.indexOf('Smoke-test the staged image');
    const promoteAt = release.indexOf('Promote the tested digest');
    expect(buildAt, 'the build step must exist').toBeGreaterThan(-1);
    expect(smokeAt, 'the smoke test must exist').toBeGreaterThan(-1);
    expect(promoteAt, 'a separate promote step must exist').toBeGreaterThan(-1);

    // Order is the whole guarantee.
    expect(buildAt).toBeLessThan(smokeAt);
    expect(smokeAt).toBeLessThan(promoteAt);

    // The build step must NOT carry the release tags.
    const buildBlock = release.slice(buildAt, smokeAt);
    expect(buildBlock).not.toContain('value=latest');
    expect(buildBlock).not.toMatch(/type=raw,value=\$\{\{ steps\.version/);

    // Promotion is digest-addressed: what ships is what passed, byte for byte.
    const promoteBlock = release.slice(promoteAt);
    expect(promoteBlock).toContain('steps.build.outputs.digest');
    expect(promoteBlock).toContain(':latest');
  });

  it('keeps composite actions to the keys the runner actually accepts', async () => {
    // THE BUG THIS PINS. `timeout-minutes` is not a legal key on a step inside a
    // composite action — GitHub's metadata syntax allows exactly the ten below,
    // and the runner rejects the WHOLE manifest when it sees another, so one bad
    // key breaks every workflow that uses the action rather than one step. A
    // draft of `.github/actions/playwright-chromium` had it on two steps and
    // would have hard-failed five required checks on the first push.
    //
    // Nothing caught it: `actionlint` does not visit `.github/actions/` at all,
    // and pointed at an `action.yml` it parses the file as a WORKFLOW — emitting
    // "jobs section is missing" and exiting 0. So the one genuinely new artifact
    // in that change had zero lint coverage. This test is that coverage.
    const { parse } = await import('yaml');
    const { readdirSync, existsSync } = await import('node:fs');

    const COMPOSITE_STEP_KEYS = new Set([
      'run',
      'shell',
      'if',
      'name',
      'id',
      'env',
      'working-directory',
      'uses',
      'with',
      'continue-on-error',
    ]);

    const dir = new URL('../../../.github/actions/', import.meta.url);
    if (!existsSync(dir)) return;

    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(names.length, 'expected at least one composite action to check').toBeGreaterThan(0);

    for (const name of names) {
      const manifest = parse(read(`.github/actions/${name}/action.yml`)) as {
        runs?: { using?: string; steps?: Array<Record<string, unknown>> };
      };
      if (manifest.runs?.using !== 'composite') continue;
      for (const [index, step] of (manifest.runs.steps ?? []).entries()) {
        for (const key of Object.keys(step)) {
          expect(
            COMPOSITE_STEP_KEYS.has(key),
            `${name}/action.yml step ${index} ("${String(step.name ?? key)}") uses "${key}", which the runner rejects on a composite step. Bound the action from the CALLER instead.`,
          ).toBe(true);
        }
        // A `run` step without a `shell` is the other manifest-load failure.
        if ('run' in step) {
          expect(step.shell, `${name}/action.yml step ${index} has run: but no shell:`).toBeTruthy();
        }
      }
    }
  });

  it('never lets a v* Release claim the Latest pointer the desktop updater needs', () => {
    // THE BUG THIS PINS. GitHub's "latest" is ONE stored pointer per repository,
    // and this repo publishes two tag series. Desktop installs already in the
    // field resolve their update feed through that pointer and cannot be
    // changed, so if a `v*` Release takes it they resolve a release carrying no
    // installers and 404. That happened: the pointer sat on v0.2.1 (zero assets)
    // and every desktop install on all three platforms silently stopped
    // updating. Only a comment stood between the pipeline and a repeat.
    // Join backslash continuations first: the two calls are one logical shell
    // line joined by `||`, so a line-by-line scan would see neither in full.
    const logical = release.replace(/\\\r?\n\s*/g, ' ');
    const invocations = logical
      .split(/\|\||&&|;/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.includes('gh release create'));

    expect(invocations.length, 'release.yml must still create a GitHub Release').toBe(2);
    for (const call of invocations) {
      expect(call, `must pass --latest=false: ${call.slice(0, 80)}`).toContain('--latest=false');
    }
  });

  it('exercises the with-meta Postgres topology, not just the SQLite fallback', () => {
    // THE BUG THIS PINS. Every smoke test booted with ADMINIUM_SECRET alone —
    // the embedded SQLite fallback §3.1 tells self-hosters NOT to use in
    // production. The `with-meta` configuration §4.2 specifies was never
    // started; `validate` only ran `compose config`, which parses YAML. So the
    // one meta store the docs recommend was the one nobody proved boots, and a
    // missing `pg` driver in the image shipped behind two green smoke tests.
    for (const [name, workflow] of [
      ['release.yml', release],
      ['docker.yml', docker],
    ] as const) {
      expect(workflow, `${name} must boot the with-meta profile`).toContain(
        'docker compose --profile with-meta up -d',
      );
      expect(workflow, `${name} must point Adminium AT the profiled Postgres`).toContain(
        'ADMINIUM_META_URL: postgres://',
      );
      // Starting Postgres is not using it: the fallback would keep this green
      // while proving nothing, which is exactly how the bug survived.
      expect(workflow, `${name} must assert the fallback did NOT engage`).toContain(
        'embedded SQLite',
      );
      expect(workflow, `${name} must assert the dialect really is postgres`).toContain(
        '"dialect":"postgres"',
      );
    }
  });

  it('names the image once, lowercased, and never interpolates github.repository raw', () => {
    // THE BUG THIS PINS. `IMAGE: ghcr.io/${{ github.repository }}` expands to
    // `ghcr.io/MoSofi/Adminium`; OCI repository names must be lowercase. Only
    // docker/metadata-action tolerated it (it lowercases internally) — the
    // smoke test, the attestation subject and both `imagetools create` calls
    // interpolated it raw and would have died on "repository name must be
    // lowercase", so the release published nothing but a staging tag.
    expect(release, 'no workflow-level IMAGE constant').not.toMatch(/^\s*IMAGE:/m);
    expect(release, 'no raw env.IMAGE consumer').not.toContain('env.IMAGE');
    expect(release, 'the reference is lowercased once').toMatch(
      /image="ghcr\.io\/\$\(printf '%s' '\$\{\{ github\.repository \}\}' \| tr '\[:upper:\]' '\[:lower:\]'\)"/,
    );
    // Every consumer reads that one output.
    for (const consumer of [
      'images: ${{ steps.version.outputs.image }}', // metadata-action
      "IMAGE_REF='${{ steps.version.outputs.image }}@", // both docker run legs
      'ADMINIUM_IMAGE: ${{ steps.version.outputs.image }}', // the compose stack
      'subject-name: ${{ steps.version.outputs.image }}', // the attestation
      "IMAGE='${{ steps.version.outputs.image }}'", // the promote step
    ]) {
      expect(release, `must consume the resolved reference: ${consumer}`).toContain(consumer);
    }
  });

  it('boots the arm64 half of the manifest before promoting it', () => {
    // THE BUG THIS PINS. The build ships amd64 + arm64 and the Dockerfile
    // compiles better-sqlite3/argon2 per target, but every smoke test ran on an
    // x86 runner with no --platform, so Docker always picked amd64. `:latest`
    // moved onto an arm64 image nobody had ever started — the exact "promote
    // only what passed" guarantee this job is built around, half unmet.
    const armAt = release.indexOf('Smoke-test the arm64 half');
    expect(armAt, 'an arm64 smoke leg must exist').toBeGreaterThan(-1);
    expect(armAt).toBeLessThan(release.indexOf('Promote the tested digest'));
    const armBlock = release.slice(armAt, release.indexOf('Smoke-test the staged image against'));
    expect(armBlock, 'must pin the platform').toContain('--platform linux/arm64');
    expect(armBlock, 'must run the same digest').toContain('steps.build.outputs.digest');
    expect(armBlock, 'must prove the arch it actually got').toContain("node -p 'process.arch'");
  });

  it('keeps compose failure diagnostics readable and the npm publish tag-gated', () => {
    // THE BUG THIS PINS (1). docker-compose.yml declares ADMINIUM_SECRET with
    // `:?`, and compose interpolates the whole file before dispatching ANY
    // subcommand — so `compose logs` without the secret aborts on the
    // interpolation error and prints nothing, exactly when the with-meta smoke
    // test has just failed.
    const logsAt = release.indexOf('Compose logs (on failure)');
    expect(logsAt).toBeGreaterThan(-1);
    const logsBlock = release.slice(logsAt, release.indexOf('Clean up the compose stack'));
    expect(logsBlock, 'the logs step must interpolate the compose file').toContain(
      'ADMINIUM_SECRET:',
    );

    // (2) The npm half is irreversible and derives its version from the
    // manifests on disk. On workflow_dispatch (a manual IMAGE rebuild, default
    // branch) that meant publishing whatever unreleased versions main carried.
    const npmAt = release.indexOf('  npm:');
    expect(release.slice(npmAt), 'npm publishes on tag pushes only').toContain(
      "if: github.event_name == 'push'",
    );
    expect(release.slice(npmAt), 'and asserts the tag matches the manifests').toContain(
      'Assert the manifest version matches the tag',
    );
  });
});

// ─── the compose file's own prose ────────────────────────────────────────────

describe('docker-compose.yml header', () => {
  const compose = read('docker-compose.yml');

  it('does not present the profile as an alternative to ADMINIUM_META_URL', () => {
    // THE BUG THIS PINS. The header said "set ADMINIUM_META_URL, **or** run the
    // bundled Postgres" — but the profile only STARTS the container, it does not
    // wire Adminium to it. A reader who took the header at its word got
    // postgres:16 sitting idle while every page, user and connection went into
    // /data/meta.db, with no error and a boot line that reads as informational.
    // The compose file's header is the surface people read first, and it was the
    // one that got this wrong; the docs page already got it right.
    const header = compose.slice(0, compose.indexOf('name: adminium'));
    expect(header).not.toMatch(/set ADMINIUM_META_URL, or run/i);
    expect(header).toMatch(/BOTH/);
    expect(header).toContain('export ADMINIUM_META_URL=postgres://');
  });
});

// ─── the probes ──────────────────────────────────────────────────────────────

describe('the healthcheck says what it does', () => {
  const compose = read('docker-compose.yml');
  const docsPage = read('apps/docs/src/content/docs/self-hosting/docker-compose.md');

  it('is documented as LIVENESS, and points readiness at /readyz', () => {
    // THE BUG THIS PINS. Four files claimed the probe catches "an instance whose
    // meta store is unreachable". It cannot: healthz() returns {ok:true}
    // unconditionally and its own docstring says "no dependency checks". A
    // compose deployment whose Postgres dies keeps reporting healthy forever,
    // and anything keyed on Docker health keeps routing to an instance that 500s
    // every request — while the operator believes the docs have them covered.
    for (const [name, source] of [
      ['Dockerfile', dockerfile],
      ['docker-compose.yml', compose],
      ['the docs page', docsPage],
    ] as const) {
      expect(source, `${name} must not claim healthz detects a dead meta store`).not.toMatch(
        /would report "?healthy"? for an instance whose meta store is unreachable/,
      );
      expect(source, `${name} must point readiness at /readyz`).toContain('readyz');
    }
  });
});
