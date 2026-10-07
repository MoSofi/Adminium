// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * RULES THAT CAME WITH AN APP OR AN ADD-ON sit apart from the owner's own:
 * a group per kind of owner, each rule with its owner's name, the zone its
 * schedule runs in, the same switch every rule has, and "Changed by you"
 * once it was. Opened, its flow is shown with "Edit a copy" — and nothing,
 * anywhere, deletes one.
 */
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RuleView } from './api.js';
import { FlowHeader, ShippedRuleGroups, splitShipped, withZone } from './rules/parts.js';

const rule = (over: Partial<RuleView>): RuleView =>
  ({
    id: 'auto_1',
    connectionId: 'cnx_1',
    name: 'Low stock',
    description: null,
    enabled: true,
    trigger: { kind: 'record', event: 'updated', connectionId: 'cnx_1', table: 'public.items', watch: false },
    graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When stock is low' }] },
    timeSavedMinutes: null,
    nextRunAt: null,
    valid: true,
    incompleteNodeId: null,
    stats: { runs30d: 3, successRate30d: 1, lastRunAt: null },
    managed: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as RuleView;

const DAILY = { kind: 'schedule', connectionId: 'cnx_1', schedule: { kind: 'daily', time: '17:00', timezone: 'Europe/Berlin' } } as RuleView['trigger'];
const RULES = [
  rule({ id: 'a', name: 'Low stock', managed: { key: 'inventory', name: 'Inventory', kind: 'add-on', templateKey: 'low-stock', edited: false } }),
  rule({ id: 'b', name: 'Send drafts', enabled: false, trigger: DAILY, managed: { key: 'inventory', name: 'Inventory', kind: 'add-on', templateKey: 'send-drafts-daily', edited: true } }),
  rule({ id: 'c', name: 'Remind guests', managed: { key: 'hotel', name: 'Hotel reservations', kind: 'app', templateKey: 'remind', edited: false } }),
];

function mount(rules: readonly RuleView[] = RULES) {
  const onSelect = vi.fn();
  const onToggle = vi.fn();
  const view = render(<ShippedRuleGroups rules={rules} selectedId="a" triggerLine={(one) => (one.trigger.kind === 'schedule' ? 'Every day at 17:00' : 'When an item changes')} now={10} onSelect={onSelect} onToggle={onToggle} />);
  return { ...view, onSelect, onToggle };
}

describe('rules that came with an app or an add-on', () => {
  it('sit under "From your add-ons" and "From your apps", each with its owner\'s name', () => {
    mount();
    const addOns = screen.getByRole('region', { name: 'From your add-ons' });
    const apps = screen.getByRole('region', { name: 'From your apps' });
    expect(within(addOns).getAllByRole('button').filter((card) => card.hasAttribute('aria-current')).map((card) => card.querySelector('.font-bold')?.textContent)).toEqual(['Low stock', 'Send drafts']);
    expect(within(apps).getByText('Remind guests')).toBeTruthy();
    expect(Array.from(addOns.querySelectorAll('[data-part="rule-owner"]')).map((chip) => chip.textContent)).toEqual(['Inventory', 'Inventory']);
    expect(apps.querySelector('[data-part="rule-owner"]')!.textContent).toBe('Hotel reservations');
  });

  it('say "Changed by you" on the one the owner changed, and on no other', () => {
    mount();
    const edited = Array.from(document.querySelectorAll('[data-part="rule-edited"]'));
    expect(edited).toHaveLength(1);
    expect(edited[0]!.textContent).toBe('Changed by you');
    expect(edited[0]!.closest('[data-testid="rule-card-b"]')).not.toBeNull();
  });

  it('a rule by the clock says the zone it runs in', () => {
    mount();
    expect(within(screen.getByTestId('rule-card-b')).getByText('Every day at 17:00 (Europe/Berlin)')).toBeTruthy();
    // One that follows a record has no clock to name; neither has "every 15 minutes".
    expect(within(screen.getByTestId('rule-card-a')).getByText('When an item changes')).toBeTruthy();
    expect(withZone('Every 15 minutes', { kind: 'schedule', connectionId: null, schedule: { kind: 'interval', everyMinutes: '15' } } as RuleView['trigger'])).toBe('Every 15 minutes');
  });

  it('each has the switch every rule has, and no way to delete it', async () => {
    const user = userEvent.setup();
    const { onToggle, onSelect, container } = mount();
    const off = screen.getByTestId('rule-toggle-b');
    expect(off.getAttribute('aria-checked')).toBe('false');
    await user.click(off);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(RULES[1]);
    // The switch is not a way into the rule.
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('rule-card-c'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(RULES[2]);
    expect(container.textContent).not.toMatch(/Delete/i);
  });

  it('a kind of owner with no rule here has no heading, and no shipped rule at all draws nothing', () => {
    const one = mount([RULES[0]!]);
    expect(screen.queryByRole('region', { name: 'From your apps' })).toBeNull();
    one.unmount();
    // An owner's own rule is not one of these, wherever it is handed.
    const none = mount([rule({ id: 'mine', managed: null })]);
    expect(none.container.innerHTML).toBe('');
  });
});

describe('the main list', () => {
  it('holds the owner\'s own rules and none that was shipped; the groups hold the rest', () => {
    const mine = rule({ id: 'mine', managed: null });
    // A server older than the word says nothing of an owner: the rule is the owner's.
    const old = rule({ id: 'old' });
    delete (old as { managed?: unknown }).managed;
    const { own, shipped } = splitShipped([RULES[0]!, mine, RULES[2]!, old]);
    expect(own.map((one) => one.id)).toEqual(['mine', 'old']);
    expect(shipped.map((one) => one.id)).toEqual(['a', 'c']);
  });
});

describe('a shipped rule, opened', () => {
  const header = (shipped?: { owner: string; copying: boolean; onCopy: () => void }) =>
    render(
      <FlowHeader rule={RULES[0]!} stepCount={2} timeSaved={null} dirty={shipped === undefined} saving={false} saveError={null} testing={false} onSave={() => undefined} onTest={() => undefined} onRename={() => undefined} onDuplicate={() => undefined} onDelete={() => undefined} {...(shipped === undefined ? {} : { shipped })} />,
    );

  it('offers "Edit a copy", and neither Save nor the menu that renames and deletes', async () => {
    const onCopy = vi.fn();
    header({ owner: 'Inventory', copying: false, onCopy });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit a copy' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('rule-save')).toBeNull();
    expect(screen.queryByTestId('rule-save-chip')).toBeNull();
    // What is left: the copy, and a test run.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Edit a copy', 'Test']);
  });

  it('an owner\'s own rule keeps its Save and its menu, and has no copy button', () => {
    header();
    expect(screen.getByTestId('rule-save')).toBeTruthy();
    expect(screen.queryByTestId('rule-copy')).toBeNull();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2);
  });
});
