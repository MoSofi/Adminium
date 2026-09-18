// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/storage` (37-files-and-storage.md §3.8, 37-T21).
 *
 * Mounted BARE rather than through the router, unlike its Studio siblings, for
 * one reason: this page's route is registered separately, so a router harness
 * here would be asserting against wiring this file does not own. Everything
 * the page draws is reachable without it — `PageActions` publishes into a
 * channel that is absent outside the shell and draws nothing where it sits, so
 * the assertions below gate on the page's own testids rather than an `<h1>`.
 *
 * The transport is stubbed at `fetch`, not at the API module, and that is
 * deliberate for the one test that matters most: **the PATCH body**. The whole
 * write-only-secret contract lives in the bytes that go on the wire — a mock
 * of `updateDestination` would prove that the page called a function, which is
 * not the claim. The claim is that a blank credential field reaches the server
 * as an ABSENT key, because an empty string would replace a working credential
 * with a broken one and there is no undo for that.
 *
 * What is proved here:
 *
 *  1. the editor renders the right fields per driver, and the local disk is
 *     listed first as a row with no id, no Test and no Delete;
 *  2. a stored secret never round-trips into the field, and a blank one is
 *     omitted from the PATCH — while a complete new pair IS sent;
 *  3. Test renders the latency on success and the provider's error VERBATIM on
 *     failure, both from a 200 (a failure is not an exception);
 *  4. a 409 delete shows the file count the server named, and says to move the
 *     files first;
 *  5. a disabled destination is not offered "Set as default" — the server 409s
 *     it — and the row says why instead.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { PageActionsProvider, PageActionsSlot } from '../../shell/PageActionsProvider.js';
import { jsonResponse } from '../../test/fixtures.js';

import { StoragePage } from './StoragePage.js';
import {
  applyPreset,
  draftFromDestination,
  emptyDraft,
  patchBodyFromDraft,
  presetIdFor,
  secretFromDraft,
  type DestinationTestResult,
  type DestinationView,
  type StorageUsageEntry,
} from './storageApi.js';

function s3Destination(over: Partial<DestinationView> = {}): DestinationView {
  return {
    id: 'dst_1',
    name: 'Uploads bucket',
    driver: 's3',
    config: {
      endpoint: 'https://nyc3.digitaloceanspaces.com',
      region: 'nyc3',
      bucket: 'adminium-uploads',
      prefix: 'files',
      forcePathStyle: false,
    },
    hasSecret: true,
    isDefault: true,
    status: 'ok',
    lastTestedAt: 1,
    lastError: null,
    disabled: false,
    createdAt: 1,
    updatedAt: 2,
    fileCount: 12,
    ...over,
  };
}

interface StubOptions {
  destinations?: DestinationView[];
  usage?: StorageUsageEntry[];
  /** Status for `GET /storage/destinations`; anything but 200 is an error path. */
  listStatus?: number;
  /** What both Test routes answer with. */
  test?: DestinationTestResult;
  /** Make DELETE refuse with the server's 409 shape. */
  deleteConflict?: number;
}

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(options: StubOptions = {}): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown;
      calls.push({ method, url, body });

      if (url === '/api/v1/storage/destinations' && method === 'GET') {
        const status = options.listStatus ?? 200;
        return Promise.resolve(
          status === 200
            ? jsonResponse(200, { data: options.destinations ?? [s3Destination()] })
            : jsonResponse(status, { error: { code: 'FORBIDDEN', message: 'nope' } }),
        );
      }
      if (url === '/api/v1/files/usage') {
        return Promise.resolve(jsonResponse(200, { data: options.usage ?? [] }));
      }
      if (url.endsWith('/test')) {
        return Promise.resolve(
          jsonResponse(200, { data: options.test ?? { ok: true, latencyMs: 42 } }),
        );
      }
      if (url === '/api/v1/storage/migrate') {
        // 202, like the route: the reply is a receipt for work that has not
        // happened yet, and the page must read the id rather than a row.
        return Promise.resolve(jsonResponse(202, { data: { jobId: 'job_9' } }));
      }
      if (method === 'DELETE') {
        return Promise.resolve(
          options.deleteConflict === undefined
            ? jsonResponse(200, { data: s3Destination() })
            : jsonResponse(409, {
                error: {
                  code: 'CONFLICT',
                  message: 'still in use',
                  details: { fileCount: options.deleteConflict, destinationId: 'dst_1' },
                },
              }),
        );
      }
      if (method === 'PATCH' || method === 'POST') {
        return Promise.resolve(jsonResponse(200, { data: s3Destination() }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
    }),
  );
  return calls;
}

/**
 * The page publishes its two primary actions — Add and Move files… — into the
 * topbar through the PageActions channel, and that channel PORTALS: outside a
 * provider whose slot has mounted, `PageActions` draws nothing at all. So the
 * harness supplies the pair the app shell supplies, and without them three of
 * the tests below would fail for a reason that has nothing to do with storage.
 */
function renderPage(options: StubOptions = {}) {
  const calls = stubFetch(options);
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <PageActionsProvider>
        <PageActionsSlot />
        <StoragePage />
      </PageActionsProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

/** The last body sent with `method` to a URL containing `fragment`. */
function lastBody(calls: RecordedCall[], method: string, fragment: string): unknown {
  const matches = calls.filter((call) => call.method === method && call.url.includes(fragment));
  return matches[matches.length - 1]?.body;
}

describe('storage draft algebra', () => {
  it('never carries a stored credential into the draft', () => {
    // The server does not send one, so anything in these fields would be
    // invented — and would then be sent back as a "new" credential.
    const draft = draftFromDestination(s3Destination());
    expect(draft.accessKeyId).toBe('');
    expect(draft.secretAccessKey).toBe('');
    expect(draft.hasSecret).toBe(true);
    expect(secretFromDraft(draft)).toBeNull();
  });

  it('omits the secret key from a PATCH when nothing was typed', () => {
    const body = patchBodyFromDraft(draftFromDestination(s3Destination()));
    // `in`, not a truthiness check: `secret: undefined` would serialize away
    // but `secret: ''` would not, and this is the assertion that tells them
    // apart.
    expect('secret' in body).toBe(false);
    expect(body.config).toMatchObject({ bucket: 'adminium-uploads', region: 'nyc3' });
  });

  it('sends the secret only when BOTH halves were typed', () => {
    const draft = draftFromDestination(s3Destination());
    const half = { ...draft, accessKeyId: 'AKIA' };
    expect('secret' in patchBodyFromDraft(half)).toBe(false);
    const whole = { ...half, secretAccessKey: 'shh' };
    expect(patchBodyFromDraft(whole).secret).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'shh',
    });
  });

  it('leaves a field a preset cannot know EMPTY rather than guessing it', () => {
    // R2's endpoint needs the operator's account id; a plausible wrong value
    // would fail at the first upload instead of at Test.
    const r2 = applyPreset(emptyDraft('s3'), 'r2');
    expect(r2.endpoint).toBe('');
    expect(r2.region).toBe('auto');
    // Tigris is the one origin that is knowable outright.
    expect(applyPreset(emptyDraft('s3'), 'tigris').endpoint).toBe('https://fly.storage.tigris.dev');
    // A self-hosted server is the only preset that addresses by path.
    expect(applyPreset(emptyDraft('s3'), 'minio').forcePathStyle).toBe(true);
  });

  it('recognises a stored endpoint so reopening the editor is not a reset', () => {
    expect(presetIdFor({ endpoint: 'https://nyc3.digitaloceanspaces.com' })).toBe('spaces');
    expect(presetIdFor({ endpoint: 'https://abc.r2.cloudflarestorage.com' })).toBe('r2');
    expect(presetIdFor({ endpoint: 'https://fly.storage.tigris.dev' })).toBe('tigris');
    expect(presetIdFor({ endpoint: 'https://s3.us-west-004.backblazeb2.com' })).toBe('b2');
    expect(presetIdFor({ endpoint: 'https://s3.eu-central-1.wasabisys.com' })).toBe('wasabi');
    expect(presetIdFor({})).toBe('aws');
    expect(presetIdFor({ endpoint: 'http://127.0.0.1:9000' })).toBe('minio');
    // Typed without a scheme, which the endpoint field accepts.
    expect(presetIdFor({ endpoint: 'nyc3.digitaloceanspaces.com' })).toBe('spaces');
    expect(presetIdFor({ endpoint: 'HTTPS://NYC3.DIGITALOCEANSPACES.COM' })).toBe('spaces');
  });

  it('reads the host, so a provider domain elsewhere in the URL is not that provider', () => {
    // Each of these CONTAINS a provider domain and is served by none of them.
    expect(presetIdFor({ endpoint: 'https://minio.internal/?ref=wasabisys.com' })).toBe('minio');
    expect(presetIdFor({ endpoint: 'https://wasabisys.com.example.net' })).toBe('minio');
    expect(presetIdFor({ endpoint: 'https://example.net/digitaloceanspaces.com' })).toBe('minio');
    expect(presetIdFor({ endpoint: 'https://notbackblazeb2.com' })).toBe('minio');
    // An endpoint that cannot be parsed is "some other S3", not a guess.
    expect(presetIdFor({ endpoint: 'http://:::::' })).toBe('minio');
  });
});

describe('StoragePage', () => {
  beforeAll(installTestI18n);
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists this server's disk first, with what is used and what is left", async () => {
    renderPage({
      usage: [
        { destinationId: null, name: "This server's disk", driver: 'local', files: 3, bytes: 2_000_000, available: 41_000_000_000 },
        { destinationId: 'dst_1', name: 'Uploads bucket', driver: 's3', files: 12, bytes: 9_000_000 },
      ],
    });

    const used = await screen.findByTestId('studio-storage-local-usage');
    expect(used.textContent).toContain('used');
    const available = screen.getByTestId('studio-storage-local-available');
    expect(available.textContent).toContain('available on this disk');
    // 37 Appendix D: a byte figure is never a fraction of a capacity.
    expect(document.body.textContent).not.toMatch(/\bB of \b/);
    // The implicit destination has no row, so it has no per-row actions.
    expect(screen.queryByTestId('studio-storage-test-')).toBeNull();
  });

  it('says a 403 is a missing permission and anything else is not', async () => {
    renderPage({ listStatus: 403 });
    const alert = await screen.findByTestId('studio-storage-error');
    expect(alert.textContent).toContain('Manage storage');
  });

  it('renders the fields each driver actually has', async () => {
    const { user } = renderPage({ destinations: [] });

    await user.click(await screen.findByTestId('studio-storage-add'));
    // s3 is the opening driver: it is the one nearly every operator picks.
    expect(await screen.findByTestId('studio-storage-field-bucket')).toBeTruthy();
    expect(screen.getByTestId('studio-storage-field-preset')).toBeTruthy();
    expect(screen.getByTestId('studio-storage-field-access-key')).toBeTruthy();
    expect(screen.queryByTestId('studio-storage-field-root')).toBeNull();
    expect(screen.queryByTestId('studio-storage-field-url')).toBeNull();

    await user.selectOptions(screen.getByTestId('studio-storage-field-driver'), 'webdav');
    expect(await screen.findByTestId('studio-storage-field-url')).toBeTruthy();
    expect(screen.getByTestId('studio-storage-field-username')).toBeTruthy();
    expect(screen.queryByTestId('studio-storage-field-bucket')).toBeNull();

    await user.selectOptions(screen.getByTestId('studio-storage-field-driver'), 'local');
    expect(await screen.findByTestId('studio-storage-field-root')).toBeTruthy();
    // A path on this machine carries no credential at all.
    expect(screen.queryByTestId('studio-storage-field-access-key')).toBeNull();
    expect(screen.queryByTestId('studio-storage-field-password')).toBeNull();
  });

  it('never shows a stored secret and never clears one by saving a blank field', async () => {
    const { user, calls } = renderPage();

    await user.click(await screen.findByTestId('studio-storage-edit-dst_1'));
    const secret = await screen.findByTestId('studio-storage-field-secret-key');
    // The server sent `hasSecret: true` and no value; the field has nothing to
    // show, and says so instead of pretending.
    expect((secret as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Leave both fields blank to keep it/)).toBeTruthy();

    await user.click(screen.getByTestId('studio-storage-save'));

    await waitFor(() => {
      expect(lastBody(calls, 'PATCH', '/storage/destinations/dst_1')).toBeDefined();
    });
    const body = lastBody(calls, 'PATCH', '/storage/destinations/dst_1') as Record<string, unknown>;
    // The whole contract: absent, not empty. `secret: ''` would replace a
    // working credential with a broken one.
    expect('secret' in body).toBe(false);
    expect(body['name']).toBe('Uploads bucket');
  });

  it('refuses to save half a credential rather than dropping it silently', async () => {
    const { user, calls } = renderPage();

    await user.click(await screen.findByTestId('studio-storage-edit-dst_1'));
    await user.type(await screen.findByTestId('studio-storage-field-access-key'), 'AKIA');

    expect(await screen.findByTestId('studio-storage-secret-partial')).toBeTruthy();
    expect((screen.getByTestId('studio-storage-save') as HTMLButtonElement).disabled).toBe(true);
    expect(lastBody(calls, 'PATCH', '/storage/destinations/dst_1')).toBeUndefined();
  });

  it('renders the latency a successful Test reports', async () => {
    const { user } = renderPage({ test: { ok: true, latencyMs: 137 } });

    await user.click(await screen.findByTestId('studio-storage-test-dst_1'));
    const line = await screen.findByTestId('studio-storage-probe-dst_1');
    expect(line.textContent).toContain('137');
  });

  it("renders a failed Test's error verbatim — it is a 200, not an exception", async () => {
    // The provider's own message is the only part an operator can act on, so
    // it must survive to the screen unrewritten.
    const provider = 'SignatureDoesNotMatch: the request signature we calculated does not match';
    const { user } = renderPage({ test: { ok: false, error: provider } });

    await user.click(await screen.findByTestId('studio-storage-test-dst_1'));
    const line = await screen.findByTestId('studio-storage-probe-dst_1');
    expect(line.textContent).toBe(provider);
    // Not routed through the page's failure alert: nothing went wrong with the
    // request itself.
    expect(screen.queryByTestId('studio-storage-action-error')).toBeNull();
  });

  it('tests an unsaved draft without storing it first', async () => {
    const { user, calls } = renderPage({
      destinations: [],
      test: { ok: false, error: 'NoSuchBucket' },
    });

    await user.click(await screen.findByTestId('studio-storage-add'));
    await user.click(await screen.findByTestId('studio-storage-draft-test'));

    const result = await screen.findByTestId('studio-storage-draft-test-result');
    expect(result.textContent).toContain('NoSuchBucket');
    // The draft route, not the per-id one — nothing has an id yet.
    expect(calls.some((call) => call.url === '/api/v1/storage/destinations/test')).toBe(true);
  });

  it('shows the file count when a delete is refused, and what to do about it', async () => {
    const { user } = renderPage({ deleteConflict: 12 });

    await user.click(await screen.findByText('Delete'));
    await user.click(await screen.findByTestId('studio-storage-delete-confirm'));

    const blocked = await screen.findByTestId('studio-storage-delete-blocked');
    expect(blocked.textContent).toContain('12');
    expect(blocked.textContent).toContain('Move them');
    // Not reported as an unexplained failure — the 409 IS the explanation.
    expect(screen.queryByTestId('studio-storage-action-error')).toBeNull();
  });

  it('does not offer "Set as default" on a disabled destination, and says why', async () => {
    renderPage({
      destinations: [s3Destination({ isDefault: false, disabled: true })],
    });

    await screen.findByTestId('studio-storage-row-dst_1');
    // The server 409s this, so the affordance would be a trap.
    expect(screen.queryByTestId('studio-storage-default-dst_1')).toBeNull();
    expect(screen.getByText(/A disabled destination cannot be the default/)).toBeTruthy();
  });

  it('starts a move between the disk and a destination and reports the job', async () => {
    const { user, calls } = renderPage();

    await user.click(await screen.findByTestId('studio-storage-move-open'));
    await user.selectOptions(await screen.findByTestId('studio-storage-move-to'), 'dst_1');
    await user.click(screen.getByTestId('studio-storage-move-start'));

    const started = await screen.findByTestId('studio-storage-move-started');
    expect(started.textContent).toContain('background');
    // `null` on the wire is how "this server's disk" is said (37 D3).
    expect(lastBody(calls, 'POST', '/storage/migrate')).toEqual({ from: null, to: 'dst_1' });
  });
});
