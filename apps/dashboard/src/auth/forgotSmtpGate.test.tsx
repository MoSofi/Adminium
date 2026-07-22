/**
 * `/forgot` under 11-electron.md §8.2's email row.
 *
 * The bug this locks down is a lie, not a crash: with no SMTP relay the server
 * mints a reset token and has nowhere to post it, so the old screen told a
 * locked-out user "Check your email" and left them waiting for mail that does
 * not exist. `Empty States.dc.html`: never hide, always explain.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider } from '@adminium/ui';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse } from '../test/fixtures.js';
import { ForgotPage } from './ForgotPage.js';

const restoreI18n = installTestI18n();
afterAll(restoreI18n);

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: () => Promise.resolve() }),
}));

function stubFetch(smtpConfigured: boolean, { probeFails = false } = {}) {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/system/info')) {
      return Promise.resolve(
        probeFails
          ? jsonResponse(500, { error: { code: 'INTERNAL', message: 'meta blip', requestId: 'req_x' } })
          : jsonResponse(200, {
              version: '0.5.0',
              node: 'v22.0.0',
              dialect: 'sqlite',
              runtime: 'desktop',
              smtpConfigured,
              networkFeaturesAllowed: true,
            }),
      );
    }
    if (url.startsWith('/api/v1/auth/password/forgot')) {
      return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider>
        <ForgotPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/forgot with no SMTP configured', () => {
  it('disables the send button and explains why', async () => {
    stubFetch(false);
    renderPage();

    const submit = await screen.findByRole('button', { name: 'Send reset link' });
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(true);
    });
    expect(screen.getByText(/no email server configured/i)).toBeDefined();
  });

  /** "…an action when possible": nobody signed out can configure SMTP. */
  it('offers the action the visitor can actually take', async () => {
    stubFetch(false);
    renderPage();
    expect(await screen.findByText(/Ask an administrator to reset your password/i)).toBeDefined();
  });

  it('never claims a mail was sent', async () => {
    const fetchMock = stubFetch(false);
    const user = userEvent.setup();
    renderPage();

    const submit = await screen.findByRole('button', { name: 'Send reset link' });
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(true);
    });
    await user.click(submit);

    expect(screen.queryByText('Check your email')).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('password/forgot'))).toBe(false);
  });
});

/**
 * REGRESSION — "we could not ask" is not "the answer is no".
 *
 * `/system/info` can 5xx on a meta-store blip; the query client retries twice on
 * a 5xx and then stops, so the unresolved default (`smtpConfigured: false`) would
 * sit there for the life of the page. An earlier cut read that default as fact:
 * one failed probe disabled password reset on a healthy instance with a working
 * relay, and told the one person who could not get in that their admin had never
 * configured email.
 */
describe('/forgot when the capability probe fails', () => {
  it('leaves the form working rather than asserting a lie about SMTP', async () => {
    stubFetch(true, { probeFails: true });
    renderPage();

    const submit = await screen.findByRole('button', { name: 'Send reset link' });
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(false);
    });
    expect(screen.queryByText(/no email server configured/i)).toBeNull();
  });

  it('still sends — the endpoint 200s regardless of what the probe did', async () => {
    const fetchMock = stubFetch(true, { probeFails: true });
    const user = userEvent.setup();
    renderPage();

    const submit = await screen.findByRole('button', { name: 'Send reset link' });
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(false);
    });
    await user.type(screen.getByRole('textbox'), 'ava@adminium.io');
    await user.click(submit);

    expect(await screen.findByText('Check your email')).toBeDefined();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('password/forgot'))).toBe(true);
  });
});

describe('/forgot with SMTP configured', () => {
  it('works exactly as before', async () => {
    const fetchMock = stubFetch(true);
    const user = userEvent.setup();
    renderPage();

    const submit = await screen.findByRole('button', { name: 'Send reset link' });
    await waitFor(() => {
      expect(submit.hasAttribute('disabled')).toBe(false);
    });
    expect(screen.queryByText(/no email server configured/i)).toBeNull();

    await user.type(screen.getByRole('textbox'), 'ava@adminium.io');
    await user.click(submit);

    expect(await screen.findByText('Check your email')).toBeDefined();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('password/forgot'))).toBe(true);
  });
});
