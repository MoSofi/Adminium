// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Regenerates src/resources/<locale>/*.ts from the canonical locales/<tag>/*.json
 * bundles (see src/resources/parity.test.ts). The JSON files are the
 * hand-authored source of truth (10-i18n-theming.md §3.1); the TS mirrors
 * exist so the runtime can bundle (en-US) or lazily chunk-split (all other
 * locales, src/resources/lazy.ts) without JSON import attributes.
 * Run after editing any bundle: `node scripts/gen-resources.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

/** BCP-47 locale directory names under locales/, mirrored to kebab-lowercase dirs under src/resources/. */
const localeTags = ['en-US', 'de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'zh-CN', 'zh-TW', 'ar-EG'];
const namespaces = ['common', 'ui', 'studio', 'generated', 'errors'];

let count = 0;
for (const tag of localeTags) {
  const dir = path.join(root, 'locales', tag);
  const outDir = path.join(root, 'src/resources', tag.toLowerCase());
  fs.mkdirSync(outDir, { recursive: true });
  for (const ns of namespaces) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, `${ns}.json`), 'utf8'));
    const body = JSON.stringify(json, null, 2);
    // The SPDX line is part of the template, not something scripts/check-spdx.mjs
    // adds afterwards: this generator rewrites all 40 mirrors from scratch, so an
    // externally-inserted header would be deleted on the next `gen:resources` run
    // and the licence gate would go red with no diff anyone made.
    const src = `// SPDX-License-Identifier: AGPL-3.0-only\n/**\n * GENERATED MIRROR of ../../../locales/${tag}/${ns}.json — do not edit by hand.\n * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);\n * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits\n * the other locales) without JSON import attributes (browser + NodeNext safe).\n * Parity is enforced by src/resources/parity.test.ts. Regenerate with\n * scripts/gen-resources.mjs.\n */\nexport default ${body} as const;\n`;
    fs.writeFileSync(path.join(outDir, `${ns}.ts`), src);
    count += 1;
  }
}
console.log(`regenerated ${count} resource modules in src/resources`);
