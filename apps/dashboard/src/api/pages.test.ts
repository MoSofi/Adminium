// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-config client (09-generated-app.md §3): migrate → validate, with every
 * failure mode returned as a value — too-new documents and invalid envelopes
 * render cards, never crash and never throw into the route error path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigMigration } from '@adminium/engine/config';

import { jsonResponse, makeCrudEnvelope } from '../test/fixtures.js';
import { PAGE_STALE_TIME_MS, pageQuery, parsePageDocument } from './pages.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parsePageDocument', () => {
  it('accepts a valid v1 envelope', () => {
    const result = parsePageDocument(makeCrudEnvelope());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.page.template).toBe('page-crud');
    expect(result.page.source.table).toBe('public.customers');
  });

  it('maps a document newer than this build to the too-new card state (§3.1)', () => {
    const result = parsePageDocument({ ...makeCrudEnvelope(), v: 99 });
    expect(result).toEqual({ status: 'too-new', v: 99, latest: 1 });
  });

  it('tolerates hidden-page nav shapes: nav.hidden, and the legacy group-less document (30 follow-up)', () => {
    const base = makeCrudEnvelope();
    const nav = base.nav as Record<string, unknown>;
    // Today's hide: group kept + hidden flag.
    expect(parsePageDocument({ ...base, nav: { ...nav, hidden: true } }).status).toBe('ok');
    // Pre-fix Studio hides DELETED the group — those documents exist in every
    // install that ever hid a page, and refusing them failed the whole
    // document (which is how record-page related tabs silently degraded).
    const { group: _group, ...withoutGroup } = nav;
    expect(parsePageDocument({ ...base, nav: withoutGroup }).status).toBe('ok');
  });

  it('maps versionless / non-object documents to invalid, never a throw', () => {
    expect(parsePageDocument(null).status).toBe('invalid');
    expect(parsePageDocument({ hello: 'world' }).status).toBe('invalid');
    expect(parsePageDocument('nonsense').status).toBe('invalid');
  });

  it('reports envelope validation failures with issue paths', () => {
    const result = parsePageDocument({ ...makeCrudEnvelope(), template: 'NOT KEBAB' });
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.issues.join('\n')).toContain('template');
  });

  it('runs the client-side migration chain before validating (§3.1)', () => {
    const migrate = vi.fn<ConfigMigration['migrate']>((doc) => ({
      ...doc,
      config: { renamed: (doc['config'] as Record<string, unknown>)['legacy'] },
    }));
    const migrations: ConfigMigration[] = [{ from: 1, to: 2, migrate }];
    // Post-migration validator for the hypothetical v2 shape (test seam — the
    // real chain and pageEnvelopeSchema always agree on the latest version).
    const schema = {
      safeParse: (input: unknown) => ({ success: true as const, data: input as never }),
    };

    const result = parsePageDocument(makeCrudEnvelope({ config: { legacy: 'kept' } }), {
      migrations,
      schema,
    });

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.page.v).toBe(2);
    expect(result.page.config).toEqual({ renamed: 'kept' });
  });
});

describe('pageQuery', () => {
  it('keys on ["page", id], holds 5 min, and parses the reply envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: makeCrudEnvelope() }));
    vi.stubGlobal('fetch', fetchMock);

    const options = pageQuery('page_customers');
    expect(options.queryKey).toEqual(['page', 'page_customers']);
    expect(options.staleTime).toBe(PAGE_STALE_TIME_MS);

    if (options.queryFn === undefined) throw new Error('queryFn missing');
    const result = await options.queryFn({} as never);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/pages/page_customers');
    expect(result.status).toBe('ok');
  });
});
