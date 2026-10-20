// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copy the repository's `skills/` into the server package, so the published
 * package carries the files Adminium Designer reads (the same files a coding
 * agent reads). Run by `prepack` and by the release's publish script.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'skills');
const target = join(here, '..', 'skills');

if (!existsSync(join(source, 'adminium', 'SKILL.md'))) {
  console.error(`bundle-skills: no skills at ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
// `VERSION` stays behind: it is the number the skills were last mirrored at, written by the mirror step for the
// mirror. Inside the server it would be a second, older answer to "which version is this" beside the server's own.
// Dot files and dot folders inside `skills/` stay behind too. Only the part of the path below `source` is tested:
// the absolute path of a checkout under `.claude/worktrees/…` holds `.claude`, and testing it dropped every file.
const left = (path) => {
  const inside = relative(source, path);
  return inside === 'VERSION' || inside.split(/[\\/]/).some((part) => part.startsWith('.') && part.length > 1);
};
cpSync(source, target, { recursive: true, filter: (path) => !left(path) });
if (!existsSync(join(target, 'adminium', 'SKILL.md'))) {
  console.error(`bundle-skills: the copy to ${target} holds no adminium/SKILL.md`);
  process.exit(1);
}
console.log(`bundle-skills: copied ${source} → ${target}`);
