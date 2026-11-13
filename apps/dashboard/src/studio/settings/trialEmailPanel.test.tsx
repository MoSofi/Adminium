// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Settings → Email on a trial (the Trial Mode comp, view 6): the
 * operator's mail service read-only in place of the mail server fields, in its
 * normal and limit-reached states, and the outbox the limit box opens.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { TrialEmailPanel, type TrialRelayView } from './TrialEmailPanel.js';

const FROM = '"Hollis Bakery via Example Trials" <i-7f3a9c@relay.example.com>';
const TOMORROW = Date.UTC(2099, 0, 6, 0, 0);

const normal = (): TrialRelayView => ({
  from: FROM,
  replyTo: 'dana@hollisbakery.example',
  caps: { perDay: 50, perHour: 20, recipientsPerDay: 20 },
  today: 12,
  thisHour: 3,
  people: 4,
  waiting: 0,
  limit: null,
  nextAt: null,
});

function mount(relay: TrialRelayView): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TrialEmailPanel relay={relay} />
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      if (String(input).endsWith('/settings/email/waiting')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              { id: 'job_1', to: 'pat@customer.example', subject: 'Your order shipped', queuedAt: TOMORROW - 3 * 3_600_000, goesOutAt: TOMORROW },
              { id: 'job_2', to: 'lee@customer.example', subject: 'Invoice 1042', queuedAt: TOMORROW - 2 * 3_600_000, goesOutAt: TOMORROW },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the trial’s Email panel', () => {
  it('says the operator sends the mail, read-only, with the From, where replies go and today’s use', () => {
    mount(normal());
    const panel = screen.getByTestId('trial-email-panel');
    expect(within(panel).getByRole('heading', { name: 'Email is sent through the operator’s mail service' })).toBeTruthy();
    expect(within(panel).getByText('Set by the operator')).toBeTruthy();
    expect(panel.textContent).toContain(`${FROM}, replies go to dana@hollisbakery.example`);
    expect(panel.textContent).toContain('12 of 50 emails today · 3 of 20 this hour');
    expect(panel.textContent).toContain('4 of 20 people written to today');
    const bars = within(panel).getAllByRole('progressbar');
    expect(bars.map((bar) => [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')])).toEqual([
      ['Emails today', '12', '50'],
      ['Emails this hour', '3', '20'],
    ]);
    // Nothing waits: no warning, no outbox link, and nothing in it to type into.
    expect(within(panel).queryByRole('status')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /Open the outbox/ })).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
  });

  it('says so when the operator set no mail service', () => {
    mount({ ...normal(), from: null });
    expect(screen.getByTestId('trial-email-panel').textContent).toContain('no email is sent');
  });

  it('at the daily limit: the warning, how many wait, and the outbox they wait in', async () => {
    mount({ ...normal(), today: 50, thisHour: 4, waiting: 7, limit: 'day', nextAt: TOMORROW });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Daily email limit reached. 7 emails are waiting and go out tomorrow.');
    expect(screen.getByTestId('trial-email-panel').textContent).toContain('50 of 50 emails today · 4 of 20 this hour');
    await userEvent.click(within(status).getByRole('button', { name: /Open the outbox/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Waiting emails')).toBeTruthy();
    const rows = await within(dialog).findAllByRole('row');
    expect(rows.slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['pat@customer.example', 'lee@customer.example']);
    expect(within(dialog).getByText('Your order shipped')).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });

  it('names the other holds: the hour, the day’s people, bounces', () => {
    mount({ ...normal(), thisHour: 20, waiting: 1, limit: 'hour', nextAt: Date.UTC(2099, 0, 5, 11, 0) });
    expect(screen.getByRole('status').textContent).toContain('Hourly email limit reached. 1 email is waiting and goes out at');
  });

  it('at a limit with nothing waiting: says only that the limit is reached', () => {
    for (const [limit, sentence] of [
      ['hour', 'Hourly email limit reached.'],
      ['day', 'Daily email limit reached.'],
    ] as const) {
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <TrialEmailPanel relay={{ ...normal(), thisHour: 20, today: 50, waiting: 0, limit, nextAt: null }} />
        </QueryClientProvider>,
      );
      const status = screen.getByRole('status');
      expect(status.textContent).toBe(sentence);
      expect(within(status).queryByRole('button', { name: /Open the outbox/ })).toBeNull();
      unmount();
    }
  });
});
