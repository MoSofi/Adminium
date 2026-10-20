// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building from a site template, in the chat: the plan card, the sheet it opens (a section open in
 * each, and at phone width), building and answered; then "Check this before it goes live" asked,
 * after a plan, allowed and not allowed. Dark, right-to-left and density come from the Storybook
 * globals and the VRT matrix.
 */
import type { ReactNode } from 'react';

import type { TemplatePlanAnswer } from '../api.js';
import { AccessChangeCard } from './chat.js';
import { BAKERY_PLAN } from './templatePlan.fixture.js';
import { TemplatePlanCard } from './templatePlan.js';

const noop = (): void => undefined;
const ANSWER: TemplatePlanAnswer & { type: 'template-plan' } = {
  type: 'template-plan',
  tables: ['products', 'orders', 'order_lines', 'subscribers'],
  decisions: { 'card-payments': 'replace', search: 'replace', 'chat-widget': 'replace' },
  links: {},
  takeOutEmpty: true,
  added: [],
};
const chat = (children: ReactNode, width = 'w-[340px]') => <div className={`flex ${width} flex-col gap-4 bg-surface p-[15px]`}>{children}</div>;

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/From a template' };
export default meta;

export const PlanCard = { tags: ['vrt'], render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={noop} />) };

export const PlanCardWide = { tags: ['vrt'], render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={noop} />, 'w-[380px]') };

export const SheetTables = {
  tags: ['vrt'],
  render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={noop} start={{ sheet: true, sections: ['tables'] }} />),
};

export const SheetShows = {
  tags: ['vrt'],
  render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={noop} start={{ sheet: true, sections: ['shows'] }} />),
};

export const SheetOnAPhone = {
  tags: ['vrt'],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={noop} start={{ sheet: true, sections: ['shows'] }} />, 'w-full'),
};

export const SheetWithChanges = {
  tags: ['vrt'],
  render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={noop} start={{ sheet: true, sections: ['added', 'changes'] }} />),
};

export const Building = { tags: ['vrt'], render: () => chat(<TemplatePlanCard card={BAKERY_PLAN} answered answer={ANSWER} busy={false} onSend={noop} />) };

export const Answered = {
  tags: ['vrt'],
  render: () =>
    chat(
      <>
        <TemplatePlanCard card={BAKERY_PLAN} answered closed answer={ANSWER} busy={false} onSend={noop} />
        <TemplatePlanCard card={{ ...BAKERY_PLAN, id: 'plan-2' }} answered closed answer={{ ...ANSWER, changes: 'Keep Categories as fixed text on the Menu page.' }} busy={false} onSend={noop} />
      </>,
    ),
};

const BOOKINGS = { id: 'access-1', type: 'access-change' as const, changes: [{ kind: 'access' as const, verb: 'add' as const, table: 'Bookings' }], planned: false };
const SHOP = { id: 'access-2', type: 'access-change' as const, changes: [{ kind: 'call' as const, screen: 'shop' }], planned: true };

export const CheckAsked = { tags: ['vrt'], render: () => chat(<AccessChangeCard card={BOOKINGS} answered={false} busy={false} onAllow={noop} onRefuse={noop} />) };

export const CheckAfterAPlan = { tags: ['vrt'], render: () => chat(<AccessChangeCard card={{ ...SHOP, changes: [...BOOKINGS.changes, ...SHOP.changes] }} answered={false} busy={false} onAllow={noop} onRefuse={noop} />) };

const LONG = {
  id: 'access-3',
  type: 'access-change' as const,
  changes: [
    { kind: 'access' as const, verb: 'read-columns' as const, table: 'Bookings', columns: ['name', 'email', 'phone', 'party size', 'date', 'time', 'notes', 'table'] },
    { kind: 'access' as const, verb: 'no-check' as const, table: 'Messages' },
    { kind: 'access' as const, verb: 'read-all' as const, table: 'Menu items' },
    { kind: 'access' as const, verb: 'hidden-rows' as const, table: 'Orders' },
  ],
  more: 5,
  planned: true,
};

export const CheckWithMore = { tags: ['vrt'], render: () => chat(<AccessChangeCard card={LONG} answered={false} busy={false} onAllow={noop} onRefuse={noop} />) };

export const CheckWithMoreAllowed = { tags: ['vrt'], render: () => chat(<AccessChangeCard card={LONG} answered allowed busy={false} onAllow={noop} onRefuse={noop} />) };

export const CheckAllowed = { tags: ['vrt'], render: () => chat(<AccessChangeCard card={{ ...BOOKINGS, planned: true }} answered allowed busy={false} onAllow={noop} onRefuse={noop} />) };

export const CheckNotAllowed = { tags: ['vrt'], render: () => chat(<AccessChangeCard card={SHOP} answered allowed={false} busy={false} onAllow={noop} onRefuse={noop} />) };
