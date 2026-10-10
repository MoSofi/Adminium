// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule the assistant drafted, as the panel shows it (comp `Milo
 * Automations`, 01 to 05): the builder's own cards as the preview, what was
 * left out with the add-on that would give it, a rule waiting for a template,
 * a change to the open rule, and a step whose add-on is gone. Each is the
 * product's own card fed a result as the server stores it; nothing is asked
 * of a server. Dark and right-to-left come from the Storybook globals and the
 * VRT matrix.
 */
import type { ReactNode } from 'react';

import { readResult, type AssistantResult } from '../assistant/api.js';
import { contextCopy } from '../assistant/contexts.js';
import { ActionsRow } from '../assistant/parts/ActionsRow.js';
import { ResultCard } from '../assistant/parts/ResultCard.js';
import { SuggestionCard } from '../assistant/parts/SuggestionCard.js';
import type { SourceTable, Sources } from './api.js';
import { RulePreview } from './assistant.js';
import { FlowBuilder } from './flow/FlowBuilder.js';
import type { Graph, Trigger } from './model/graph.js';

const noop = (): void => undefined;
const words = (text: string) => ({ 'en-US': text });
const column = (name: string, emailLike = false) => ({ name, label: name, logicalType: 'varchar', isPk: false, pii: false, emailLike, dateLike: false });
const ORDERS = {
  id: 'main.orders',
  label: 'orders',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: null, updated: null },
  columns: [column('id'), column('customer_id'), column('delivered_at')],
  links: [{ column: 'customer_id', table: 'main.customers', label: 'customers', columns: [column('email', true), column('first_name')] }],
  children: [],
  pageSlug: null,
} as unknown as SourceTable;
const VOUCHER = { addOn: 'offers', addOnName: 'Offers & gift cards', key: 'issue-voucher', name: words('Issue a voucher'), does: words('Sends a voucher from one of your offers'), table: 'main.offers_vouchers', canCreate: true, inputs: [{ key: 'to', label: words('Send to'), kind: 'email' as const, required: true }] };
const sources = (withOffers: boolean): Sources => ({ connections: [{ id: 'cnx_1', name: 'Juniper', dialect: 'sqlite', timezone: 'UTC', tables: [ORDERS], steps: withOffers ? [VOUCHER] : [] }], templates: [{ key: 'thanks', name: 'Thank you for your order', placeholders: [], ownedByApp: false }], roles: [] });

const TRIGGER = { kind: 'record', event: 'updated', connectionId: 'cnx_1', table: 'main.orders', watch: true, changedColumn: 'delivered_at', when: [{ left: { field: 'delivered_at' }, op: 'not_empty' }] } as unknown as Trigger;
const mail = (templateKey: string | null) => ({ id: 'n2', kind: 'action', title: 'Send an email', onError: false, action: { kind: 'email', templateKey, to: { kind: 'field', column: 'customer_id.email' }, vars: {} } });
const voucher = { id: 'n3', kind: 'action', title: 'Issue a voucher', onError: false, action: { kind: 'add-on.step', addOn: 'offers', step: 'issue-voucher', addOnName: 'Offers & gift cards', inputs: { to: '{{record.customer_id.email}}' } } };
const wait = { id: 'n4', kind: 'wait', title: 'Wait 2 hours', amount: 2, unit: 'hours' };
const graphOf = (...nodes: unknown[]): Graph => ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When an order changes' }, ...nodes] }) as unknown as Graph;

const result = (graph: Graph, over: Record<string, unknown> = {}): AssistantResult =>
  readResult({ title: 'Thank customers after delivery', meta: 'New rule · runs on orders', artefact: { name: 'Thank customers after delivery', trigger: TRIGGER, graph }, diff: { against: null, adds: 0, dels: 0, lines: [], truncated: false }, ...over }) as AssistantResult;

const pill = (text: string, warn = false): ReactNode => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-bold ${warn ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-fg-muted'}`}>{text}</span>
);

function Card({ drafted, withOffers, base, badge, note, under, change }: { drafted: AssistantResult; withOffers: boolean; base?: Graph; badge?: ReactNode; note?: string; under?: ReactNode; change?: boolean }) {
  const copy = contextCopy('automation', {}, 'Milo');
  const actions = change === true ? [{ id: 'editor' as const, label: 'Apply to this rule', icon: 'pen-tool', primary: true, writes: false }] : copy.actions;
  return (
    <div className="flex w-[400px] flex-col gap-3.5 bg-bg px-4 py-[18px]">
      <ResultCard
        result={drafted}
        kind={copy.page}
        tokensIn={5200}
        tokensOut={640}
        preview={<RulePreview artefact={drafted.artefact} sources={sources(withOffers)} base={base ?? null} name="Milo" />}
        alwaysLeftOut
        stacked
        badge={badge}
        note={note}
        under={under}
        footer={<ActionsRow actions={actions} enabled canWrite saved={false} name="Milo" busy={false} onRun={noop} />}
      />
    </div>
  );
}

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Assistant/Rule draft' };
export default meta;

export const ARuleDrafted = {
  tags: ['vrt'],
  render: () => <Card drafted={result(graphOf(mail('thanks'), voucher))} withOffers badge={pill('Will be saved switched off')} />,
};

export const WithoutTheAddOn = {
  tags: ['vrt'],
  render: () => (
    <Card
      drafted={result(graphOf(mail('thanks')), { leftOut: [{ what: 'The discount code.', why: 'Nothing installed here can issue one.' }] })}
      withOffers={false}
      badge={pill('Will be saved switched off')}
      under={<SuggestionCard suggestion={{ key: 'offers', name: 'Offers & gift cards', line: 'Discounts, codes, vouchers, packs and gift cards, worked out in the same save as the order.', mayInstall: true }} onOpen={noop} />}
    />
  ),
};

export const WaitingForATemplate = {
  tags: ['vrt'],
  render: () => <Card drafted={result(graphOf(mail(null), voucher))} withOffers badge={pill('Waiting for a template', true)} />,
};

export const AChangeToTheOpenRule = {
  tags: ['vrt'],
  render: () => (
    <Card drafted={result(graphOf(wait, mail('thanks')), { basedOn: 'auto_1', meta: 'Added a 2-hour delay' })} withOffers base={graphOf(mail('thanks'))} note="Nothing is saved until you save the rule." change />
  ),
};

/** On the page itself: a step whose add-on was removed (comp 5c). */
export const TheAddOnWasRemoved = {
  tags: ['vrt'],
  render: () => (
    <div className="w-[720px] bg-bg p-4">
      <FlowBuilder
        graph={graphOf(mail('thanks'), voucher)}
        selectedId={null}
        runningId={null}
        ranIds={[]}
        incompleteId={null}
        subFor={() => ''}
        addOnFor={(node) => (node.id === 'n3' ? { name: 'Offers & gift cards', gone: 'The add-on Offers & gift cards is no longer installed.' } : null)}
        onSelect={noop}
        onRemove={noop}
        onInsert={noop}
        onMoveTo={noop}
        onMoveIntoBranch={noop}
      />
    </div>
  ),
};
