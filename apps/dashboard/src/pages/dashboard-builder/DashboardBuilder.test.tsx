/**
 * Dashboard builder integration (04-T14): edit-mode gating (viewer vs admin),
 * palette insert at first-fit, the auto-generated inspector honoring a locked
 * path, duplicate/remove, and the save/reset persistence flows (persist hooks
 * mocked).
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWidget, type WidgetDefinition } from '@adminium/widgets';
import type { PageEnvelope } from '@adminium/engine/config';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { makeBootstrap, makeDashboardEnvelope } from '../../test/fixtures.js';
import { DashboardBuilder } from './DashboardBuilder.js';

const persist = vi.hoisted(() => ({
  sharedSave: vi.fn(),
  sharedFlush: vi.fn().mockResolvedValue(undefined),
  sharedCancel: vi.fn(),
  personalSave: vi.fn(),
  personalFlush: vi.fn().mockResolvedValue(undefined),
  personalCancel: vi.fn(),
  resetFn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../layout/useLayoutPersistence.js', () => ({
  useSaveSharedLayout: () => ({
    save: persist.sharedSave,
    flush: persist.sharedFlush,
    cancel: persist.sharedCancel,
    isSaving: false,
  }),
  useSavePersonalLayout: () => ({
    save: persist.personalSave,
    flush: persist.personalFlush,
    cancel: persist.personalCancel,
    isSaving: false,
  }),
  useResetLayout: () => ({ reset: persist.resetFn, isResetting: false }),
}));

/** Small registry so the palette mounts only two lightweight previews. */
const smallRegistry: ReadonlyMap<string, WidgetDefinition> = new Map(
  (['kpi-stat-card', 'usage-meter'] as const)
    .map((id) => getWidget(id))
    .filter((definition): definition is WidgetDefinition => definition !== undefined)
    .map((definition) => [definition.id, definition]),
);

function layoutPage(items: PageEnvelope['config']['layout']): PageEnvelope {
  return makeDashboardEnvelope({ config: { layout: items } });
}

function renderBuilder(options: { roles?: string[]; canEditLayout?: boolean; page?: PageEnvelope } = {}) {
  const client = createQueryClient();
  client.setQueryData(['bootstrap'], makeBootstrap({ roles: options.roles ?? ['super-admin'] }));
  const page = options.page ?? makeDashboardEnvelope();
  render(
    <QueryClientProvider client={client}>
      <DashboardBuilder page={page} canEditLayout={options.canEditLayout ?? false} registry={smallRegistry} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), page };
}

function builderItems(): NodeListOf<Element> {
  return document.querySelectorAll('[data-builder-item]');
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
beforeEach(() => vi.clearAllMocks());

describe('edit-mode gating', () => {
  it('viewers edit only their personal layout — no shared save button', async () => {
    const { user } = renderBuilder({ roles: ['viewer'] });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Add widget' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save layout' })).toBeNull();
    expect(screen.getByText(/personal layout/)).toBeDefined();
  });

  it('page-edit grantees edit the shared default with a Save layout button', async () => {
    // Capability, not role: a built-in `editor` blessed with page:<id>:edit.
    const { user } = renderBuilder({ roles: ['editor'], canEditLayout: true });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Save layout' })).toBeDefined();
    expect(screen.getByText(/shared dashboard everyone sees/)).toBeDefined();
  });

  it('a grantless admin edits only a personal override (no shared save)', async () => {
    // A default `admin` holds no per-page grant → canEditLayout false → the
    // client must NOT show the shared Save (the server would 403 the PATCH).
    const { user } = renderBuilder({ roles: ['admin'], canEditLayout: false });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    expect(screen.queryByRole('button', { name: 'Save layout' })).toBeNull();
    expect(screen.getByText(/personal layout/)).toBeDefined();
  });
});

describe('palette insert', () => {
  it('inserts the picked widget at first-fit and closes the palette', async () => {
    const { user } = renderBuilder({ roles: ['admin'] });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));
    expect(builderItems()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    await user.click(await screen.findByRole('button', { name: 'Add Usage meter' }));

    await waitFor(() => expect(builderItems()).toHaveLength(3));
    expect(document.querySelector('[data-grid-widget="usage-meter"]')).not.toBeNull();
  });
});

describe('duplicate / remove', () => {
  it('duplicates then removes a widget', async () => {
    const { user } = renderBuilder({ roles: ['admin'] });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));
    expect(builderItems()).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /^Duplicate / })[0]!);
    await waitFor(() => expect(builderItems()).toHaveLength(3));

    await user.click(screen.getAllByRole('button', { name: /^Remove / })[0]!);
    await waitFor(() => expect(builderItems()).toHaveLength(2));
  });
});

describe('config inspector', () => {
  const page = (): PageEnvelope =>
    layoutPage({
      version: 1,
      items: [
        { i: 'w1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { __locked: ['metricFormat'] } },
      ],
    });

  it('generates fields from the Zod schema and disables the locked path', async () => {
    const { user } = renderBuilder({ roles: ['admin'], page: page() });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Configure KPI stat card' }));

    // Text field from the schema.
    expect(await screen.findByLabelText('Title')).toBeDefined();
    // Enum field rendered as a disabled select because it's locked.
    const metricFormat = screen.getByLabelText('Metric format') as HTMLSelectElement;
    expect(metricFormat.disabled).toBe(true);
    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0);
  });

  it('applies inspector edits to the widget live', async () => {
    const { user } = renderBuilder({ roles: ['admin'], page: page() });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Configure KPI stat card' }));

    await user.type(await screen.findByLabelText('Title'), 'Net revenue');
    // The canvas widget's frame reflects the new title immediately.
    await waitFor(() => expect(screen.getAllByText('Net revenue').length).toBeGreaterThan(0));
  });
});

describe('save + reset persistence', () => {
  it('page-edit users publish the shared default via useSaveSharedLayout', async () => {
    const { user } = renderBuilder({ roles: ['editor'], canEditLayout: true });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    await user.click(await screen.findByRole('button', { name: 'Add Usage meter' }));
    await waitFor(() => expect(builderItems()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Save layout' }));

    await waitFor(() => expect(persist.sharedSave).toHaveBeenCalled());
    const saved = persist.sharedSave.mock.calls.at(-1)?.[0] as { items: unknown[] };
    expect(saved.items).toHaveLength(3);
    expect(persist.sharedFlush).toHaveBeenCalled();
    expect(persist.personalSave).not.toHaveBeenCalled();
  });

  it('viewers auto-save personal rearrangements via useSavePersonalLayout', async () => {
    const { user } = renderBuilder({ roles: ['viewer'] });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    await user.click(screen.getAllByRole('button', { name: /^Remove / })[0]!);

    await waitFor(() => expect(persist.personalSave).toHaveBeenCalled());
    expect(persist.sharedSave).not.toHaveBeenCalled();
  });

  it('a grid keyboard move settles into the draft and auto-saves (viewer)', async () => {
    const stacked = layoutPage({
      version: 1,
      items: [
        { i: 'w1', widget: 'kpi-stat-card', x: 0, y: 0, w: 6, h: 3, config: {} },
        { i: 'w2', widget: 'kpi-stat-card', x: 0, y: 3, w: 6, h: 3, config: {} },
      ],
    });
    const { user } = renderBuilder({ roles: ['viewer'], page: stacked });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    // Each item carries the grid's drag handle (edit mode wired through).
    const grips = document.querySelectorAll('[data-grid-drag-handle]');
    expect(grips).toHaveLength(2);

    // Grab the lower widget, move it up two rows, commit — the grid emits the
    // settled layout, which the builder folds into the draft and auto-saves.
    const lower = grips[1] as HTMLElement;
    lower.focus();
    fireEvent.keyDown(lower, { key: 'ArrowUp' });
    fireEvent.keyDown(lower, { key: 'ArrowUp' });
    fireEvent.keyDown(lower, { key: 'Enter' });

    await waitFor(() => expect(persist.personalSave).toHaveBeenCalled());
  });

  it('Reset layout drops the personal override via useResetLayout', async () => {
    const { user } = renderBuilder({ roles: ['viewer'] });

    await user.click(screen.getByRole('button', { name: 'Dashboard options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset layout' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reset layout' }));

    await waitFor(() => expect(persist.resetFn).toHaveBeenCalled());
  });

  it('Reset cancels the pending personal debounce so a trailing PUT cannot re-create the override', async () => {
    const { user } = renderBuilder({ roles: ['viewer'] });
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    // Dirty the draft → the auto-save effect schedules a trailing personal PUT.
    await user.click(screen.getAllByRole('button', { name: /^Remove / })[0]!);
    await waitFor(() => expect(persist.personalSave).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Dashboard options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset layout' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reset layout' }));

    // The pending debounce is cancelled BEFORE the reset DELETE fires.
    await waitFor(() => expect(persist.resetFn).toHaveBeenCalled());
    expect(persist.personalCancel).toHaveBeenCalled();
    const cancelOrder = persist.personalCancel.mock.invocationCallOrder[0]!;
    const resetOrder = persist.resetFn.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(resetOrder);
  });
});
