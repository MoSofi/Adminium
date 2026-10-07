// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Regenerates src/resources/<locale>/*.ts from the canonical locales/<tag>/*.json
 * bundles (see src/resources/parity.test.ts). The JSON files are the
 * hand-authored source of truth; the TS mirrors exist so the runtime can bundle
 * (en-US) or lazily chunk-split (all other locales, src/resources/lazy.ts)
 * without JSON import attributes. Run after editing any bundle: `node
 * scripts/gen-resources.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

/** BCP-47 locale directory names under locales/, mirrored to kebab-lowercase dirs under src/resources/. */
const localeTags = ['en-US', 'de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'zh-CN', 'zh-TW', 'ar-EG'];
/**
 * Read from the canonical bundles rather than a list kept here.
 *
 * This WAS a hardcoded array, a second copy of `src/resources/namespaces.ts`'s
 * `NAMESPACES` — so adding `onboarding.json` in eight locales regenerated 88
 * mirrors and silently skipped all eight new ones. The JSON files are the
 * canonical hand-authored bundles; anything else is a mirror of them.
 */
const namespaces = fs
  .readdirSync(path.join(root, 'locales/en-US'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => path.basename(file, '.json'))
  .sort();

/**
 * The groups of en-US `ui` that leave its eager mirror for `en-us/ui-deferred.ts`:
 * the widget and page-template vocabulary, read only by lazy widget code, which
 * waits for them (`ui-words.ts`). MUST equal `UI_DEFERRED_GROUPS` in
 * src/resources/namespaces.ts (src/ui-words.test.ts holds them together). The
 * JSON stays one `ui.json`: this is a delivery split, not a second namespace.
 */
const UI_DEFERRED_GROUPS = ['widgets', 'templates', 'pages'];
/**
 * The groups of en-US `common` that leave its eager mirror the same way, for
 * `en-us/common-deferred.ts`: the words of four screens nobody sees on the
 * first paint. MUST equal `COMMON_DEFERRED_GROUPS` in src/resources/namespaces.ts.
 */
const COMMON_DEFERRED_GROUPS = ['builder', 'kb', 'about', 'team'];
const DEFERRED_GROUPS = { ui: UI_DEFERRED_GROUPS, common: COMMON_DEFERRED_GROUPS };
/** How many texts each deferred group holds: how the runtime tells a group that is in from one an override only started. */
const deferredCounts = {};
const leaves = (node) => (typeof node === 'string' ? 1 : Object.values(node).reduce((sum, child) => sum + leaves(child), 0));

const header = (tag, ns, what) =>
  `// SPDX-License-Identifier: AGPL-3.0-only\n/**\n * GENERATED MIRROR of ../../../locales/${tag}/${ns}.json${what} — do not edit by hand.\n * The JSON file is the canonical hand-authored bundle;\n * this TS mirror exists so the runtime can bundle a namespace (en-US's eager\n * ones) or chunk-split it (every other locale, and en-US's deferred \`studio\`)\n * without JSON import attributes (browser + NodeNext safe).\n * Parity is enforced by src/resources/parity.test.ts. Regenerate with\n * scripts/gen-resources.mjs.\n */\n`;

let count = 0;
for (const tag of localeTags) {
  const dir = path.join(root, 'locales', tag);
  const outDir = path.join(root, 'src/resources', tag.toLowerCase());
  fs.mkdirSync(outDir, { recursive: true });
  for (const ns of namespaces) {
    let json = JSON.parse(fs.readFileSync(path.join(dir, `${ns}.json`), 'utf8'));
    const groups = tag === 'en-US' ? DEFERRED_GROUPS[ns] : undefined;
    if (groups !== undefined) {
      // en-US ships this namespace eagerly MINUS these groups, which go to their own chunk.
      const deferred = Object.fromEntries(groups.map((group) => [group, json[group]]));
      const deferredBody = JSON.stringify(deferred, null, 2);
      fs.writeFileSync(
        path.join(outDir, `${ns}-deferred.ts`),
        `${header(tag, ns, ` (its ${groups.join(', ')} groups: en-US's deferred part of \`${ns}\`)`)}export default ${deferredBody} as const;\n`,
      );
      count += 1;
      deferredCounts[ns] = Object.fromEntries(groups.map((group) => [group, leaves(json[group])]));
      json = Object.fromEntries(Object.entries(json).filter(([group]) => !groups.includes(group)));
    }
    const body = JSON.stringify(json, null, 2);
    // The SPDX line is part of the template, not something scripts/check-spdx.mjs
    // adds afterwards: this generator rewrites all 40 mirrors from scratch, so an
    // externally-inserted header would be deleted on the next `gen:resources` run
    // and the licence gate would go red with no diff anyone made.
    const src = `// SPDX-License-Identifier: AGPL-3.0-only\n/**\n * GENERATED MIRROR of ../../../locales/${tag}/${ns}.json — do not edit by hand.\n * The JSON file is the canonical hand-authored bundle;\n * this TS mirror exists so the runtime can bundle a namespace (en-US's eager\n * ones) or chunk-split it (every other locale, and en-US's deferred \`studio\`)\n * without JSON import attributes (browser + NodeNext safe).\n * Parity is enforced by src/resources/parity.test.ts. Regenerate with\n * scripts/gen-resources.mjs.\n */\nexport default ${body} as const;\n`;
    fs.writeFileSync(path.join(outDir, `${ns}.ts`), src);
    count += 1;
  }
}
fs.writeFileSync(
  path.join(root, 'src/resources/deferred-counts.ts'),
  `// SPDX-License-Identifier: AGPL-3.0-only\n/**\n * GENERATED by scripts/gen-resources.mjs — do not edit by hand.\n * How many texts each deferred group of en-US holds (see ./namespaces.ts).\n */\nexport const DEFERRED_GROUP_COUNTS = ${JSON.stringify(deferredCounts)} as const;\n`,
);
console.log(`regenerated ${count} resource modules in src/resources`);
