// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule's e-mail step as a kind of mail.
 *
 *  - The step's inspector shows "Kind of mail" only for a mail to the
 *    record's own address; a new one starts as marketing mail about the
 *    newsletter; "Why you're writing" shows for marketing mail only; a step
 *    saved before steps could say reads as service mail, and says so.
 *  - What is saved: the kind and the purpose ride in the step's own JSON, and
 *    a mail to anyone else carries neither.
 *  - The canvas says each such step's kind under it, and on the second and
 *    later marketing mails of a path that they are checked again when they go.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { SourceColumn, SourceTable, Sources } from '../api.js';
import type { Action, Graph } from '../model/graph.js';
import { classPatch, laterMarketingMails, recipientPatch } from '../model/mailClass.js';
import { patchAction } from '../model/ops.js';
import { FlowBuilder, type FlowBuilderProps } from './FlowBuilder.js';
import { ActionSettings } from './inspector/ActionSettings.js';

type Email = Extract<Action, { kind: 'email' }>;

const column = (name: string, over: Partial<SourceColumn> = {}): SourceColumn => ({ name, label: name, logicalType: 'varchar', isPk: false, pii: false, emailLike: false, dateLike: false, ...over });
const CONTACTS: SourceTable = {
  id: 'main.crm_contacts',
  label: 'Contacts',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: 'created_at', updated: 'updated_at' },
  columns: [column('email', { emailLike: true, pii: true }), column('owner_id')],
  children: [],
  pageSlug: null,
};
const SOURCES: Sources = { connections: [{ id: 'cnx_1', name: 'CRM', dialect: 'sqlite', timezone: 'UTC', tables: [CONTACTS] }], templates: [], roles: [] };

const mail = (over: Partial<Email> = {}): Email => ({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'email' }, vars: {}, ...over });

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => cleanup());

function inspect(action: Action) {
  const onChange = vi.fn();
  render(<ActionSettings action={action} sources={SOURCES} table={CONTACTS} connectionId="cnx_1" onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe('the e-mail step\'s kind of mail, in its inspector', () => {
  it('starts a mail to the record\'s address as marketing mail about the newsletter', async () => {
    const { onChange, user } = inspect(mail({ to: null }));
    expect(screen.queryByTestId('email-mail-kind')).toBeNull();
    await user.selectOptions(screen.getByTestId('email-to-kind'), 'field');
    expect(onChange).toHaveBeenCalledWith({ to: { kind: 'field', column: '' }, class: 'marketing', purpose: 'newsletter' });
  });

  it('shows the kind and why you are writing for marketing mail, and changes them', async () => {
    const { onChange, user } = inspect(mail({ class: 'marketing', purpose: 'newsletter' }));
    const kind = screen.getByTestId('email-class');
    expect(within(kind).getByRole('radio', { name: 'Marketing mail' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Service mail (a quote, a receipt, a booking) still reaches people on the do-not-email list. Marketing mail never does.')).toBeTruthy();
    const why = screen.getByTestId('email-purpose');
    expect(within(why).getByRole('radio', { name: 'Newsletter' }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(why).getByRole('radio', { name: 'Surveys' }));
    expect(onChange).toHaveBeenLastCalledWith({ purpose: 'surveys' });
    await user.click(within(kind).getByRole('radio', { name: 'Service mail' }));
    expect(onChange).toHaveBeenLastCalledWith({ class: 'service', purpose: undefined });
  });

  it('shows no "Why you\'re writing" for service mail', () => {
    inspect(mail({ class: 'service' }));
    expect(within(screen.getByTestId('email-class')).getByRole('radio', { name: 'Service mail' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('email-purpose')).toBeNull();
    expect(screen.queryByTestId('email-class-unsaid')).toBeNull();
  });

  it('reads a step saved before steps could say as service mail, and says so', () => {
    inspect(mail());
    expect(within(screen.getByTestId('email-class')).getByRole('radio', { name: 'Service mail' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('email-class-unsaid').textContent).toBe('Saved before mail had kinds: it goes as service mail until you choose.');
    expect(screen.queryByTestId('email-purpose')).toBeNull();
  });

  it('has no kind for a mail to staff, and drops it when the mail goes to staff instead', async () => {
    const { onChange, user } = inspect(mail({ class: 'marketing', purpose: 'surveys' }));
    await user.selectOptions(screen.getByTestId('email-to-kind'), 'staff');
    expect(onChange).toHaveBeenCalledWith({ to: { kind: 'staff', column: '' }, class: undefined, purpose: undefined });
    cleanup();
    inspect(mail({ to: { kind: 'staff', column: 'owner_id' } }));
    expect(screen.queryByTestId('email-mail-kind')).toBeNull();
  });
});

describe('what the step saves', () => {
  const graphOf = (action: Email): Graph => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, { id: 'm', kind: 'action', title: 'Mail', action }] }) as unknown as Graph;
  const saved = (graph: Graph) => JSON.parse(JSON.stringify(graph)) as { nodes: { action?: Record<string, unknown> }[] };

  it('carries the kind and the purpose in the step\'s own JSON', () => {
    let graph = graphOf(mail({ to: null }));
    graph = patchAction(graph, 'm', recipientPatch(mail({ to: null }), { kind: 'field', column: 'email' }) as Partial<Action>);
    expect(saved(graph).nodes[1]!.action).toMatchObject({ to: { kind: 'field', column: 'email' }, class: 'marketing', purpose: 'newsletter' });
    graph = patchAction(graph, 'm', classPatch('service', mail({ class: 'marketing' })) as Partial<Action>);
    expect(saved(graph).nodes[1]!.action).toMatchObject({ class: 'service' });
    expect(saved(graph).nodes[1]!.action).not.toHaveProperty('purpose');
  });

  it('carries neither for a mail to staff', () => {
    let graph = graphOf(mail({ class: 'marketing', purpose: 'surveys' }));
    graph = patchAction(graph, 'm', recipientPatch(mail({ class: 'marketing' }), { kind: 'staff', column: 'owner_id' }) as Partial<Action>);
    const action = saved(graph).nodes[1]!.action!;
    expect(action).not.toHaveProperty('class');
    expect(action).not.toHaveProperty('purpose');
  });

  it('keeps the kind of a mail whose column changes', () => {
    expect(recipientPatch(mail({ class: 'service' }), { kind: 'field', column: 'other' })).toEqual({ to: { kind: 'field', column: 'other' } });
  });
});

describe('the canvas', () => {
  const noop = (): void => undefined;
  const node = (id: string, action: Email) => ({ id, kind: 'action', title: id, action });
  const GRAPH = {
    version: 1,
    nodes: [
      { id: 't', kind: 'trigger', title: 'A contact is added' },
      node('first', mail({ class: 'marketing' })),
      { id: 'wait', kind: 'wait', title: 'Wait 3 days', amount: 3, unit: 'days' },
      node('second', mail({ class: 'marketing', purpose: 'surveys' })),
      node('receipt', mail({ class: 'service' })),
      node('older', mail()),
      node('staff', mail({ to: { kind: 'staff', column: 'owner_id' } })),
    ],
  } as unknown as Graph;
  const props: FlowBuilderProps = { graph: GRAPH, selectedId: null, runningId: null, ranIds: [], incompleteId: null, onSelect: noop, onRemove: noop, onInsert: noop, onMoveTo: noop, onMoveIntoBranch: noop, subFor: () => '' };

  it('says each mail\'s kind under it, and that later marketing mail is checked again', () => {
    render(<FlowBuilder {...props} />);
    const card = (id: string) => screen.getByTestId(`flow-node-${id}`);
    expect(within(card('first')).getByTestId('flow-node-mail-kind').textContent).toBe('Marketing mail · Newsletter');
    expect(within(card('first')).queryByTestId('flow-node-recheck')).toBeNull();
    expect(within(card('second')).getByTestId('flow-node-mail-kind').textContent).toBe('Marketing mail · Surveys');
    expect(within(card('second')).getByTestId('flow-node-recheck').textContent).toBe('Checks consent and the do-not-email list again when it sends.');
    expect(within(card('receipt')).getByTestId('flow-node-mail-kind').textContent).toBe('Service mail');
    expect(within(card('receipt')).queryByTestId('flow-node-recheck')).toBeNull();
    // Saved before steps could say: it goes as service mail, and the canvas says so.
    expect(within(card('older')).getByTestId('flow-node-mail-kind').textContent).toBe('Service mail');
    expect(within(card('staff')).queryByTestId('flow-node-mail-kind')).toBeNull();
  });

  it('counts a marketing mail in one branch only on that branch\'s path', () => {
    const branched = {
      version: 1,
      nodes: [
        { id: 't', kind: 'trigger', title: 'When' },
        {
          id: 'b',
          kind: 'branch',
          title: 'If',
          branches: [
            { id: 'yes', label: 'Yes', condition: null, nodes: [node('y1', mail({ class: 'marketing' })), node('y2', mail({ class: 'marketing' }))] },
            { id: 'no', label: 'No', condition: null, nodes: [node('n1', mail({ class: 'marketing' }))] },
          ],
        },
        node('after', mail({ class: 'marketing' })),
      ],
    } as unknown as Graph;
    expect([...laterMarketingMails(branched)].sort()).toEqual(['after', 'y2']);
  });
});
