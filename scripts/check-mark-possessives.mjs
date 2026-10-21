#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Payment providers' marks are never written in the possessive in anything
 * that ships: no screen, email, locale bundle, guide or skill says "Stripe's"
 * or "PayPal's". Their marks terms bar the possessive form, so the words say
 * "the Stripe page", "the PayPal dashboard", "Stripe payment id".
 *
 * WHAT IS READ. Every tracked file a reader can meet:
 *   - the string literals and JSX text of `apps/<app>/src` and
 *     `packages/<package>/src` (comments are not shipped words and are
 *     skipped; tests are skipped too, since a test may quote a refused word);
 *   - every locale bundle (`packages/i18n/locales/**.json`), whole;
 *   - the docs site's pages and the skills, whole (Markdown and MDX).
 *
 * Both apostrophes count (' and ’). In the locale bundles, the docs and the
 * skills a mark joined into a compound is refused too ("Stripe-Konto",
 * "Stripe-siden"): it is the mark modified, and the other languages write
 * "Konto bei Stripe", "siden hos Stripe". Code is not read for compounds, since
 * a provider's own header names are written that way.
 *
 * A fix is a rewording, never an exemption.
 *
 *   node scripts/check-mark-possessives.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
// TypeScript's own scanner tells a string from a comment; the server's copy is always installed.
const require = createRequire(join(root, 'apps/server/package.json'));
const ts = require('typescript');

/** The marks this gate guards. */
const MARKS = ['Stripe', 'PayPal'];
const POSSESSIVE = new RegExp(`\\b(${MARKS.join('|')})['’]s\\b`, 'g');
const COMPOUND = new RegExp(`\\b(?:${MARKS.join('|')})-\\p{L}+|\\p{L}+-(?:${MARKS.join('|')})\\b`, 'gu');

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

const CODE = /^(apps|packages)\/[^/]+\/src\/.*\.(ts|tsx|js|mjs)$/;
const TEST = /(\.test\.|\.spec\.|\/test\/|\/tests\/|\/__tests__\/|\.stories\.)/;
const WHOLE = [/^packages\/i18n\/locales\/.*\.json$/, /^apps\/docs\/.*\.(md|mdx)$/, /^skills\/.*\.md$/];

const problems = [];

function note(file, text, offset, found) {
  const line = text.slice(0, offset).split('\n').length;
  problems.push(`${file}:${String(line)}  "${found}"`);
}

function scanWhole(file, text) {
  for (const match of text.matchAll(POSSESSIVE)) note(file, text, match.index, match[0]);
  for (const match of text.matchAll(COMPOUND)) note(file, text, match.index, match[0]);
}

const STRING_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

function scanCode(file, text) {
  const jsx = file.endsWith('.tsx');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (STRING_KINDS.has(node.kind)) {
      const raw = node.getText(source);
      for (const match of raw.matchAll(POSSESSIVE)) note(file, text, node.getStart(source) + match.index, match[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const file of files) {
  if (WHOLE.some((pattern) => pattern.test(file))) {
    scanWhole(file, readFileSync(join(root, file), 'utf8'));
  } else if (CODE.test(file) && !TEST.test(file)) {
    scanCode(file, readFileSync(join(root, file), 'utf8'));
  }
}

if (problems.length > 0) {
  console.error(`check-mark-possessives: ${String(problems.length)} shipped string(s) write a provider's mark in the possessive or joined into a compound.`);
  console.error('Reword them ("the Stripe page", "the PayPal dashboard", "Stripe payment id"; "die Seite von Stripe", "siden hos Stripe"):');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('check-mark-possessives: no provider mark in the possessive in any shipped string.');
