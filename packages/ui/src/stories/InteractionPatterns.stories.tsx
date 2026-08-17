// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Interaction-patterns gallery (M1-T05) — the load-bearing behaviors the comps
 * share (research/ia-mapping.md §5 "reusable primitives"), each as a sub-story
 * with a play-function interaction test:
 *
 *   1. Two-phase modal — form → success in one dialog, harvested inputs echoed.
 *   2. Undo toast queue — destructive action + Undo restore, max-4 + FIFO.
 *   3. Type-to-confirm — ConfirmModal gating the danger button ("prod-db").
 *   4. Command palette — ⌘K/Ctrl+K toggle, grouped results, keyboard driven.
 *   5. Autosave indicator — idle → saving → saved cycle, aria-live announced.
 *   6. Bulk action bar — appears on selection, mono count, clear dismisses.
 *
 * Portaled UI (modals, palette) is asserted through `canvasElement.ownerDocument.body`.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import {
  CalendarClock,
  Download,
  LayoutDashboard,
  Mail,
  Plug,
  SunMoon,
  Table2,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';

import {
  AutosaveIndicator,
  type AutosaveStatus,
} from '../components/autosave-indicator/index.js';
import { BulkActionBar, BulkActionButton } from '../components/bulk-action-bar/index.js';
import { Button } from '../components/button/index.js';
import { Card } from '../components/card/index.js';
import { Checkbox } from '../components/checkbox/index.js';
import {
  CommandPalette,
  useCommandK,
  type CommandGroup,
} from '../components/command-palette/index.js';
import { ConfirmModal } from '../components/confirm-modal/index.js';
import { FormField } from '../components/form-field/index.js';
import { Input } from '../components/input/index.js';
import { Kbd } from '../components/kbd/index.js';
import { ModalBody, ModalFooter, ModalHeader } from '../components/modal/index.js';
import { MonoText } from '../components/mono-text/index.js';
import { ToastStack } from '../components/toast/index.js';
import { useToastQueue } from '../components/toast/index.js';
import { TwoPhaseModal, useModalFlow } from '../components/two-phase-modal/index.js';

const meta = {
  title: 'DesignSystem/Interaction Patterns',
  parameters: { layout: 'padded', a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Modals/palettes portal to document.body — query there, not the canvas. */
const withinBody = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);

/* ------------------------------------------------------------------ */
/* 1. Two-phase modal                                                   */
/* ------------------------------------------------------------------ */

function InviteFlowDemo() {
  const flow = useModalFlow<{ email: string }>();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('ravi@adminium.io');
  return (
    <div className="flex flex-col items-start gap-3">
      <Button onClick={() => setOpen(true)}>Invite teammate</Button>
      <p className="max-w-[52ch] text-body-sm text-fg-muted">
        The same dialog instance swaps its body to a success state on submit; the harvested email
        echoes into the success copy, and closing resets the flow after the exit animation.
      </p>
      <TwoPhaseModal
        flow={flow}
        open={open}
        onOpenChange={setOpen}
        successTitle="Invitation sent"
        successBody={(payload) => (
          <>
            We emailed <MonoText>{payload.email}</MonoText> an invite link. It expires in 7 days.
          </>
        )}
        doneLabel="Done"
      >
        <ModalHeader
          icon={<UserPlus />}
          title="Invite teammate"
          subtitle="They’ll get an email with a join link."
          closeLabel="Close"
        />
        <ModalBody>
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => flow.toSuccess({ email })}>Send invite</Button>
        </ModalFooter>
      </TwoPhaseModal>
    </div>
  );
}

export const TwoPhaseModalFlow: Story = {
  render: () => <InviteFlowDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = withinBody(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Invite teammate' }));
    const input = await body.findByLabelText('Email');
    await userEvent.clear(input);
    await userEvent.type(input, 'dana@adminium.io');
    await userEvent.click(body.getByRole('button', { name: 'Send invite' }));

    // Phase 2: success state in the SAME dialog, echoing the harvested email.
    // (Presence, not visibility: entrance animations keep opacity at 0 in
    // headless/throttled environments, so toBeVisible() would be flaky.)
    await waitFor(() => expect(body.getByText('Invitation sent')).toBeInTheDocument());
    await expect(body.getByText('dana@adminium.io')).toBeInTheDocument();

    await userEvent.click(body.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

/* ------------------------------------------------------------------ */
/* 2. Undo toast queue                                                  */
/* ------------------------------------------------------------------ */

const TABLES = [
  'prod-db',
  'staging-db',
  'analytics-replica',
  'events-archive',
  'billing-db',
  'audit-log',
] as const;

function UndoQueueDemo() {
  const queue = useToastQueue();
  const [rows, setRows] = useState<readonly string[]>(TABLES);

  const remove = (name: string) => {
    setRows((current) => current.filter((row) => row !== name));
    queue.push({
      variant: 'success',
      title: `Deleted ${name}`,
      action: {
        label: 'Undo',
        // Restore in canonical order so undos are position-stable.
        onAction: () => setRows((current) => TABLES.filter((t) => current.includes(t) || t === name)),
      },
    });
  };

  return (
    <div className="flex min-h-[360px] flex-col items-start gap-3">
      <Card padded={false} className="w-full max-w-[440px] divide-y divide-border">
        {rows.map((name) => (
          <div key={name} className="flex items-center gap-3 px-4 py-2">
            <MonoText className="text-body-sm font-semibold text-fg">{name}</MonoText>
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              aria-label={`Delete ${name}`}
              onClick={() => remove(name)}
            >
              Delete
            </Button>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-body-sm text-fg-muted">All connections deleted.</p>
        ) : null}
      </Card>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            for (let i = 1; i <= 7; i++) {
              queue.push({ variant: 'info', title: `Toast ${i} of 7` });
            }
          }}
        >
          Push 7 toasts
        </Button>
        <Button variant="ghost" onClick={() => queue.dismiss()}>
          Dismiss all
        </Button>
      </div>
      <ToastStack {...queue.stackProps} dismissLabel="Dismiss notification" label="Notifications" />
    </div>
  );
}

export const UndoToastQueue: Story = {
  render: () => <UndoQueueDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Destructive action → row gone, undo toast up.
    await userEvent.click(canvas.getByRole('button', { name: 'Delete prod-db' }));
    await waitFor(() => expect(canvas.queryByText('prod-db')).not.toBeInTheDocument());

    // Undo restores the row and dismisses the toast.
    await userEvent.click(await canvas.findByRole('button', { name: 'Undo' }));
    await expect(await canvas.findByText('prod-db')).toBeInTheDocument();

    // Max-4 clamp: 7 pushed, only 4 visible (3 queue FIFO behind them).
    await userEvent.click(canvas.getByRole('button', { name: 'Push 7 toasts' }));
    await waitFor(() => {
      const region = canvas.getByRole('region', { name: 'Notifications' });
      expect(within(region).getAllByRole('status')).toHaveLength(4);
    });

    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss all' }));
    await waitFor(() =>
      expect(within(canvas.getByRole('region', { name: 'Notifications' })).queryAllByRole('status')).toHaveLength(0),
    );
  },
};

/* ------------------------------------------------------------------ */
/* 3. Type-to-confirm                                                   */
/* ------------------------------------------------------------------ */

function TypeToConfirmDemo() {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="destructive"
        onClick={() => {
          setDeleted(false);
          setOpen(true);
        }}
      >
        Delete prod-db
      </Button>
      {deleted ? <p className="text-body-sm text-fg-muted">Connection prod-db deleted.</p> : null}
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="Delete connection"
        body="This permanently deletes prod-db and its 14 mapped tables."
        confirmWord="prod-db"
        promptLabel={
          <>
            Type <MonoText className="text-fg">prod-db</MonoText> to confirm
          </>
        }
        confirmLabel="Delete connection"
        cancelLabel="Cancel"
        closeLabel="Close"
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          setDeleted(true);
          setOpen(false);
        }}
      />
    </div>
  );
}

export const TypeToConfirm: Story = {
  render: () => <TypeToConfirmDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = withinBody(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Delete prod-db' }));
    const dialog = await body.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete connection' });
    await expect(confirmButton).toBeDisabled();

    // The danger button unlocks only on an exact match.
    await userEvent.type(within(dialog).getByRole('textbox'), 'prod-db');
    await expect(confirmButton).toBeEnabled();
    await userEvent.click(confirmButton);

    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    await expect(canvas.getByText('Connection prod-db deleted.')).toBeVisible();
  },
};

/* ------------------------------------------------------------------ */
/* 4. Command palette + ⌘K                                              */
/* ------------------------------------------------------------------ */

const PALETTE_GROUPS: readonly CommandGroup[] = [
  {
    id: 'recent',
    label: 'Recent',
    items: [
      { id: 'orders', label: 'public.orders', icon: <Table2 />, keywords: ['table'] },
      { id: 'revenue', label: 'Revenue overview', icon: <LayoutDashboard />, keywords: ['dashboard'] },
      { id: 'weekly', label: 'Weekly revenue', icon: <CalendarClock />, keywords: ['report'] },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      { id: 'connect', label: 'Connect database', icon: <Plug />, hint: 'G C' },
      { id: 'invite', label: 'Invite teammate', icon: <UserPlus />, hint: 'G I' },
      { id: 'theme', label: 'Switch theme', icon: <SunMoon />, hint: 'G T' },
    ],
  },
];

function PaletteDemo() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState('—');
  useCommandK(() => setOpen((current) => !current));
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open command palette
        <Kbd>⌘K</Kbd>
      </Button>
      <p className="text-body-sm text-fg-muted">
        Last action: <MonoText className="text-fg">{last}</MonoText>
      </p>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        groups={PALETTE_GROUPS}
        onSelect={(item) => setLast(item.label)}
        labels={{
          dialog: 'Command palette',
          placeholder: 'Search dashboards, tables, records…',
          navigate: 'navigate',
          open: 'open',
          close: 'close',
          empty: (query) => <>No results for “{query}”</>,
        }}
        footerExtra={<span className="text-caption font-bold text-accent">Ask AI</span>}
      />
    </div>
  );
}

export const CommandPaletteK: Story = {
  render: () => <PaletteDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = withinBody(canvasElement);

    // Global hotkey (useCommandK handles both ⌘K and Ctrl+K).
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await body.findByRole('dialog');

    // The search input is auto-focused — typing filters across groups.
    await userEvent.keyboard('invite');
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: /Invite teammate/ })).toBeInTheDocument(),
    );
    await expect(within(dialog).queryByRole('option', { name: /Connect database/ })).not.toBeInTheDocument();

    // Enter opens the active (first) result and closes the palette.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(canvas.getByText('Invite teammate')).toBeInTheDocument();
  },
};

/* ------------------------------------------------------------------ */
/* 5. Autosave indicator                                                */
/* ------------------------------------------------------------------ */

function AutosaveDemo() {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const save = () => {
    setStatus('saving');
    window.setTimeout(() => setStatus('saved'), 900);
    window.setTimeout(() => setStatus('idle'), 3200);
  };
  return (
    <div className="flex items-center gap-4">
      <Button variant="secondary" onClick={save}>
        Edit a field
      </Button>
      <AutosaveIndicator
        status={status}
        savingLabel="Saving…"
        savedLabel="All changes saved"
        errorLabel="Couldn’t save"
      />
    </div>
  );
}

export const AutosaveCycle: Story = {
  render: () => <AutosaveDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Edit a field' }));
    // The pill fades in via nb-fade, so assert presence, then the settled state.
    await expect(canvas.getByText('Saving…')).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByText('All changes saved')).toBeInTheDocument(), {
      timeout: 2500,
    });
  },
};

/* ------------------------------------------------------------------ */
/* 6. Bulk action bar                                                   */
/* ------------------------------------------------------------------ */

const MEMBERS = [
  { id: 'u1', name: 'Ava Chen', email: 'ava.chen@adminium.io' },
  { id: 'u2', name: 'Ravi Patel', email: 'ravi@adminium.io' },
  { id: 'u3', name: 'Dana Kim', email: 'dana@adminium.io' },
  { id: 'u4', name: 'Liam Fox', email: 'liam@adminium.io' },
  { id: 'u5', name: 'Mia Novak', email: 'mia@adminium.io' },
] as const;

function BulkSelectionDemo() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string, checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <div className="flex min-h-[320px] flex-col items-start gap-4">
      <Card padded={false} className="w-full max-w-[520px] divide-y divide-border">
        {MEMBERS.map((member) => (
          <div key={member.id} className="flex items-center gap-3 px-4 py-2.5">
            <Checkbox
              checked={selected.has(member.id)}
              onCheckedChange={(checked) => toggle(member.id, checked === true)}
              aria-label={`Select ${member.name}`}
            />
            <span className="text-body font-semibold text-fg">{member.name}</span>
            <span className="ms-auto text-body-sm text-fg-muted">{member.email}</span>
          </div>
        ))}
      </Card>
      {selected.size > 0 ? (
        <BulkActionBar
          floating={false}
          count={selected.size}
          countLabel="selected"
          label="Bulk actions"
          clearLabel="Clear selection"
          onClear={() => setSelected(new Set())}
        >
          <BulkActionButton icon={<Download />}>Export</BulkActionButton>
          <BulkActionButton icon={<Mail />}>Email</BulkActionButton>
          <BulkActionButton destructive icon={<Trash2 />}>
            Delete
          </BulkActionButton>
        </BulkActionBar>
      ) : null}
    </div>
  );
}

export const BulkSelection: Story = {
  render: () => <BulkSelectionDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Ava Chen' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Ravi Patel' }));

    const bar = await canvas.findByRole('toolbar', { name: 'Bulk actions' });
    await waitFor(() => expect(within(bar).getByText('2')).toBeInTheDocument());

    await userEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    await waitFor(() =>
      expect(canvas.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument(),
    );
  },
};
