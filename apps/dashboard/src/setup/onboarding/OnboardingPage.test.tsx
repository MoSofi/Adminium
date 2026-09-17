// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wizard, assembled.
 *
 * The cases here are the ones no step body can be responsible for on its own:
 * what Continue means on each screen, and what happens on the two failures the
 * step-3 transition can produce — one of which leaves the person signed in with
 * a database that would not answer, which is the state the whole R1 ordering
 * was chosen to make recoverable.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider } from '@adminium/ui';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { OnboardingPage } from './OnboardingPage.js';

const clear = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    options: { context: { queryClient: { clear } } },
    history: { push: (path: string) => pushed.push(path) },
  }),
}));

const pushed: string[] = [];

const submit = vi.fn();
const telemetry = vi.fn();
const savedWizardState = vi.fn();
vi.mock('../../about/desktopAbout.js', () => ({
  setTelemetry: (next: unknown) => {
    telemetry(next);
    return Promise.resolve(next);
  },
}));
vi.mock('../../studio/connect/wizardState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../studio/connect/wizardState.js')>();
  return { ...actual, saveWizardState: (state: unknown) => savedWizardState(state) };
});
vi.mock('./submitHeldAnswers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./submitHeldAnswers.js')>();
  return { ...actual, submitHeldAnswers: (...args: unknown[]) => submit(...args) };
});

let restoreI18n: () => void;
const realFetch = globalThis.fetch;
beforeAll(() => {
  restoreI18n = installTestI18n();
  // Hermetic: once the account exists the page asks where the meta store is,
  // and an unstubbed test would open a real socket to answer it.
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/v1/meta/placement')) {
      return jsonResponse(200, {
        data: { source: 'embedded', engine: 'sqlite', embedded: true, canRelocate: true },
      });
    }
    if (url.includes('/api/v1/setup/probe')) {
      return jsonResponse(200, {
        data: { reachable: true, reason: null, tables: [], occupied: [], secretMatches: null },
      });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'req_x' } });
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  restoreI18n();
  globalThis.fetch = realFetch;
});
afterEach(() => {
  submit.mockReset();
  clear.mockReset();
  telemetry.mockReset();
  savedWizardState.mockReset();
  pushed.length = 0;
});

function renderPage(): void {
  // The page asks where the meta store lives — a query, and one that only fires
  // once the account exists. It still needs a client to be inert against.
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider resolveDir={() => 'ltr'}>
        <OnboardingPage passwordMinLength={10} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function fillAccount(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/Email/), 'ada@example.com');
  await userEvent.type(screen.getByLabelText(/^Password/), 'correct-horse-1');
  await userEvent.type(screen.getByLabelText(/Confirm password/), 'correct-horse-1');
}

/** start → connect → account, answering nothing. */
async function walkToAccount(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
}

describe('the walk', () => {
  it('opens on the starting point, with Blank canvas chosen', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'What will you build first?' })).toBeDefined();
    expect(screen.getByText('Step 1 of 6')).toBeDefined();
  });

  it('walks to the account step and asks for the account there', async () => {
    renderPage();
    await walkToAccount();
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Create account/ })).toBeDefined();
  });

  it('will not continue past a connection string that cannot be one', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText('Connection string'), 'mongodb://host/db');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Continue/ }).disabled).toBe(true);
    // Skip is still offered: not answering is always allowed here.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip' }).disabled).toBe(false);
  });
});

describe('the check on the connection string', () => {
  it('holds Continue until it has an answer — Skip stays open', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText('Connection string'), 'postgres://u@h:5432/db');

    // The probe is debounced and then in flight; pressing Continue in that
    // window is exactly how the panel used to appear a screen too late.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Continue/ }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip' }).disabled).toBe(false);

    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Continue/ }).disabled).toBe(false);
    });
    // And the answer is on THIS screen, before the account is asked for.
    expect(screen.getByRole('heading', { name: 'Connect your database' })).toBeDefined();
  });

  it('does not wait on a string that is not a DSN yet', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText('Connection string'), 'postgres://');
    // Nothing to ask about: the shape error is the answer.
    expect(screen.getByText(/Add the host and database/)).toBeDefined();
  });
});

describe('the account submit', () => {
  it('validates before it sends anything', async () => {
    renderPage();
    await walkToAccount();
    await userEvent.type(screen.getByLabelText(/Email/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    expect(screen.getByText('Enter a valid email address.')).toBeDefined();
    expect(submit).not.toHaveBeenCalled();
  });

  it('advances to the storage step and drops the query cache', async () => {
    submit.mockResolvedValue({ kind: 'ok', connection: null });
    renderPage();
    await walkToAccount();
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
    });
    expect(clear).toHaveBeenCalled();
  });

  it('explains a 409 without moving', async () => {
    const { ApiError } = await import('../../app/api.js');
    submit.mockResolvedValue({
      kind: 'account-failed',
      cause: new ApiError(409, 'CONFLICT', 'Setup has already been completed.', 'req_1'),
    });
    renderPage();
    await walkToAccount();
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent ?? '').toContain('already been set up');
    });
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeDefined();
  });

  it('sends you back to the connection — and says the account survived', async () => {
    submit.mockResolvedValue({
      kind: 'connection-failed',
      cause: { message: 'password authentication failed' },
    });
    renderPage();
    await walkToAccount();
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Connect your database' })).toBeDefined();
    });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('signed in');
    expect(alert).toContain('password authentication failed');
  });
});

describe('the retry after a database that would not answer', () => {
  it('lands the connection without creating the account twice', async () => {
    submit.mockResolvedValue({ kind: 'connection-failed', cause: { message: 'password authentication failed' } });
    renderPage();
    await walkToAccount();
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Connect your database' })).toBeDefined();
    });

    // Fix the string and go on. A second `createSuperAdmin` would 409 against
    // the instance's own new admin and strand the operator in the wizard.
    submit.mockResolvedValue({ kind: 'ok', connection: null });
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
    });
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ accountExists: true }));
  });

  it('does not walk back into the account step, whichever way you ask', async () => {
    submit.mockResolvedValue({ kind: 'connection-failed', cause: { message: 'nope' } });
    renderPage();
    await walkToAccount();
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Connect your database' })).toBeDefined();
    });
    // Skipping the connect step means "no database" — and must still not send
    // the operator to a screen whose only button would 409.
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
  });
});

describe('once the account exists', () => {
  it('refuses to walk the rail back into it — a second submit would 409', async () => {
    submit.mockResolvedValue({ kind: 'ok', connection: null });
    renderPage();
    await walkToAccount();
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
    });
    await userEvent.click(screen.getByText('Your account'));
    expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
  });
});

/** start → connect → account (submitted) → meta → team → done. */
async function walkToDone(connection: unknown): Promise<void> {
  submit.mockResolvedValue({ kind: 'ok', connection });
  renderPage();
  await walkToAccount();
  await fillAccount();
  await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
  });
  // Keep the local file, skip the team, land on the last screen.
  await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Bring your team' })).toBeDefined();
  });
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: /You’re all set/ })).toBeDefined();
  });
}

describe('finishing', () => {
  it('writes the consent answers that were asked on the LAST screen, not the account one', async () => {
    await walkToDone(null);
    // The account was created with both consents off — the question had not
    // been put yet when that request went out.
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ consent: { telemetry: false, updateCheck: false } }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Go to dashboard/ }));
    await waitFor(() => expect(telemetry).toHaveBeenCalled());
    expect(telemetry).toHaveBeenCalledWith({ telemetry: false, updateCheck: false });
  });

  it('goes home when nothing was connected, seeding no wizard', async () => {
    await walkToDone(null);
    await userEvent.click(screen.getByRole('button', { name: /Go to dashboard/ }));
    await waitFor(() => expect(pushed).toContain('/'));
    expect(savedWizardState).not.toHaveBeenCalled();
  });

  it('hands a connection to the Studio wizard, resumed at the tables step', async () => {
    // Blank canvas is the default, so pick something that generates.
    submit.mockResolvedValue({ kind: 'ok', connection: null });
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: /CRUD tables/ }));
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText('Connection string'), 'postgres://u@h:5432/shop');
    // Continue waits for the check now — this used to walk straight past it.
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Continue/ }).disabled).toBe(false);
    });
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    submit.mockResolvedValue({
      kind: 'ok',
      connection: {
        connectionId: 'con_9',
        engine: 'postgres',
        tableCount: 14,
        serverVersion: 'PostgreSQL 16',
        latencyMs: 9,
        readOnly: false,
        privileges: null,
      },
    });
    await fillAccount();
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Where Adminium keeps its own data' })).toBeDefined();
    });
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(screen.getByText(/14 tables found/)).toBeDefined();
    });
    await userEvent.click(screen.getByRole('button', { name: /Go to dashboard/ }));
    await waitFor(() => expect(pushed).toContain('/studio/connect'));
    expect(savedWizardState).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 'tables',
        intent: 'crud',
        connectionId: 'con_9',
        dsn: 'postgres://u@h:5432/shop',
        name: 'shop',
      }),
    );
  });
});
