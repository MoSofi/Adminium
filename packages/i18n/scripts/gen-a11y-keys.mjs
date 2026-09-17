// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generate the a11y-critical key list.
 *
 * The runtime override layer has a third state — a row with an empty value,
 * meaning "render nothing". That is a useful affordance for decorative copy
 * and a serious hazard for an accessible name: blanking a key that feeds an
 * `aria-label` removes the only name a screen reader has for that control,
 * and NO gate in this repo can observe it. The axe ratchet in CI runs over
 * `@adminium/ui` stories only, whose strings are props by contract, so it
 * never evaluates a `t()` key — let alone a database row written after the
 * build.
 *
 * So the server refuses to blank any key that appears in an accessible-name
 * position, and this script is where that list comes from.
 *
 * Scanning is deliberately GENEROUS: a false positive costs an admin the
 * ability to blank one string (they can still translate it), while a false
 * negative costs a blind user a nameless button. When in doubt, include.
 *
 * ─── Why it parses instead of grepping ─────────────────────────────────────
 *
 * Until 2026-09-14 this was two regexes, `prop={t('key'` and `prop: t('key'`.
 * Both required the call to be the WHOLE value, so every other way a key
 * reaches a name was invisible, and invisible meant blankable:
 *
 *  - `label={revealed ? t('…hidePassword') : t('…showPassword')}` — the only
 *    name of the onboarding wizard's icon-only password toggle;
 *  - `title={emptyTitle ?? t('ui:widgets.…')}` — every widget's translated
 *    default, 286 call sites on their own;
 *  - `aria-label={studioT('…')}` — the translator imported under another name;
 *  - `label: { key: 'studio:addOns.connect.apiKey', fallback: 'API key' }` —
 *    the API-key input's label, which fell OFF the list when 06e2e22 moved it
 *    from `placeholder={t(…)}` into a field descriptor.
 *
 * Tolerating each shape in a pattern means writing an expression parser by
 * hand, so this uses the real one: TypeScript's, already a dev dependency here.
 *
 * ─── What counts ───────────────────────────────────────────────────────────
 *
 * A literal key is a11y-critical when its value LANDS in a binding whose name
 * ends in an {@link A11Y_NAME} suffix. Landing walks out to the nearest JSX
 * attribute, object property, assignment, initializer or named function,
 * straight through anything that only carries a value along: `??`, ternary
 * branches, templates, casts, arrays, call arguments, JSX children, function
 * bodies. A key comes from one of:
 *
 *  1. a translator call — `t(…)`, `x.t(…)`, or an `import { t as studioT }`
 *     alias — with a literal first argument. Its own interpolation values are
 *     transparent: `aria-label={t('remove', { name: t('item') })}` names with
 *     `item` too;
 *  2. a descriptor — an object literal with a literal `key` — resolved later
 *     as `t(d.key, d.fallback)`;
 *  3. a `<name>Key` property whose stem is itself an a11y name (`labelKey`,
 *     `titleKey`) — the same indirection, one hop earlier.
 *
 * The match is a SUFFIX on purpose. The old regex was unanchored on the left,
 * so `subtitle` (through `title`) and `a11yLabel` have been protected since the
 * list existed; anchoring it would have unprotected 68 keys without a word.
 *
 * NOT seen, by construction: a key that reaches a name through a binding that
 * is not NAMED like one (`const text = t(…)`, then `aria-label={text}`), and
 * visible children such as `<Button>{t('save')}</Button>`, which this list has
 * never claimed to cover.
 *
 * Run:   pnpm --filter @adminium/i18n gen:a11y-keys
 * Check: pnpm run a11y-keys-check   (exits 1 naming every key that differs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const out = path.join(repoRoot, 'packages/i18n/src/a11y-keys.ts');
const check = process.argv.includes('--check');

/**
 * Source trees whose `t()` calls resolve against the `@adminium/i18n`
 * bundles.
 *
 * `apps/desktop/src/main` is deliberately absent: the Electron main process
 * has its OWN translator (`menu.ts`'s `opts.t ?? defaultTranslate`) over a
 * separate key space that the SPA pushes to it, so its `label: t('file')`
 * calls are not bundle keys and would land as permanently stale entries.
 */
const ROOTS = [
  'apps/dashboard/src',
  'packages/ui/src',
  'packages/widgets/src',
  'packages/charts/src',
  'apps/desktop/src/renderer',
];

/**
 * Binding names whose value becomes an accessible name, a tooltip, or the only
 * text on a control — matched as a suffix, so `[Ll]abel` catches the repo's
 * many `confirmLabel` / `cancelLabel` / `submitLabel` props in one rule.
 */
const A11Y_NAME = /(?:aria-label|aria-description|aria-placeholder|title|alt|placeholder|[Ll]abel)$/;

/**
 * What a bundle key looks like. Applied to descriptors and `labelKey` values
 * only, where a literal is not a key by construction: `{ key: 'api_key' }` is a
 * form field's id.
 */
const KEY_SHAPE = /^(?:[A-Za-z][\w-]*:[\w-]+(?:\.[\w-]+)*|[\w-]+(?:\.[\w-]+)+)$/;

/**
 * Directories that are not product source. `test/` and `__fixtures__/` hold
 * harnesses and fixture data — `src/test/fixtures.ts` builds page descriptors
 * titled `pages.customers`, which no bundle has — for the same reason the walk
 * already skips `*.test.tsx`.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', '__fixtures__', '__mocks__']);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

/** A binding's name, or undefined when it is computed and says nothing. */
function nameOf(node) {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isJsxNamespacedName(node)) return `${node.namespace.text}:${node.name.text}`;
  return undefined;
}

function literalText(node) {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** Every local name the translator goes by in this file. */
function translatorNames(sourceFile) {
  const names = new Set(['t']);
  for (const statement of sourceFile.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 't') names.add(element.name.text);
    }
  }
  return names;
}

function isTranslatorCall(node, names) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && names.has(callee.text)) ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

/** The name of the binding `node`'s value lands in; undefined when there is none. */
function landing(node, names) {
  for (let child = node, parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return nameOf(parent.name);
    if (ts.isPropertyAssignment(parent)) {
      if (parent.name === child) return undefined;
      const call = parent.parent.parent;
      if (call !== undefined && isTranslatorCall(call, names) && call.arguments.includes(parent.parent)) continue;
      return nameOf(parent.name);
    }
    if (
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyDeclaration(parent)
    ) {
      return parent.initializer === child ? nameOf(parent.name) : undefined;
    }
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent)) {
      return nameOf(parent.name);
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (parent.right !== child) return undefined;
      const target = parent.left;
      return ts.isPropertyAccessExpression(target) ? target.name.text : nameOf(target);
    }
    if (ts.isConditionalExpression(parent) && parent.condition === child) return undefined;
  }
  return undefined;
}

function descriptorKey(object) {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && nameOf(property.name) === 'key') {
      const key = literalText(property.initializer);
      return key !== undefined && KEY_SHAPE.test(key) ? key : undefined;
    }
  }
  return undefined;
}

const found = new Set();
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(path.join(repoRoot, root))) {
    scanned += 1;
    const sourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const names = translatorNames(sourceFile);
    // `t()` keys may carry an explicit namespace (`ui:action.save`); bare keys
    // resolve in `common` (createI18n's defaultNS).
    const keep = (key) => found.add(key.includes(':') ? key : `common:${key}`);
    const inA11yName = (node) => A11Y_NAME.test(landing(node, names) ?? '');

    const visit = (node) => {
      if (isTranslatorCall(node, names)) {
        const key = literalText(node.arguments[0]);
        // Interpolated keys (`shortcuts.go.${item.slug}`) are banned by lint
        // and can never be matched literally, so
        // they are not blankable and do not belong on this list.
        if (key !== undefined && !key.includes('${') && inA11yName(node)) keep(key);
      } else if (ts.isObjectLiteralExpression(node)) {
        const key = descriptorKey(node);
        if (key !== undefined && inA11yName(node)) keep(key);
      } else if (ts.isPropertyAssignment(node)) {
        const name = nameOf(node.name);
        const key = literalText(node.initializer);
        if (name?.endsWith('Key') && A11Y_NAME.test(name.slice(0, -3)) && key !== undefined && KEY_SHAPE.test(key)) {
          keep(key);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

const keys = [...found].sort();

// The SPDX line belongs to this template rather than to scripts/check-spdx.mjs:
// the file below is rewritten from scratch on every run, so a header inserted
// afterwards would vanish at the next `gen:a11y-keys` and turn the licence gate
// red with no diff anyone made.
const content = `// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED by scripts/gen-a11y-keys.mjs — do not edit by hand.
 *
 * Keys that reach an accessible name, tooltip, or the only text on a control.
 * The runtime override layer refuses to BLANK any of these: translating them is
 * always allowed, emptying them is not, because no CI gate in this repo can see
 * a database row that removed a button's name.
 *
 * Regenerate after adding an \`aria-label={t(…)}\`-shaped call site:
 *   pnpm --filter @adminium/i18n gen:a11y-keys
 */

/** \`namespace:key\` — ${keys.length} entries. */
export const A11Y_CRITICAL_KEYS: ReadonlySet<string> = new Set([
${keys.map((k) => `  '${k}',`).join('\n')}
]);

/** Is blanking this key forbidden? \`namespace\` + dotted \`key\`. */
export function isA11yCriticalKey(namespace: string, key: string): boolean {
  return A11Y_CRITICAL_KEYS.has(\`\${namespace}:\${key}\`);
}
`;

if (check) {
  const committed = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (committed === content) {
    console.log(`gen:a11y-keys --check — current: ${keys.length} keys from ${scanned} files`);
    process.exit(0);
  }
  const listed = new Set([...committed.matchAll(/^ {2}'([^']+)',$/gm)].map((m) => m[1]));
  const missing = keys.filter((k) => !listed.has(k));
  const stale = [...listed].filter((k) => !found.has(k)).sort();
  const show = (list, mark) => {
    for (const k of list.slice(0, 40)) console.error(`    ${mark} ${k}`);
    if (list.length > 40) console.error(`    … and ${list.length - 40} more`);
  };
  console.error('gen:a11y-keys --check — packages/i18n/src/a11y-keys.ts is out of date.\n');
  if (missing.length > 0) {
    console.error(`  ${missing.length} key(s) reach an accessible name but are NOT listed, so an admin can blank them:`);
    show(missing, '+');
  }
  if (stale.length > 0) {
    console.error(`  ${stale.length} listed key(s) no longer reach one:`);
    show(stale, '-');
  }
  if (missing.length === 0 && stale.length === 0) {
    console.error('  The keys match but the bytes do not: the file was edited by hand, or the template changed.');
  }
  console.error('\n  Fix: pnpm --filter @adminium/i18n gen:a11y-keys');
  process.exit(1);
}

fs.writeFileSync(out, content, 'utf8');
console.log(`gen:a11y-keys — scanned ${scanned} files, found ${keys.length} a11y-critical keys`);
