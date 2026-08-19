// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import/export client. Two halves, both of which fail silently if they drift.
 *
 * `uploadImportFile` is the ONE non-JSON call in the SPA, so it hand-rolls
 * `fetch` — which means it also hand-rolls the CSRF header and the §1.4 error
 * envelope that `app/api.ts` would otherwise have given it. A missing header is
 * a 403 at the upload step of every CSV import; a missing envelope read is an
 * "Upload failed with status 422" where the server sent a reason.
 *
 * And the polling predicates decide when the page stops asking. They are pure
 * functions of the last reply, so they are tested directly rather than by
 * watching a clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CSRF_HEADER, setCsrfToken } from '../app/api.js';
import { jsonResponse } from '../test/fixtures.js';
import {
  dataIoApi,
  exportsListQuery,
  importQuery,
  importsListQuery,
  jobQuery,
  type ExportDto,
  type ImportDto,
  type JobDto,
} from './api.js';

beforeEach(() => {
  setCsrfToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

/** A `File` the upload path can read — happy-dom supplies the constructor. */
function csvFile(name = 'orders.csv'): File {
  return new File(['id,total\n1,2\n'], name, { type: 'text/csv' });
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('uploadImportFile', () => {
  it('posts the raw bytes as text/csv with the filename in the query', async () => {
    const fetchMock = stubFetch(200, { data: { fileId: 'file_1', columns: [] } });
    const file = csvFile('Q1 orders.csv');
    const preview = await dataIoApi.uploadImportFile(file);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('/api/v1/imports/upload?filename=Q1%20orders.csv');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['content-type']).toBe('text/csv');
    expect(init.body).toBe(file);
    expect(preview).toEqual({ fileId: 'file_1', columns: [] });
  });

  it('carries the CSRF token — without it every CSV import 403s at the upload step', async () => {
    setCsrfToken('csrf_abc');
    const fetchMock = stubFetch(200, { data: { fileId: 'file_1' } });
    await dataIoApi.uploadImportFile(csvFile());
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers[CSRF_HEADER]).toBe('csrf_abc');
  });

  it('names an unnamed drop `upload.csv` rather than sending a blank filename', async () => {
    const fetchMock = stubFetch(200, { data: { fileId: 'file_1' } });
    await dataIoApi.uploadImportFile(csvFile(''));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/imports/upload?filename=upload.csv');
  });

  it('reads the §1.4 error envelope back out of a rejected upload', async () => {
    stubFetch(422, {
      error: {
        code: 'CSV_TOO_LARGE',
        message: 'The file exceeds the 50 MB import limit.',
        requestId: 'req_9',
        details: { limitBytes: 52_428_800 },
      },
    });
    await expect(dataIoApi.uploadImportFile(csvFile())).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'CSV_TOO_LARGE',
      message: 'The file exceeds the 50 MB import limit.',
      requestId: 'req_9',
      details: { limitBytes: 52_428_800 },
    });
  });

  it('falls back to a status message when the failure carries no envelope', async () => {
    // A proxy 502 with an HTML body — `json()` throws and there is nothing to read.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: { get: () => 'req_edge' },
        json: async () => {
          await Promise.resolve();
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );
    await expect(dataIoApi.uploadImportFile(csvFile())).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL',
      message: 'Upload failed with status 502.',
      requestId: 'req_edge',
    });
  });
});

describe('the JSON calls', () => {
  it('creates and runs an import against the id-scoped routes', async () => {
    const create = stubFetch(200, { data: { import: { id: 'imp_1' }, report: {} } });
    await dataIoApi.createImport({
      fileId: 'file_1',
      connectionId: 'conn_1',
      table: 'public.orders',
      mapping: {} as never,
      options: {} as never,
    });
    expect(String(create.mock.calls[0]?.[0])).toBe('/api/v1/imports');

    const run = stubFetch(200, { data: { import: { id: 'imp 1' }, jobId: 'job_1' } });
    await dataIoApi.runImport('imp 1');
    expect(String(run.mock.calls[0]?.[0])).toBe('/api/v1/imports/imp%201/run');
  });

  it('unwraps the envelope on every read', async () => {
    stubFetch(200, { data: { id: 'imp_1', status: 'ready' } });
    expect(await dataIoApi.getImport('imp_1')).toEqual({ id: 'imp_1', status: 'ready' });

    stubFetch(200, { data: [{ id: 'imp_1' }] });
    expect(await dataIoApi.listImports()).toEqual([{ id: 'imp_1' }]);

    stubFetch(200, { data: [{ id: 'exp_1' }] });
    expect(await dataIoApi.listExports()).toEqual([{ id: 'exp_1' }]);

    stubFetch(200, { data: { id: 'exp_1' } });
    expect(await dataIoApi.getExport('exp_1')).toEqual({ id: 'exp_1' });

    stubFetch(200, { data: { id: 'job_1', status: 'running' } });
    expect(await dataIoApi.getJob('job_1')).toEqual({ id: 'job_1', status: 'running' });
  });

  it('posts an export request', async () => {
    const fetchMock = stubFetch(200, { data: { id: 'exp_1' } });
    await dataIoApi.createExport({
      connectionId: 'conn_1',
      source: { kind: 'table', table: 'public.orders' } as never,
      format: 'csv',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('/api/v1/exports');
    expect(JSON.parse(String(init.body))).toMatchObject({ format: 'csv', connectionId: 'conn_1' });
  });

  it('builds the two browser-navigated hrefs with the id encoded', () => {
    // These are `<a href>` targets, not fetches — an unencoded id would point the
    // browser at a different route.
    expect(dataIoApi.errorReportHref('imp/1')).toBe('/api/v1/imports/imp%2F1/error-report');
    expect(dataIoApi.downloadHref('exp 1')).toBe('/api/v1/exports/exp%201/download');
  });
});

/** `refetchInterval` is a function of the last reply — call it with one. */
function pollOf<T>(
  options: { refetchInterval?: unknown },
  data: T | undefined,
): number | false | undefined {
  const predicate = options.refetchInterval as (query: { state: { data: T | undefined } }) => number | false;
  return predicate({ state: { data } });
}

describe('the polling predicates', () => {
  it('polls the export list only while something is still processing', () => {
    const options = exportsListQuery();
    expect(pollOf<ExportDto[]>(options, [{ status: 'processing' } as ExportDto])).toBe(2_000);
    expect(pollOf<ExportDto[]>(options, [{ status: 'ready' } as ExportDto])).toBe(false);
    // Before the first reply there is nothing running to wait for.
    expect(pollOf<ExportDto[]>(options, undefined)).toBe(false);
  });

  it('polls one import while it is validating its way to a terminal status', () => {
    const options = importQuery('imp_1');
    expect(pollOf<ImportDto>(options, { status: 'running' } as ImportDto)).toBe(1_000);
    expect(pollOf<ImportDto>(options, { status: 'ready' } as ImportDto)).toBe(1_000);
    expect(pollOf<ImportDto>(options, { status: 'succeeded' } as ImportDto)).toBe(false);
    expect(pollOf<ImportDto>(options, undefined)).toBe(false);
  });

  it('disables the import query until there is an id to ask about', () => {
    expect(importQuery('imp_1').enabled).toBe(true);
    expect(importQuery('imp_1', false).enabled).toBe(false);
    expect(importsListQuery().queryKey).toEqual(['data-io', 'imports']);
  });

  it('polls a job until it settles, and keeps polling before the first reply', () => {
    const options = jobQuery('job_1');
    // `undefined` here means "the first fetch has not landed"; a job that has
    // not answered yet is exactly the one worth asking again.
    expect(pollOf<JobDto>(options, undefined)).toBe(1_000);
    expect(pollOf<JobDto>(options, { status: 'pending' } as JobDto)).toBe(1_000);
    expect(pollOf<JobDto>(options, { status: 'running' } as JobDto)).toBe(1_000);
    expect(pollOf<JobDto>(options, { status: 'succeeded' } as JobDto)).toBe(false);
    expect(pollOf<JobDto>(options, { status: 'failed' } as JobDto)).toBe(false);
  });

  it('does not run the job query with no job id', () => {
    expect(jobQuery(null).enabled).toBe(false);
    expect(jobQuery('job_1').enabled).toBe(true);
  });
});
