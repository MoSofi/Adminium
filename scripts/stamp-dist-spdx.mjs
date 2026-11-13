#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Put the licence line back at the top of each built `.js` file that lost it.
 *
 * Every source opens with `// SPDX-License-Identifier: AGPL-3.0-only`
 * (scripts/check-spdx.mjs), but tsc does not always keep it. It hangs a file's
 * first comments on the first statement, and when that statement is erased
 * from the output (an `import type`, an `export type`, an interface) the
 * comments go with it. A blank line after the header saves it in plain `.ts`
 * files, but not in a `.tsx` file whose JSX makes tsc add its own runtime
 * import: there it is lost either way. No source shape is safe in every case,
 * so each shipped package's build runs this right after tsc:
 *
 *   tsc -p tsconfig.json && node ../../scripts/stamp-dist-spdx.mjs
 *
 * It adds the line after a shebang when there is one, at the very top
 * otherwise, and shifts the file's source map down by that one line, so stack
 * traces and debuggers still point at the right place. A file that already
 * carries the line is left as it is, so a second run changes nothing.
 * scripts/check-dist-spdx.mjs proves the result.
 *
 *   node scripts/stamp-dist-spdx.mjs [dist folder, default ./dist]
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HEADER = 'SPDX-License-Identifier: AGPL-3.0-only';
const LINE = `// ${HEADER}`;

/** Lines the header may already sit in. Same window as check-spdx and check-dist-spdx. */
const HEADER_WINDOW = 5;

const dist = resolve(process.argv[2] ?? 'dist');
if (!existsSync(dist)) {
  console.error(`[stamp-dist-spdx] no ${dist}: run it after the build`);
  process.exit(1);
}

function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) jsFiles(path, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(path);
  }
  return out;
}

let stamped = 0;
const files = jsFiles(dist);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.split('\n', HEADER_WINDOW).some((line) => line.includes(HEADER))) continue;

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const shebang = text.startsWith('#!');
  const at = shebang ? text.indexOf('\n') + 1 : 0;
  writeFileSync(file, `${text.slice(0, at)}${LINE}${eol}${text.slice(at)}`);

  // One new line of output: one empty group in the mappings, at the same line.
  const mapFile = `${file}.map`;
  if (existsSync(mapFile)) {
    const map = JSON.parse(readFileSync(mapFile, 'utf8'));
    if (typeof map.mappings === 'string') {
      const lines = map.mappings.split(';');
      lines.splice(shebang ? 1 : 0, 0, '');
      map.mappings = lines.join(';');
      writeFileSync(mapFile, JSON.stringify(map));
    }
  }
  stamped += 1;
}
console.log(`[stamp-dist-spdx] ${String(stamped)} of ${String(files.length)} built file(s) needed the licence line`);
