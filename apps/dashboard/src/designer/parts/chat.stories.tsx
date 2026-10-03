// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer's chat pieces, in the states the build page draws. Dark,
 * right-to-left and density come from the Storybook globals and the VRT
 * matrix, not from separate stories.
 */

import type { StepRow } from '../build/turns.js';
import { BuildComposer } from './BuildComposer.js';
import {
  DesignerMessage,
  FailedNote,
  LimitNote,
  NotAppliedNote,
  PackageCard,
  PersonMessage,
  QuestionCard,
  RemovalCard,
  SavedChip,
  StepsBlock,
  StoppedNote,
  UsageLine,
} from './chat.js';

const DONE: StepRow[] = [
  { id: 'a', tool: 'read_reference', label: '', state: 'done', ms: 400, detail: null, folded: 1, subject: 'adminium-app' },
  { id: 'b', tool: 'write_file', label: '', state: 'done', ms: 2100, detail: null, folded: 6 },
  { id: 'c', tool: 'check_app', label: '', state: 'failed', ms: 300, detail: 'pages/jobs.json · columns · no column "price"', folded: 1, count: 2 },
  { id: 'd', tool: 'edit_file', label: '', state: 'done', ms: 200, detail: null, folded: 1, subject: 'apps/repairs/manifest/pages/jobs.json' },
  { id: 'e', tool: 'check_app', label: '', state: 'done', ms: 250, detail: null, folded: 1, count: 0 },
  { id: 'f', tool: 'apply_app', label: '', state: 'done', ms: 1800, detail: null, folded: 1 },
];
const LIVE: StepRow[] = [
  { id: 'a', tool: 'read_file', label: '', state: 'done', ms: 120, detail: null, folded: 1, subject: 'apps/repairs/customer/src/App.tsx' },
  { id: 'b', tool: 'build_sides', label: '', state: 'running', ms: null, detail: null, folded: 1 },
];
const noop = (): void => undefined;

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/Chat' };
export default meta;

export const Turns = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[420px] flex-col gap-5 bg-surface p-5">
      <PersonMessage text="A bike repair shop. Track customers, their bikes and repair jobs with parts and labour." />
      <DesignerMessage text="I'll build this as an app called Repair Desk: five tables, a dashboard, a counter screen for staff and a status page for customers." streaming={false}>
        <StepsBlock rows={DONE} stepCount={11} live={false} ms={38_000} open onToggle={noop} />
        <SavedChip name="v1" />
      </DesignerMessage>
      <PersonMessage text="Now the customer page to check a repair." />
      <DesignerMessage text="Writing the customer page" streaming>
        <StepsBlock rows={LIVE} stepCount={2} live ms={null} open onToggle={noop} />
        <UsageLine step={3} tokens={12_400} />
      </DesignerMessage>
    </div>
  ),
};

export const Cards = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[420px] flex-col gap-4 bg-surface p-5">
      <QuestionCard card={{ id: 'q', type: 'question', question: 'Should mechanics see part prices?', choices: ['Yes', 'No, hide prices'] }} answered={false} busy={false} onChoose={noop} onOwnWords={noop} />
      <RemovalCard
        card={{ id: 'r', type: 'removal', appKey: 'repairs', changes: [{ kind: 'column', table: 'repairs_jobs', tableName: 'jobs', column: 'notes', rows: 127 }] }}
        answered={false}
        busy={false}
        onKeep={noop}
        onRemove={noop}
      />
      <RemovalCard
        card={{ id: 'n', type: 'removal', appKey: 'repairs', changes: [{ kind: 'narrow', table: 'repairs_jobs', tableName: 'jobs', column: 'code', rows: 3 }] }}
        answered={false}
        busy={false}
        onKeep={noop}
        onRemove={noop}
      />
      <PackageCard card={{ id: 'p', type: 'package', name: 'qrcode', version: '1.5.4', why: 'A QR code on the customer page links to the repair.' }} answered={false} busy={false} onAdd={noop} onSkip={noop} />
      <QuestionCard card={{ id: 'a', type: 'question', question: 'Should mechanics see part prices?', choices: [] }} answered answer="No, hide prices" busy={false} onChoose={noop} onOwnWords={noop} />
    </div>
  ),
};

export const Endings = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[420px] flex-col gap-4 bg-surface p-5">
      <StoppedNote busy={false} onContinue={noop} onPutBack={noop} />
      <LimitNote which="steps" value={60} version="v5" busy={false} onKeepGoing={noop} />
      <LimitNote which="session-tokens" value={4_000_000} version={null} busy={false} />
      <FailedNote error={{ code: 'server', message: 'overloaded', provider: 'Anthropic', status: 529 }} busy={false} onRetry={noop} />
      <NotAppliedNote message="The check found errors." />
    </div>
  ),
};

export const Composer = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[420px] flex-col gap-4 bg-surface-2 p-3">
      <BuildComposer value="" onChange={noop} onSend={noop} onStop={noop} working={false} canSend placeholder="Describe a change…" model={<span className="px-2 text-xs font-bold text-fg-muted">Claude Sonnet 5.5</span>} />
      <BuildComposer value="" onChange={noop} onSend={noop} onStop={noop} working canSend={false} placeholder="Describe a change…" model={<span className="px-2 text-xs font-bold text-fg-muted">Claude Sonnet 5.5</span>} />
    </div>
  ),
};
