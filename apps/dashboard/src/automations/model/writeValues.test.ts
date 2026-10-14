// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A value an app's rule writes from its settings row, or so many days on, as
 * the step's editor and the canvas say it: never as "Now".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { FlowNode } from './graph.js';
import { subLineFor, writeValueText } from './summaries.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());

describe('a value from the settings row, or so many days on', () => {
  it('is said as what it is', () => {
    expect(writeValueText('Call {{record.name}}')).toBe('Call {{record.name}}');
    expect(writeValueText({ now: true })).toBe('Now');
    expect(writeValueText({ setting: { table: 'main.settings', column: 'aftercare_owner_id' } })).toBe('From settings: aftercare_owner_id');
    expect(writeValueText({ daysAfter: { column: 'signed_at', days: 28 } })).toBe('28 days after signed_at');
    expect(writeValueText({ daysAfter: { now: true, days: 1 } })).toBe('1 day after Now');
    expect(writeValueText({ daysAfter: { column: 'signed_at', days: 28, setting: { table: 'main.settings', column: 'aftercare_days' } } })).toBe('From settings: aftercare_days (28 days) after signed_at');
  });

  it('is said so under an update step', () => {
    const node = { id: 'u', kind: 'action', title: 'Due', action: { kind: 'record.update', values: { due_on: { daysAfter: { column: 'signed_on', days: 7 } }, owner_id: { setting: { table: 'main.settings', column: 'owner_id' } } } } } as unknown as FlowNode;
    expect(subLineFor(node, null)).toBe('due_on = 7 days after signed_on, owner_id = From settings: owner_id');
  });
});
