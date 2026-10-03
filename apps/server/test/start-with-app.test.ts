// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Start with an app": the copy as a job of three steps.
 *
 * The source is a small app shaped like the published ones (one
 * manifest.json, a Vite build named in package.json, the key in the places
 * the six keep it), served as the archive GitHub would serve.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStarter, type StartInput, type StarterHost } from '../src/designer/start-with-app.js';
import { isBuildApproved, readAppBuild } from '../src/project/apps/own-build.js';
import { starterParts } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';

function member(name: string, body: string): Buffer {
  const data = Buffer.from(body, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(`${data.byteLength.toString(8).padStart(11, '0')}\0`, 124);
  header.write('0', 156);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.byteLength % 512)) % 512)]);
}

/** A published app in small: the starter's manifest under the key `desk`, published by Adminium. */
function sourceArchive(): Buffer {
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
  return gzipSync(Buffer.concat([...Object.entries(files).map(([name, body]) => member(`desk-1.0.0/${name}`, body)), Buffer.alloc(1024)]));
}

let root: string;
let fetched: string[];
let applied: string[];
let problems: string[];
const input = (over: Partial<StartInput> = {}): StartInput => ({ key: 'desk', newKey: 'my-desk', name: 'My desk', approve: '', connectionId: 'env:ollama', model: 'm', by: { id: 'u1', label: 'Ada' }, ...over });

function starter(over: Partial<StarterHost> = {}) {
  const audits: string[] = [];
  const host: StarterHost = {
    root,
    listed: async (key) => (key === 'desk' ? { key: 'desk', version: '1.0.0', name: 'Desk', repo: 'https://github.com/Adminiumjs/desk' } : null),
    installedKeys: async () => ['pos'],
    buildAndApply: async (key) => {
      applied.push(key);
      return problems;
    },
    openSession: async () => 'ds_000000000000000000000001',
    audit: async (action) => {
      audits.push(action);
    },
    fetch: (async (url: unknown) => {
      fetched.push(String(url));
      return new Response(new Uint8Array(sourceArchive()), { status: 200 });
    }) as never,
    log: () => undefined,
    ...over,
  };
  return { ...createStarter(host), audits };
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
    for (const gone of ['.github', 'RELEASES.json', 'src/App.test.tsx']) expect(existsSync(at(gone)), gone).toBe(false);
    // The build the person approved is the one in the folder.
    const build = readAppBuild(root, 'my-desk');
    expect(build !== null && !('problem' in build) && isBuildApproved(root, 'my-desk', build)).toBe(true);
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

  it('writes nothing when the source cannot be fetched, and says so', async () => {
    const made = starter({ fetch: (async () => new Response(null, { status: 404 })) as never });
    const job = await settled(made, (await made.start(input({ approve: made.buildFor('my-desk').fingerprint }))).id);
    expect(job).toMatchObject({ state: 'failed', steps: [{ state: 'failed', detail: expect.stringContaining('no such tag') }, { state: 'waiting' }, { state: 'waiting' }] });
    expect(existsSync(join(root, 'apps/my-desk'))).toBe(false);
    expect(await made.keyProblem('my-desk')).toBeNull();
  });
});
