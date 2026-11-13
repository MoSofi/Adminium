// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect Supabase" (`ProviderConnect.tsx`, `connectReturn.ts`): every state
 * of the card the three connect front doors share, and the card in each door.
 *
 *  - unset (`/system/info` lists no provider): nothing renders, in every door;
 *  - the start card and the "or" above today's form; its button starts the
 *    hand-off and sends the browser to the operator;
 *  - back from the operator: a new project lands the connection; an existing
 *    one asks for its password here (project name, Change, the help line,
 *    Connect / Back), a wrong password is typed again; an expired hand-off
 *    shows "Supabase connection expired." and "Connect Supabase again";
 *  - before an account exists (setup, desktop): the button picks, nothing is
 *    called.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setI18nInstance, type I18nInstance } from '../i18n/t.js';
import { jsonResponse } from '../test/fixtures.js';
import { ConnectStep } from '../setup/onboarding/steps/ConnectStep.js';
import { SourceStep as DesktopSourceStep } from '../desktop/setup/steps/SourceStep.js';
import { INITIAL_DESKTOP_SETUP_STATE, type DesktopSetupState } from '../desktop/setup/desktopSetupState.js';
import { SourceStep as StudioSourceStep } from '../studio/connect/steps/SourceStep.js';
import { INITIAL_WIZARD_STATE, type WizardState } from '../studio/connect/wizardState.js';
import { leaveFor } from './connectApi.js';
import { captureConnectReturn } from './connectReturn.js';
import { ProviderConnect } from './ProviderConnect.js';

const INFO = { version: '0.3.57', node: 'v22', dialect: 'sqlite', runtime: 'self-host', smtpConfigured: false, networkFeaturesAllowed: true, lanShare: false, desktopDemo: false, deployLink: true };

interface Answers {
  offered: boolean;
  calls: { url: string; body: unknown }[];
  replies: Record<string, () => Response>;
}

let answers: Answers;
let leaving: string[];

beforeEach(() => {
  answers = { offered: true, calls: [], replies: {} };
  leaving = [];
  vi.spyOn(leaveFor, 'go').mockImplementation((url: string) => {
    leaving.push(url);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/system/info')) return Promise.resolve(jsonResponse(200, { ...INFO, connect: answers.offered ? [{ provider: 'supabase' }] : [] }));
      const path = new URL(url, 'http://localhost').pathname;
      answers.calls.push({ url: path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const reply = answers.replies[path];
      return Promise.resolve(reply === undefined ? jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no mock' } }) : reply());
    }),
  );
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function withClient(ui: ReactNode): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const connected = { status: 'connected', connection: { id: 'c1', name: 'hollis-orders', engine: 'postgres', readOnly: false, introspected: true } };

/** As if the operator had just sent the browser back. */
function comeBack(): void {
  window.history.replaceState(null, '', '/connect/supabase/return?state=st-1&code=co-1');
  captureConnectReturn();
}

describe('the way back from the operator', () => {
  it('lifts the code out of the address before anything reads it, and lands on the connect wizard', () => {
    comeBack();
    expect(window.location.pathname).toBe('/studio/connect');
    expect(window.location.search).toBe('');
    expect(JSON.parse(window.sessionStorage.getItem('adminium-connect-return') ?? 'null')).toEqual({ provider: 'supabase', state: 'st-1', code: 'co-1' });
  });

  it('leaves every other address alone', () => {
    window.history.replaceState(null, '', '/studio/connect?state=a&code=b');
    captureConnectReturn();
    expect(window.location.search).toBe('?state=a&code=b');
    expect(window.sessionStorage.getItem('adminium-connect-return')).toBeNull();
  });
});

describe('the card, signed in', () => {
  it('shows nothing when the operator offers no provider', async () => {
    answers.offered = false;
    const { container } = render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
    await waitFor(() => expect(answers.calls).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe('');
  });

  it('draws the card above an "or", and its button sends the browser to the operator', async () => {
    answers.replies['/api/v1/connect/start'] = () => jsonResponse(200, { redirectUrl: 'https://connect.example.com/supabase?instance=x&state=s&challenge=c' });
    render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
    expect(await screen.findByRole('heading', { name: 'Connect Supabase' })).toBeDefined();
    expect(screen.getByText('Sign in to Supabase and pick a project.')).toBeDefined();
    expect(screen.getByTestId('connect-provider-or').textContent).toBe('or');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Supabase' }));
    await waitFor(() => expect(leaving).toEqual(['https://connect.example.com/supabase?instance=x&state=s&challenge=c']));
    expect(answers.calls).toEqual([{ url: '/api/v1/connect/start', body: { provider: 'supabase' } }]);
  });

  it('starts at once when the person chose it before their account existed', async () => {
    answers.replies['/api/v1/connect/start'] = () => jsonResponse(200, { redirectUrl: 'https://connect.example.com/supabase' });
    const started = vi.fn();
    render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} autoStart onAutoStarted={started} />));
    await waitFor(() => expect(leaving).toEqual(['https://connect.example.com/supabase']));
    expect(started).toHaveBeenCalledOnce();
  });

  it('lands a new project: the wizard gets the connection', async () => {
    comeBack();
    answers.replies['/api/v1/connect/return'] = () => jsonResponse(200, connected);
    const onConnected = vi.fn();
    render(withClient(<ProviderConnect mode="connect" onConnected={onConnected} />));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(connected.connection));
    expect(answers.calls).toEqual([{ url: '/api/v1/connect/return', body: { provider: 'supabase', state: 'st-1', code: 'co-1' } }]);
    // Spent at this end too.
    expect(window.sessionStorage.getItem('adminium-connect-return')).toBeNull();
  });

  it('asks for an existing project’s password here, takes a wrong one again, then connects', async () => {
    comeBack();
    answers.replies['/api/v1/connect/return'] = () => jsonResponse(200, { status: 'needs-password', pendingId: 'p1', project: 'hollis-orders' });
    let tries = 0;
    answers.replies['/api/v1/connect/complete'] = () =>
      (tries += 1) === 1 ? jsonResponse(502, { error: { code: 'SOURCE_DB_UNREACHABLE', message: 'password authentication failed for user "postgres"', requestId: 'r' } }) : jsonResponse(200, connected);
    const onConnected = vi.fn();
    render(withClient(<ProviderConnect mode="connect" onConnected={onConnected} />));
    expect(await screen.findByRole('heading', { name: 'Use an existing project' })).toBeDefined();
    expect(screen.getByText('hollis-orders').className).toContain('font-mono');
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();
    expect(screen.getByText('The operator never sees it: it goes straight to this installation.')).toBeDefined();
    const field = screen.getByLabelText('Enter the database password for project hollis-orders') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(field, 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('password authentication failed for user "postgres"')).toBeDefined();
    await userEvent.clear(field);
    await userEvent.type(field, 'right');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(connected.connection));
    expect(answers.calls.filter((call) => call.url === '/api/v1/connect/complete').map((call) => call.body)).toEqual([
      { pendingId: 'p1', password: 'wrong' },
      { pendingId: 'p1', password: 'right' },
    ]);
  });

  it('goes Back to the start card from the password step', async () => {
    comeBack();
    answers.replies['/api/v1/connect/return'] = () => jsonResponse(200, { status: 'needs-password', pendingId: 'p1', project: null });
    render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
    expect(await screen.findByLabelText('Enter the database password for this project')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('connect-provider-start')).toBeDefined();
  });

  it('says the connection expired, and starts again from its button', async () => {
    comeBack();
    answers.replies['/api/v1/connect/return'] = () => jsonResponse(410, { error: { code: 'CONNECT_EXPIRED', message: 'expired', requestId: 'r' } });
    answers.replies['/api/v1/connect/start'] = () => jsonResponse(200, { redirectUrl: 'https://connect.example.com/supabase' });
    render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Supabase connection expired.');
    expect(alert.textContent).toContain('Sign in to Supabase and pick a project.');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Supabase again' }));
    await waitFor(() => expect(leaving).toEqual(['https://connect.example.com/supabase']));
  });

  it('says the connection expired when the operator answered something refused, never the server’s English', async () => {
    comeBack();
    answers.replies['/api/v1/connect/return'] = () => jsonResponse(502, { error: { code: 'CONNECT_REFUSED', message: 'The operator answered with a redirect, which this instance does not follow.', requestId: 'r' } });
    render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Supabase connection expired.');
    expect(alert.textContent).toContain('Sign in to Supabase and pick a project.');
    expect(alert.textContent).not.toContain('does not follow');
    expect(screen.getByRole('button', { name: 'Connect Supabase again' })).toBeDefined();
  });

  it('says a host the operator does not allow in the person’s words', async () => {
    comeBack();
    answers.replies['/api/v1/connect/return'] = () =>
      jsonResponse(403, { error: { code: 'OFF_BY_OPERATOR', message: 'db.example.net is not on this server’s list of database hosts.', requestId: 'r', details: { question: 'unlistedDatabaseHosts', reason: 'trial-mode' } } });
    render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This installation connects only to the database hosts its operator allows.');
    expect(alert.textContent).not.toContain('db.example.net');
  });

  it('says it in German for a German reader', async () => {
    const common = JSON.parse(readFileSync(join(process.cwd(), '../../packages/i18n/locales/de-DE/common.json'), 'utf8')) as Record<string, unknown>;
    setI18nInstance({
      language: 'de-DE',
      t: (key: string, options?: Record<string, unknown>) => {
        let node: unknown = common;
        for (const part of key.split('.')) node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
        return typeof node === 'string' ? node : String(options?.['defaultValue'] ?? key);
      },
    } as unknown as I18nInstance);
    try {
      comeBack();
      answers.replies['/api/v1/connect/return'] = () => jsonResponse(502, { error: { code: 'CONNECT_REFUSED', message: 'The operator answered with a redirect, which this instance does not follow.', requestId: 'r' } });
      render(withClient(<ProviderConnect mode="connect" onConnected={() => undefined} />));
      const alert = await screen.findByRole('alert');
      const supabase = (common['onboarding'] as { connectProvider: { supabase: Record<string, string> } }).connectProvider.supabase;
      expect(alert.textContent).toContain(supabase['expired']);
      expect(alert.textContent).toContain(supabase['body']);
      expect(alert.textContent).not.toContain('does not follow');
    } finally {
      setI18nInstance(null);
    }
  });
});

describe('the card in the three front doors', () => {
  function StudioDoor({ onConnected }: { onConnected?: () => void }) {
    const [state, setState] = useState<WizardState>({ ...INITIAL_WIZARD_STATE, step: 'source' });
    return <StudioSourceStep state={state} onPatch={(patch) => setState((prev) => ({ ...prev, ...patch }))} onProviderConnected={onConnected ?? (() => undefined)} />;
  }

  function DesktopDoor({ onPick }: { onPick: () => void }) {
    const [state, setState] = useState<DesktopSetupState>(INITIAL_DESKTOP_SETUP_STATE);
    return (
      <DesktopSourceStep
        state={state}
        onPatch={(patch) => setState((prev) => ({ ...prev, ...patch }))}
        onPickSqliteFile={() => undefined}
        schemaFileName={null}
        onPickSchemaFile={() => undefined}
        demoAvailable
        busy={false}
        onPickProvider={() => {
          setState((prev) => ({ ...prev, source: 'supabase' }));
          onPick();
        }}
      />
    );
  }

  function setupDoor(props: { provider?: 'supabase' | null; onPick?: () => void }) {
    return (
      <ConnectStep
        engine="postgres"
        dsn=""
        onChange={() => undefined}
        existing={null}
        probing={false}
        park={false}
        onPark={() => undefined}
        onAdopt={() => undefined}
        adopting={null}
        bridgePending={false}
        provider={props.provider ?? null}
        onPickProvider={props.onPick ?? (() => undefined)}
      />
    );
  }

  it.each([
    ['Studio', () => <StudioDoor />],
    ['first-run setup', () => setupDoor({})],
    ['desktop first run', () => <DesktopDoor onPick={() => undefined} />],
  ])('%s: the card sits above today’s form when offered', async (_door, door) => {
    render(withClient(door()));
    const card = await screen.findByTestId('connect-provider');
    // Above the form: the card comes first in the step, the "or" after it.
    const firstField = document.querySelector('input, [role="radiogroup"]') as HTMLElement;
    expect(card.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Supabase' })).toBeDefined();
  });

  it.each([
    ['Studio', () => <StudioDoor />],
    ['first-run setup', () => setupDoor({})],
    ['desktop first run', () => <DesktopDoor onPick={() => undefined} />],
  ])('%s: nothing changes when the operator offers none', async (_door, door) => {
    answers.offered = false;
    render(withClient(door()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId('connect-provider')).toBeNull();
    expect(screen.queryByText('Connect Supabase')).toBeNull();
  });

  it('the Supabase quick-fill chip stays in Studio either way', async () => {
    render(withClient(<StudioDoor />));
    await screen.findByTestId('connect-provider');
    expect(screen.getByRole('button', { name: 'Supabase' })).toBeDefined();
  });

  it('the desktop picks it and calls nothing: there is no account yet', async () => {
    const onPick = vi.fn();
    render(withClient(<DesktopDoor onPick={onPick} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Supabase' }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(await screen.findByText('Picked. You sign in to Supabase once your account exists.')).toBeDefined();
    expect(answers.calls).toEqual([]);
    expect(leaving).toEqual([]);
  });

  it('first-run setup picks it and calls nothing: there is no account yet', async () => {
    const onPick = vi.fn();
    render(withClient(setupDoor({ onPick })));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Supabase' }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(answers.calls).toEqual([]);
    expect(leaving).toEqual([]);
  });

  it('first-run setup says a picked Supabase waits for the account', async () => {
    render(withClient(setupDoor({ provider: 'supabase' })));
    expect(await screen.findByText('Picked. You sign in to Supabase once your account exists.')).toBeDefined();
  });
});
