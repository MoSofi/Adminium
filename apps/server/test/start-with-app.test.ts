// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Start with an app": the copy as a job of three steps.
 *
 * The source is a small app shaped like the published ones (one
 * manifest.json, a Vite build named in package.json, the key in the places
 * the six keep it), served as the archive GitHub would serve.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStarter, type StartInput, type StarterHost } from '../src/designer/start-with-app.js';
import { isBuildApproved, readAppBuild } from '../src/project/apps/own-build.js';
import { starterParts } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';

function member(name: string, body: string, type = '0'): Buffer {
  const data = Buffer.from(body, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(`${data.byteLength.toString(8).padStart(11, '0')}\0`, 124);
  header.write(type, 156);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.byteLength % 512)) % 512)]);
}

/** A published app in small: the starter's manifest under the key `desk`, published by Adminium. */
/** `commit`: the commit GitHub says the archive is of, in the archive's own first record. */
function sourceArchive(commit: string | null = null): Buffer {
  const parts = starterParts({ key: 'desk', name: 'Desk', sides: ['staff', 'customer'], version: APP_VERSION });
  const app = parts['manifest/app.json'] as Record<string, unknown>;
  const manifest = {
    kind: 'app',
    ...app,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    requiredSchema: { prefixed: true, tables: [parts['manifest/tables/items.json'], parts['manifest/tables/requests.json']] },
    pages: [parts['manifest/pages/desk-items.json'], parts['manifest/pages/desk-requests.json']],
    roles: parts['manifest/roles.json'],
    ...(parts['manifest/access.json'] as object),
    sampleData: { file: 'seeds/desk.sample.json' },
  };
  delete (manifest as Record<string, unknown>)['prefixed'];
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify(manifest),
    'package.json': JSON.stringify({
      name: 'desk-app',
      scripts: {
        'build:surface:staff': 'vite build --base=/apps/desk/staff/ --outDir dist-surface/desk/staff',
        'build:surface:customer': 'vite build --base=/apps/desk/customer/ --outDir dist-surface/desk/customer',
      },
    }),
    'package-lock.json': '{}',
    'src/surface-nav.ts': "export const APP_KEY = 'desk';\n",
    'src/main.tsx': "import sample from '../seeds/desk.sample.json';\nexport default sample;\n",
    'src/App.test.tsx': "import manifest from '../manifest.json';\n",
    'seeds/desk.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'desk', tables: [] }),
    'LICENSE': 'GNU AFFERO GENERAL PUBLIC LICENSE',
    '.github/workflows/release.yml': 'on: push',
    'RELEASES.json': '{}',
  };
  const said = commit === null ? [] : [member('pax_global_header', `52 comment=${commit}\n`, 'g')];
  return gzipSync(Buffer.concat([...said, ...Object.entries(files).map(([name, body]) => member(`desk-1.0.0/${name}`, body)), Buffer.alloc(1024)]));
}

let root: string;
let fetched: string[];
let applied: string[];
let problems: string[];
const input = (over: Partial<StartInput> = {}): StartInput => ({ key: 'desk', newKey: 'my-desk', name: 'My desk', approve: '', connectionId: 'env:ollama', model: 'm', by: { id: 'u1', label: 'Ada' }, ...over });

function starter(over: Partial<StarterHost> = {}) {
  const audits: string[] = [];
  const details: Record<string, unknown>[] = [];
  const host: StarterHost = {
    root,
    listed: async (key) => (key === 'desk' ? { key: 'desk', version: '1.0.0', name: 'Desk', repo: 'https://github.com/Adminiumjs/desk' } : null),
    installedKeys: async () => ['pos'],
    buildAndApply: async (key) => {
      applied.push(key);
      return problems;
    },
    openSession: async () => 'ds_000000000000000000000001',
    audit: async (action, _by, detail) => {
      audits.push(action);
      details.push(detail);
    },
    fetch: (async (url: unknown) => {
      fetched.push(String(url));
      return new Response(new Uint8Array(sourceArchive()), { status: 200 });
    }) as never,
    log: () => undefined,
    ...over,
  };
  return { ...createStarter(host), audits, details };
}
const settled = async (made: ReturnType<typeof starter>, id: string) => {
  await vi.waitFor(() => expect(made.job(id).state).not.toBe('running'), { timeout: 10_000, interval: 10 });
  return made.job(id);
};

beforeEach(() => {
  root = tempProject('adminium-start-with-app-');
  fetched = [];
  applied = [];
  problems = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the key a copy takes', () => {
  it('is an app key nobody has: not a folder of the project, not an installed app', async () => {
    const made = starter();
    expect(await made.keyProblem('my-desk')).toBeNull();
    expect(await made.keyProblem('My Desk')).toContain('lowercase');
    expect(await made.keyProblem('pos')).toContain('installed here already');
    expect(await made.keyProblem('a'.repeat(41))).toContain('at most 40');
  });

  it('comes with the build it would be given, to be read before anything is fetched', () => {
    const build = starter().buildFor('my-desk');
    expect(build.install).toBe('npm ci --ignore-scripts');
    expect(build.command).toContain('--base=/apps/my-desk/staff/');
    expect(build.command).toContain('--outDir dist-surface/my-desk/customer');
    expect(build.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the copy', () => {
  it('refuses to start without the approval of the build as shown, and for an app the list does not have', async () => {
    const made = starter();
    await expect(made.start(input({ approve: 'something else' }))).rejects.toMatchObject({ details: { reason: 'BUILD_NOT_APPROVED' } });
    await expect(made.start(input({ key: 'nope', approve: made.buildFor('my-desk').fingerprint }))).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(fetched).toEqual([]);
    expect(existsSync(join(root, 'apps/my-desk'))).toBe(false);
  });

  it('fetches the tag, writes the copy under the new key with its build approved, applies it and opens a session', async () => {
    const made = starter();
    const job = await settled(made, (await made.start(input({ approve: made.buildFor('my-desk').fingerprint }))).id);
    expect(job, JSON.stringify(job.steps)).toMatchObject({ state: 'done', sessionId: 'ds_000000000000000000000001', steps: [{ state: 'done' }, { state: 'done' }, { state: 'done' }] });
    expect(fetched).toEqual(['https://codeload.github.com/Adminiumjs/desk/tar.gz/refs/tags/v1.0.0']);
    expect(applied).toEqual(['my-desk']);
    expect(made.audits).toEqual(['designer.app.copied']);

    const at = (file: string): string => join(root, 'apps/my-desk', file);
    // The manifest, as parts, under the new key and the local publisher.
    const app = JSON.parse(readFileSync(at('manifest/app.json'), 'utf8')) as { key: string; name: string; publisher: { id: string }; license: string };
    expect(app).toMatchObject({ key: 'my-desk', name: 'My desk', publisher: { id: 'local' }, license: 'AGPL-3.0-only' });
    expect(existsSync(at('manifest/pages/my-desk-items.json'))).toBe(true);
    expect(readFileSync(at('manifest/roles.json'), 'utf8')).toContain('page:@my-desk-items:view');
    expect(existsSync(at('manifest.json'))).toBe(false);
    // The source's places.
    expect(readFileSync(at('src/surface-nav.ts'), 'utf8')).toContain("APP_KEY = 'my-desk'");
    expect(readFileSync(at('src/main.tsx'), 'utf8')).toContain('seeds/my-desk.sample.json');
    expect(JSON.parse(readFileSync(at('seeds/my-desk.sample.json'), 'utf8'))).toMatchObject({ app: 'my-desk' });
    expect(readFileSync(at('package.json'), 'utf8')).toContain('/apps/my-desk/staff/');
    expect(existsSync(at('LICENSE'))).toBe(true);
    // Left behind: the original's chores and tests.
    for (const gone of ['.github', 'src/App.test.tsx']) expect(existsSync(at(gone)), gone).toBe(false);
    // Its own package, and a list of releases that starts empty: not the original's (spec 16).
    expect(JSON.parse(readFileSync(at('RELEASES.json'), 'utf8'))).toEqual({ schemaVersion: 1, releases: [] });
    expect((JSON.parse(readFileSync(at('package.json'), 'utf8')) as { name?: string }).name).toBe('my-desk');
    // The build the person approved is the one in the folder.
    const build = readAppBuild(root, 'my-desk');
    expect(build !== null && !('problem' in build) && isBuildApproved(root, 'my-desk', build)).toBe(true);
  });

  it('takes the project folder after the download and before its first write, and hands it back however the copy ends', async () => {
    const order: string[] = [];
    let signal: AbortSignal | undefined;
    let copy = 'my-desk';
    const hold = () => {
      order.push(`hold (fetched ${String(fetched.length)}, folder ${String(existsSync(join(root, 'apps', copy)))})`);
      const controller = new AbortController();
      return { signal: controller.signal, announce: () => undefined, release: () => void order.push('release') };
    };
    const made = starter({
      hold,
      buildAndApply: async (key, given) => {
        signal = given;
        order.push(`build ${key}`);
        return problems;
      },
    });
    expect(await settled(made, (await made.start(input({ approve: made.buildFor('my-desk').fingerprint }))).id)).toMatchObject({ state: 'done' });
    // Held once the source is here and nothing is written; the build is given the hold's own stop.
    expect(order).toEqual(['hold (fetched 1, folder false)', 'build my-desk', 'release']);
    expect(signal).toBeInstanceOf(AbortSignal);

    // A copy that fails hands the folder back too, and "Try again" takes it again before the build.
    order.length = 0;
    copy = 'other-desk';
    problems = ['src/main.tsx: the build failed'];
    const failing = starter({ hold });
    expect(await settled(failing, (await failing.start(input({ newKey: 'other-desk', approve: failing.buildFor('other-desk').fingerprint }))).id)).toMatchObject({ state: 'failed' });
    expect(order).toEqual(['hold (fetched 2, folder false)', 'release']);
    order.length = 0;
    problems = [];
    expect(await settled(failing, (await failing.start(input({ newKey: 'other-desk', approve: failing.buildFor('other-desk').fingerprint }))).id)).toMatchObject({ state: 'done' });
    // Nothing is fetched again: the copy is there, and only its build is left.
    expect(order).toEqual(['hold (fetched 2, folder true)', 'release']);
  });

  it('fails as its own step, in the folder’s own words, when something else is writing the project, and writes nothing', async () => {
    const made = starter({
      hold: () => {
        throw new Error('The app is being changed. Try again in a moment.');
      },
    });
    const job = await settled(made, (await made.start(input({ approve: made.buildFor('my-desk').fingerprint }))).id);
    expect(job).toMatchObject({ state: 'failed', steps: [{ id: 'get', state: 'done' }, { id: 'make', state: 'failed', detail: 'The app is being changed. Try again in a moment.' }, { id: 'build', state: 'waiting' }] });
    expect(existsSync(join(root, 'apps/my-desk'))).toBe(false);
    expect(applied).toEqual([]);
    // The next copy can start: the refusal did not leave this one running.
    const again = starter();
    expect(await settled(again, (await again.start(input({ approve: again.buildFor('my-desk').fingerprint }))).id)).toMatchObject({ state: 'done' });
  });

  it('keeps a copy whose build failed, says why, and finishes it on "Try again" without fetching again', async () => {
    const made = starter();
    const approve = made.buildFor('my-desk').fingerprint;
    problems = ['apps/my-desk — its screens did not build:\nsrc/App.tsx: Cannot find name "jobs".'];
    const failed = await settled(made, (await made.start(input({ approve }))).id);
    expect(failed).toMatchObject({ state: 'failed', steps: [{ state: 'done' }, { state: 'done' }, { state: 'failed', detail: expect.stringContaining('Cannot find name') }] });
    expect(existsSync(join(root, 'apps/my-desk/manifest/app.json'))).toBe(true);

    problems = [];
    const again = await settled(made, (await made.start(input({ approve }))).id);
    expect(again).toMatchObject({ state: 'done', sessionId: 'ds_000000000000000000000001' });
    expect(fetched).toHaveLength(1);
    expect(applied).toEqual(['my-desk', 'my-desk']);
    // Finished: the key is now taken.
    expect(await made.keyProblem('my-desk')).toContain('already an app');
  });

  it('copies one app at a time, and lets the next one start when the first has ended', async () => {
    let release: () => void = () => undefined;
    const made = starter({
      buildAndApply: async (key) => {
        applied.push(key);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [];
      },
    });
    const first = await made.start(input({ approve: made.buildFor('my-desk').fingerprint }));
    await expect(made.start(input({ newKey: 'other-desk', approve: made.buildFor('other-desk').fingerprint }))).rejects.toMatchObject({ details: { reason: 'COPY_RUNNING' } });
    await vi.waitFor(() => expect(applied).toEqual(['my-desk']));
    release();
    expect(await settled(made, first.id)).toMatchObject({ state: 'done' });
    // A refusal before anything started does not hold the next one back either.
    await expect(made.start(input({ newKey: 'other-desk', approve: 'not-it' }))).rejects.toMatchObject({ details: { reason: 'BUILD_NOT_APPROVED' } });
    const second = await made.start(input({ newKey: 'other-desk', approve: made.buildFor('other-desk').fingerprint }));
    await vi.waitFor(() => expect(applied).toEqual(['my-desk', 'other-desk']));
    release();
    expect(await settled(made, second.id)).toMatchObject({ state: 'done' });
    expect(first.id).toMatch(/^start_[0-9a-f]{24}$/);
  });

  it('finishes a copy whose session did not open on "Try again", from the same app only', async () => {
    let opens = 0;
    const made = starter({
      openSession: async () => {
        opens += 1;
        if (opens === 1) throw new Error('There is no such model connection.');
        return 'ds_000000000000000000000002';
      },
    });
    const approve = made.buildFor('my-desk').fingerprint;
    const failed = await settled(made, (await made.start(input({ approve }))).id);
    expect(failed).toMatchObject({ state: 'failed', steps: [{ state: 'done' }, { state: 'done' }, { state: 'failed', detail: expect.stringContaining('no such model connection') }] });
    const again = await settled(made, (await made.start(input({ approve }))).id);
    expect(again).toMatchObject({ state: 'done', sessionId: 'ds_000000000000000000000002' });
    expect(fetched).toHaveLength(1);
  });

  it('writes nothing when the source cannot be fetched, and says so', async () => {
    const made = starter({ fetch: (async () => new Response(null, { status: 404 })) as never });
    const job = await settled(made, (await made.start(input({ approve: made.buildFor('my-desk').fingerprint }))).id);
    expect(job).toMatchObject({ state: 'failed', steps: [{ state: 'failed', detail: expect.stringContaining('no such tag') }, { state: 'waiting' }, { state: 'waiting' }] });
    expect(existsSync(join(root, 'apps/my-desk'))).toBe(false);
    expect(await made.keyProblem('my-desk')).toBeNull();
  });

  const C1 = '1111111111111111111111111111111111111111';
  const C2 = '2222222222222222222222222222222222222222';
  const serving = (commit: string | null) => ({ fetch: (async () => new Response(new Uint8Array(sourceArchive(commit)), { status: 200 })) as never });
  const copy = async (made: ReturnType<typeof starter>, newKey: string) => settled(made, (await made.start(input({ newKey, name: newKey, approve: made.buildFor(newKey).fingerprint }))).id);

  it('says which commit a copy was taken from, and keeps it for the next copy of that version', async () => {
    const made = starter(serving(C1));
    expect(await copy(made, 'my-desk')).toMatchObject({ state: 'done' });
    expect(made.details).toEqual([{ from: 'desk', version: '1.0.0', key: 'my-desk', repo: 'https://github.com/Adminiumjs/desk', commit: C1 }]);
    expect(JSON.parse(readFileSync(join(root, '.adminium/designer/sources.json'), 'utf8'))).toEqual({ 'adminiumjs/desk@1.0.0': C1 });
    // The same version again, from the same commit: nothing to say.
    expect(await copy(made, 'second-desk')).toMatchObject({ state: 'done' });
  });

  it('refuses a version whose tag now points at another commit than the one this project copied before, and writes nothing', async () => {
    expect(await copy(starter(serving(C1)), 'my-desk')).toMatchObject({ state: 'done' });
    const moved = starter(serving(C2));
    const job = await copy(moved, 'second-desk');
    expect(job).toMatchObject({ state: 'failed', steps: [{ state: 'failed' }, { state: 'waiting' }, { state: 'waiting' }] });
    expect(job.steps[0]?.detail).toContain('1.0.0');
    expect(job.steps[0]?.detail).toContain(C1.slice(0, 12));
    expect(job.steps[0]?.detail).toContain(C2.slice(0, 12));
    expect(existsSync(join(root, 'apps/second-desk'))).toBe(false);
    expect(moved.audits).toEqual([]);
    // What was kept is what was first seen: the moved tag did not replace it.
    expect(JSON.parse(readFileSync(join(root, '.adminium/designer/sources.json'), 'utf8'))).toEqual({ 'adminiumjs/desk@1.0.0': C1 });
  });

  it('copies an archive that names no commit as before, and keeps nothing of it', async () => {
    const made = starter(serving(null));
    expect(await copy(made, 'my-desk')).toMatchObject({ state: 'done' });
    expect(made.details[0]).toEqual({ from: 'desk', version: '1.0.0', key: 'my-desk', repo: 'https://github.com/Adminiumjs/desk', commit: null });
    expect(existsSync(join(root, '.adminium/designer/sources.json'))).toBe(false);
    // A commit seen later is the first one known: taken, and kept from then on.
    expect(await copy(starter(serving(C1)), 'second-desk')).toMatchObject({ state: 'done' });
    expect(JSON.parse(readFileSync(join(root, '.adminium/designer/sources.json'), 'utf8'))).toEqual({ 'adminiumjs/desk@1.0.0': C1 });
  });

  it('a kept list that cannot be read stops no copy: it is started again', async () => {
    mkdirSync(join(root, '.adminium/designer'), { recursive: true });
    writeFileSync(join(root, '.adminium/designer/sources.json'), '{ not json');
    expect(await copy(starter(serving(C1)), 'my-desk')).toMatchObject({ state: 'done' });
    expect(JSON.parse(readFileSync(join(root, '.adminium/designer/sources.json'), 'utf8'))).toEqual({ 'adminiumjs/desk@1.0.0': C1 });
  });
});
