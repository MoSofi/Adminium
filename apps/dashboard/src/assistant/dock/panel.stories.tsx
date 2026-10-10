// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's panel, in the states the comp draws (Milo Panel): idle,
 * working, an answer with what stands under it, the suggestion card in both
 * forms, a draft parked on another page, and the states of the whole panel.
 * Dark and right-to-left come from the Storybook globals and the VRT matrix,
 * not from separate stories.
 */
import type { ReactNode } from 'react';

import { readAnswer } from '../api.js';
import { AllowanceBar } from '../parts/AllowanceBar.js';
import { Idle } from '../parts/Idle.js';
import { UnavailableBar } from '../parts/UnavailableBar.js';
import type { ThreadTurn } from '../thread.js';
import { TurnView } from '../TurnView.js';
import { PanelView, type PanelViewProps } from './PanelView.js';
import { ParkedDraft } from './ParkedDraft.js';

const noop = (): void => undefined;

function turn(over: Partial<ThreadTurn>): ThreadTurn {
  return {
    id: 't1',
    status: 'done',
    askText: 'Who are our best customers?',
    pickedLabels: [],
    say: 'Your five best customers this year are Lena Hoffmann, Jonas Weber, Mia Schulz, Felix Braun and Clara Neumann, by the total of their orders.',
    steps: [
      { id: 'page', state: 'done', icon: 'file-search', label: '', detail: '', tables: [], facts: { tables: 14, page: 'Customers', table: 'main.customers' } },
      { id: 'a', state: 'done', icon: 'database', label: 'Ranked them by total', detail: 'Top 5 of 214', tables: ['shop.main.orders', 'shop.main.customers'] },
    ],
    ask: null,
    result: null,
    errorMessage: null,
    tooLong: false,
    errorKind: null,
    usedUpUntil: null,
    answer: readAnswer({ sources: ['shop.main.orders', 'shop.main.customers'], reads: [], followups: ['Compare with last year', 'Who comes next?'] }),
    context: 'data',
    on: { pageId: 'p1', documentId: null, title: 'Customers', scope: { kind: 'page', count: null }, gone: false },
    jobId: null,
    tokensIn: 6_800,
    tokensOut: 310,
    ...over,
  };
}

function Turn({ value, newest = true }: { value: ThreadTurn; newest?: boolean }) {
  return (
    <TurnView
      turn={value}
      live={false}
      liveSteps={[]}
      answered={!newest}
      workTitle="Read the data"
      context={value.context}
      name="Milo"
      canConfigure
      newest={newest}
      blocked={false}
      onAsk={noop}
      onOpenAddOn={noop}
      askedOn={`on ${value.on.title ?? 'Email templates'}`}
      askedScope={value.on.scope === null ? undefined : 'Filtered rows'}
      picks={{}}
      onPick={noop}
      onGo={noop}
      onRetry={noop}
      renderResult={(result) => <ParkedDraft title={result.title} madeOn={value} name="Milo" />}
    />
  );
}

function Panel({ children, ...over }: Partial<PanelViewProps> & { children?: ReactNode }) {
  return (
    <div className="flex h-[900px] w-[400px] bg-bg">
      <PanelView
        layout="docked"
        name="Milo"
        lookingAt="Customers · 214 rows shown"
        canStartNew
        onNew={noop}
        onClose={noop}
        busyElsewhere={false}
        chip={{ icon: 'filter', label: '214 filtered rows' }}
        onDismissChip={noop}
        followups={[]}
        input=""
        onInput={noop}
        onSubmit={noop}
        placeholder="Ask about this data…"
        blocked={false}
        working={false}
        onStop={noop}
        nextTurnTokens={3_300}
        dimmed={false}
        {...over}
      >
        {children}
      </PanelView>
    </div>
  );
}

const IDLE = (
  <Idle
    greeting="I can read what this page shows, and the other tables your role can read."
    greetingSub="Ask about the rows here. I answer in words, with the figures, and say which tables I read."
    suggestions={[
      { icon: 'calculator', label: 'How many rows are shown here?' },
      { icon: 'search', label: 'Summarise what this page shows' },
      { icon: 'clock', label: 'What changed most recently?' },
    ]}
    onPick={noop}
  />
);

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Assistant/Panel' };
export default meta;

export const IdleOnAPage = { tags: ['vrt'], render: () => <Panel canStartNew={false}>{IDLE}</Panel> };

export const AnAnswer = {
  tags: ['vrt'],
  render: () => (
    <Panel>
      <Turn value={turn({})} />
    </Panel>
  ),
};

export const PartOfATableAndNothingRead = {
  tags: ['vrt'],
  render: () => (
    <Panel chip={null}>
      <Turn
        newest={false}
        value={turn({
          id: 'a',
          answer: readAnswer({ sources: ['shop.main.orders'], reads: [{ table: 'shop.main.orders', returned: 50, total: 830 }] }),
          on: { pageId: 'p1', documentId: null, title: 'Orders', scope: null, gone: false },
        })}
      />
      <Turn
        value={turn({
          id: 'b',
          askText: 'Who usually orders most?',
          say: 'Usually the customers with the most orders, but I would need to read your data to say who.',
          steps: [],
          answer: readAnswer({ sources: [], reads: [], forgot: 4 }),
        })}
      />
    </Panel>
  ),
};

const OFFERS = { key: 'offers', name: 'Offers & gift cards', line: 'Discounts, codes, vouchers, packs and gift cards, worked out in the same save as the order.' };
const suggestion = (mayInstall: boolean) =>
  turn({
    askText: 'Can I give regulars 10% off their next order?',
    say: 'You cannot do that here yet. The Offers & gift cards add-on adds discount codes, vouchers and gift cards.',
    steps: [],
    answer: readAnswer({ sources: [], reads: [], suggest: [{ ...OFFERS, mayInstall }] }),
    on: { pageId: 'p2', documentId: null, title: 'Orders', scope: null, gone: false },
  });

export const SuggestionMayInstall = {
  tags: ['vrt'],
  render: () => (
    <Panel chip={null} lookingAt="Orders · 25 rows shown">
      <Turn value={suggestion(true)} />
    </Panel>
  ),
};

export const SuggestionMayNotInstall = {
  tags: ['vrt'],
  render: () => (
    <Panel chip={null} lookingAt="Orders · 25 rows shown">
      <Turn value={suggestion(false)} />
    </Panel>
  ),
};

const DRAFT = {
  title: 'Autumn at Juniper Kitchen',
  meta: 'template',
  workTitle: 'Drafted a new email template',
  basedOn: null,
  light: true,
  artefact: {},
  warning: null,
  details: [],
  modelDetails: [],
  checks: [],
  leftOut: [],
  followups: [],
  sources: [],
  saved: null,
  diff: { against: null, adds: 0, dels: 0, lines: [], truncated: false },
};
const drafted = (gone: boolean) =>
  turn({
    askText: 'Draft an email for our new autumn menu.',
    say: 'Here is a draft.',
    steps: [],
    answer: null,
    context: 'email',
    result: DRAFT,
    on: { pageId: null, documentId: gone ? 'tpl_1' : null, title: null, scope: null, gone },
  });

export const ADraftParkedOnAnotherPage = {
  tags: ['vrt'],
  render: () => (
    <Panel chip={null} lookingAt="Orders · 25 rows shown">
      <Turn newest={false} value={drafted(false)} />
      <Turn newest={false} value={drafted(true)} />
    </Panel>
  ),
};

export const Working = {
  tags: ['vrt'],
  render: () => (
    <Panel working chip={null}>
      <Turn value={turn({ status: 'running', say: null, answer: null, steps: [] })} />
    </Panel>
  ),
};

export const StillWorkingElsewhere = {
  render: () => (
    <Panel busyElsewhere chip={null}>
      <Turn value={turn({})} />
    </Panel>
  ),
};

export const NoModel = {
  tags: ['vrt'],
  render: () => (
    <Panel blocked chip={null} bars={<UnavailableBar reason="no-provider" name="Milo" canConfigure onOpenSettings={noop} />}>
      {null}
    </Panel>
  ),
};

export const AllowanceUsed = {
  tags: ['vrt'],
  render: () => (
    <Panel blocked chip={null} bars={<AllowanceBar resetsAt={Date.UTC(2026, 9, 10, 0, 0)} />}>
      <Turn value={turn({})} />
    </Panel>
  ),
};

export const WrongFormat = {
  tags: ['vrt'],
  render: () => (
    <Panel chip={null}>
      <Turn value={turn({ status: 'failed', say: null, answer: null, errorKind: 'model-format', steps: [] })} />
    </Panel>
  ),
};

export const BehindAPageDialog = {
  render: () => (
    <Panel dimmed blocked>
      <Turn value={turn({})} />
    </Panel>
  ),
};

export const AsASheet = {
  tags: ['vrt'],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  // Fixed to the window, as on a phone: the sheet fills the story's frame.
  render: () => (
    <Panel layout="sheet" chip={null} lookingAt="Orders · 25 rows shown">
      <Turn value={turn({ on: { pageId: 'p2', documentId: null, title: 'Orders', scope: null, gone: false } })} />
    </Panel>
  ),
};

// ── speaking to the assistant (comp 19, 20) ─────────────────────────────────
const MIC = { state: 'idle' as const, seconds: 0, language: 'English', note: null, maxMinutes: 2, notice: null, onNoticeRead: noop, onToggle: noop };

export const MicIdle = { render: () => <Panel mic={MIC}>{IDLE}</Panel> };

export const MicListening = {
  tags: ['vrt'],
  render: () => (
    <Panel mic={{ ...MIC, state: 'listening', seconds: 7 }} input="Which dishes sold best last">
      {IDLE}
    </Panel>
  ),
};

export const MicWritingItDown = { render: () => <Panel mic={{ ...MIC, state: 'working' }}>{IDLE}</Panel> };

export const MicDone = {
  tags: ['vrt'],
  render: () => (
    <Panel mic={{ ...MIC, note: 'check' }} input="Which dishes sold best last weekend?">
      {IDLE}
    </Panel>
  ),
};

export const MicBlockedByTheBrowser = { tags: ['vrt'], render: () => <Panel mic={{ ...MIC, note: 'blocked' }}>{IDLE}</Panel> };

export const MicUsedUpForToday = { render: () => <Panel mic={{ ...MIC, note: 'used' }}>{IDLE}</Panel> };

export const MicFailed = { render: () => <Panel mic={{ ...MIC, note: 'failed' }}>{IDLE}</Panel> };

export const MicStoppedByItself = {
  render: () => (
    <Panel mic={{ ...MIC, note: 'stopped' }} input="Which dishes sold best last weekend, and which ones should we take off the autumn menu because">
      {IDLE}
    </Panel>
  ),
};

export const MicTheOneTimeNotice = {
  tags: ['vrt'],
  render: () => <Panel mic={{ ...MIC, notice: 'What you say is sent to OpenAI to be written down. Nothing is kept.' }}>{IDLE}</Panel>,
};
