// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule the assistant drafted, on the rules page (comp `Milo Automations`,
 * 01–04): the card's preview is the builder's own drawing, small and
 * read-only; a new rule says it will be saved switched off; one whose email
 * has no template waits, with the way to Email templates; and a change to the
 * rule that is open goes into the page's own unsaved draft, never to a save.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readResult, type AssistantResult } from '../assistant/api.js';
import { contextCopy } from '../assistant/contexts.js';
import { LiveDraft } from '../assistant/dock/LiveDraft.js';
import type { AssistantHostContext } from '../assistant/hostContext.js';
import type { ThreadTurn } from '../assistant/thread.js';
import { installTestI18n } from '../i18n/testing.js';
import type { SourceTable, Sources } from './api.js';
import { useAutomationAssistant, type OpenRule } from './assistant.js';
import type { Graph, Trigger } from './model/graph.js';

const column = (name: string, emailLike = false) => ({ name, label: name, logicalType: 'varchar', isPk: false, pii: false, emailLike, dateLike: false });
const ORDERS = {
  id: 'main.orders',
  label: 'orders',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: null, updated: null },
  columns: [column('id'), column('customer_id'), column('delivered_at')],
  links: [{ column: 'customer_id', table: 'main.customers', label: 'customers', columns: [column('email', true)] }],
  children: [],
  pageSlug: null,
} as unknown as SourceTable;
const SOURCES: Sources = { connections: [{ id: 'cnx_1', name: 'Juniper', dialect: 'sqlite', timezone: 'UTC', tables: [ORDERS], steps: [] }], templates: [{ key: 'thanks', name: 'Thank you for your order', placeholders: [], ownedByApp: false }], roles: [] };

const TRIGGER = { kind: 'record', event: 'updated', connectionId: 'cnx_1', table: 'main.orders', watch: true, changedColumn: 'delivered_at', when: [{ left: { field: 'delivered_at' }, op: 'not_empty' }] } as unknown as Trigger;
const mail = (templateKey: string | null) => ({ id: 'n2', kind: 'action', title: 'Send an email', onError: false, action: { kind: 'email', templateKey, to: { kind: 'field', column: 'customer_id.email' }, vars: {} } });
const graphOf = (...nodes: unknown[]): Graph => ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When an order changes' }, ...nodes] }) as unknown as Graph;
const OPEN: OpenRule = { id: 'auto_1', name: 'Thank customers after delivery', description: null, trigger: TRIGGER, graph: graphOf(mail('thanks')) };

const draft = (graph: Graph, over: Record<string, unknown> = {}): AssistantResult =>
  readResult({ title: 'Thank customers after delivery', meta: 'New rule · runs on orders', artefact: { name: 'Thank customers after delivery', trigger: TRIGGER, graph, enabled: false }, diff: { against: null, adds: 0, dels: 0, lines: [], truncated: false }, ...over }) as AssistantResult;
const turn = (result: AssistantResult, documentId: string | null): ThreadTurn =>
  ({ id: 't1', status: 'done', askText: 'x', pickedLabels: [], say: 'Here is the rule.', steps: [], ask: null, result, errorMessage: null, tooLong: false, errorKind: null, usedUpUntil: null, answer: null, context: 'automation', on: { pageId: null, documentId, title: null, scope: null, gone: false }, tokensIn: 1, tokensOut: 1 }) as unknown as ThreadTurn;

/** The rules page's own assistant host, with a rule open or none, and the draft's card on it. */
function mount(result: AssistantResult, open: OpenRule | null) {
  const onApply = vi.fn();
  const onOpenEmailTemplates = vi.fn();
  const runAction = vi.fn().mockResolvedValue(null);
  function Page() {
    const host: AssistantHostContext = useAutomationAssistant({ sources: SOURCES, name: 'Milo', open, onApply, onOpen: () => undefined });
    return (
      <LiveDraft
        turn={turn(result, open?.id ?? null)}
        result={result}
        host={() => host}
        copy={contextCopy('automation', {}, 'Milo')}
        name="Milo"
        enabled
        canWrite
        tokensIn={1}
        tokensOut={1}
        runAction={runAction}
        loadWhole={() => undefined}
        onOwnDialog={() => undefined}
        onLeave={() => undefined}
        onOpenEmailTemplates={onOpenEmailTemplates}
      />
    );
  }
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({ component: () => <QueryClientProvider client={queryClient}><Page /></QueryClientProvider> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  return { onApply, onOpenEmailTemplates, runAction };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(cleanup);

describe('a rule the assistant drafted', () => {
  it('is previewed by the builder\'s own cards, small and out of the tab order, with its steps said in words beside', async () => {
    mount(draft(graphOf(mail('thanks'))), null);
    const preview = await screen.findByTestId('assistant-rule-preview');
    expect(preview.hasAttribute('inert')).toBe(true);
    expect(within(preview).getByTestId('flow-node-n1').textContent).toContain('TRIGGER');
    expect(within(preview).getByTestId('flow-node-n1').textContent).toContain('When an order changes');
    expect(within(preview).getByTestId('flow-node-n2').textContent).toContain('Send an email');
    // A picture of the rule: no place to add a step, no step to remove.
    expect(within(preview).queryByTestId('flow-add-end')).toBeNull();
    expect(screen.getByTestId('assistant-rule-outline').querySelectorAll('li')).toHaveLength(2);
  });

  it('a new rule says it will be saved switched off, and what it left out: "Nothing."', async () => {
    mount(draft(graphOf(mail('thanks'))), null);
    expect((await screen.findByTestId('assistant-rule-badge')).textContent).toBe('Will be saved switched off');
    expect(screen.getByTestId('assistant-left-out').textContent).toBe('What I left out, and whyNothing.');
    expect(screen.queryByTestId('assistant-rule-handoff')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save rule (switched off)' })).toBeDefined();
  });

  it('one whose email has no template waits for one, with the way to Email templates', async () => {
    const { onOpenEmailTemplates } = mount(draft(graphOf(mail(null))), null);
    expect((await screen.findByTestId('assistant-rule-badge')).textContent).toBe('Waiting for a template');
    const handoff = screen.getByTestId('assistant-rule-handoff');
    expect(handoff.textContent).toContain('Open Email templates to draft one. This conversation comes with you.');
    await userEvent.setup().click(within(handoff).getByRole('button', { name: 'Open Email templates' }));
    expect(onOpenEmailTemplates).toHaveBeenCalledTimes(1);
  });

  it('a change to the rule that is open is applied to the builder, not saved: one button, what is new marked, and nothing sent to the server', async () => {
    const wait = { id: 'n3', kind: 'wait', title: 'Wait 2 hours', amount: 2, unit: 'hours' };
    const changed = graphOf(wait, mail('thanks'));
    const { onApply, runAction } = mount(draft(changed, { basedOn: 'auto_1', meta: 'Changed this rule' }), OPEN);
    const preview = await screen.findByTestId('assistant-rule-preview');
    // Only the step the open rule does not have says who added it.
    expect(within(preview).getAllByTestId('flow-node-tag').map((tag) => tag.textContent)).toEqual(['Added by Milo']);
    expect(within(within(preview).getByTestId('flow-node-n3')).getByTestId('flow-node-tag')).toBeDefined();
    expect(screen.queryByTestId('assistant-rule-badge')).toBeNull();
    expect(screen.getByTestId('assistant-result-note').textContent).toBe('Nothing is saved until you save the rule.');
    expect(screen.queryByRole('button', { name: 'Save rule (switched off)' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply to this rule' }));
    expect(onApply).toHaveBeenCalledWith({ trigger: TRIGGER, graph: changed });
    expect(runAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Applied to this rule. It is not saved yet.')).toBeDefined());
  });

  it('a NEW rule drafted while another is open is never put into the open one', async () => {
    const { onApply } = mount(draft(graphOf(mail('thanks'))), OPEN);
    expect((await screen.findByTestId('assistant-rule-badge')).textContent).toBe('Will be saved switched off');
    expect(screen.queryByRole('button', { name: 'Apply to this rule' })).toBeNull();
    // "Open in builder" here is the save that then opens the new rule: it asks first, and applies nothing.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open in builder' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(await screen.findByText('Save this rule?')).toBeDefined();
  });
});
