// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer's chat pieces, in the states the build page draws. Dark,
 * right-to-left and density come from the Storybook globals and the VRT
 * matrix, not from separate stories.
 */

import type { StepRow } from '../build/turns.js';
import { BuildComposer } from './BuildComposer.js';
import { PickedTray, SentPicked } from './picked.js';
import {
  AddOnCard,
  DesignerMessage,
  FailedNote,
  KeepSpotCard,
  LimitNote,
  NeedsCard,
  NotAppliedNote,
  PackageCard,
  PersonMessage,
  PictureLines,
  PictureNote,
  PicturesChip,
  QuestionCard,
  RemovalCard,
  RowsCard,
  SavedChip,
  SpendNotice,
  SpotsCard,
  StepsBlock,
  StoppedNote,
  StyleChip,
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
      <RowsCard
        card={{ id: 'rw', type: 'rows', attachment: 'att_00000000000000000001', file: 'orders.csv', table: 'orders', rows: 1200, left: 4, reasons: ['row 7, email: is required'], mapping: [{ from: 'Customer', to: 'name' }, { from: 'E-mail', to: 'email' }, { from: 'Total', to: 'total' }] }}
        answered={false}
        busy={false}
        onLoad={noop}
        onSkip={noop}
      />
      <AddOnCard
        card={{ id: 'ao', type: 'add-on', key: 'invoices', name: 'Invoices & Receipts', version: '1.0.7', line: 'Invoices, quotes and receipts, numbered and sent by email.' }}
        answered={false}
        busy={false}
        onGet={noop}
        onSkip={noop}
      />
      <AddOnCard card={{ id: 'ao2', type: 'add-on', key: 'invoices', name: 'invoices', version: null, line: '', listOff: true }} answered={false} busy={false} onGet={noop} onSkip={noop} />
      <QuestionCard card={{ id: 'a', type: 'question', question: 'Should mechanics see part prices?', choices: [] }} answered answer="No, hide prices" busy={false} onChoose={noop} onOwnWords={noop} />
    </div>
  ),
};

const STYLES = [
  { key: 'warm', title: 'Warm table', description: 'Cream, terracotta and a serif. For restaurants, cafés and bakeries.', origin: 'built-in' as const, swatch: { bg: '#faf4ea', text: '#2c1d13', accent: '#a04e26' } },
  { key: 'craft-market', title: 'Craft market', description: 'Oat, charcoal and clay. For makers and small shops.', origin: 'built-in' as const, swatch: { bg: '#f5efe6', text: '#2a2622', accent: '#b4532a' } },
  { key: 'night', title: 'Night', description: 'Near-black with amber. For bars, cinema and late venues.', origin: 'built-in' as const, swatch: { bg: '#0e0e12', text: '#f3f1ea', accent: '#f5a524' } },
  { key: 'house', title: 'Lucia house style', description: 'From this project', origin: 'project' as const },
];
const NEEDS = [
  { id: 'package:react', kind: 'package' as const, name: 'react', version: '19.2.0', role: 'screens' as const },
  { id: 'package:@adminiumjs/public-client', kind: 'package' as const, name: '@adminiumjs/public-client', version: '0.3.17', role: 'public-client' as const },
  { id: 'package:tailwindcss', kind: 'package' as const, name: 'tailwindcss', version: '4.3.3', role: 'tailwind' as const },
  { id: 'package:lucide-react', kind: 'package' as const, name: 'lucide-react', version: '1.52.0', role: 'icons' as const, why: 'For the menu’s section marks and the booking form.' },
  { id: 'font:@fontsource/playfair-display', kind: 'font' as const, family: 'Playfair Display', name: '@fontsource/playfair-display', version: '5.3.0', use: 'heading' as const },
  { id: 'font:@fontsource/inter', kind: 'font' as const, family: 'Inter', name: '@fontsource/inter', version: '5.3.0', use: 'body' as const },
  { id: 'site:images.example.com', kind: 'picture-site' as const, host: 'images.example.com' },
  { id: 'package:date-fns', kind: 'package' as const, name: 'date-fns', version: '4.1.0', role: 'other' as const, why: 'Opening hours by weekday.' },
];

/** The cards a design raises: everything it needs on one card, the style question, and a question with no choices. */
export const DesignCards = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-4 bg-surface p-5">
      <NeedsCard card={{ id: 'n1', type: 'needs', items: NEEDS }} answered={false} busy={false} onSend={noop} />
      <NeedsCard card={{ id: 'n2', type: 'needs', items: NEEDS }} answered accepted={NEEDS.slice(0, 6).map((item) => item.id)} busy={false} onSend={noop} />
      <NeedsCard card={{ id: 'n3', type: 'needs', items: NEEDS.slice(5, 6) }} answered={false} busy onSend={noop} />
      <QuestionCard card={{ id: 's1', type: 'question', question: 'How should it look?', choices: ['warm', 'craft-market', 'surprise'], style: STYLES, more: ['night', 'house'] }} answered={false} busy={false} onChoose={noop} onOwnWords={noop} />
      <QuestionCard card={{ id: 'q2', type: 'question', question: 'What are the restaurant’s opening hours?', choices: [] }} answered={false} busy={false} onChoose={noop} onOwnWords={noop} />
      <StyleChip title="Warm table" fontsLater />
    </div>
  ),
};

/** The page's pictures in the chat: the needs card's own choice, the spots card and its answered form, the keep-it card and its two answers, the chip, the Apply and Undo lines, the note at a reply's end. */
export const PictureCards = {
  tags: ['vrt'],
  render: () => {
    const spots = { id: 'sp1', type: 'spots' as const, spots: [{ id: 'hero', label: 'Hero', shape: 'wide' as const }, { id: 'team', label: 'Team', shape: 'wide' as const }, { id: 'kitchen', label: 'Kitchen', shape: 'square' as const }], rows: { table: 'Dishes', count: 8 } };
    const keep = { id: 'k1', type: 'keep-spot' as const, spot: 'hero', label: 'Hero', screen: 'Home' };
    return (
      <div className="flex w-[420px] flex-col gap-4 bg-surface p-5">
        <NeedsCard card={{ id: 'n4', type: 'needs', items: NEEDS.slice(0, 2), pictures: { preselect: 'placeholders' } }} answered={false} busy={false} onSend={noop} />
        <NeedsCard card={{ id: 'n5', type: 'needs', items: NEEDS.slice(0, 2), pictures: { preselect: 'placeholders' } }} answered accepted={[NEEDS[0]?.id ?? '']} answeredPictures="choose" busy={false} onSend={noop} />
        <SpotsCard card={spots} chosen={[]} onChoose={noop} />
        <SpotsCard card={spots} chosen={['Hero', 'Team']} onChoose={noop} />
        <KeepSpotCard card={keep} answered={false} busy={false} onKeep={noop} onLetGo={noop} />
        <KeepSpotCard card={keep} answered kept busy={false} onKeep={noop} onLetGo={noop} />
        <KeepSpotCard card={keep} answered kept={false} busy={false} onKeep={noop} onLetGo={noop} />
        <DesignerMessage text="The home page has a hero, a team section and a kitchen picture now." streaming={false}>
          <PictureNote lines={[{ kind: 'note', note: 'placeholders', count: 3 }]} />
          <div className="flex flex-wrap items-center gap-1.5">
            <SavedChip name="v13" />
            <PicturesChip toFill={3} onOpen={noop} />
            <PicturesChip toFill={0} onOpen={noop} />
          </div>
        </DesignerMessage>
        <PictureLines lines={[{ kind: 'applied', names: ['Hero', 'Team'], version: { n: 14, name: 'v14 · Pictures: Hero, Team' } }, { kind: 'undone', to: 13 }]} />
        <PictureNote lines={[{ kind: 'note', note: 'still-empty', count: 3 }]} />
      </div>
    );
  },
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

/** The marks passed: this turn's while it still works, the session's from then on, and both at once. */
export const Spend = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[420px] flex-col gap-3 bg-surface pb-4 pt-2">
      <SpendNotice warnings={[{ which: 'turn-tokens', mark: 150_000 }]} />
      <SpendNotice warnings={[{ which: 'session-tokens', mark: 1_000_000 }]} onNewSession={noop} />
      <SpendNotice
        warnings={[
          { which: 'turn-tokens', mark: 150_000 },
          { which: 'session-tokens', mark: 1_000_000 },
        ]}
        onNewSession={noop}
      />
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

const PICKED = { side: 'customer' as const, path: '/menu', page: 1280, part: 'button btn primary', text: 'Add to cart', label: '', within: ['div card'], nth: 3, of: 12, width: 120, height: 40 };

/** The element a person pointed at in the preview: waiting above the box, and under a sent message. */
export const PickedElement = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-4 bg-surface-2 p-3">
      <BuildComposer
        value=""
        onChange={noop}
        onSend={noop}
        onStop={noop}
        working={false}
        canSend
        placeholder="Say what to change about this element…"
        model={<span className="px-2 text-xs font-bold text-fg-muted">Claude Sonnet 5.5</span>}
        tray={<PickedTray picked={PICKED} onRemove={noop} />}
      />
      <SentPicked picked={{ ...PICKED, part: 'img hero', text: '', label: 'The house burger on a wooden board, seen from above' }} />
    </div>
  ),
};
