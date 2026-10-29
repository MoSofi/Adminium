// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `canExportSomewhere` (V28): the rail offered "Data exports" to a helper whose
 * role could export nothing.
 */
import { describe, expect, it } from 'vitest';

import { canExportSomewhere } from '../src/routes/bootstrap/handlers.js';

const live = new Set(['conn_a']);
const set = (grants: string[], superAdmin = false) => ({ superAdmin, grants: new Set(grants) });

describe('canExportSomewhere', () => {
  it('is false for a role that can read and edit but not export', () => {
    expect(canExportSomewhere(set(['table:conn_a:*:read', 'table:conn_a:*:update']), live)).toBe(false);
  });

  it('is true for an export grant, or every action, on a live connection', () => {
    expect(canExportSomewhere(set(['table:conn_a:public.orders:export']), live)).toBe(true);
    expect(canExportSomewhere(set(['table:*:*:export']), live)).toBe(true);
    expect(canExportSomewhere(set(['table:conn_a:*:*']), live)).toBe(true);
  });

  it('is false when the only export grant is on a paused connection', () => {
    expect(canExportSomewhere(set(['table:conn_paused:*:export']), live)).toBe(false);
  });

  it('is true for a super admin and for whoever manages everyone’s exports', () => {
    expect(canExportSomewhere(set([], true), live)).toBe(true);
    expect(canExportSomewhere(set(['system:exports:manage']), new Set())).toBe(true);
  });
});
