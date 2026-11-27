// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ENTRY THAT ADDS ROWS AND NAMES NOTHING A BROWSER MAY SET, said by the
 * folder check. Found on a trial: the Designer wrote
 * `{ table: order_requests, methods: [POST], select: [id] }` for a customer
 * screen whose order form sends six columns. The check passed, the app was
 * applied, and the mistake surfaced when a person opened the app's page to
 * allow its public access: the endpoint could not be made ("declares "create"
 * but lists no writable columns") and the Allow button stayed off. The check
 * is where the Designer reads it and puts it right, so it is said there, as
 * an error (the level that stops an apply), against the file it is written in.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
const file = (name: string) => join(root, 'apps/shop/manifest', name);
const put = (name: string, value: unknown) => writeFileSync(file(name), `${JSON.stringify(value, null, 2)}\n`);
const errors = () =>
  checkApp(root, 'shop', { version: APP_VERSION })
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => `${finding.file} · ${finding.path} · ${finding.message}`);

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 200) => ({ ref, type: 'text', maxLength, nullable: true });
/** What the customer screen's order form sends. */
const SENT = ['product_id', 'quantity', 'name', 'email', 'address', 'message'];
const ORDER_REQUESTS = {
  ref: 'order_requests',
  label: { 'en-US': 'Order request' },
  labelPlural: { 'en-US': 'Order requests' },
  keyField: 'id',
  columns: [pk, { ref: 'product_id', type: 'fk', references: 'items', nullable: true }, { ref: 'quantity', type: 'int', nullable: true }, text('name'), text('email'), text('address'), text('message', 1000)],
};
/** The entry as the Designer wrote it on the trial. */
const AS_WRITTEN = { table: 'order_requests', methods: ['POST'], select: ['id'] };

beforeEach(async () => {
  root = tempProject('adminium-check-add-writable-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'shop'], { io, deps }), io.stderr()).toBe(0);
  put('tables/order_requests.json', ORDER_REQUESTS);
  expect(errors()).toEqual([]);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the folder check, of an entry that adds rows and names nothing a browser may set', () => {
  it('refuses the entry the Designer wrote on the trial, at access.json, in words that say what to do', () => {
    put('access.json', { publicAccess: [AS_WRITTEN] });
    expect(errors()).toEqual([
      "apps/shop/manifest/access.json · publicAccess.0.writable · this entry adds rows, so list the columns a browser may set in writable: with no list it may set the columns the entry shows (select), and none of those is a browser's to set",
    ]);
    // An error is what stops an apply: the check hands back no manifest.
    expect(checkApp(root, 'shop', { version: APP_VERSION }).manifest).toBeNull();
  });

  it('passes once the entry lists what the form sends', () => {
    put('access.json', { publicAccess: [{ ...AS_WRITTEN, writable: SENT }] });
    expect(errors()).toEqual([]);
    expect(checkApp(root, 'shop', { version: APP_VERSION }).access).toContain(`order_requests: add a row (${SENT.join(', ')})`);
  });

  it('says it of a list left empty too', () => {
    put('access.json', { publicAccess: [{ ...AS_WRITTEN, writable: [] }] });
    expect(errors()).toEqual(['apps/shop/manifest/access.json · publicAccess.0.writable · this entry adds rows, so list the columns a browser may set in writable']);
  });

  it('leaves alone an entry that shows a column a browser may set: the endpoint takes it as what the entry writes', () => {
    // No `writable`, and `select` shows `message`: the endpoint works out [message], and is made.
    put('access.json', { publicAccess: [{ table: 'order_requests', methods: ['POST'], select: ['id', 'message'] }] });
    expect(errors()).toEqual([]);
  });
});
