/**
 * Regenerates src/resources/en-us/*.ts from the canonical locales/en-US/*.json
 * bundles (see src/resources/parity.test.ts). Run after editing any en-US
 * bundle: `node scripts/gen-resources.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const dir = path.join(root, 'locales/en-US');
const outDir = path.join(root, 'src/resources/en-us');
fs.mkdirSync(outDir, { recursive: true });

const namespaces = ['common', 'ui', 'studio', 'generated', 'errors'];
for (const ns of namespaces) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, `${ns}.json`), 'utf8'));
  const body = JSON.stringify(json, null, 2);
  const src = `/**\n * GENERATED MIRROR of ../../../locales/en-US/${ns}.json — do not edit by hand.\n * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);\n * this TS mirror exists so the runtime bundles en-US resources without JSON\n * import attributes (browser + NodeNext safe). Parity is enforced by\n * src/resources/parity.test.ts. Regenerate with scripts/gen-resources.mjs.\n */\nexport default ${body} as const;\n`;
  fs.writeFileSync(path.join(outDir, `${ns}.ts`), src);
}
console.log(`regenerated ${namespaces.length} resource modules in src/resources/en-us`);
