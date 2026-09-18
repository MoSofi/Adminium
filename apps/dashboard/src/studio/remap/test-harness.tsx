// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared harness for the remap editor component tests: a routing fetch stub
 * over the four endpoints the editor talks to, plus a QueryClient render
 * wrapper. Not a test file — imported by *.test.tsx siblings.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { ShellHarness } from '../../test/shellHarness.js';
import { RemapEditor } from './RemapEditor.js';
import { makeGenerateReply, makeSchemaReply } from './fixtures.js';
import type { GenerateReply, SchemaReply } from './model.js';
import type { OverrideDto } from './overrides.js';

export interface HarnessOptions {
  schema?: (() => SchemaReply) | undefined;
  overridesRows?: (() => OverrideDto[]) | undefined;
  /** Return a Response to override the default 200 echo. */
  onPut?: ((body: unknown) => Response | undefined) | undefined;
  generate?: (() => GenerateReply) | undefined;
  /** Design mode's three POSTs. Each gets the request body. */
  onPlan?: ((body: unknown) => Response) | undefined;
  onApply?: ((body: unknown) => Response) | undefined;
  onAdopt?: ((body: unknown) => Response) | undefined;
  /**
   * The workspace's option lists, which the Rules section's list picker reads
   * (plan 50 phase F). Absent ⇒ an empty workspace, which is what every suite
   * that predates F gets: the picker offers nothing and nothing else changes.
   */
  optionLists?: (() => { key: string; name: string; items: { value: string }[]; origin: string; editable: boolean }[]) | undefined;
}

export interface Harness {
  putBodies: unknown[];
  generateCalls: number;
  /** Bodies sent to `/schema/plan`, `/schema/apply` and `/schema/adopt`. */
  planBodies: unknown[];
  applyBodies: unknown[];
  adoptBodies: unknown[];
  fetchMock: ReturnType<typeof vi.fn>;
}

export function installFetch(options: HarnessOptions = {}): Harness {
  const harness: Harness = {
    putBodies: [],
    generateCalls: 0,
    planBodies: [],
    applyBodies: [],
    adoptBodies: [],
    fetchMock: vi.fn(),
  };
  harness.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.endsWith('/schema')) {
      return Promise.resolve(jsonResponse(200, options.schema?.() ?? makeSchemaReply()));
    }
    if (method === 'GET' && url.endsWith('/option-lists')) {
      return Promise.resolve(jsonResponse(200, { lists: options.optionLists?.() ?? [] }));
    }
    if (method === 'GET' && url.endsWith('/overrides')) {
      return Promise.resolve(jsonResponse(200, { overrides: options.overridesRows?.() ?? [] }));
    }
    if (method === 'PUT' && url.endsWith('/overrides')) {
      const body: unknown = JSON.parse(String(init?.body));
      harness.putBodies.push(body);
      const custom = options.onPut?.(body);
      if (custom !== undefined) return Promise.resolve(custom);
      const items = (body as { overrides: Array<Record<string, unknown>> }).overrides;
      return Promise.resolve(
        jsonResponse(200, {
          overrides: items.map((item, index) => ({
            id: `ovr_${index}`,
            op: item.op,
            tableName: item.tableName,
            columnName: item.columnName ?? null,
            value: item.value,
            origin: 'user',
            status: item.status ?? 'active',
            createdAt: 1,
            updatedAt: 1,
          })),
        }),
      );
    }
    if (method === 'POST' && url.endsWith('/schema/plan')) {
      const body: unknown = JSON.parse(String(init?.body));
      harness.planBodies.push(body);
      if (options.onPlan === undefined) throw new Error('no onPlan handler installed');
      return Promise.resolve(options.onPlan(body));
    }
    if (method === 'POST' && url.endsWith('/schema/apply')) {
      const body: unknown = JSON.parse(String(init?.body));
      harness.applyBodies.push(body);
      if (options.onApply === undefined) throw new Error('no onApply handler installed');
      return Promise.resolve(options.onApply(body));
    }
    if (method === 'POST' && url.endsWith('/schema/adopt')) {
      const body: unknown = JSON.parse(String(init?.body));
      harness.adoptBodies.push(body);
      if (options.onAdopt === undefined) throw new Error('no onAdopt handler installed');
      return Promise.resolve(options.onAdopt(body));
    }
    if (method === 'POST' && url.endsWith('/generate')) {
      harness.generateCalls += 1;
      return Promise.resolve(jsonResponse(200, options.generate?.() ?? makeGenerateReply()));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
  });
  vi.stubGlobal('fetch', harness.fetchMock);
  return harness;
}

export function renderEditor(): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // `ShellHarness`, because the editor's heading and its "N tables · N
  // overrides applied" line are published to the TOPBAR rather than drawn in
  // the body — a bare render has no topbar, so neither one would exist.
  return render(
    <QueryClientProvider client={queryClient}>
      <ShellHarness>
        <RemapEditor connectionId="conn_1" />
      </ShellHarness>
    </QueryClientProvider>,
  );
}
