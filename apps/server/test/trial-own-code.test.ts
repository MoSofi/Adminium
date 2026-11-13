// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Packages from the catalogue only, and a Designer that builds with the
 * manifest alone, under trial mode and the hosted profile: each guard where
 * its effect happens, one by one, both ways. The routes that lead there are
 * in `trial-own-code-routes.test.ts`.
 *
 * The profile comes from the process's environment here (`vi.stubEnv`), as it
 * does on a trial server; the policy a server is built with is the ordinary
 * one, so what is proved is that the guards read the environment too.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { childEnvironment, type ChildEnvProfile } from '../src/config/child-env.js';
import { gateTools, TOOL_REACH } from '../src/designer/declarative.js';
import { createEventLog } from '../src/designer/events.js';
import { createJail, JailError } from '../src/designer/jail.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import { addDesignSkill } from '../src/designer/skill-upload.js';
import { createStarter } from '../src/designer/start-with-app.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools, DESIGNER_TOOL_NAMES } from '../src/designer/tools.js';
import { runCli } from '../src/cli/run.js';
import { buildProjectApps } from '../src/project/apps/build-apps.js';
import { approveBuild, runOwnBuild, type AppBuildFile, type StepRunner } from '../src/project/apps/own-build.js';
import { buildPhone, installPhone } from '../src/project/apps/phone-build.js';
import { createProjectCodeRuntime } from '../src/project/code/runtime.js';
import { loadProjectCode } from '../src/project/code/load.js';
import { OwnCodeOffError, ownCodeAllows, useOwnCodePolicy } from '../src/trial/own-code.js';
import { ORDINARY_POLICY } from '../src/trial/policy.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const PROFILES = [
  ['trial mode', 'ADMINIUM_TRIAL_MODE', 'trial-mode'],
  ['the hosted profile', 'ADMINIUM_HOSTED_MODE', 'hosted-mode'],
] as const;

let root: string;
let asked: CardRequest[];
let installed: { name: string; version: string }[][];

const session = { id: 'ds_000000000000000000000000', appKey: 'repairs' } as DesignerSession;
const context = (): ToolContext => {
  const signal = new AbortController().signal;
  const ask = async (card: CardRequest): Promise<CardAnswer> => {
    asked.push(card);
    // A card is never right here: say no, so a test that reaches one still ends.
    return { type: 'question', text: 'Do not allow it' };
  };
  return { session, turn: 1, signal, ask, handle: { turn: 1, by: { id: null, label: 'x' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) } };
};

function toolsFor(appKey = 'repairs'): DesignerTool[] {
  return createDesignerTools(
    {
      root,
      version: APP_VERSION,
      designer: () => ({ store: { messages: () => [] } }) as never,
      skills: createSkills(),
      listAddOns: async () => [],
      newestVersion: async () => '4.1.0',
      install: async (specs) => {
        installed.push([...specs]);
        return null;
      },
      mode: 'live',
    },
    appKey,
  );
}
const run = async (name: string, input: Record<string, unknown> = {}) => {
  const found = toolsFor().find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found.run(input, context());
};

beforeEach(async () => {
  useOwnCodePolicy(ORDINARY_POLICY);
  root = tempProject('adminium-own-code-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps }), io.stderr()).toBe(0);
  asked = [];
  installed = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('every Designer tool is listed with what it may do', () => {
  it('the table names exactly the tools the Designer has', () => {
    expect(Object.keys(TOOL_REACH).sort()).toEqual([...DESIGNER_TOOL_NAMES].sort());
    for (const tool of toolsFor()) expect(Object.keys(TOOL_REACH), tool.name).toContain(tool.name);
  });

  it('a tool the table does not name is refused whole while own code is off, and runs otherwise', async () => {
    let ran = 0;
    const unknown: DesignerTool = { name: 'run_shell', description: '', inputSchema: { type: 'object' }, running: () => '', run: async () => ((ran += 1), { content: 'ran', label: 'Ran' }) };
    const [gated] = gateTools([unknown]);
    expect(await gated!.run({}, context())).toMatchObject({ content: 'ran' });
    vi.stubEnv('ADMINIUM_TRIAL_MODE', 'on');
    expect(await gated!.run({}, context())).toMatchObject({ isError: true, facts: { operator: 'trial-mode' } });
    expect(ran).toBe(1);
  });
});

describe.each(PROFILES)('the Designer under %s', (_name, variable, reason) => {
  beforeEach(() => {
    vi.stubEnv(variable, 'on');
  });

  it('refuses hooks/ and actions/ with fixed words and no card, and writes nothing', async () => {
    for (const [tool, input] of [
      ['write_file', { path: 'hooks/orders.ts', content: 'export default {};' }],
      ['write_file', { path: 'actions/send.ts', content: 'export default {};' }],
      ['edit_file', { path: 'hooks/kept.ts', old: 'a', new: 'b' }],
      ['delete_file', { path: 'hooks/kept.ts' }],
    ] as const) {
      if (tool !== 'write_file') {
        mkdirSync(join(root, 'hooks'), { recursive: true });
        writeFileSync(join(root, 'hooks/kept.ts'), 'a');
      }
      const said = await run(tool, input);
      expect(said, `${tool} ${input.path}`).toMatchObject({ isError: true, label: 'Turned off on this server', facts: { outcome: 'refused', operator: reason } });
      expect(said.content).toContain('operator has turned off code the server would run');
    }
    expect(existsSync(join(root, 'hooks/orders.ts'))).toBe(false);
    expect(existsSync(join(root, 'actions/send.ts'))).toBe(false);
    expect(readFileSync(join(root, 'hooks/kept.ts'), 'utf8')).toBe('a');
    expect(asked).toEqual([]);
  });

  it('refuses the files a build of its own runs, and a build command, with no card', async () => {
    writeFileSync(join(root, 'apps/repairs/build.json'), JSON.stringify({ install: 'npm ci --ignore-scripts', command: 'vite build', output: 'dist-surface/repairs' }));
    for (const path of ['apps/repairs/build.json', 'apps/repairs/vite.config.ts', 'apps/repairs/package.json', 'apps/repairs/scripts/postbuild.mjs']) {
      expect(await run('write_file', { path, content: '{}' }), path).toMatchObject({ isError: true, facts: { operator: reason } });
    }
    rmSync(join(root, 'apps/repairs/build.json'));
    const app = readFileSync(join(root, 'apps/repairs/manifest/app.json'), 'utf8');
    const withBuild = JSON.stringify({ ...(JSON.parse(app) as object), build: 'node evil.js' });
    expect(await run('write_file', { path: 'apps/repairs/manifest/app.json', content: withBuild })).toMatchObject({ isError: true, facts: { operator: reason } });
    expect(asked).toEqual([]);
  });

  it('still writes the app’s manifest, pages and screens', async () => {
    expect(await run('write_file', { path: 'apps/repairs/notes.md', content: 'x' })).toMatchObject({ label: 'Wrote notes.md' });
    expect(readFileSync(join(root, 'apps/repairs/notes.md'), 'utf8')).toBe('x');
    expect((await run('check_app')).isError).toBeUndefined();
  });

  it('refuses run_tests, request_package and a phone app with no card and nothing run or installed', async () => {
    for (const [tool, input] of [
      ['run_tests', {}],
      ['request_package', { packages: [{ name: 'date-fns', why: 'dates' }] }],
      ['add_side', { side: 'mobile' }],
    ] as const) {
      expect(await run(tool, input), tool).toMatchObject({ isError: true, label: 'Turned off on this server', facts: { operator: reason } });
    }
    expect(asked).toEqual([]);
    expect(installed).toEqual([]);
    expect(existsSync(join(root, 'apps/repairs/mobile'))).toBe(false);
  });
});

describe('the Designer on an ordinary server', () => {
  it('writes an app’s tsconfig as it always has', () => {
    createJail(root, 'repairs').write('apps/repairs/staff/tsconfig.json', '{}');
    expect(existsSync(join(root, 'apps/repairs/staff/tsconfig.json'))).toBe(true);
  });

  it('asks before server code and tests, as it always has', async () => {
    expect(await run('write_file', { path: 'hooks/orders.ts', content: 'export default {};' })).toMatchObject({ isError: true, label: 'Server code not allowed' });
    expect(await run('run_tests')).toMatchObject({ label: 'Tests not run' });
    expect(asked.map((card) => card.type)).toEqual(['question', 'question']);
  });
});

describe.each(PROFILES)('where the effect happens, under %s', (_name, variable, reason) => {
  beforeEach(() => {
    vi.stubEnv(variable, 'on');
  });

  it('the jail writes no code and deletes none, whoever writes', () => {
    const jail = createJail(root, 'repairs');
    expect(() => jail.write('hooks/orders.ts', 'export default {};')).toThrow(JailError);
    expect(() => jail.write('actions/send.ts', 'export default {};')).toThrow(/operator/);
    mkdirSync(join(root, 'hooks'), { recursive: true });
    writeFileSync(join(root, 'hooks/kept.ts'), 'a');
    expect(() => jail.delete('hooks/kept.ts')).toThrow(/operator/);
    expect(existsSync(join(root, 'hooks/orders.ts'))).toBe(false);
    expect(existsSync(join(root, 'hooks/kept.ts'))).toBe(true);
    // The app's own declarative files are written as before.
    jail.write('apps/repairs/notes.md', 'x');
    expect(readFileSync(join(root, 'apps/repairs/notes.md'), 'utf8')).toBe('x');
  });

  it('the jail writes no tsconfig or jsconfig anywhere in an app, own build or not: a bundler reads what one extends', () => {
    const jail = createJail(root, 'repairs');
    const extend = JSON.stringify({ extends: '/run/secrets/operator_token' });
    for (const path of ['apps/repairs/staff/tsconfig.json', 'apps/repairs/tsconfig.json', 'apps/repairs/staff/src/jsconfig.json', 'apps/repairs/staff/tsconfig.app.json', 'apps/repairs/staff/TSConfig.json']) {
      expect(() => jail.write(path, extend), path).toThrow(/operator/);
      expect(existsSync(join(root, path)), path).toBe(false);
    }
    mkdirSync(join(root, 'apps/repairs/staff'), { recursive: true });
    writeFileSync(join(root, 'apps/repairs/staff/tsconfig.json'), '{}');
    expect(() => jail.delete('apps/repairs/staff/tsconfig.json')).toThrow(/operator/);
  });

  it('an app’s own build command never runs, though a person approved it', async () => {
    const build: AppBuildFile = { install: 'npm ci --ignore-scripts', command: 'vite build', output: 'dist-surface/repairs' };
    writeFileSync(join(root, 'apps/repairs/build.json'), JSON.stringify(build));
    approveBuild(root, 'repairs', build);
    const lines: string[] = [];
    const runLine: StepRunner = async (line) => {
      lines.push(line);
      return { ok: true, output: '' };
    };
    const ran = await runOwnBuild(root, 'repairs', build, { run: runLine, sides: ['staff'] });
    expect(ran).toEqual({ problems: [expect.stringContaining('operator has turned off builds of an app’s own')] });
    const built = await buildProjectApps(root, { version: APP_VERSION, bundler: null, runBuild: runLine });
    expect(built.apps.find((app) => app.key === 'repairs')?.problems?.[0]).toContain('operator has turned off builds');
    expect(lines).toEqual([]);
  });

  it('the phone app is neither installed nor built', async () => {
    let started = 0;
    const runPhone = async () => ((started += 1), { code: 0, output: '', timedOut: false, stopped: false });
    expect(await installPhone(root, 'repairs', { run: runPhone as never })).toEqual({ ok: false, words: expect.stringContaining('operator') });
    mkdirSync(join(root, 'apps/repairs/mobile'), { recursive: true });
    writeFileSync(join(root, 'apps/repairs/mobile/App.tsx'), 'export default () => null;');
    expect(await buildPhone(root, 'repairs', { run: runPhone as never })).toMatchObject({ state: 'failed', words: expect.stringContaining('operator') });
    expect(started).toBe(0);
  });

  it('the project’s hooks and actions are never imported, at boot or on a rebuild', async () => {
    const buildDir = join(root, '.adminium/build');
    const manifest = (hash: string) => ({
      server: {
        digest: hash,
        files: [
          { kind: 'hooks', name: 'orders', source: 'hooks/orders.ts', output: 'server/hooks/orders.mjs', hash },
          { kind: 'actions', name: 'send', source: 'actions/send.ts', output: 'server/actions/send.mjs', hash },
        ],
      },
    });
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, 'manifest.json'), JSON.stringify(manifest('a'.repeat(64))));
    const imported: string[] = [];
    const importer = async (url: string) => {
      imported.push(url);
      return { default: { table: 'orders', afterCreate: () => undefined } };
    };
    const code = await loadProjectCode(buildDir, { importer });
    expect(code.hooks).toEqual([]);
    expect(code.actions.size).toBe(0);
    expect(code.problems.map((problem) => problem.source)).toEqual(['actions/send.ts', 'hooks/orders.ts']);
    expect(code.problems[0]?.message).toContain('operator');
    // The runtime a server keeps: its first load, and the one after a rebuild.
    const warned: string[] = [];
    const runtime = createProjectCodeRuntime({ root, mode: 'dev', log: () => undefined, warn: (line) => void warned.push(line), importer, pollMs: 10 });
    await runtime.load();
    writeFileSync(join(buildDir, 'manifest.json'), JSON.stringify(manifest('b'.repeat(64))));
    runtime.start();
    await vi.waitFor(() => expect(runtime.current().digest).toBe('b'.repeat(64)));
    runtime.close();
    expect(runtime.current().hooks).toEqual([]);
    expect(imported).toEqual([]);
    expect(warned.join('\n')).toContain('operator');
  });

  it('"Start with an app" copies nothing', async () => {
    let fetched = 0;
    const starter = createStarter({
      root,
      listed: async () => ((fetched += 1), { key: 'shop', version: '1.0.0', name: 'Shop', repo: 'https://github.com/example/shop' }),
      installedKeys: async () => [],
      buildAndApply: async () => [],
      openSession: async () => 'ds_x',
      audit: async () => undefined,
      log: () => undefined,
    });
    const build = starter.buildFor('my-shop');
    await expect(starter.start({ key: 'shop', newKey: 'my-shop', name: 'My shop', approve: build.fingerprint, connectionId: 'env:x', model: 'x', by: { id: null, label: 'x' } })).rejects.toMatchObject({
      statusCode: 403,
      code: 'OWN_CODE_OFF',
      details: { question: 'ownBuilds', reason },
    });
    expect(fetched).toBe(0);
    expect(existsSync(join(root, 'apps/my-shop'))).toBe(false);
  });

  it('a style of one’s own is not added', () => {
    const skill = Buffer.from('---\nname: Mine\ndescription: A look of my own.\n---\n# Mine\n');
    expect(() => addDesignSkill(root, { filename: 'SKILL.md', bytes: skill })).toThrow(OwnCodeOffError);
    expect(existsSync(join(root, 'design-skills'))).toBe(false);
  });
});

describe('the questions, both ways', () => {
  it('allowed on an ordinary server, by the server’s policy and by its environment', () => {
    for (const question of ['packageUploads', 'designerUploads', 'designerCode', 'ownBuilds', 'requestPackage'] as const) {
      expect(ownCodeAllows(question), question).toEqual({ allowed: true, reason: null });
    }
    vi.stubEnv('ADMINIUM_TRIAL_MODE', 'on');
    expect(ownCodeAllows('designerCode')).toEqual({ allowed: false, reason: 'trial-mode' });
  });
});

describe.each(PROFILES)('a program the server starts, under %s', (_name, variable) => {
  it('is given no ADMINIUM_ variable at all, whatever the process holds', () => {
    const held: Record<string, string> = {
      PATH: '/usr/bin',
      HOME: '/home/trial',
      [variable]: 'on',
      ADMINIUM_SECRET: 's'.repeat(40),
      ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
      ADMINIUM_OPERATOR_TOKEN: 'o'.repeat(40),
      ADMINIUM_TRIAL_SMTP_URL: 'smtp://user:pass@relay.example.com',
      ADMINIUM_TRIAL_ENDS_AT: '2026-12-01T00:00:00Z',
      ADMINIUM_TRIAL_UPGRADE_URL: 'https://example.com/upgrade',
      ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
      ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
      ADMINIUM_SOURCE_URL: 'postgres://trial:pw@pg-trials:5432/trial',
      ADMINIUM_META_URL: 'postgres://trial:pw@pg-trials:5432/meta',
      ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-x',
      ADMINIUM_AI_OPERATOR_ONLY: 'on',
      ADMINIUM_OPERATOR_EVENTS_URL: 'https://example.com/events',
      ADMINIUM_DESIGNER_START_PROMPT_B64: 'aGVsbG8=',
      ADMINIUM_SUPABASE_CONNECT_URL: 'https://example.com/connect',
    };
    for (const profile of ['program', 'build', 'packages', 'browser'] satisfies ChildEnvProfile[]) {
      const given = childEnvironment(profile, {}, held, 'linux');
      expect(Object.keys(given).filter((name) => name.startsWith('ADMINIUM_')), profile).toEqual([]);
      expect(given['PATH']).toBe('/usr/bin');
    }
  });
});
