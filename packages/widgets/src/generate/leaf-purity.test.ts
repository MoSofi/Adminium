// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The `@adminium/widgets/generate` purity contract (see `./index.ts`).
 *
 * `.dependency-cruiser.cjs` carves this subpath out of `engine-no-full-widgets`,
 * which is only sound while the leaf stays free of component code: the Engine is
 * Node-only and must never load React, and dep-cruiser's rule matches the direct
 * `@adminium/engine → @adminium/widgets/generate` edge, not what that module
 * pulls in behind it. This test is the thing that actually holds the line — it
 * walks the **runtime** import graph from the barrel and fails on the first
 * module that reaches outside the pure set.
 *
 * `import type` / `export type` statements are excluded: `verbatimModuleSyntax`
 * (packages/config/tsconfig.base.json) erases them, so they carry no runtime
 * edge. That is what lets `registry/candidates.ts` name `WidgetFamily` from the
 * registry's own types module rather than forking a parallel union.
 */
const generateDir = fileURLToPath(new URL('.', import.meta.url));
const srcDir = resolve(generateDir, '..');
const entry = join(generateDir, 'index.ts');

/** Only zod may be imported by name; everything else must be relative. */
const ALLOWED_BARE_IMPORTS = new Set(['zod']);

/** Strip comments and type-only import/export statements before matching. */
function runtimeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*(?:import|export)\s+type\s[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');
}

function collectImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1] as string);
  }
  return specifiers;
}

/** `./foo.js` in ESM source resolves to `./foo.ts` on disk. */
function resolveRelative(fromFile: string, specifier: string): string {
  const raw = resolve(dirname(fromFile), specifier);
  return raw.endsWith('.js') ? `${raw.slice(0, -3)}.ts` : raw;
}

interface Edge {
  from: string;
  specifier: string;
}

/** Every module reachable from the barrel, plus every bare specifier seen. */
function walk(): { modules: string[]; bare: Edge[] } {
  const seen = new Set<string>();
  const bare: Edge[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = runtimeSource(readFileSync(file, 'utf8'));
    for (const specifier of collectImports(source)) {
      if (!specifier.startsWith('.')) {
        bare.push({ from: file, specifier });
        continue;
      }
      // Checked-in manifests (04 §10) are data, not code.
      if (specifier.endsWith('.json')) continue;
      queue.push(resolveRelative(file, specifier));
    }
  }
  return { modules: [...seen].sort(), bare };
}

const graph = walk();
const rel = (file: string): string => relative(srcDir, file);

describe('@adminium/widgets/generate is a pure leaf', () => {
  it('reaches the modules the barrel advertises', () => {
    const modules = graph.modules.map(rel);
    expect(modules).toContain('registry/candidates.ts');
    expect(modules).toContain('registry/archetypes.ts');
    expect(modules).toContain('templates/compose.ts');
    expect(modules).toContain('templates/manifests.ts');
    expect(modules).toContain('templates/template-schema.ts');
    expect(modules).toContain('generate/crud-body.ts');
    expect(modules).toContain('generate/dashboard-domain.ts');
    expect(modules).toContain('page-config/grid-column-spec.ts');
  });

  it('imports no package other than zod', () => {
    const offenders = graph.bare
      .filter((edge) => !ALLOWED_BARE_IMPORTS.has(edge.specifier))
      .map((edge) => `${rel(edge.from)} → ${edge.specifier}`);
    expect(offenders).toEqual([]);
  });

  it('never reaches React or component code at runtime', () => {
    // Belt and braces over the rule above: React is what would break the Engine.
    const reactEdges = graph.bare
      .filter((edge) => edge.specifier === 'react' || edge.specifier.startsWith('react/'))
      .map((edge) => rel(edge.from));
    expect(reactEdges).toEqual([]);

    const componentModules = graph.modules
      .map(rel)
      .filter((file) => file.endsWith('.tsx') || file.startsWith('families/'));
    expect(componentModules).toEqual([]);
  });

  it('imports no node: builtin (the leaf ships to the browser too)', () => {
    const nodeEdges = graph.bare
      .filter((edge) => edge.specifier.startsWith('node:'))
      .map((edge) => `${rel(edge.from)} → ${edge.specifier}`);
    expect(nodeEdges).toEqual([]);
  });

  it('does not reach the registry map (it would pull every widget component)', () => {
    expect(graph.modules.map(rel)).not.toContain('registry/index.ts');
    expect(graph.modules.map(rel)).not.toContain('templates/crosscheck.ts');
  });
});
