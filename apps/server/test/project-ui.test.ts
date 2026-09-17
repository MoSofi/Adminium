// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/adminium/ui` (`src/ui/index.ts`): the define helpers, and the
 * kit it hands out from the host runtime, or refuses outside a dashboard.
 */
import { PROJECT_UI_EXPORTS, clearAddOnRuntime, installAddOnRuntime } from '@adminium/add-on-contracts/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  clearAddOnRuntime();
});

const load = async (): Promise<Record<string, unknown>> => (await import('../src/ui/index.js')) as Record<string, unknown>;

describe('the UI kit module', () => {
  it('returns page and widget definitions as they are', async () => {
    const ui = await load();
    const page = { title: 'Revenue', component: () => null };
    const widget = { kind: 'cell', component: () => null };
    expect((ui['definePage'] as (value: unknown) => unknown)(page)).toBe(page);
    expect((ui['defineWidget'] as (value: unknown) => unknown)(widget)).toBe(widget);
  });

  it('exports exactly the kit names, and the helpers', async () => {
    const ui = await load();
    expect(Object.keys(ui).sort()).toEqual([...PROJECT_UI_EXPORTS, 'defineWidget', 'definePage'].sort());
  });

  it('says who provides the kit when it is used outside a dashboard', async () => {
    const ui = await load();
    expect(() => (ui['Card'] as () => unknown)()).toThrow(
      'Card from @adminiumjs/adminium/ui is provided by the Adminium dashboard, and this code is running outside it.',
    );
    expect(() => (ui['useRecords'] as () => unknown)()).toThrow(/useRecords from @adminiumjs\/adminium\/ui/);
  });

  it("hands out the host's kit when one is installed first", async () => {
    const kit = Object.fromEntries(PROJECT_UI_EXPORTS.map((name) => [name, { name }]));
    installAddOnRuntime({ react: {}, jsx: { jsx: null, jsxs: null, Fragment: null }, ui: kit });
    const ui = await load();
    for (const name of PROJECT_UI_EXPORTS) expect(ui[name]).toBe(kit[name]);
  });

  it('falls back per name for a host whose kit lacks one', async () => {
    installAddOnRuntime({ react: {}, jsx: { jsx: null, jsxs: null, Fragment: null }, ui: { Card: 'card' } });
    const ui = await load();
    expect(ui['Card']).toBe('card');
    expect(() => (ui['Stat'] as () => unknown)()).toThrow(/Stat from @adminiumjs\/adminium\/ui/);
  });
});
