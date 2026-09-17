// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Project paths are keys: always `/`, whatever the operating system, and only
 * `pages/*.json` and `schema/*.json` count.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fromProjectPath, pagePath, parseProjectPath, schemaPath, toProjectPath } from '../src/project/paths.js';

describe('project paths', () => {
  it('name pages by address and schema files by database key', () => {
    expect(pagePath('order-items')).toBe('pages/order-items.json');
    expect(schemaPath('billing')).toBe('schema/billing.json');
    expect(parseProjectPath('pages/order-items.json')).toEqual({ kind: 'page', slug: 'order-items', valid: true });
    expect(parseProjectPath('schema/billing-db.json')).toEqual({ kind: 'schema', key: 'billing-db', valid: true });
  });

  it('keep a badly named JSON file so check can say what is wrong, and ignore the rest', () => {
    expect(parseProjectPath('pages/Order Items.json')).toEqual({ kind: 'page', slug: 'Order Items', valid: false });
    expect(parseProjectPath(`pages/${'a'.repeat(32)}.json`)).toMatchObject({ valid: false });
    expect(parseProjectPath('schema/1st.json')).toMatchObject({ kind: 'schema', valid: false });
    for (const ignored of ['pages/README.md', 'pages/revenue.tsx', 'pages/_nav.json', 'pages/.gitkeep', 'pages/sub/x.json', 'other/x.json', 'pages/x.json.bak']) {
      expect(parseProjectPath(ignored), ignored).toBeNull();
    }
  });

  it('turn Windows paths into keys and back', () => {
    const root = 'C:\\Users\\dev\\my-admin';
    expect(toProjectPath(root, 'C:\\Users\\dev\\my-admin\\pages\\orders.json', path.win32)).toBe('pages/orders.json');
    expect(fromProjectPath(root, 'schema/main.json', path.win32)).toBe('C:\\Users\\dev\\my-admin\\schema\\main.json');
    expect(toProjectPath('/srv/app', '/srv/app/pages/orders.json', path.posix)).toBe('pages/orders.json');
  });
});
