// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A step to the people listed on the record, as the canvas says it under the
 * step and as the editor judges it finished: the listing by its label, and
 * unfinished until a listing is picked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { SourceTable } from '../api.js';
import type { FlowNode } from './graph.js';
import { subLineFor } from './summaries.js';
import { isActionComplete } from './validate.js';

const DEALS: SourceTable = {
  id: 'main.deals',
  label: 'Deals',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: null, updated: null },
  columns: [],
  children: [],
  pageSlug: null,
  listings: [{ table: 'main.deal_members', label: 'People on deals' }],
};

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());

describe('a step to the people listed on the record', () => {
  it('says the listing by its label under a notice and a mail', () => {
    const notice = { id: 'n', kind: 'action', title: 'Tell', action: { kind: 'notification', to: { listed: 'main.deal_members' }, title: 'Hi', body: null } } as unknown as FlowNode;
    expect(subLineFor(notice, DEALS)).toBe('To · the people listed in People on deals');
    const mail = { id: 'm', kind: 'action', title: 'Mail', action: { kind: 'email', templateKey: 'news', to: { kind: 'listed', table: 'main.deal_members' }, vars: {} } } as unknown as FlowNode;
    expect(subLineFor(mail, DEALS)).toBe('Template · news → the people listed in People on deals');
  });

  it('is unfinished until a listing is picked', () => {
    expect(isActionComplete({ kind: 'notification', to: { listed: '' }, title: 'Hi', body: null })).toBe(false);
    expect(isActionComplete({ kind: 'notification', to: { listed: 'main.deal_members' }, title: 'Hi', body: null })).toBe(true);
    expect(isActionComplete({ kind: 'email', templateKey: 'news', to: { kind: 'listed', table: '' }, vars: {} } as never)).toBe(false);
    expect(isActionComplete({ kind: 'email', templateKey: 'news', to: { kind: 'listed', table: 'main.deal_members' }, vars: {} } as never)).toBe(true);
  });
});
