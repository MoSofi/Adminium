// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Notification settings: the "Quiet hours" and "Summaries" cards.
 *
 * Each has a switch the server keeps beside what it switches, so switching
 * off loses nothing: the hours, and the summaries' day and time, are sent
 * back as they were with the switch, and come back when it is on again. Both
 * cards say that quiet hours hold only the e-mail.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NotificationScheduleDto } from '../api/notifications.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse } from '../test/fixtures.js';
import { QuietHoursCard, SummariesCard } from './QuietHoursCard.js';

const DAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
const EVENINGS = Object.fromEntries(DAYS.map((day) => [day, { from: '18:30', to: '08:00' }]));
const NONE: NotificationScheduleDto = { timezone: null, quiet: null, digestDay: null, digestTime: null, quietOn: true, summariesOn: true, fallbackTimezone: 'Europe/London' };

function installFetch(start: NotificationScheduleDto) {
  const puts: Record<string, unknown>[] = [];
  let held = start;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/v1/me/notification-schedule' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Omit<NotificationScheduleDto, 'fallbackTimezone'>;
        puts.push(body);
        held = { ...held, ...body };
        return Promise.resolve(jsonResponse(200, { data: held }));
      }
      if (url === '/api/v1/me/notification-schedule') return Promise.resolve(jsonResponse(200, { data: held }));
      if (url === '/api/v1/me/notification-prefs') {
        return Promise.resolve(jsonResponse(200, { data: { channels: [], events: [{ key: 'mention', channels: { inApp: true, email: true, push: false }, custom: false }] } }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    }),
  );
  return puts;
}

function renderCards() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <QuietHoursCard eventLabel={(key) => (key === 'mention' ? 'Someone mentions you' : key)} />
        <SummariesCard />
      </Suspense>
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
afterEach(() => vi.unstubAllGlobals());

describe('the Quiet hours card', () => {
  it('is off until switched on, and then holds every evening, on the reader’s own clock', async () => {
    const puts = installFetch(NONE);
    renderCards();
    const card = within(await screen.findByTestId('quiet-hours'));
    expect(card.getByRole('heading', { name: 'Quiet hours' })).toBeTruthy();
    expect(card.getByTestId('quiet-lead').textContent).toBe('Off. Notices and their e-mails arrive as they happen.');
    const toggle = card.getByRole('switch', { name: 'Quiet hours' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(card.queryByTestId('quiet-zone')).toBeNull();
    await userEvent.click(toggle);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ quietOn: true, quiet: EVENINGS, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, summariesOn: true });
    // Said as it is: the notice still shows; only its e-mail waits.
    expect((await card.findByTestId('quiet-lead')).textContent).toBe(
      'In these hours a notice still shows in the bell, without a sound. Only its e-mail waits, and goes when they end. Something a rule marks urgent is sent at once.',
    );
    expect(card.getByTestId('quiet-example').textContent).toBe('An e-mail that comes at 18:30 on Monday is sent at 08:00 on Tuesday, unless its kind is ticked below.');
    expect(card.getByText('Still tell me at once about…')).toBeTruthy();
    expect(card.getByText('Someone mentions you')).toBeTruthy();
  });

  it('switched off, keeps the hours and sends them back with the switch; on again, they are the same hours', async () => {
    const puts = installFetch({ ...NONE, timezone: 'Europe/Berlin', quiet: { '1': { from: '19:00', to: '07:00' } } });
    renderCards();
    const card = within(await screen.findByTestId('quiet-hours'));
    const toggle = card.getByRole('switch', { name: 'Quiet hours' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(card.getByTestId('quiet-example').textContent).toBe('An e-mail that comes at 19:00 on Monday is sent at 07:00 on Tuesday, unless its kind is ticked below.');
    await userEvent.click(toggle);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ timezone: 'Europe/Berlin', quiet: { '1': { from: '19:00', to: '07:00' } }, digestDay: null, digestTime: null, quietOn: false, summariesOn: true });
    await waitFor(() => expect(card.queryByTestId('quiet-zone')).toBeNull());
    await userEvent.click(card.getByRole('switch', { name: 'Quiet hours' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ quietOn: true, quiet: { '1': { from: '19:00', to: '07:00' } } });
  });

  it('ticks a day on with the first day’s times, and says when a window ends the next day', async () => {
    const puts = installFetch({ ...NONE, timezone: 'UTC', quiet: { '1': { from: '22:00', to: '06:00' } } });
    renderCards();
    const card = within(await screen.findByTestId('quiet-hours'));
    expect(card.getByText('ends Tuesday')).toBeTruthy();
    await userEvent.click(card.getByTestId('quiet-day-2'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ quiet: { '1': { from: '22:00', to: '06:00' }, '2': { from: '22:00', to: '06:00' } } });
    await userEvent.click(card.getByTestId('quiet-copy'));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ quiet: Object.fromEntries(DAYS.map((day) => [day, { from: '22:00', to: '06:00' }])) });
  });
});

describe('the Summaries card', () => {
  it('says "not me" with a switch, keeping the day and time for when it is on again', async () => {
    const puts = installFetch({ ...NONE, timezone: 'UTC', digestDay: 1, digestTime: '07:00' });
    renderCards();
    const card = within(await screen.findByTestId('summaries'));
    expect(card.getByRole('heading', { name: 'Summaries' })).toBeTruthy();
    expect(card.getByTestId('summaries-lead').textContent).toContain('in your quiet hours it waits like any other');
    expect((card.getByTestId('digest-day') as HTMLSelectElement).value).toBe('1');
    await userEvent.click(card.getByRole('switch', { name: 'Summaries' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ timezone: 'UTC', quiet: null, digestDay: 1, digestTime: '07:00', quietOn: true, summariesOn: false });
    expect((await card.findByTestId('summaries-lead')).textContent).toBe('Off. No rule sends you a summary. Your day and time are kept for when you switch them on.');
    expect(card.queryByTestId('digest-day')).toBeNull();
  });

  it('sends summaries on the day each is made until a day is chosen, then at a time', async () => {
    const puts = installFetch(NONE);
    renderCards();
    const card = within(await screen.findByTestId('summaries'));
    const day = card.getByTestId('digest-day') as HTMLSelectElement;
    expect(day.options[0]!.textContent).toBe('The day each one is made');
    await userEvent.selectOptions(day, '5');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ digestDay: 5, digestTime: '08:00', summariesOn: true });
  });
});
