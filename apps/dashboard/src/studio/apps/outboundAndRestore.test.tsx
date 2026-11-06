// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule step that sends out with words of the file's own, as the install
 * review and the app page say it; and an uninstall that would put the server's
 * look back, which only someone who may change the server's settings runs.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { afterInstallRows, afterInstallText } from './OwnAppCards.js';
import { UninstallAppDialog } from './UninstallAppDialog.js';
import type { AfterInstallEntry, UninstallPlan } from './appsApi.js';
import { afterInstallLines, outsideRules } from './installReview.js';

beforeEach(async () => {
  await installTestI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a step that sends out with words of the file’s own', () => {
  const items = [
    { kind: 'webhook' as const, item: 'post-orders', field: 'w.url' },
    { kind: 'outbound' as const, item: 'post-orders', field: 'm' },
    { kind: 'outbound' as const, item: 'thank-buyers', field: 'x' },
  ];

  it('is one of the rules that send data out, said by how', () => {
    expect(outsideRules(items)).toEqual([
      { item: 'post-orders', webhook: true, address: false, outbound: true },
      { item: 'thank-buyers', webhook: false, address: false, outbound: true },
    ]);
    const lines = afterInstallLines(items);
    render(<ul>{lines.map((line) => <li key={line.key}>{line.words}</li>)}</ul>);
    expect(screen.getByText((_, element) => element?.tagName === 'LI' && element.textContent === 'What the rule thank-buyers sends out')).toBeTruthy();
  });

  it('is a row of the app page’s list', () => {
    const entry: AfterInstallEntry = { id: '1', kind: 'outbound', item: 'thank-buyers', field: 'x', name: 'Thank buyers', done: false, doneBy: null, doneAt: null, seen: false, right: 'system:automations:manage', canTick: true, link: { to: 'automation', id: 'a1' } };
    expect(afterInstallRows([entry]).map((row) => afterInstallText(row))).toEqual(["Check what 'Thank buyers' sends out, then switch it on"]);
  });
});

describe('uninstalling an app that changed the server’s look', () => {
  function stub(instance: UninstallPlan['instance']): void {
    const plan: UninstallPlan = { key: 'fern', pages: { removed: [], kept: [] }, keys: 0, endpoints: 0, roles: [], tables: [], hosts: [], canDropTables: false, ...(instance === undefined ? {} : { instance }) };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        if (url.endsWith('/api/v1/apps/fern/uninstall-plan')) return Promise.resolve(jsonResponse(200, plan));
        return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
      }),
    );
  }
  const open = () =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <UninstallAppDialog appKey="fern" name="Fern notes" onClose={() => {}} onUninstalled={() => {}} />
      </QueryClientProvider>,
    );

  it('says the look is put back, for someone who may change the settings', async () => {
    stub({ values: 3, canRestore: true });
    open();
    await screen.findByText('The look and languages it applied, put back as they were');
    expect(screen.getByRole('button', { name: 'Uninstall' }).hasAttribute('disabled')).toBe(false);
  });

  it('asks for someone who may, and offers no uninstall, to anybody else', async () => {
    stub({ values: 3, canRestore: false });
    open();
    await screen.findByText(/Putting them back needs the permission to change the server’s settings/);
    expect(screen.getByRole('button', { name: 'Uninstall' }).hasAttribute('disabled')).toBe(true);
  });
});
