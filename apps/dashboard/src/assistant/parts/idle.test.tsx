// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The panel's idle state: the page's own three things to try, and after them
 * the questions an installed add-on offers on its page, under the add-on's
 * name. A click on either asks it.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { Idle } from './Idle.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(cleanup);

const OWN = [{ icon: 'search', label: 'Which orders are late?' }];

describe('the idle state\'s starters', () => {
  it('with no add-on on the page shows only the page\'s own', () => {
    render(<Idle greeting="Hello" greetingSub="Ask me" suggestions={OWN} onPick={() => undefined} />);
    expect(screen.getByRole('button', { name: /Which orders are late/ })).toBeDefined();
    expect(screen.queryByTestId('assistant-add-on-starters')).toBeNull();
  });

  it('shows an add-on\'s questions after them, said to be that add-on\'s, and asks the one that is picked', async () => {
    const onPick = vi.fn();
    render(
      <Idle
        greeting="Hello"
        greetingSub="Ask me"
        suggestions={OWN}
        starters={[{ key: 'offers:a', text: 'Which vouchers were never used?', addOn: 'Offers & gift cards' }, { key: 'offers:b', text: 'What did gift cards pay for this month?', addOn: 'Offers & gift cards' }]}
        onPick={onPick}
      />,
    );
    const group = screen.getByTestId('assistant-add-on-starters');
    expect(group.textContent).toContain('From Offers & gift cards');
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    // After the page's own, never before them.
    const all = screen.getAllByRole('button').map((button) => button.textContent);
    expect(all.indexOf('Which orders are late?')).toBeLessThan(all.findIndex((text) => text?.includes('vouchers')));
    await userEvent.setup().click(within(group).getByRole('button', { name: /never used/ }));
    expect(onPick).toHaveBeenCalledWith('Which vouchers were never used?');
  });
});
