import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The page-config leaf is architecturally load-bearing: it must import ONLY
 * zod (plus its own relative modules) so that `@adminium/engine/config` can
 * depend on it without a cycle and browsers can bundle it (01-architecture.md
 * §6.1). This test fails the build if any other import sneaks in.
 */
const leafDir = fileURLToPath(new URL('../src/page-config', import.meta.url));

function collectImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g, // import/export … from '…'
    /import\s*['"]([^'"]+)['"]/g, // bare side-effect import '…'
    /import\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('…')
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1] as string);
    }
  }
  return specifiers;
}

describe('page-config leaf purity', () => {
  const files = readdirSync(leafDir).filter((f) => f.endsWith('.ts'));

  it('contains source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports only zod and relative modules', (file) => {
    const source = readFileSync(join(leafDir, file), 'utf8');
    for (const specifier of collectImports(source)) {
      const allowed = specifier === 'zod' || specifier.startsWith('./') || specifier.startsWith('../');
      expect(allowed, `disallowed import "${specifier}" in ${file}`).toBe(true);
      expect(specifier.startsWith('node:'), `node: import "${specifier}" in ${file}`).toBe(false);
      // relative imports must stay inside the leaf
      expect(specifier.startsWith('../'), `import "${specifier}" escapes the leaf in ${file}`).toBe(
        false,
      );
    }
  });
});
