// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Check this before it goes live": each change said in the person's words, asked and once allowed;
 * the lead that says whether a plan was approved; both answers, and how the card stands after each.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { AccessChangeView, DesignerCard } from '../api.js';
import { AccessChangeCard, accessChangeLine } from './chat.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => cleanup());

type AccessCard = Extract<DesignerCard, { type: 'access-change' }>;
const card = (changes: AccessChangeView[], planned = true): AccessCard => ({ id: 'access-1', type: 'access-change', changes, planned });

function draw(over: Partial<Parameters<typeof AccessChangeCard>[0]> = {}) {
  const onAllow = vi.fn();
  const onRefuse = vi.fn();
  render(<AccessChangeCard card={card([{ kind: 'access', verb: 'add', table: 'Bookings' }])} answered={false} busy={false} onAllow={onAllow} onRefuse={onRefuse} {...over} />);
  return { onAllow, onRefuse };
}

describe('each change, in the person’s words', () => {
  it('says what strangers could do with a table, and once allowed what they can', () => {
    const lines: [AccessChangeView, string, string][] = [
      [{ kind: 'access', verb: 'read', table: 'Bookings' }, 'strangers could read Bookings', 'strangers can read Bookings'],
      [{ kind: 'access', verb: 'add', table: 'Bookings' }, 'strangers could add rows to Bookings', 'strangers can add rows to Bookings'],
      [{ kind: 'access', verb: 'change', table: 'Bookings' }, 'strangers could change rows of Bookings', 'strangers can change rows of Bookings'],
      [{ kind: 'access', verb: 'read-columns', table: 'Bookings', columns: ['email', 'phone'] }, 'strangers could read email, phone of Bookings', 'strangers can read email, phone of Bookings'],
      [{ kind: 'access', verb: 'write-columns', table: 'Bookings', columns: ['notes'] }, 'strangers could write notes of Bookings', 'strangers can write notes of Bookings'],
    ];
    for (const [change, asked, allowed] of lines) {
      expect(accessChangeLine(change, false)).toBe(asked);
      expect(accessChangeLine(change, true)).toBe(allowed);
    }
  });

  it('says what a role could do, new or already there, and a page that calls outside Adminium', () => {
    expect(accessChangeLine({ kind: 'role', role: 'Courier', isNew: true }, false)).toBe('a new role, Courier, could sign in and use the app');
    expect(accessChangeLine({ kind: 'role', role: 'Courier', isNew: true }, true)).toBe('a new role, Courier, can sign in and use the app');
    expect(accessChangeLine({ kind: 'role', role: 'Staff', isNew: false }, false)).toBe('the role Staff could do more than before');
    expect(accessChangeLine({ kind: 'role', role: 'Staff', isNew: false }, true)).toBe('the role Staff can do more than before');
    expect(accessChangeLine({ kind: 'call', screen: 'shop' }, false)).toBe('the shop page calls an address outside Adminium');
    expect(accessChangeLine({ kind: 'call', screen: 'shop' }, true)).toBe('the shop page can call an address outside Adminium');
  });
});

describe('the card', () => {
  it('asks with each change on its own line, after a lead that says a plan was approved', () => {
    draw({ card: card([{ kind: 'access', verb: 'add', table: 'Bookings' }, { kind: 'call', screen: 'shop' }, { kind: 'role', role: 'Courier', isNew: true }]) });
    const asked = screen.getByRole('group', { name: 'Check this before it goes live' });
    expect(asked.textContent).toContain('This was not on the plan you approved:');
    expect(within(asked).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['strangers could add rows to Bookings', 'the shop page calls an address outside Adminium', 'a new role, Courier, could sign in and use the app']);
    expect(within(asked).getAllByRole('button').map((button) => button.textContent)).toEqual(['Allow it', 'Do not allow it']);
  });

  it('asks for a yes without naming a plan when none was approved', () => {
    draw({ card: card([{ kind: 'access', verb: 'read', table: 'Bookings' }], false) });
    const asked = screen.getByRole('group', { name: 'Check this before it goes live' });
    expect(asked.textContent).toContain('This needs your yes first:');
    expect(asked.textContent).not.toContain('plan');
  });

  it('answers with either button, and neither while an answer is on its way', async () => {
    const { onAllow, onRefuse } = draw();
    await userEvent.click(screen.getByRole('button', { name: 'Allow it' }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Do not allow it' }));
    expect(onRefuse).toHaveBeenCalledTimes(1);
    cleanup();
    draw({ busy: true });
    expect(screen.getByRole('button', { name: 'Allow it' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Do not allow it' }).hasAttribute('disabled')).toBe(true);
  });

  it('once allowed, says what is allowed now, change by change', () => {
    draw({ card: card([{ kind: 'access', verb: 'add', table: 'Bookings' }, { kind: 'call', screen: 'shop' }]), answered: true, allowed: true });
    const answered = screen.getByRole('group', { name: 'Check before it goes live, answered' });
    expect(answered.textContent).toContain('Answered');
    expect(answered.textContent).toContain('Allowed: strangers can add rows to Bookings.');
    expect(answered.textContent).toContain('Allowed: the shop page can call an address outside Adminium.');
    expect(within(answered).queryByRole('button')).toBeNull();
  });

  it('once refused, says the Designer builds without it', () => {
    draw({ answered: true, allowed: false });
    const answered = screen.getByRole('group', { name: 'Check before it goes live, answered' });
    expect(answered.textContent).toContain('Not allowed. The Designer will build without it.');
    expect(answered.textContent).not.toContain('Allowed:');
  });

  it('says no answer was given when its turn ended without one', () => {
    draw({ closed: true });
    const answered = screen.getByRole('group', { name: 'Check before it goes live, answered' });
    expect(answered.textContent).toContain('No answer was given.');
    expect(within(answered).queryByRole('button')).toBeNull();
  });
});
