// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `@adminium/engine/config` is a browser-safe subpath (01-architecture.md
 * §2.3.2): dashboard, widgets, and manifest bundle it. Nothing under
 * src/config-schema/ may import node: builtins, and the only external
 * modules allowed are zod and the @adminium/widgets/page-config pure-Zod
 * leaf.
 */
const configSchemaDir = fileURLToPath(new URL('../src/config-schema', import.meta.url));

const ALLOWED_BARE_IMPORTS = new Set(['zod', '@adminium/widgets/page-config']);

function collectImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1] as string);
    }
  }
  return specifiers;
}

describe('config-schema browser safety', () => {
  const files = readdirSync(configSchemaDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts'));

  it('contains source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no node: imports and only allowed externals', (file) => {
    const source = readFileSync(join(configSchemaDir, file), 'utf8');
    for (const specifier of collectImports(source)) {
      expect(specifier.startsWith('node:'), `node: import "${specifier}" in ${file}`).toBe(false);
      const allowed =
        specifier.startsWith('./') ||
        specifier.startsWith('../') ||
        ALLOWED_BARE_IMPORTS.has(specifier);
      expect(allowed, `disallowed import "${specifier}" in ${file}`).toBe(true);
      // full @adminium/widgets (component code) must never be imported here
      expect(specifier === '@adminium/widgets', `full widgets import in ${file}`).toBe(false);
    }
  });
});
