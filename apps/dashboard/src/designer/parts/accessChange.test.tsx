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

  it('says the reads and adds that go further than before: every column, no check, rows that were kept back', () => {
    const lines: [AccessChangeView, string, string][] = [
      [{ kind: 'access', verb: 'read-all', table: 'Bookings' }, 'strangers could read every column of Bookings', 'strangers can read every column of Bookings'],
      [{ kind: 'access', verb: 'no-check', table: 'Bookings' }, 'strangers could add rows to Bookings with no check that a person sent them', 'strangers can add rows to Bookings with no check that a person sent them'],
      [{ kind: 'access', verb: 'hidden-rows', table: 'Bookings' }, 'strangers could reach rows of Bookings that were kept from them', 'strangers can reach rows of Bookings that were kept from them'],
    ];
    for (const [change, asked, allowed] of lines) {
      expect(accessChangeLine(change, false)).toBe(asked);
      expect(accessChangeLine(change, true)).toBe(allowed);
    }
  });

  it('names four columns at most and counts the rest', () => {
    const read = (columns: string[]) => accessChangeLine({ kind: 'access', verb: 'read-columns', table: 'Bookings', columns }, false);
    expect(read(['a', 'b', 'c', 'd'])).toBe('strangers could read a, b, c, d of Bookings');
    expect(read(['a', 'b', 'c', 'd', 'e'])).toBe('strangers could read a, b, c, d and 1 more of Bookings');
    const forty = Array.from({ length: 40 }, (_, index) => `c${String(index + 1)}`);
    expect(read(forty)).toBe('strangers could read c1, c2, c3, c4 and 36 more of Bookings');
    expect(accessChangeLine({ kind: 'access', verb: 'write-columns', table: 'Bookings', columns: forty.slice(0, 6) }, true)).toBe('strangers can write c1, c2, c3, c4 and 2 more of Bookings');
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

  it('says how many more changes past the listed ones the same answer covers, asked and once allowed', () => {
    draw({ card: { ...card([{ kind: 'access', verb: 'add', table: 'Bookings' }]), more: 3 } });
    expect(screen.getByRole('group', { name: 'Check this before it goes live' }).textContent).toContain('And 3 more changes like these.');
    cleanup();
    draw({ card: { ...card([{ kind: 'access', verb: 'add', table: 'Bookings' }]), more: 1 } });
    expect(screen.getByRole('group', { name: 'Check this before it goes live' }).textContent).toContain('And 1 more change like these.');
    cleanup();
    draw({ card: { ...card([{ kind: 'access', verb: 'add', table: 'Bookings' }]), more: 3 }, answered: true, allowed: true });
    const allowed = screen.getByRole('group', { name: 'Check before it goes live, answered' });
    expect(allowed.textContent).toContain('Allowed: strangers can add rows to Bookings.');
    expect(allowed.textContent).toContain('Also allowed: 3 more changes like these.');
    cleanup();
    // Refused, nothing of it is allowed; with none past the list, no line.
    draw({ card: { ...card([{ kind: 'access', verb: 'add', table: 'Bookings' }]), more: 3 }, answered: true, allowed: false });
    expect(screen.getByRole('group', { name: 'Check before it goes live, answered' }).textContent).not.toContain('more change');
    cleanup();
    draw({ card: { ...card([{ kind: 'access', verb: 'add', table: 'Bookings' }]), more: 0 } });
    expect(screen.getByRole('group', { name: 'Check this before it goes live' }).textContent).not.toContain('like these');
  });

  it('says no answer was given when its turn ended without one', () => {
    draw({ closed: true });
    const answered = screen.getByRole('group', { name: 'Check before it goes live, answered' });
    expect(answered.textContent).toContain('No answer was given.');
    expect(within(answered).queryByRole('button')).toBeNull();
  });
});
