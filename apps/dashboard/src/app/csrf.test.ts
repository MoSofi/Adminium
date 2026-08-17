// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The client half of §7 item 4 (08-server-api.md): the CSRF token
 * `GET /bootstrap` issues has to reach EVERY mutating request, and this app
 * has five mutating fetch call sites of which four bypass `app/api.ts`
 * entirely. Patching only the shared client would ship a dashboard that 403s
 * on schema-override saves, logo uploads, CSV imports and one delete path —
 * so each of the five is pinned here by name.
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { uploadBrandingLogo } from './branding.js';
import { dataIoApi } from '../data-io/api.js';
import { studioApi } from '../studio/api.js';
import { putOverrides } from '../studio/remap/api.js';
import { api, CSRF_HEADER, setCsrfToken } from './api.js';
import { bootstrapQuery } from './bootstrap.js';

const TOKEN = 'tok_from_bootstrap';

/** The headers the call under test actually put on the wire. */
function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]?.[1] as { headers?: Record<string, string> } | undefined)
    ?.headers ?? {};
}

function stubOk(body: unknown = { data: {} }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  setCsrfToken(TOKEN);
});

afterEach(() => {
  setCsrfToken(null);
  vi.unstubAllGlobals();
});

describe('the token holder', () => {
  it('is filled by the bootstrap query — the single writer', async () => {
    setCsrfToken(null);
    const fetchMock = stubOk({ data: makeBootstrap({ csrfToken: TOKEN }) });
    await new QueryClient().ensureQueryData(bootstrapQuery());

    // Proven by a subsequent mutation carrying it, not by reading the holder:
    // the holder is an implementation detail, the header is the contract.
    await api.post('/api/v1/anything', { a: 1 });
    expect(sentHeaders(fetchMock, 1)[CSRF_HEADER]).toBe(TOKEN);
  });

  it('sends nothing before /bootstrap has resolved', async () => {
    setCsrfToken(null);
    const fetchMock = stubOk();
    await api.post('/api/v1/anything');
    expect(sentHeaders(fetchMock)).not.toHaveProperty(CSRF_HEADER);
  });
});

describe('all five mutating call sites carry the token', () => {
  it('1/5 — app/api.ts, on every verb but GET/HEAD', async () => {
    const fetchMock = stubOk();
    await api.post('/api/v1/a', {});
    await api.put('/api/v1/b', {});
    await api.patch('/api/v1/c', {});
    await api.delete('/api/v1/d');
    await api.get('/api/v1/e');

    for (const call of [0, 1, 2, 3]) {
      expect(sentHeaders(fetchMock, call)[CSRF_HEADER], `call ${String(call)}`).toBe(TOKEN);
    }
    // GET is never checked server-side, so it never carries a credential it
    // does not need.
    expect(sentHeaders(fetchMock, 4)).not.toHaveProperty(CSRF_HEADER);
  });

  it('2/5 — studio/api.ts deleteJson (delete connection)', async () => {
    const fetchMock = stubOk({ ok: true });
    await studioApi.deleteConnection('conn_1', 'Sales DB');
    expect(sentHeaders(fetchMock)[CSRF_HEADER]).toBe(TOKEN);
  });

  it('3/5 — studio/remap/api.ts putJson (schema override save)', async () => {
    const fetchMock = stubOk({ overrides: [] });
    await putOverrides('conn_1', { overrides: [] });
    expect(sentHeaders(fetchMock)[CSRF_HEADER]).toBe(TOKEN);
  });

  it('4/5 — app/branding.ts raw image bytes (logo upload)', async () => {
    const fetchMock = stubOk({ data: { appName: 'A', logoUrl: null, showVersion: true } });
    await uploadBrandingLogo(new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
    // The raw-bytes upload keeps its own content-type AND gains the token.
    expect(sentHeaders(fetchMock)['content-type']).toBe('image/png');
    expect(sentHeaders(fetchMock)[CSRF_HEADER]).toBe(TOKEN);
  });

  it('5/5 — data-io/api.ts raw text/csv (import upload)', async () => {
    const fetchMock = stubOk({ data: { fileId: 'file_1' } });
    await dataIoApi.uploadImportFile(new File(['a,b\n1,2'], 'rows.csv', { type: 'text/csv' }));
    expect(sentHeaders(fetchMock)['content-type']).toBe('text/csv');
    expect(sentHeaders(fetchMock)[CSRF_HEADER]).toBe(TOKEN);
  });
});
