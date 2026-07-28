/**
 * Widget-chrome i18n coverage gate (RELEASE-GATE "translated-but-unwired
 * keys"): every `widgets.*` leaf key in the canonical en-US `ui` bundle must be
 * referenced from this package's runtime source, and every referenced key must
 * exist in the bundle. Keys referenced through a dynamic segment count when the
 * source carries the template's static prefix (e.g. `ui:widgets.domain.status.`
 * covers every leaf under it). Test/story files do not count as wiring.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * Keys that are deliberately config-layer suggestions rather than rendered
 * defaults (a rendered default would CHANGE today's output — e.g. points render
 * bare unless a unit is configured). Each entry needs a reason.
 */
const CONFIG_SUGGESTION_KEYS = new Set<string>([
  // 'pts' is only appended when a host/config supplies pointsUnit; defaulting
  // it would suffix every points value that renders bare today.
  'widgets.boards.pointsUnit',
  // aria-label/region name renders only when configured; a default would add
  // accessible names/regions where none render today.
  'widgets.feeds.unreadBadge.unitLabel',
  'widgets.feeds.toastStack.regionLabel',
  // No empty-state render site exists (frame intercepts empty payloads).
  'widgets.kpi.autoInsights.emptyTitle',
  'widgets.kpi.autoInsights.emptyBody',
  // Footer renders only when config.footerHint is set.
  'widgets.chrome.shortcutsPanel.footerHint',
  // An idle typing indicator deliberately renders nothing.
  'widgets.communication.typingIndicator.emptyTitle',
  'widgets.communication.typingIndicator.emptyBody',
  // Empty state renders only when the host configures a title.
  'widgets.calendar.calendarMonth.emptyTitle',
  // Switch aria-label defaults to the job's NAME (data-derived, per-row).
  'widgets.calendar.scheduledJobsList.toggleLabel',
  // Defaults are '' or the element renders only when configured.
  'widgets.forms.chipInput.placeholder',
  'widgets.forms.ruleBuilder.valuePlaceholder',
  'widgets.forms.connectionStringField.helper',
  'widgets.forms.connectionStringField.quickFill',
  'widgets.forms.connectionStringField.host',
  // The frame owns these widgets' empty states (04-T06).
  'widgets.forms.columnMappingTable.emptyTitle',
  'widgets.forms.columnMappingTable.emptyBody',
  // Enter/blur commit and Escape cancel by design; no buttons render.
  'widgets.forms.inlineEditableField.save',
  'widgets.forms.inlineEditableField.cancel',
  // Title-only empty states / render-only-when-configured labels.
  'widgets.tables.masterList.emptyBody',
  'widgets.tables.logTable.emptyBody',
  'widgets.tables.groupedSummaryTable.emptyBody',
  'widgets.tables.schemaTree.emptyBody',
  'widgets.tables.toggleMatrix.emptyBody',
  'widgets.tables.comparisonMatrix.promotedLabel',
  // The add-block palette lives in the page-builder host, not the canvas.
  'widgets.domain.documentCanvas.addBlockLabel',
  // The signer title renders read-only; no input exists for a placeholder.
  'widgets.domain.blockSignature.titlePlaceholder',
  // Footnote renders only when config supplies one.
  'widgets.domain.blockMultiCurrency.footnote',
]);

function leafKeys(node: unknown, prefix: string, out: string[]): string[] {
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      leafKeys(value, prefix === '' ? key : `${prefix}.${key}`, out);
    }
  } else {
    out.push(prefix);
  }
  return out;
}

function sourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // src/test is harness scaffolding (fixtures declare fake widget ids).
      if (entry !== 'test') sourceFiles(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|stories)\.(ts|tsx)$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

describe('widget-chrome i18n coverage', () => {
  const bundle = JSON.parse(
    readFileSync(require.resolve('@adminium/i18n/locales/en-US/ui.json'), 'utf8'),
  ) as Record<string, unknown>;
  // The namespaces this package owns end-to-end. Other `ui` subtrees (action,
  // state, grid, …) are consumed from apps/dashboard too, so deadness cannot
  // be judged from this package's sources alone.
  const OWNED = ['widgets', 'templates', 'frame', 'charts'] as const;
  const bundleKeys = new Set(OWNED.flatMap((ns) => leafKeys(bundle[ns], ns, [])));

  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  // @adminium/charts wires the top-level `charts.*` primitive defaults.
  const chartsSrcRoot = join(srcRoot, '..', '..', 'charts', 'src');
  const fullRefs = new Set<string>();
  const prefixRefs = new Set<string>();
  // `ui:widgets.…` runtime refs (t() calls) and bare `widgets.…` string
  // literals (registry descriptionKeys) — a dynamic `${…}` segment turns the
  // static part into a prefix ref.
  const refPattern = /(['"`])(?:ui:)?((?:widgets|templates|frame|charts)\.[A-Za-z0-9_.-]*)(\$\{)?/g;
  // Comments are not wiring: strip /* */ blocks and whitespace-led // lines
  // before scanning so a key quoted in prose can't mask a dead key (the '//'
  // guard on the line form keeps 'https://…' inside strings intact).
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const file of [...sourceFiles(srcRoot, []), ...sourceFiles(chartsSrcRoot, [])]) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(refPattern)) {
      const key = match[2]!;
      if (match[3] !== undefined) {
        // A dynamic ref must be scoped deeper than its family, or one broad
        // template (`widgets.charts.${…}`) would mask a whole namespace.
        if (/^[a-z]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(key.replace(/\.$/, ''))) prefixRefs.add(key);
      } else if (!key.endsWith('.')) {
        // Generator-rule ids share the `ns.kebab-case` shape ('charts.time-numeric',
        // registry/candidates.ts); real depth-2 keys are camelCase leaves.
        const segments = key.split('.');
        if (segments.length === 2 && segments[1]!.includes('-')) continue;
        fullRefs.add(key);
      }
    }
  }

  it('leaves no bundle key unwired (dead keys)', () => {
    const prefixes = [...prefixRefs];
    const dead = [...bundleKeys]
      .filter((key) => !CONFIG_SUGGESTION_KEYS.has(key))
      .filter((key) => !fullRefs.has(key))
      .filter((key) => !prefixes.some((prefix) => key.startsWith(prefix)))
      .sort();
    expect(dead, `dead ui.widgets.* keys:\n${dead.join('\n')}`).toEqual([]);
  });

  it('references no key missing from the en-US bundle (typos)', () => {
    const prefixes = [...bundleKeys];
    const unknown = [...fullRefs]
      .filter((key) => !bundleKeys.has(key))
      // A full ref may legitimately be a parent node (rare); accept if any
      // bundle leaf sits under it.
      .filter((key) => !prefixes.some((leaf) => leaf.startsWith(`${key}.`)))
      .sort();
    expect(unknown, `refs missing from en-US ui.json:\n${unknown.join('\n')}`).toEqual([]);
  });

  it('config-suggestion allowlist stays honest (entries must exist and stay unwired)', () => {
    for (const key of CONFIG_SUGGESTION_KEYS) {
      expect(bundleKeys.has(key), `${key} is not in the bundle`).toBe(true);
      expect(fullRefs.has(key), `${key} is wired now — drop it from the allowlist`).toBe(false);
    }
  });
});
