/**
 * dependency-cruiser rules enforcing the import matrix of
 * workplan/01-architecture.md §2.3 (task 01-T03 / M0-T03).
 *
 * Layering: tokens → (i18n, charts, ui) → widgets → apps,
 * and engine → (adapters, schema-import, llm, manifest, meta-consumers) → server.
 *
 * Rules match dependencies both in their resolved form (packages/<dir>/…,
 * pnpm workspace symlinks resolve to the real path) and in their raw
 * specifier form (@adminium/<name>[/subpath], which is what dependency-cruiser
 * reports when a workspace package has not been built/resolved yet). Sanctioned
 * subpath entry points (§2.3.1/§2.3.2/§6.1) are carved out via pathNot.
 */

/** A workspace package in resolved, symlinked, or unresolved-specifier form. */
const pkg = (dir, name = dir) =>
  `^(packages/${dir}|node_modules/@adminium/${name}|@adminium/${name})(/|$)`;

/** An app workspace in resolved or unresolved-specifier form. */
const app = (dir, name = dir) =>
  `^(apps/${dir}|node_modules/@adminium/${name}|@adminium/${name})(/|$)`;

// Sanctioned subpath entry points.
// Browser-safe pure-Zod engine leaf (§2.3.2): `@adminium/engine/config`.
const ENGINE_CONFIG_LEAF =
  '^(packages/engine|node_modules/@adminium/engine)/(src|dist)/config(-schema)?(/|\\.)|^@adminium/engine/config$';
// Adapter interface entry (§2.3.1): `@adminium/engine/adapter`.
const ENGINE_ADAPTER_LEAF =
  '^(packages/engine|node_modules/@adminium/engine)/(src|dist)/adapter(/|\\.)|^@adminium/engine/adapter$';
// Pure-Zod page-config leaf inside widgets (§6.1): `@adminium/widgets/page-config`.
const WIDGETS_PAGE_CONFIG_LEAF =
  '^(packages/widgets|node_modules/@adminium/widgets)/(src|dist)/page-config(/|\\.)|^@adminium/widgets/page-config$';
// Pure generator leaf inside widgets: `@adminium/widgets/generate`.
//
// 04-widget-registry.md §8 splits the auto-instantiation pipeline across the two
// packages on purpose: the Engine drives hooks H1/H2/H4 ("`composeTemplate(…)` →
// `PageConfig` rows written to `adminium_pages`") while the rules and manifests
// they run on live in the Registry ("the Registry owns what can be instantiated
// and why … so the catalog and its trigger logic never drift apart"). That
// requires one engine → widgets edge. It is NOT `page-config`: that leaf is the
// frozen config-body schema the server and `@adminium/engine/config` bundle, and
// must not grow generator logic. So the generator gets its own leaf under the
// identical purity contract — zod + the page-config leaf only, no React, no
// component code, no `node:` builtins — gated by
// `packages/widgets/src/generate/leaf-purity.test.ts`.
const WIDGETS_GENERATE_LEAF =
  '^(packages/widgets|node_modules/@adminium/widgets)/(src|dist)/generate(/|\\.)|^@adminium/widgets/generate$';

const ANY_WORKSPACE = '^(packages|apps)/|^node_modules/@adminium/|^@adminium/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Circular dependencies are forbidden everywhere (01 §2.3).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'tokens-imports-nothing',
      comment: '@adminium/tokens is the leaf of the layering — it imports no workspace package.',
      severity: 'error',
      from: { path: '^packages/tokens/' },
      to: { path: ANY_WORKSPACE, pathNot: ['^packages/tokens/'] },
    },
    {
      name: 'i18n-no-ui-server',
      comment: '@adminium/i18n must never import ui or server (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/i18n/' },
      to: { path: [pkg('ui'), app('server')].join('|') },
    },
    {
      name: 'charts-only-tokens',
      comment: '@adminium/charts may import only @adminium/tokens from the workspace (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/charts/' },
      to: { path: ANY_WORKSPACE, pathNot: ['^packages/charts/', pkg('tokens')] },
    },
    {
      name: 'ui-no-charts-widgets-engine',
      comment: '@adminium/ui must never import charts, widgets, or engine (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: [pkg('charts'), pkg('widgets'), pkg('engine')].join('|') },
    },
    {
      name: 'widgets-no-full-engine',
      comment:
        '@adminium/widgets may import only the browser-safe @adminium/engine/config leaf, never the full engine (01 §2.3, §2.3.2).',
      severity: 'error',
      from: { path: '^packages/widgets/' },
      to: { path: pkg('engine'), pathNot: [ENGINE_CONFIG_LEAF] },
    },
    {
      name: 'widgets-no-meta-adapters-server',
      comment: '@adminium/widgets must never import meta, adapters, or server (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/widgets/' },
      to: { path: [pkg('meta'), pkg('adapter-[^/]+', 'adapter-[^/]+'), app('server')].join('|') },
    },
    {
      name: 'engine-no-meta-adapters',
      comment:
        '@adminium/engine defines the Adapter interface but never imports adapter packages (registration happens in server, 01 §2.3.1); it must never import meta.',
      severity: 'error',
      from: { path: '^packages/engine/' },
      to: { path: [pkg('meta'), pkg('adapter-[^/]+', 'adapter-[^/]+')].join('|') },
    },
    {
      name: 'engine-no-full-widgets',
      comment:
        '@adminium/engine may import only the pure @adminium/widgets/page-config (01 §2.3, §6.1) and @adminium/widgets/generate (04 §8) leaves, never widget component code.',
      severity: 'error',
      from: { path: '^packages/engine/' },
      to: { path: pkg('widgets'), pathNot: [WIDGETS_PAGE_CONFIG_LEAF, WIDGETS_GENERATE_LEAF] },
    },
    {
      name: 'adapters-only-engine-adapter',
      comment:
        'adapter-* packages may import only @adminium/engine/adapter (interface + SchemaModel types) from the workspace (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/(adapter-[^/]+)/' },
      to: { path: ANY_WORKSPACE, pathNot: ['^packages/$1/', ENGINE_ADAPTER_LEAF] },
    },
    {
      name: 'meta-no-engine-adapters-server',
      comment:
        '@adminium/meta is standalone (kysely + zod only) — it must never import engine, adapters, or server (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/meta/' },
      to: {
        path: [pkg('engine'), pkg('adapter-[^/]+', 'adapter-[^/]+'), app('server')].join('|'),
      },
    },
    {
      name: 'manifest-no-server-ui',
      comment: '@adminium/manifest must never import server or ui (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/manifest/' },
      to: { path: [app('server'), pkg('ui')].join('|') },
    },
    {
      name: 'schema-import-no-adapters-server',
      comment: '@adminium/schema-import must never import adapters or server (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/schema-import/' },
      to: { path: [pkg('adapter-[^/]+', 'adapter-[^/]+'), app('server')].join('|') },
    },
    {
      name: 'llm-no-server-ui',
      comment: '@adminium/llm must never import server or ui (01 §2.3).',
      severity: 'error',
      from: { path: '^packages/llm/' },
      to: { path: [app('server'), pkg('ui')].join('|') },
    },
    {
      name: 'server-no-ui-widgets-charts',
      comment:
        '@adminium/server must never import ui, widgets, charts, or dashboard runtime code (01 §2.3).',
      severity: 'error',
      from: { path: '^apps/server/' },
      to: { path: [pkg('ui'), pkg('widgets'), pkg('charts'), app('dashboard')].join('|') },
    },
    {
      name: 'dashboard-no-full-engine',
      comment:
        '@adminium/dashboard may import only the browser-safe @adminium/engine/config leaf, never the full (Node-only) engine (01 §2.3, §2.3.2).',
      severity: 'error',
      from: { path: '^apps/dashboard/' },
      to: { path: pkg('engine'), pathNot: [ENGINE_CONFIG_LEAF] },
    },
    {
      name: 'dashboard-no-meta-adapters-llm',
      comment: '@adminium/dashboard must never import meta, adapters, or llm (01 §2.3).',
      severity: 'error',
      from: { path: '^apps/dashboard/' },
      to: { path: [pkg('meta'), pkg('adapter-[^/]+', 'adapter-[^/]+'), pkg('llm')].join('|') },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Tooling config files (eslint/vitest configs, build scripts) import @adminium/config
    // by design — they are dev-time wiring, not part of the runtime import graph the
    // 01-architecture.md §2.3 matrix governs.
    exclude: {
      path: '(^|/)(eslint|vitest|prettier|playwright)\\.config\\.(js|ts|mjs|cjs)$|(^|/)scripts/|(^|/)storybook-static/|(^|/)vrt/|(^|/)dist/|(^|/)playwright-report/|(^|/)test-results/',
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
