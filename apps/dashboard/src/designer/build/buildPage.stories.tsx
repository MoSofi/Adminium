// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page's parts in the states it draws: the work bar at each of its
 * levels, the address list, bar 1's own parts, and the Code tab clean, edited,
 * held and with a file changed underneath. Dark, right-to-left and density
 * come from the Storybook globals and the VRT matrix, not from more stories.
 *
 * Nothing here asks a server anything: each part is handed the model it would
 * be handed on the page, written out.
 */
import type { ReactNode } from 'react';
import { Tabs, TabsContent } from '@adminium/ui';

import type { DesignerFiles, DesignerVersion } from '../api.js';
import { PersonMessage } from '../parts/chat.js';
import { AddressBar, type KnownPage } from './AddressBar.js';
import type { BarLevel } from './barLevel.js';
import { CodeBarEnd } from './CodeBar.js';
import { idleCode } from './codeFiles.fixture.js';
import CodeTab from './CodeTab.js';
import { SessionMenu } from './SessionMenu.js';
import { SessionTitle } from './SessionTitle.js';
import type { CodeFiles } from './useCodeFiles.js';
import type { PreviewModel, PreviewSide } from './usePreview.js';
import { WorkBar, type WorkTab } from './WorkBar.js';

const noop = (): void => undefined;

const TABS: WorkTab[] = [
  { value: 'preview', label: 'Preview' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'code', label: 'Code' },
];

function previewOf(sides: readonly PreviewSide[], side: PreviewSide, seenAs: readonly string[] | null, sees = true): PreviewModel {
  return {
    noPreview: false,
    app: { key: 'shop' } as PreviewModel['app'],
    appPending: false,
    sides,
    side,
    setSide: noop,
    width: 'desktop',
    setWidth: noop,
    round: 1,
    reload: noop,
    sees,
    setSees: noop,
    prefix: side === 'dashboard' ? '' : `/apps/shop/${side}`,
    to: '/',
    path: side === 'staff' ? '/orders' : '/menu/spicy-wings',
    spoken: true,
    go: noop,
    visited: [],
    frame: { current: null },
    dashboardSrc: '/',
    onStaffNavigate: noop,
    ticket: { url: 'about:blank', origin: 'http://localhost', seenAs },
    ticketError: null,
    running: false,
    openTab: noop,
  };
}

const PAGES: KnownPage[] = [
  { path: '/', name: 'Home' },
  { path: '/menu', name: 'Menu' },
  { path: '/menu/spicy-wings', name: 'Spicy wings' },
  { path: '/cart', name: 'Cart' },
  { path: '/order', name: 'My order' },
];

function Bar({ width, level, sides, side, seenAs, sees, tab = 'preview', end }: { width: number; level: BarLevel; sides: readonly PreviewSide[]; side: PreviewSide; seenAs: readonly string[] | null; sees?: boolean; tab?: string; end?: ReactNode }): ReactNode {
  const preview = previewOf(sides, side, seenAs, sees);
  return (
    // The bar at a width of its own, as the work area would give it.
    <div className="[width:var(--bar-w)] max-w-full" style={{ '--bar-w': `${String(width)}px` }}>
      <Tabs value={tab} onValueChange={noop}>
        <WorkBar tabs={TABS} tab={tab} level={level} preview={preview} address={<AddressBar side={side} path={preview.path} prefix={preview.prefix} spoken pages={PAGES} onGo={noop} />} onNotice={noop} end={end} endFills={tab === 'code'} />
        {/* The selected tab names its panel: on the page that is the work area under the bar. */}
        <TabsContent value={tab} className="sr-only" />
      </Tabs>
    </div>
  );
}

const THREE: PreviewSide[] = ['dashboard', 'staff', 'customer'];
const TWO: PreviewSide[] = ['dashboard', 'customer'];

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/Build page' };
export default meta;

export const WorkBarLevels = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-4 bg-bg p-4">
      <Bar width={1059} level={0} sides={TWO} side="customer" seenAs={null} />
      <Bar width={1120} level={1} sides={THREE} side="staff" seenAs={['Cook', 'Cashier']} sees={false} />
      <Bar width={900} level={2} sides={THREE} side="staff" seenAs={['Cook', 'Cashier']} />
      <Bar width={744} level={3} sides={THREE} side="staff" seenAs={['Cook', 'Cashier']} />
      <Bar width={1059} level={0} sides={TWO} side="dashboard" seenAs={null} tab="architecture" end={<span className="text-[12px] font-semibold text-fg-muted">Read only · drawn from v13</span>} />
    </div>
  ),
};

export const WorkBarOnAPhone = {
  tags: ['vrt'],
  render: () => (
    <div className="bg-bg p-2">
      <Bar width={390} level={4} sides={TWO} side="customer" seenAs={null} />
    </div>
  ),
};

export const AddressList = {
  tags: ['vrt'],
  render: () => (
    <div className="flex h-[300px] w-[520px] items-start bg-surface p-4">
      <AddressBar side="customer" path="/menu/spicy-wings" prefix="/apps/shop/customer" spoken pages={PAGES} listLabel="Pages you have opened" onGo={noop} />
    </div>
  ),
  // The list opens when the field takes the keyboard.
  play: ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLInputElement>('[role="combobox"]')?.focus();
  },
};

const VERSIONS: DesignerVersion[] = [
  { n: 13, name: 'v13 · Warm table style', at: 1_760_000_000_000, current: true },
  { n: 12, name: 'v12 · Your edit to Menu.tsx', at: 1_759_999_000_000, current: false },
  { n: 11, name: 'v11 · Cart and pickup times', at: 1_759_998_000_000, current: false },
];

export const TopBarParts = {
  tags: ['vrt'],
  render: () => (
    <div className="flex h-[52px] w-[900px] items-center justify-between gap-3.5 border-b border-border bg-surface px-4">
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        <SessionTitle title="Crispy Bites" onRename={noop} versions={VERSIONS} available current={VERSIONS[0] ?? null} onGoBack={noop} busy={false} />
      </div>
      <SessionMenu
        sessions={[
          { id: 'ds_a', title: 'Crispy Bites', updatedAt: 1_760_000_000_000, turns: 4 },
          { id: 'ds_b', title: 'The menu page', updatedAt: 1_759_990_000_000, turns: 2 },
        ]}
        currentId="ds_a"
        onNew={noop}
        onOpen={noop}
        disabled={false}
      />
    </div>
  ),
};

const MENU = 'apps/shop/customer/src/pages/Menu.tsx';
const SOURCE = `import { useState } from "react";
import { Flame } from "lucide-react";
import { Card } from "../ui/card";

// The menu, grouped as the kitchen groups it.
export default function Menu() {
  const [group, setGroup] = useState("wings");
  const price = 9.5;
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-4xl">Our menu</h1>
      <Card title="Spicy wings" hot={<Flame />} price={price} onPick={() => setGroup("wings")} />
    </main>
  );
}
`;
const LIST: DesignerFiles = {
  busy: null,
  version: 13,
  groups: [
    {
      key: 'customer',
      files: [
        { path: 'apps/shop/customer/src/App.tsx', label: 'customer/App.tsx', hash: 'a'.repeat(64), size: 900 },
        { path: 'apps/shop/customer/src/pages/Home.tsx', label: 'customer/pages/Home.tsx', hash: 'a'.repeat(64), size: 900 },
        { path: MENU, label: 'customer/pages/Menu.tsx', hash: 'a'.repeat(64), size: 900 },
        { path: 'apps/shop/customer/src/ui/button.tsx', label: 'customer/ui/button.tsx', hash: 'a'.repeat(64), size: 300 },
        { path: 'apps/shop/customer/src/design.css', label: 'customer/design.css', hash: 'a'.repeat(64), size: 200 },
      ],
    },
    { key: 'dashboard', files: [{ path: 'apps/shop/manifest/pages/shop-orders.json', label: 'dashboard/pages/orders.json', hash: 'a'.repeat(64), size: 200 }] },
    {
      key: 'settings',
      files: [
        { path: 'apps/shop/design.md', label: 'design.md', hash: 'a'.repeat(64), size: 500, note: 'brief' },
        { path: 'apps/shop/look.json', label: 'look.json', hash: 'a'.repeat(64), size: 60 },
        { path: 'apps/shop/manifest/app.json', label: 'app.json', hash: 'a'.repeat(64), size: 120 },
      ],
    },
  ],
};

function codeOf(over: Partial<CodeFiles>): CodeFiles {
  return idleCode({ active: true, list: LIST, listState: 'ready', open: MENU, content: { state: 'ready', text: SOURCE }, textFor: () => SOURCE, ...over });
}

function CodeFrame({ code }: { code: CodeFiles }): ReactNode {
  return (
    <div className="flex h-[440px] w-[1059px] flex-col border border-border bg-surface">
      <div className="flex min-h-[46px] items-center gap-3 border-b border-border px-3">
        <CodeBarEnd code={code} />
      </div>
      <CodeTab code={code} compact={false} onFix={noop} />
    </div>
  );
}

export const CodeClean = { tags: ['vrt'], render: () => <CodeFrame code={codeOf({})} /> };

export const CodeEdited = {
  tags: ['vrt'],
  render: () => <CodeFrame code={codeOf({ marks: new Set([MENU]), edited: new Set([MENU]), count: 1, canSave: true, canDiscard: true })} />,
};

export const CodeHeld = { tags: ['vrt'], render: () => <CodeFrame code={codeOf({ lock: 'turn' })} /> };

export const CodeChangedUnderneath = {
  tags: ['vrt'],
  render: () => <CodeFrame code={codeOf({ marks: new Set([MENU]), edited: new Set([MENU]), changed: new Set([MENU]), count: 1, canSave: true, canDiscard: true })} />,
};

export const CodeNotApplied = {
  tags: ['vrt'],
  render: () => (
    <CodeFrame
      code={codeOf({
        marks: new Set([MENU]),
        count: 1,
        canSave: true,
        problem: { kind: 'not-applied', stage: 'build', lines: ['customer/src/pages/Menu.tsx:12:6: Expected ">" but found "<"'] },
      })}
    />
  ),
};

export const CopyAMessage = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[400px] flex-col gap-8 bg-surface p-5">
      <PersonMessage text="A fried-chicken shop called Crispy Bites. Customers order on the website for pickup or delivery." />
      <PersonMessage text="Put the spicy items first on the menu." />
    </div>
  ),
  // The button of the first message, as the keyboard reaches it.
  play: ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('button')?.focus();
  },
};
