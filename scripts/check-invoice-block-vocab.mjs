#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Invoice block vocabulary gate — the editor's canvas and every renderer of
 * the authored body must agree on the 27 kinds (34-invoices-add-on.md 34-T50,
 * §3.9 "Two vocabularies, three trees, one gate").
 *
 * The canvas (`apps/dashboard/src/invoices/model/blocks.ts`) derives its list
 * from the block order and the four custom types. The renderer that turns an
 * authored body into bytes lives in ANOTHER REPOSITORY (the `invoices` add-on,
 * 34e), which the email gate's shape (`check-email-block-vocab.mjs`) never had
 * to face: all three of its trees sit in this repo. So the vocabulary crosses
 * the boundary as DATA — `block-vocabulary.json` beside the model — and every
 * copy is held equal to it here: the dashboard's derived list now, and the
 * add-on's vendored copy whenever that checkout sits beside this one.
 *
 * WHAT IT REFUSES TO DO: pass by silence. When a copy that should exist is
 * absent it says so on stdout; the add-on's copy is optional only because the
 * package has not been created yet (34e) — the day it ships, drop the
 * `optional` flag on its row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DATA = 'apps/dashboard/src/invoices/model/block-vocabulary.json';
const MODEL = 'apps/dashboard/src/invoices/model/blocks.ts';
const ENVELOPE = 'apps/dashboard/src/invoices/model/envelope.ts';

/** Every quoted entry of the first `[...]` after `export const <name>`. */
function readList(relPath, constName, pattern = /'([^']+)'/g) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8');
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) throw new Error(`${relPath}: could not find "export const ${constName}"`);
  const open = source.indexOf('= [', start) + 2;
  const close = source.indexOf(']', open);
  if (open === 1 || close === -1) throw new Error(`${relPath}: ${constName} has no array literal`);
  return [...source.slice(open, close).matchAll(pattern)].map((match) => match[1]);
}

const data = JSON.parse(fs.readFileSync(path.join(root, DATA), 'utf8'));
const truth = [...data.kinds].sort();

// The dashboard's list is DERIVED: the 23 built-in keys of DEFAULT_BLOCK_ORDER + the four custom types.
const builtins = readList(ENVELOPE, 'DEFAULT_BLOCK_ORDER');
const customTypes = readList(MODEL, 'CUSTOM_TYPES', /type: '([^']+)'/g);
const dashboard = [...builtins, ...customTypes.map((type) => `custom.${type}`)].sort();

const copies = [
  // The add-on renderer (34e) vendors the same file; sibling checkout, optional until it exists.
  { label: 'add-on renderer', file: path.resolve(root, '..', 'add-ons', 'packages', 'invoices', 'src', 'block-vocabulary.json'), optional: true },
];

const problems = [];
const notes = [];

function same(a, b) {
  return a.length === b.length && a.every((kind, index) => kind === b[index]);
}
function differ(label, a, b) {
  const onlyA = a.filter((kind) => !b.includes(kind));
  const onlyB = b.filter((kind) => !a.includes(kind));
  return `${label}\n  data: ${JSON.stringify(truth)}\n  ${label}: ${JSON.stringify(b)}` + (onlyA.length ? `\n  only the data knows: ${onlyA.join(', ')}` : '') + (onlyB.length ? `\n  only ${label} knows: ${onlyB.join(', ')}` : '');
}

if (truth.length !== 27) problems.push(`${DATA}: expected 27 kinds, found ${String(truth.length)}`);
if (!same(truth, dashboard)) problems.push(differ('the dashboard canvas (model/blocks.ts + envelope.ts)', truth, dashboard));

// Every built-in key must be gated (or declared permanent) in BLOCK_GATE — a kind the gate does not know never renders.
const modelSource = fs.readFileSync(path.join(root, MODEL), 'utf8');
for (const kind of builtins) {
  if (!new RegExp(`^\\s+${kind}: (null|'[a-zA-Z]+Show'),`, 'm').test(modelSource)) {
    problems.push(`${MODEL}: "${kind}" is in DEFAULT_BLOCK_ORDER but BLOCK_GATE has no entry for it`);
  }
}

let present = 1;
for (const copy of copies) {
  if (!fs.existsSync(copy.file)) {
    (copy.optional ? notes : problems).push(`${copy.label}: no copy at ${copy.file}${copy.optional ? ' (not created yet — 34e)' : ''}`);
    continue;
  }
  present += 1;
  const theirs = [...JSON.parse(fs.readFileSync(copy.file, 'utf8')).kinds].sort();
  if (!same(truth, theirs)) problems.push(differ(copy.label, truth, theirs));
}

if (problems.length > 0) {
  console.error('Invoice block vocabulary gate FAILED:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error(`Every list is the wire format of adminium_invoice_documents.body.blockOrder. Change ${DATA} and the copies together.`);
  process.exit(1);
}

console.log(`Invoice block vocabulary OK - ${String(truth.length)} kinds; ${String(present)} of ${String(1 + copies.length)} copies present and equal.`);
for (const note of notes) console.log(`  note: ${note}`);
