#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email block vocabulary gate - the mail renderer and the canvas must agree.
 *
 * `adminium_email_templates.blocks` stores an ordered array of
 * `{ block: 'email.heading' | 'email.text' | ... }` records. TWO independent
 * pieces of code read that vocabulary:
 *
 *   - `apps/server/src/email/render.ts`  turns the blocks into MIME
 *   - `packages/widgets/.../block-lib.ts`  renders them in the editor canvas
 *
 * and when the two lists disagree the failure is silent in BOTH directions: a
 * kind the canvas doesn't know is dropped into `unknown` and the template opens
 * as a blank page, while a kind the renderer doesn't know is skipped by
 * `renderEmail` and simply never appears in the sent mail. Neither path throws,
 * neither was covered by a fixture-fed test, and that is exactly how the two
 * vocabularies came to be disjoint - 22 `block-*` ids on one side and six
 * `email.*` kinds on the other, intersection empty, CI green throughout.
 *
 * --- WHY A SCRIPT AND NOT A SHARED IMPORT ---------------------------------
 *
 * Because the import does not exist and must not be created. `apps/server` may
 * not import `@adminium/widgets` and `@adminium/widgets` may not import the
 * server (01 2.3, enforced by `.dependency-cruiser.cjs`
 * `server-no-ui-widgets-charts` / `widgets-no-meta-adapters-server`), and there
 * is no runtime workspace package that both already depend on:
 * `@adminium/config` is an ESLint plugin, and `@adminium/i18n` - the only other
 * shared dependency - is not a vocabulary registry. The established answer in
 * this repo for exactly this shape is to move the value across the boundary as
 * DATA and gate the copies: `compose.ts` already injects the
 * `LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` allow-lists into the server
 * rather than importing them ("the server tree may not import
 * `@adminium/widgets`"). This is the same trade, made checkable.
 *
 * Parsing is a literal scan rather than an import because the widgets file is
 * TSX-adjacent ESM that pulls in React-land transitively, and this gate has to
 * run in plain node with no build step - the same reasoning as `check-spdx`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read the string literals of an `export const <name> = [ ... ] as const;` block. */
function readVocabulary(relPath, constName) {
  const file = path.join(root, relPath);
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf(`export const ${constName} = [`);
  if (start === -1) {
    throw new Error(`${relPath}: could not find "export const ${constName} = ["`);
  }
  const end = source.indexOf(']', start);
  if (end === -1) throw new Error(`${relPath}: ${constName} has no closing "]"`);
  const body = source.slice(start, end);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const SERVER = 'apps/server/src/email/render.ts';
const WIDGETS = 'packages/widgets/src/families/domain/block-lib.ts';
const CANVAS = 'packages/widgets/src/families/domain/DocumentCanvas.tsx';

const server = readVocabulary(SERVER, 'EMAIL_BLOCK_KINDS');
const widgets = readVocabulary(WIDGETS, 'EMAIL_BLOCK_KINDS');

const problems = [];

if (server.length === 0) problems.push(`${SERVER}: EMAIL_BLOCK_KINDS is empty`);

// ORDER MATTERS, not just membership: the canvas palette and the doc-type
// default composition are built from this order, so a silent reshuffle changes
// which blocks a new template starts with.
if (server.join(' ') !== widgets.join(' ')) {
  const onlyServer = server.filter((kind) => !widgets.includes(kind));
  const onlyWidgets = widgets.filter((kind) => !server.includes(kind));
  problems.push(
    'EMAIL_BLOCK_KINDS differ between the mail renderer and the canvas.\n' +
      `  ${SERVER}\n    ${JSON.stringify(server)}\n` +
      `  ${WIDGETS}\n    ${JSON.stringify(widgets)}` +
      (onlyServer.length > 0 ? `\n  only the renderer knows: ${onlyServer.join(', ')}` : '') +
      (onlyWidgets.length > 0 ? `\n  only the canvas knows:   ${onlyWidgets.join(', ')}` : ''),
  );
}

const renderSource = fs.readFileSync(path.join(root, SERVER), 'utf8');
const canvasSource = fs.readFileSync(path.join(root, CANVAS), 'utf8');
const widgetsSource = fs.readFileSync(path.join(root, WIDGETS), 'utf8');

/*
  DECLARING the kinds is not the same as ACCEPTING them, and the difference is
  the whole bug. `isBlockId` gates whether a stored block is recognised at all,
  and it tests membership of `BLOCK_IDS` — so dropping the spread below leaves
  `EMAIL_BLOCK_KINDS` sitting there, perfectly in sync with the renderer, while
  every seeded template once again loads as an empty page. An earlier draft of
  this gate compared only the two lists and passed happily in exactly that
  state.
*/
if (!/export const BLOCK_IDS = \[[^\]]*\.\.\.EMAIL_BLOCK_KINDS/.test(widgetsSource)) {
  problems.push(
    `${WIDGETS}: BLOCK_IDS must spread ...EMAIL_BLOCK_KINDS — without it isBlockId() rejects ` +
      'every stored email block and the canvas renders nothing.',
  );
}

// Every kind must actually reach a renderer on both sides: a kind that is
// listed but never dispatched is the same silent drop this gate exists to stop.
for (const kind of server) {
  if (!renderSource.includes(`case '${kind}':`)) {
    problems.push(`${SERVER}: "${kind}" is in EMAIL_BLOCK_KINDS but renderBlock has no case for it`);
  }
  if (!canvasSource.includes(`'${kind}': blockRenderer(`)) {
    problems.push(`${CANVAS}: "${kind}" is in EMAIL_BLOCK_KINDS but BLOCK_COMPONENTS has no entry for it`);
  }
}

if (problems.length > 0) {
  console.error('Email block vocabulary gate FAILED:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error('Both lists are the wire format of adminium_email_templates.blocks. Change them together.');
  process.exit(1);
}

console.log(`Email block vocabulary OK - ${String(server.length)} kinds, renderer and canvas agree.`);
