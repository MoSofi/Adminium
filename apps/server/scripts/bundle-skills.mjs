// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copy the repository's `skills/` into the server package, so the published
 * package carries the files Adminium Designer reads (the same files a coding
 * agent reads). Run by `prepack` and by the release's publish script.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'skills');
const target = join(here, '..', 'skills');

if (!existsSync(join(source, 'adminium', 'SKILL.md'))) {
  console.error(`bundle-skills: no skills at ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.split(/[\\/]/).some((part) => part.startsWith('.') && part.length > 1) });
console.log(`bundle-skills: copied ${source} → ${target}`);
