/**
 * Connect wizard component tests (M5-T01/02/03 + M9-T04) — happy-dom, fetch
 * mocked like the sibling api tests (no msw): step navigation, source-mode
 * switching, DSN validation gating, the engine picker (scheme sync, SQLite
 * file-path form), the schema-file format picker (auto-detect + override
 * re-parse), parse preview + parser warnings, capability degradation (file
 * sources: notes in the log, — row counts), inclusion defaults (high-volume
 * unchecked, join pre-hidden), read-only meta gating, and the full connect →
 * introspect → include → meta → generate → success walk.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { ConnectWizard } from './ConnectWizard.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- fetch scripting ---------------------------------------------------------

const SCHEMA_MODEL = {
  tables: [
    {
      id: 'public.customers',
      schema: 'public',
      name: 'customers',
      rowCountEstimate: 1200,
      columns: [
        { name: 'id', logicalType: 'integer' },
        { name: 'email', logicalType: 'text', semantics: { flags: { pii: 'email', maskedByDefault: true } } },
      ],
    },
    {
      id: 'public.sessions',
      schema: 'public',
      name: 'sessions',
      rowCountEstimate: 500_000,
      columns: [{ name: 'id', logicalType: 'integer' }],
    },
    {
      id: 'public.orders_products',
      schema: 'public',
      name: 'orders_products',
      rowCountEstimate: 90,
      semantics: { role: 'join-table' },
      columns: [{ name: 'order_id', logicalType: 'integer' }],
    },
  ],
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function scriptFetch(overrides: Partial<Record<string, (call: Call) => Response>> = {}) {
  const calls: Call[] = [];
  const patches: Call[] = [];
  const respond = (call: Call): Response => {
    const key = `${call.method} ${call.url.split('?')[0] ?? ''}`;
    const override = overrides[key];
    if (override !== undefined) return override(call);
    switch (key) {
      case 'POST /api/v1/connections/test':
        return jsonResponse(200, {
          ok: true,
          latencyMs: 42,
          serverVersion: '16.4',
          readOnly: true,
          privileges: { canReadSchema: true, canRead: true, canWrite: false, canDDL: false },
          error: null,
        });
      case 'POST /api/v1/connections':
        return jsonResponse(201, {
          id: 'conn_1',
          name: 'Prod',
          engine: 'postgres',
          sourceKind: 'dsn',
          dsnMasked: 'postgres://ava@db.acme.io:5432/prod',
          readOnly: true,
          status: 'connected',
          lastTestedAt: 1,
          lastLatencyMs: 42,
          lastError: null,
          snapshot: null,
          createdAt: 1,
          updatedAt: 1,
        });
      case 'POST /api/v1/connections/conn_1/introspect':
        return jsonResponse(200, { snapshotId: 'snap_1', noop: false, proposedMasks: 1, checksum: 'c' });
      case 'GET /api/v1/connections/conn_1/schema':
        return jsonResponse(200, {
          connectionId: 'conn_1',
          snapshotId: 'snap_1',
          checksum: 'c',
          createdAt: 1,
          source: 'introspection',
          model: SCHEMA_MODEL,
          appliedOverrides: 0,
        });
      case 'PATCH /api/v1/connections/conn_1':
        patches.push(call);
        return jsonResponse(200, { id: 'conn_1' });
      case 'POST /api/v1/connections/conn_1/generate':
        return jsonResponse(200, {
          pages: 3,
          navGroups: ['workspace', 'library'],
          snapshotId: 'snap_1',
          introspected: false,
          intent: 'read-only-analytics',
          result: { created: 3, updated: 0, unchanged: 0, pruned: 0, preserved: [] },
          warnings: [],
          durationMs: 12,
        });
      default:
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no mock for ${key}`, requestId: 'req_t' } });
    }
  };
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, patches };
}

function renderWizard(onOpenApp: () => void = () => undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectWizard onOpenApp={onOpenApp} lineDelayMs={0} pollIntervalMs={1} />
    </QueryClientProvider>,
  );
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });

// --- tests ---------------------------------------------------------------------

describe('step navigation + source modes', () => {
  it('starts on the intent step and walks to source; Back returns', async () => {
    scriptFetch();
    renderWizard();
    expect(screen.getByText('What do you need?')).toBeDefined();
    // The comps' unimplemented 'split' variant is dropped — exactly 4 cards.
    expect(screen.getAllByRole('radio')).toHaveLength(4);

    await userEvent.click(continueButton());
    expect(screen.getByText('Connect your database')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('What do you need?')).toBeDefined();
  });

  it('switches between DSN, fields and schema-file panes', async () => {
    scriptFetch();
    renderWizard();
    await userEvent.click(continueButton());

    expect(screen.getByPlaceholderText('postgres://user:password@host:5432/database')).toBeDefined();
    await userEvent.click(screen.getByRole('radio', { name: 'Individual fields' }));
    expect(screen.getByLabelText(/Host/)).toBeDefined();
    await userEvent.click(screen.getByRole('radio', { name: 'Schema file' }));
    expect(screen.getByText(/No database connection required/)).toBeDefined();
    // Read-only-role advice is a live-database concern — hidden in file mode.
    expect(screen.queryByText('Use a read-only role')).toBeNull();
  });

  it('gates Continue on DSN validity and quick-fills from provider chips', async () => {
    scriptFetch();
    renderWizard();
    await userEvent.click(continueButton());

    await userEvent.type(screen.getByLabelText(/Connection name/), 'Prod');
    const dsnInput = screen.getByPlaceholderText('postgres://user:password@host:5432/database');
    await userEvent.type(dsnInput, 'mongodb://nope');
    expect(screen.getByText(/Unrecognized scheme/)).toBeDefined();
    expect(continueButton()).toHaveProperty('disabled', true);

    await userEvent.clear(dsnInput);
    await userEvent.click(screen.getByRole('button', { name: 'localhost' }));
    expect((dsnInput as HTMLInputElement).value).toBe('postgres://postgres@localhost:5432/app_dev');
    expect(continueButton()).toHaveProperty('disabled', false);
  });
});

describe('engine picker (M9-T04)', () => {
  async function toSource() {
    scriptFetch();
    renderWizard();
    await userEvent.click(continueButton());
  }

  it('typing a mysql:// DSN drags the picker along; picking an engine rewrites the scheme', async () => {
    await toSource();
    const dsnInput = screen.getByPlaceholderText('postgres://user:password@host:5432/database');
    await userEvent.type(dsnInput, 'mysql://ava@db.acme.io:3306/prod');
    expect(screen.getByRole('radio', { name: 'MySQL / MariaDB' }).getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByRole('radio', { name: 'PostgreSQL' }));
    expect((dsnInput as HTMLInputElement).value).toBe('postgres://ava@db.acme.io:3306/prod');
    expect(screen.getByRole('radio', { name: 'PostgreSQL' }).getAttribute('aria-checked')).toBe('true');
  });

  it('provider chips follow the engine — postgres row is postgres-relevant only', async () => {
    await toSource();
    expect(screen.getByRole('button', { name: 'Supabase' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'PlanetScale' })).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'MySQL / MariaDB' }));
    expect(screen.queryByRole('button', { name: 'Supabase' })).toBeNull();
    expect(screen.getByRole('button', { name: 'PlanetScale' })).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: 'SQLite' }));
    expect(screen.queryByText('Quick fill:')).toBeNull();
  });

  it('SQLite in fields mode is a file-path form, not host/port', async () => {
    await toSource();
    await userEvent.type(screen.getByLabelText(/Connection name/), 'Local db');
    await userEvent.click(screen.getByRole('radio', { name: 'Individual fields' }));
    expect(screen.getByLabelText(/Host/)).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: 'SQLite' }));
    expect(screen.queryByLabelText(/Host/)).toBeNull();
    expect(continueButton()).toHaveProperty('disabled', true);
    await userEvent.type(screen.getByLabelText(/Database file path/), '/var/data/app.db');
    expect(screen.getByText('sqlite:/var/data/app.db')).toBeDefined();
    expect(continueButton()).toHaveProperty('disabled', false);
  });

  it('mysql fields form defaults the port to 3306 and hides the pg-only SSL select', async () => {
    await toSource();
    await userEvent.click(screen.getByRole('radio', { name: 'Individual fields' }));
    await userEvent.click(screen.getByRole('radio', { name: 'MySQL / MariaDB' }));
    expect(screen.getByLabelText(/Port/)).toHaveProperty('value', '3306');
    expect(screen.queryByLabelText(/SSL mode/)).toBeNull();
  });
});

describe('schema-file mode', () => {
  async function toFileMode() {
    renderWizard();
    await userEvent.click(continueButton());
    await userEvent.click(screen.getByRole('radio', { name: 'Schema file' }));
  }

  const uploadInput = () =>
    screen.getByText(/Drop your schema file here/).closest('button')!.nextElementSibling as HTMLInputElement;

  it('parses a .sql upload with auto-detect and shows what was detected', async () => {
    const { calls } = scriptFetch({
      'POST /api/v1/schema-import/parse': () =>
        jsonResponse(200, {
          model: SCHEMA_MODEL,
          format: 'sql-ddl',
          warnings: ['orders.user_id: REFERENCES users points outside the file — relation dropped.'],
          summary: { tables: 3, columns: 4, relations: 0, enums: 0 },
        }),
    });
    await toFileMode();
    expect(screen.getByLabelText('Schema format')).toHaveProperty('value', 'auto');
    const file = new File(['CREATE TABLE customers (id int);'], 'acme_schema.sql', { type: 'application/sql' });
    await userEvent.upload(uploadInput(), file);

    await screen.findByText('acme_schema.sql');
    // Auto-detect: no `format` in the request; the reply's format shows as "Detected".
    const parse = calls.find((call) => call.url === '/api/v1/schema-import/parse');
    expect(parse?.body).not.toHaveProperty('format');
    expect(screen.getByText('Detected: SQL DDL / pg_dump')).toBeDefined();
    expect(screen.getByText(/relation dropped/)).toBeDefined();
    // Name auto-fills from the file stem → Continue unlocks.
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
  });

  it('format override re-parses the kept upload with the forced format', async () => {
    const { calls } = scriptFetch({
      'POST /api/v1/schema-import/parse': (call) => {
        const body = call.body as { format?: string };
        return jsonResponse(200, {
          model: SCHEMA_MODEL,
          format: body.format ?? 'sql-ddl',
          warnings: [],
          summary: { tables: 3, columns: 4, relations: 0, enums: 0 },
        });
      },
    });
    await toFileMode();
    const file = new File(['model User { id Int @id }'], 'schema.prisma', { type: 'text/plain' });
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(uploadInput(), file);
    await screen.findByText('schema.prisma');

    await user.selectOptions(screen.getByLabelText('Schema format'), 'prisma');
    await waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/v1/schema-import/parse')).toHaveLength(2),
    );
    const parses = calls.filter((call) => call.url === '/api/v1/schema-import/parse');
    expect(parses[1]?.body).toMatchObject({ format: 'prisma', fileName: 'schema.prisma' });
    // Forced format renders as a plain tag (picker <option> + tag) — no "Detected:" prefix.
    await waitFor(() => expect(screen.getAllByText('Prisma schema')).toHaveLength(2));
    expect(screen.queryByText(/Detected:/)).toBeNull();
  });

  it('unrecognized format renders the pick-one-explicitly copy', async () => {
    scriptFetch({
      'POST /api/v1/schema-import/parse': () =>
        jsonResponse(422, {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The format could not be detected',
            requestId: 'req_1',
            details: { reason: 'UNSUPPORTED_FORMAT' },
          },
        }),
    });
    await toFileMode();
    const file = new File(['~~~'], 'notes.txt', { type: 'text/plain' });
    // applyAccept off: mimics drag-drop, which accepts any extension.
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(uploadInput(), file);

    await screen.findByText(/That format is not recognized — SQL DDL, Prisma/);
    expect(continueButton()).toHaveProperty('disabled', true);
  });

  it('no-live-DB path (M9-T04): upload → analyze log with capability notes → — row counts', async () => {
    scriptFetch({
      'POST /api/v1/schema-import/parse': () =>
        jsonResponse(200, {
          model: SCHEMA_MODEL,
          format: 'sql-ddl',
          warnings: ['orders.user_id: REFERENCES users points outside the file — relation dropped.'],
          summary: { tables: 3, columns: 4, relations: 0, enums: 0 },
        }),
    });
    await toFileMode();
    const file = new File(['CREATE TABLE customers (id int);'], 'acme_schema.sql', { type: 'application/sql' });
    await userEvent.upload(uploadInput(), file);
    await screen.findByText('acme_schema.sql');
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
    await userEvent.click(continueButton());

    // Analyze step replays the preview, surfaces parser warnings and the
    // import degradation notes — honestly, before Ready.
    await screen.findByText('Detected 3 tables · 4 columns');
    expect(screen.getByText(/relation dropped/)).toBeDefined();
    await screen.findByText(/Schema files carry no row counts/);
    expect(screen.getByText(/health checks and schema-drift detection are unavailable/)).toBeDefined();
    await screen.findByText('Ready');
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
    await userEvent.click(continueButton());

    // Tables step: parsed tables listed from memory, row counts degrade to —
    // (no live database) instead of repeating the parsed-model estimates.
    await screen.findByText('public.customers');
    expect(screen.queryByText('1,200')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Schema files carry no row counts — the column shows/)).toBeDefined();
  });
});

describe('full walk: test → include → meta → generate (read-only source)', () => {
  it('runs the storytelling log, defaults inclusion, forces separate meta, and succeeds', async () => {
    const { calls, patches } = scriptFetch();
    const onOpenApp = vi.fn();
    renderWizard(onOpenApp);

    // Step 1 — pick read-only analytics.
    await userEvent.click(screen.getByRole('radio', { name: /Read-only analytics/ }));
    await userEvent.click(continueButton());

    // Step 2 — DSN source.
    await userEvent.type(screen.getByLabelText(/Connection name/), 'Prod');
    await userEvent.type(
      screen.getByPlaceholderText('postgres://user:password@host:5432/database'),
      'postgres://ava@db.acme.io:5432/prod',
    );
    await userEvent.click(continueButton());

    // Step 3 — auto-runs: probe → create → introspect → storytelling lines.
    await screen.findByText('Establishing secure connection…');
    await screen.findByText('Connected (42 ms) · read-only introspection');
    await screen.findByText('Found 3 tables · 4 columns');
    await screen.findByText('Scanning for PII columns…');
    await screen.findByText('PII scan complete — 1 columns masked by default');
    await screen.findByText('Ready');
    // Connection was created with the chosen intent.
    const create = calls.find((call) => call.method === 'POST' && call.url === '/api/v1/connections');
    expect(create?.body).toMatchObject({ name: 'Prod', engine: 'postgres', settings: { intent: 'read-only-analytics' } });
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
    await userEvent.click(continueButton());

    // Step 4 — inclusion checklist: join table pre-hidden (2 visible),
    // high-volume sessions UNCHECKED by default, PII badge on customers.
    await screen.findByText('public.customers');
    expect(screen.queryByText('public.orders_products')).toBeNull();
    const customers = screen.getByRole('checkbox', { name: 'public.customers' });
    const sessions = screen.getByRole('checkbox', { name: 'public.sessions' });
    expect(customers.getAttribute('data-state')).toBe('checked');
    expect(sessions.getAttribute('data-state')).toBe('unchecked');
    expect(screen.getByText('PII · 1')).toBeDefined();
    expect(screen.getByText('high volume')).toBeDefined();
    expect(screen.getByText('1/2')).toBeDefined();
    expect(screen.getByText(/join\/system tables are pre-hidden/)).toBeDefined();
    await userEvent.click(continueButton());

    // Leaving step 4 persisted intent + includedTables (default selection).
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]?.body).toEqual({
      settings: { intent: 'read-only-analytics', includedTables: ['public.customers'] },
    });

    // Step 5 — read-only source: same-DB card disabled with the explanation.
    await screen.findByText('Where should Adminium keep its own tables?');
    const sameDb = screen.getByRole('radio', { name: /Same database/ });
    expect(sameDb).toHaveProperty('disabled', true);
    expect(screen.getByText(/Your role is read-only — Adminium never writes to this database/)).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: /Separate database/ }));
    expect(continueButton()).toHaveProperty('disabled', true);
    await userEvent.type(
      screen.getByLabelText(/Meta database connection string/),
      'postgres://adminium@meta.acme.io:5432/adminium_meta',
    );
    // The separate-DSN probe must report canWrite ∧ canDDL.
    scriptFetch({
      'POST /api/v1/connections/test': () =>
        jsonResponse(200, {
          ok: true,
          latencyMs: 12,
          serverVersion: '16.4',
          readOnly: false,
          privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
          error: null,
        }),
      'POST /api/v1/connections/conn_1/generate': () =>
        jsonResponse(200, {
          pages: 3,
          navGroups: ['workspace', 'library'],
          snapshotId: 'snap_1',
          introspected: false,
          intent: 'read-only-analytics',
          result: { created: 3, updated: 0, unchanged: 0, pruned: 0, preserved: [] },
          warnings: [],
          durationMs: 12,
        }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText(/Compatible — write/);
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
    await userEvent.click(continueButton());

    // Step 6 — Enrich with AI: skip to keep the heuristic baseline (never penalized).
    await screen.findByText('Enrich with AI');
    await userEvent.click(screen.getByRole('radio', { name: /Skip — use heuristics only/ }));
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
    await userEvent.click(continueButton());

    // Step 7 — generate → success → open app.
    await userEvent.click(screen.getByRole('button', { name: 'Generate dashboard' }));
    await screen.findByText('Your dashboard is ready');
    expect(screen.getByText(/3 pages across 2 navigation groups/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Open your app' }));
    expect(onOpenApp).toHaveBeenCalledTimes(1);
    // Success clears the resumable state.
    expect(window.sessionStorage.getItem('adminium-studio-connect')).toBeNull();
  });

  it('maps adapter error codes to remediation hints and offers Retry', async () => {
    scriptFetch({
      'POST /api/v1/connections/test': () =>
        jsonResponse(200, {
          ok: false,
          latencyMs: 3,
          serverVersion: null,
          readOnly: false,
          privileges: null,
          error: { code: 'AUTH', message: 'password authentication failed for user "ava"', hint: null },
        }),
    });
    renderWizard();
    await userEvent.click(continueButton());
    await userEvent.type(screen.getByLabelText(/Connection name/), 'Prod');
    await userEvent.type(
      screen.getByPlaceholderText('postgres://user:password@host:5432/database'),
      'postgres://ava@db.acme.io:5432/prod',
    );
    await userEvent.click(continueButton());

    await screen.findByText('password authentication failed for user "ava"');
    expect(screen.getByText(/check the user name and password/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(continueButton()).toHaveProperty('disabled', true);
  });

  it('prefers the adapter hint over the per-code copy (pooled endpoint)', async () => {
    // A transaction-pooling DSN fails with UNSUPPORTED, whose per-code copy is
    // the generic "verify the DSN" line — useless here. The adapter ships the
    // actual fix in `hint`, so that is what the wizard must render.
    scriptFetch({
      'POST /api/v1/connections/test': () =>
        jsonResponse(200, {
          ok: false,
          latencyMs: 4,
          serverVersion: null,
          readOnly: false,
          privileges: null,
          error: {
            code: 'UNSUPPORTED',
            message:
              'postgres query failed: unsupported startup parameter in options: statement_timeout.',
            hint: 'this looks like a transaction-pooling (PgBouncer) endpoint — on Neon drop `-pooler` from the host',
          },
        }),
    });
    renderWizard();
    await userEvent.click(continueButton());
    await userEvent.type(screen.getByLabelText(/Connection name/), 'Neon');
    await userEvent.type(
      screen.getByPlaceholderText('postgres://user:password@host:5432/database'),
      'postgres://ava@ep-x-123456-pooler.us-east-1.aws.neon.tech:5432/prod',
    );
    await userEvent.click(continueButton());

    expect(await screen.findByText(/drop `-pooler` from the host/)).toBeDefined();
    expect(screen.queryByText(/verify the DSN and retry/)).toBeNull();
  });
});

/**
 * The meta step used to record an answer and do nothing with it — the Studio
 * runs on a server that already has a meta store, so "same database" was a
 * choice the browser path could not carry out. It can now: `GET
 * /meta/placement` says whether there is anything to move, and Continue does
 * the moving.
 *
 * The two directions are both tested, because the OLD behaviour is still
 * correct in one of them: an instance already on a configured store must not
 * try to relocate, and the wizard must not stall waiting for a restart that
 * will never happen.
 */
describe('meta step — carrying out the placement choice', () => {
  const walkToMetaStep = async () => {
    await userEvent.click(continueButton());
    await userEvent.type(screen.getByLabelText(/Connection name/), 'Prod');
    await userEvent.type(
      screen.getByPlaceholderText('postgres://user:password@host:5432/database'),
      'postgres://ava@db.acme.io:5432/prod',
    );
    await userEvent.click(continueButton());
    await screen.findByText('Ready');
    await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
    await userEvent.click(continueButton());
    await screen.findByText('public.customers');
    await userEvent.click(continueButton());
    await screen.findByText('Where should Adminium keep its own tables?');
  };

  it('moves the store, then advances once the server is back', async () => {
    const { calls } = scriptFetch({
      'GET /api/v1/meta/placement': () =>
        jsonResponse(200, {
          data: { source: 'embedded', engine: 'sqlite', embedded: true, canRelocate: true, reason: null },
        }),
      'POST /api/v1/meta/relocate': () =>
        jsonResponse(200, {
          data: { engine: 'postgres', rowsCopied: 41, restarting: true, healthPath: '/api/v1/healthz' },
        }),
      'GET /api/v1/healthz': () => jsonResponse(200, { status: 'ok' }),
    });
    renderWizard();
    await walkToMetaStep();

    // The step says what Continue is about to do — the old copy claimed the
    // opposite ("moving an existing meta store is an ops task").
    expect(screen.getByText(/This will move Adminium’s tables/)).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: /Separate database/ }));
    await userEvent.type(
      screen.getByLabelText(/Meta database connection string/),
      'postgres://adminium@meta.acme.io:5432/adminium_meta',
    );
    // Re-scripting swaps the global fetch, so the RETURNED recorder is the one
    // that sees everything from here on — the outer `calls` stops being
    // appended to the moment this runs.
    const { calls: after } = scriptFetch({
      'POST /api/v1/connections/test': () =>
        jsonResponse(200, {
          ok: true,
          latencyMs: 9,
          serverVersion: '16.4',
          readOnly: false,
          privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
          error: null,
        }),
      'GET /api/v1/meta/placement': () =>
        jsonResponse(200, {
          data: { source: 'embedded', engine: 'sqlite', embedded: true, canRelocate: true, reason: null },
        }),
      'POST /api/v1/meta/relocate': () =>
        jsonResponse(200, {
          data: { engine: 'postgres', rowsCopied: 41, restarting: true, healthPath: '/api/v1/healthz' },
        }),
      'GET /api/v1/healthz': () => jsonResponse(200, { status: 'ok' }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText(/Compatible/);

    await userEvent.click(continueButton());

    // The DSN the user typed is what gets moved to.
    await waitFor(() => {
      const relocate = after.find((call) => call.url === '/api/v1/meta/relocate');
      expect(relocate?.body).toEqual({ dsn: 'postgres://adminium@meta.acme.io:5432/adminium_meta' });
    });
    // …and the wizard only moves on after the server answers again.
    await waitFor(() => {
      expect(after.some((call) => call.url === '/api/v1/healthz')).toBe(true);
    });
    // Asserted as "left the meta step" rather than on the next step's contents,
    // which is what this test actually cares about.
    await waitFor(() => {
      expect(screen.queryByText('Where should Adminium keep its own tables?')).toBeNull();
    });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('does not try to move a store that is already where it belongs', async () => {
    const { calls } = scriptFetch({
      // A WRITABLE source, so the same-db card is selectable at all — the
      // default script's role is read-only, which disables it for the §3.1
      // reason the other tests cover.
      //
      // BOTH endpoints, because `TestStep` patches `readOnly` twice: once from
      // the probe, then again from the CREATED connection, which wins. Overriding
      // only the probe leaves the card disabled and the step unable to advance.
      'POST /api/v1/connections/test': () =>
        jsonResponse(200, {
          ok: true,
          latencyMs: 12,
          serverVersion: '16.4',
          readOnly: false,
          privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
          error: null,
        }),
      'POST /api/v1/connections': () =>
        jsonResponse(201, {
          id: 'conn_1',
          name: 'Prod',
          engine: 'postgres',
          sourceKind: 'dsn',
          dsnMasked: 'postgres://ava@db.acme.io:5432/prod',
          readOnly: false,
          status: 'connected',
          lastTestedAt: 1,
          lastLatencyMs: 12,
          lastError: null,
          snapshot: null,
          createdAt: 1,
          updatedAt: 1,
        }),
      'GET /api/v1/meta/placement': () =>
        jsonResponse(200, {
          data: { source: 'bootstrap', engine: 'postgres', embedded: false, canRelocate: true, reason: null },
        }),
    });
    renderWizard();
    await walkToMetaStep();

    expect(screen.queryByText(/This will move Adminium’s tables/)).toBeNull();
    expect(screen.getByText(/already keeps its own tables in a configured database/)).toBeDefined();

    await userEvent.click(screen.getByRole('radio', { name: /Same database/ }));
    await userEvent.click(continueButton());

    await waitFor(() => {
      expect(screen.queryByText('Where should Adminium keep its own tables?')).toBeNull();
    });
    expect(calls.some((call) => call.url === '/api/v1/meta/relocate')).toBe(false);
  });
});
