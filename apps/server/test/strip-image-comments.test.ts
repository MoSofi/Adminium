// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Docker image's comment strip (`scripts/release/strip-image-comments.mjs`)
 * takes out explanatory comments and keeps every licence comment, wherever it
 * stands: the `// SPDX-License-Identifier` line that heads each file (the code
 * is AGPL-3.0), `/*!` notices and `@license` blocks. Text that only looks like
 * a comment (in a string, a template, a regular expression) and the meta
 * migrations stay as they were, and the code still parses.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/release/strip-image-comments.mjs', import.meta.url));

const SOURCE = `// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A long explanation — with a dash.
 */
import { b } from './b.js';
// a plain line comment
const s = '// SPDX- in a string, and /* not a comment */';
const r = /\\/\\/ @license/;
/*! a pinned notice */
/**
 * @license MIT
 * Copyright Someone
 */
export function f() {
  return/* gone */b + s; // trailing words
}
let x = 1/*
*/x = 2
const t = \`/* in a template */ \${b /* inside */}\`;
export { r, t, x };
`;

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function strip(): Promise<{ out: string; migration: string }> {
  dir = await mkdtemp(join(tmpdir(), 'strip-image-'));
  const pkg = join(dir, 'node_modules', '@adminium', 'example');
  await mkdir(join(pkg, 'dist', 'migrations'), { recursive: true });
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@adminium/example' }));
  await writeFile(join(pkg, 'dist', 'a.js'), SOURCE);
  await writeFile(join(pkg, 'dist', 'a.js.map'), '{}');
  await writeFile(join(pkg, 'dist', 'migrations', '0001.js'), SOURCE);
  execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' });
  return { out: await readFile(join(pkg, 'dist', 'a.js'), 'utf8'), migration: await readFile(join(pkg, 'dist', 'migrations', '0001.js'), 'utf8') };
}

describe('the image’s comment strip', () => {
  it('keeps the SPDX line, /*! notices and @license blocks wherever they stand', async () => {
    const { out } = await strip();
    expect(out.startsWith('// SPDX-License-Identifier: AGPL-3.0-only\n')).toBe(true);
    expect(out).toContain('/*! a pinned notice */');
    expect(out).toContain('/**\n * @license MIT\n * Copyright Someone\n */');
  });

  it('takes every other comment out and leaves code, strings, templates and patterns as they were', async () => {
    const { out, migration } = await strip();
    for (const gone of ['A long explanation', 'a plain line comment', '/* gone */', 'trailing words', '/* inside */']) expect(out).not.toContain(gone);
    expect(out).toContain(`const s = '// SPDX- in a string, and /* not a comment */';`);
    expect(out).toContain('const r = /\\/\\/ @license/;');
    expect(out).toContain('`/* in a template */ ${b  }`');
    // A comment reads as a space, or a line break where it held one: no tokens join, no statement end moves.
    expect(out).toContain('return b + s;');
    expect(out).toContain('let x = 1\nx = 2');
    expect(() => execFileSync(process.execPath, ['--check', '--input-type=module'], { input: out, stdio: 'pipe' })).not.toThrow();
    // The migrations are checked by their source's hash: never touched.
    expect(migration).toBe(SOURCE);
  });
});
