#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pages the assistant can be opened from are listed three times, by hand:
 *
 *   packages/meta/src/schema/json-payloads.ts    assistantContextSchema  (what a session row may hold)
 *   packages/llm/src/assistant/turn-schema.ts    ASSISTANT_CONTEXTS      (what a reply may be for)
 *   apps/dashboard/src/assistant/api.ts          AssistantContext        (what the dashboard may ask for)
 *
 * Three copies on purpose: the two packages and the dashboard may not import
 * one another. A page added to two of them compiles, and then a session for
 * it is refused by the third at run time. This reads the three lists out of
 * the source and fails when they differ.
 *
 * A script and not a test: a test that reads another package's source is
 * replayed from the build cache when only that other package changed.
 *
 *   node scripts/check-assistant-contexts.mjs              check the tree
 *   node scripts/check-assistant-contexts.mjs --self-test  prove the reader sees a difference
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each copy: where it is, and the expression its list of quoted keys follows. */
export const COPIES = [
  { file: 'packages/meta/src/schema/json-payloads.ts', after: /export const assistantContextSchema = z\.enum\(\[/, until: ']' },
  { file: 'packages/llm/src/assistant/turn-schema.ts', after: /export const ASSISTANT_CONTEXTS = \[/, until: ']' },
  { file: 'apps/dashboard/src/assistant/api.ts', after: /export type AssistantContext =/, until: ';' },
];

/** The quoted keys of one copy, in source order. Throws when the copy cannot be found. */
export function readList(source, copy) {
  const start = copy.after.exec(source);
  if (start === null) throw new Error(`${copy.file}: the context list was not found (looked for ${String(copy.after)})`);
  const from = start.index + start[0].length;
  const to = source.indexOf(copy.until, from);
  if (to === -1) throw new Error(`${copy.file}: the context list does not end`);
  const keys = [...source.slice(from, to).matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (keys.length === 0) throw new Error(`${copy.file}: the context list is empty`);
  return keys;
}

/** What differs between the lists: one line per copy that lacks a key another has. Empty when they agree. */
export function differences(lists) {
  const all = new Set(lists.flatMap((entry) => entry.keys));
  const out = [];
  for (const entry of lists) {
    const missing = [...all].filter((key) => !entry.keys.includes(key));
    if (missing.length > 0) out.push(`${entry.file} lacks ${missing.map((key) => `'${key}'`).join(', ')}`);
    const repeated = entry.keys.filter((key, index) => entry.keys.indexOf(key) !== index);
    if (repeated.length > 0) out.push(`${entry.file} names ${repeated.map((key) => `'${key}'`).join(', ')} twice`);
  }
  return out;
}

function selfTest() {
  const meta = "export const assistantContextSchema = z.enum(['email', 'report', 'data']);";
  const llm = "export const ASSISTANT_CONTEXTS = ['email', 'report', 'data'] as const;";
  const dashboard = "export type AssistantContext = 'email' | 'report';";
  const read = (sources) => COPIES.map((copy, index) => ({ file: copy.file, keys: readList(sources[index], copy) }));
  const agree = differences(read([meta, llm, "export type AssistantContext = 'email' | 'report' | 'data';"]));
  if (agree.length !== 0) throw new Error(`self-test: three equal lists were reported as different: ${agree.join('; ')}`);
  const differ = differences(read([meta, llm, dashboard]));
  if (differ.length !== 1 || !differ[0].includes("apps/dashboard/src/assistant/api.ts lacks 'data'")) {
    throw new Error(`self-test: a list that lacks a key was not reported: ${JSON.stringify(differ)}`);
  }
  let threw = false;
  try {
    readList('nothing here', COPIES[0]);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('self-test: a copy that is gone was not reported');
  console.log('assistant contexts: the self-test passed.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const lists = COPIES.map((copy) => ({ file: copy.file, keys: readList(readFileSync(join(root, copy.file), 'utf8'), copy) }));
  const found = differences(lists);
  if (found.length > 0) {
    console.error('The assistant\'s pages are not the same in the three places that list them:');
    for (const line of found) console.error(`  ${line}`);
    console.error('Add the page to each list (see the header of scripts/check-assistant-contexts.mjs).');
    process.exit(1);
  }
  console.log(`assistant contexts ok: ${lists[0].keys.join(', ')} (in ${String(lists.length)} places).`);
}
