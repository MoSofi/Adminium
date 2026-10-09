// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the assistant asks a person to confirm, in the states the comp draws
 * (Milo Panel, 13 to 18): one change, a list, a delete with what refers to
 * the row, a send, the states around a proposal, and what a confirmation
 * leaves behind. Each is the live card, fed a proposal as the server sends
 * it; nothing is asked of a server. Dark and right-to-left come from the
 * Storybook globals and the VRT matrix.
 */
import type { ReactNode } from 'react';

import { readProposal, type AssistantProposal } from '../api.js';
import { AssistantBubble } from '../parts/AssistantBubble.js';
import { UserBubble } from '../parts/UserBubble.js';
import { LiveProposal, type LiveProposalProps } from './LiveProposal.js';

const noop = (): void => undefined;

const change = (id: string, before: string, after: string, column = 'status') => ({
  do: 'row.change',
  table: 'main.invoices',
  id,
  preview: { kind: 'change', before: { [column]: before }, after: { [column]: after } },
});
const refused = (id: string, message: string) => ({ do: 'row.change', table: 'main.invoices', id, refused: { code: 'COLUMN_FORBIDDEN', message } });
const open = (actions: unknown[], title = 'Mark as paid') => ({ state: 'open', title, actions, madeAt: 1, hash: 'a'.repeat(64), expiresAt: 9e15 });
const applied = (actions: unknown[], picked: number[], outcome: Record<string, unknown>) => ({ state: 'applied', title: 'Mark as paid', madeAt: 1, actions, picked, outcome });

function Card({ proposal, asked, said = 'I can do this for you.', ...over }: Omit<Partial<LiveProposalProps>, 'proposal'> & { proposal: unknown; asked?: string; said?: string | null }) {
  const read = readProposal(proposal) as AssistantProposal;
  return (
    <Frame>
      {asked === undefined ? null : <UserBubble text={asked} pickedLabels={[]} askedOn="on Invoices" />}
      {said === null || asked === undefined ? null : (
        <AssistantBubble>
          <p className="text-[13.5px] leading-[1.6] text-fg">{said}</p>
        </AssistantBubble>
      )}
      <AssistantBubble spacer={asked !== undefined} bare>
        <LiveProposal sessionId="s1" turnId="t1" proposal={read} name="Milo" atHome homeTitle="Invoices" onOpenHome={noop} onAsk={noop} blocked={false} onChanged={noop} {...over} />
      </AssistantBubble>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="flex w-[400px] flex-col gap-3.5 bg-bg px-4 py-[18px]">{children}</div>;
}

const three = [change('INV-0214', 'sent', 'paid'), change('INV-0216', 'sent', 'paid'), change('INV-0217', 'sent', 'paid')];

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Assistant/Proposal' };
export default meta;

export const OneChange = {
  tags: ['vrt'],
  render: () => (
    <Card
      asked="Mark this as paid."
      proposal={open([{ do: 'row.change', table: 'main.invoices', id: 'INV-0218', preview: { kind: 'change', before: { status: 'sent', paid_at: null }, after: { status: 'paid', paid_at: '2026-10-09' } } }])}
    />
  ),
};

export const AListOfChanges = { tags: ['vrt'], render: () => <Card asked="Mark these as paid" proposal={open(three)} /> };

export const ALongList = {
  render: () => <Card asked="Mark these as paid" proposal={open(Array.from({ length: 50 }, (_, index) => change(`INV-0${String(160 + index)}`, 'sent', 'paid')))} />,
};

export const ADelete = {
  tags: ['vrt'],
  render: () => (
    <Card
      asked="Delete this customer"
      proposal={open(
        [
          {
            do: 'row.delete',
            table: 'main.customers',
            id: 'HOFFL',
            preview: { kind: 'delete', row: { customer_id: 'HOFFL', company_name: 'Lena Hoffmann', email: 'lena.h@mail.example' }, references: [{ table: 'main.orders', count: 12 }, { table: 'main.order_items', count: 31 }] },
          },
        ],
        'Delete the customer',
      )}
    />
  ),
};

export const ASend = {
  tags: ['vrt'],
  render: () => (
    <Card
      asked="Send the Menu update to all staff"
      onOpenTemplate={noop}
      proposal={open(
        [{ do: 'send.template', preview: { kind: 'send.template', id: 'tpl_1', name: 'Menu update', subject: 'Our autumn menu starts Monday', roles: [{ id: 'r1', name: 'Staff' }], total: 14, skipped: 0 } }],
        'Send the menu update',
      )}
    />
  ),
};

export const SaveADraft = {
  render: () => <Card asked="Write a welcome email and save it" proposal={open([{ do: 'doc.save', preview: { kind: 'doc.save', what: 'email', name: 'Welcome aboard' } }], 'Save the welcome email')} />,
};

export const BeingChecked = { render: () => <Card proposal={{ state: 'unchecked', madeAt: 1 }} /> };

export const PartCannotBeDone = {
  tags: ['vrt'],
  render: () => (
    <Card
      proposal={open([
        change('INV-0214', 'sent', 'paid'),
        change('INV-0216', 'sent', 'paid'),
        refused('INV-0219', 'You may not change total on invoices.'),
        refused('INV-0220', 'You may not change total on invoices.'),
      ])}
    />
  ),
};

export const LetGo = {
  tags: ['vrt'],
  render: () => (
    <Frame>
      <LiveProposal sessionId="s1" turnId="a" proposal={readProposal({ state: 'superseded', title: 'Mark as paid', madeAt: 1, count: 3 }) as AssistantProposal} name="Milo" atHome homeTitle="Invoices" onOpenHome={noop} onAsk={noop} blocked={false} onChanged={noop} />
      <LiveProposal sessionId="s1" turnId="b" proposal={readProposal({ state: 'expired', title: 'Mark as paid', madeAt: 1, count: 3 }) as AssistantProposal} name="Milo" atHome homeTitle="Invoices" onOpenHome={noop} onAsk={noop} blocked={false} onChanged={noop} />
      <LiveProposal sessionId="s1" turnId="c" proposal={readProposal(open(three)) as AssistantProposal} name="Milo" atHome={false} homeTitle="Invoices" onOpenHome={noop} onAsk={noop} blocked={false} onChanged={noop} />
      <LiveProposal
        sessionId="s1"
        turnId="d"
        proposal={readProposal({ state: 'refused', title: 'Mark as paid', madeAt: 1, actions: [{ do: 'row.change', id: '1' }], refusal: { code: 'OVER_CAP', message: '', count: 80, cap: 50 } }) as AssistantProposal}
        name="Milo"
        atHome
        homeTitle="Invoices"
        onOpenHome={noop}
        onAsk={noop}
        blocked={false}
        onChanged={noop}
      />
    </Frame>
  ),
};

export const AllDone = {
  tags: ['vrt'],
  render: () => <Card proposal={applied(three, [0, 1, 2], { done: [{ index: 0, id: 'INV-0214' }, { index: 1, id: 'INV-0216' }, { index: 2, id: 'INV-0217' }], failed: [], notTried: [] })} />,
};

export const DoneInPart = {
  tags: ['vrt'],
  render: () => (
    <Card
      proposal={applied([...three, change('INV-0219', 'sent', 'paid'), change('INV-0220', 'sent', 'paid')], [0, 1, 2, 3, 4], {
        done: [{ index: 0, id: 'INV-0214' }, { index: 1, id: 'INV-0216' }, { index: 2, id: 'INV-0217' }],
        failed: [{ index: 3, code: 'COLUMN_FORBIDDEN', message: 'You may not change total on invoices.' }, { index: 4, code: 'ROW_CHANGED', message: 'This invoice was paid in the meantime.' }],
        notTried: [],
      })}
    />
  ),
};

export const StoppedPartWay = {
  tags: ['vrt'],
  render: () => (
    <Card
      proposal={{
        ...applied([...three, change('INV-0219', 'sent', 'paid'), change('INV-0220', 'sent', 'paid')], [0, 1, 2, 3, 4], {
          done: [{ index: 0, id: 'INV-0214' }, { index: 1, id: 'INV-0216' }],
          failed: [],
          unsure: [2],
          notTried: [3, 4],
        }),
        state: 'interrupted',
      }}
    />
  ),
};
