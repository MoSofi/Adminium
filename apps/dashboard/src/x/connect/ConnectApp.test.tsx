// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The connect page against a pretend door: the token leaves the address at
 * once, every outcome has its own page, and nothing is handed in twice.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@adminium/i18n/react';

import { routeOf } from '../route.js';
import { initXWords } from '../words.js';
import { takeReturn, takeToken } from './api.js';
import { addConnectWords, ConnectApp, providerWord } from './ConnectApp.js';

const TOKEN = 'a'.repeat(43);
const GOOGLE = { key: 'calendar-google', name: 'Google Calendar' };
const MICROSOFT = { key: 'calendar-microsoft', name: 'Outlook Calendar' };
const LINK = { business: 'Lumen Studio', contact: 'hello@lumen.example', person: 'Rafa Ortiz', address: 'rafa@lumen.example', sentBy: 'Selma Okonjo', purpose: 'connect', providers: [GOOGLE] };

type Reply = { status: number; body?: unknown };
let replies: Record<string, Reply[]>;
let calls: { path: string; body: Record<string, unknown> }[];

function stubDoor(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    const path = input.replace('/x/connect/api/', '');
    calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const reply = replies[path]?.shift() ?? { status: 404, body: { error: 'unavailable' } };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'content-type': 'application/json' } });
  }));
}

async function draw(address: string): Promise<void> {
  window.history.replaceState(null, '', address);
  const i18n = await initXWords('en_US');
  await addConnectWords(i18n, 'en-US');
  render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <ConnectApp />
      </I18nProvider>
    </StrictMode>,
  );
}

const heading = (name: RegExp) => screen.findByRole('heading', { level: 1, name });

beforeEach(() => {
  replies = {};
  calls = [];
  window.sessionStorage.clear();
  stubDoor();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the address', () => {
  it('is the connect page, on both its paths and nowhere else', () => {
    expect(routeOf('/x/connect', '').kind).toBe('connect');
    expect(routeOf('/x/connect/back', '').kind).toBe('connect');
    expect(routeOf('/x/connect/other', '').kind).toBe('none');
  });

  it('moves the token out of the address and into this tab', () => {
    const replaceState = vi.fn();
    const store = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(takeToken({ pathname: '/x/connect', hash: `#${TOKEN}` }, { replaceState }, store)).toBe(TOKEN);
    expect(store.setItem).toHaveBeenCalledWith('adminium-connect-link', TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/x/connect');
  });

  it('takes what the provider sent out of the address', () => {
    const replaceState = vi.fn();
    expect(takeReturn({ pathname: '/x/connect/back', hash: `#state=${'s'.repeat(20)}&code=abc` }, { replaceState })).toEqual({ state: 's'.repeat(20), code: 'abc' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/x/connect/back');
    expect(takeReturn({ pathname: '/x/connect/back', hash: '#code=abc' }, { replaceState })).toBeNull();
  });

  it('names the company whose page the person will see', () => {
    expect(providerWord(GOOGLE)).toBe('Google');
    expect(providerWord(MICROSOFT)).toBe('Microsoft');
    expect(providerWord({ key: 'other', name: 'Other' })).toBe('Other');
  });
});

describe('the link opened', () => {
  it('greets the person, says what it will do, and whose page comes next', async () => {
    replies['open'] = [{ status: 200, body: LINK }];
    await draw(`/x/connect#${TOKEN}`);
    await heading(/Selma asked you to connect your calendar to Lumen Studio/);
    expect(window.location.hash).toBe('');
    expect(screen.getByText('Hi Rafa,')).toBeTruthy();
    expect(screen.getByText(/never what an event is called/)).toBeTruthy();
    expect(screen.getByText(/grey Busy block/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect with Google' })).toBeTruthy();
    expect(screen.getByText(/Google asks you to sign in on its own page/)).toBeTruthy();
    expect(screen.getByText(/Sent by Selma Okonjo at Lumen Studio/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Adminium');
  });

  it('shows a button per provider when the link names no one provider', async () => {
    replies['open'] = [{ status: 200, body: { ...LINK, providers: [GOOGLE, MICROSOFT] } }];
    await draw(`/x/connect#${TOKEN}`);
    expect(await screen.findByRole('button', { name: 'Connect with Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect with Microsoft' })).toBeTruthy();
    expect(screen.getByText(/Google or Microsoft asks you to sign in/)).toBeTruthy();
  });

  it('says "reconnect" on a reconnect', async () => {
    replies['open'] = [{ status: 200, body: { ...LINK, purpose: 'reconnect' } }];
    await draw(`/x/connect#${TOKEN}`);
    await heading(/Selma asked you to reconnect your calendar/);
  });

  it('reads the same for a used, expired or unknown link', async () => {
    replies['open'] = [{ status: 404 }];
    await draw(`/x/connect#${TOKEN}`);
    await heading(/This link doesn’t work any more/);
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
  });

  it('says so when the business has not finished its setup', async () => {
    replies['open'] = [{ status: 200, body: LINK }];
    replies['start'] = [{ status: 409, body: { error: 'NOT_SET_UP' } }];
    await draw(`/x/connect#${TOKEN}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect with Google' }));
    await heading(/This can’t be connected yet/);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
  });
});

describe('coming back from the provider', () => {
  const back = `/x/connect/back#state=${'s'.repeat(20)}&code=abc`;
  const arrive = async (outcome: Record<string, unknown>) => {
    window.sessionStorage.setItem('adminium-connect-link', TOKEN);
    replies['open'] = [{ status: 200, body: LINK }];
    replies['complete'] = [{ status: 200, body: outcome }];
    await draw(back);
  };

  it('hands the answer in once, even when drawn twice, and says who connected', async () => {
    await arrive({ outcome: 'connected', address: 'rafa@lumen.example', addressDiffers: false, testing: false });
    await heading(/Done — your Lumen Studio bookings will appear in a calendar called Lumen Studio/);
    expect(screen.getByText(/Connected as/)).toBeTruthy();
    expect(calls.filter((call) => call.path === 'complete')).toHaveLength(1);
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem('adminium-connect-link')).toBeNull();
  });

  it('says when a different address connected', async () => {
    await arrive({ outcome: 'connected', address: 'rafa@gmail.example', addressDiffers: true, testing: false });
    expect(await screen.findByText(/isn’t the address Lumen Studio has for you/)).toBeTruthy();
  });

  it.each([
    [{ outcome: 'denied' }, /Nothing was connected/, true],
    [{ outcome: 'partial', missing: ['calendar'] }, /One box was left unticked/, true],
    [{ outcome: 'different-account' }, /That’s a different account/, true],
    [{ outcome: 'other-provider' }, /already connected another way/, false],
    [{ outcome: 'needs-admin' }, /Microsoft 365 admin has to approve/, true],
    [{ outcome: 'setup' }, /This can’t be connected yet/, false],
    [{ outcome: 'nothing' }, /Nothing was connected/, true],
  ])('%j', async (outcome, title, canRetry) => {
    await arrive(outcome);
    await heading(title);
    expect(screen.queryByRole('button', { name: 'Try again' }) !== null).toBe(canRetry);
    expect(window.sessionStorage.getItem('adminium-connect-link')).toBe(TOKEN);
  });

  it('"Try again" goes back to the start of the same link', async () => {
    await arrive({ outcome: 'denied' });
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Connect with Google' })).toBeTruthy();
  });
});
