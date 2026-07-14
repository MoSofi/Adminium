/**
 * Shared harness for the remap editor component tests: a routing fetch stub
 * over the four endpoints the editor talks to, plus a QueryClient render
 * wrapper. Not a test file — imported by *.test.tsx siblings.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
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
}

export interface Harness {
  putBodies: unknown[];
  generateCalls: number;
  fetchMock: ReturnType<typeof vi.fn>;
}

export function installFetch(options: HarnessOptions = {}): Harness {
  const harness: Harness = { putBodies: [], generateCalls: 0, fetchMock: vi.fn() };
  harness.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.endsWith('/schema')) {
      return Promise.resolve(jsonResponse(200, options.schema?.() ?? makeSchemaReply()));
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
  return render(
    <QueryClientProvider client={queryClient}>
      <RemapEditor connectionId="conn_1" />
    </QueryClientProvider>,
  );
}
