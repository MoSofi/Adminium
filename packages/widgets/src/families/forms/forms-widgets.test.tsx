// @vitest-environment happy-dom
/**
 * TRACK FCS — `forms` family unit tests (annex §10).
 *
 * The QA harness (qa/*) already proves the generic contracts for every
 * delivered widget (four states, config fuzz, determinism, chunk budget). These
 * cover what is SPECIFIC to this family — above all THE WRITE MODEL, which is
 * the part that can lose a user's data if it is wrong:
 *   · required-field validation (and that `false` is a legitimate switch value)
 *   · submit awaits the host's commit — a rejected insert must not show success
 *   · optimistic toggles roll back when the host rejects them
 *   · an unbound widget emits no intent (there is nowhere to send it)
 *   · derived facet counts / issue ordering / step-state derivation
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DrawerFormWidget } from './DrawerForm.js';
import { ALL_KEY, FilterChipBarWidget, facetsOf } from './FilterChipBar.js';
import { ChipInputWidget, PasswordStrengthMeterWidget, SegmentedControlWidget } from './InputWidgets.js';
import { ModalWizardWidget } from './ModalWizard.js';
import { OptionCardsWidget, optionsOf } from './OptionCards.js';
import { ProgressBarWidget } from './ProgressBarWidget.js';
import { StepperWidget, stepsOf } from './StepperWidget.js';
import { ToggleSwitchListWidget } from './ToggleSwitchList.js';
import { ValidationIssuesListWidget, issuesOf, sortIssues } from './ValidationIssuesList.js';
import { booleanEntriesOf, facetCountsOf } from './forms-lib.js';
import { formValuesOf, initialValues, missingRequired, resolveFields } from './forms-state.js';
import {
  chipInputConfigSchema,
  drawerFormConfigSchema,
  filterChipBarConfigSchema,
  modalWizardConfigSchema,
  optionCardsConfigSchema,
  passwordStrengthMeterConfigSchema,
  progressBarConfigSchema,
  segmentedControlConfigSchema,
  stepperConfigSchema,
  toggleSwitchListConfigSchema,
  validationIssuesListConfigSchema,
} from './forms-config.js';
import type { FormFieldConfig } from './forms-config.js';

afterEach(cleanup);

function cfg<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

const noop = () => {};

const BINDING = { connectionId: 'c1', source: { schema: 'public', name: 'customers' }, shape: 'form-state' };

const FIELDS: FormFieldConfig[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true },
  { name: 'active', label: 'Active', kind: 'switch', required: false },
];

// ── form-state readers ─────────────────────────────────────────────────────

describe('form-state readers (04 §3)', () => {
  it('reads the values map out of the envelope', () => {
    expect(formValuesOf({ fields: [], values: { a: 1 } })).toEqual({ a: 1 });
  });

  it('accepts a bare values object (direct template composition)', () => {
    expect(formValuesOf({ a: 1 })).toEqual({ a: 1 });
  });

  it('returns {} for junk rather than throwing', () => {
    expect(formValuesOf(null)).toEqual({});
    expect(formValuesOf('nope')).toEqual({});
    expect(formValuesOf([1, 2])).toEqual({});
  });

  it('prefers CONFIG fields over payload fields (config is the generated contract)', () => {
    const fields = resolveFields(FIELDS, { fields: [{ name: 'other', kind: 'text' }], values: {} });
    expect(fields.map((f) => f.name)).toEqual(['name', 'active']);
  });

  it('falls back to payload fields when config names none', () => {
    const fields = resolveFields(undefined, { fields: [{ name: 'other', kind: 'text' }], values: {} });
    expect(fields.map((f) => f.name)).toEqual(['other']);
  });

  it('drops payload fields with no name (nothing to write to)', () => {
    expect(resolveFields(undefined, { fields: [{ kind: 'text' }, { name: 'ok' }], values: {} })).toHaveLength(1);
  });

  it('seeds values from the payload and defaults the rest per kind', () => {
    expect(initialValues(FIELDS, { fields: [], values: { name: 'Ana' } })).toEqual({ name: 'Ana', active: false });
  });
});

describe('missingRequired', () => {
  it('reports an empty required field', () => {
    expect(missingRequired(FIELDS, { name: '', active: false })).toEqual(['name']);
  });

  it('passes when the required field is filled', () => {
    expect(missingRequired(FIELDS, { name: 'Ana', active: false })).toEqual([]);
  });

  it('treats `false` as a PRESENT switch value, not a missing one', () => {
    // A required opt-out toggle must be submittable while off — a falsiness
    // check here would make that impossible.
    const fields: FormFieldConfig[] = [{ name: 'agree', kind: 'switch', required: true }];
    expect(missingRequired(fields, { agree: false })).toEqual([]);
  });

  it('treats 0 as a present number value', () => {
    const fields: FormFieldConfig[] = [{ name: 'count', kind: 'number', required: true }];
    expect(missingRequired(fields, { count: 0 })).toEqual([]);
  });
});

// ── modal-wizard: the write model ──────────────────────────────────────────

describe('ModalWizardWidget (annex §10)', () => {
  const open = () => fireEvent.click(screen.getByText('Create'));

  it('blocks submit and flags the field when a required value is missing', async () => {
    const onEvent = vi.fn();
    render(
      <ModalWizardWidget
        config={cfg(modalWizardConfigSchema, { fields: FIELDS, triggerLabel: 'Create', binding: BINDING })}
        instanceId="w1"
        onEvent={onEvent}
        data={{ fields: [], values: {} }}
      />,
    );
    open();
    fireEvent.click(document.querySelector('[data-part="wizard-submit"]') as Element);
    await waitFor(() => expect(screen.getByText('This field is required.')).toBeTruthy());
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('emits an insert intent with the harvested values', async () => {
    const onEvent = vi.fn();
    render(
      <ModalWizardWidget
        config={cfg(modalWizardConfigSchema, { fields: FIELDS, triggerLabel: 'Create', binding: BINDING })}
        instanceId="w2"
        onEvent={onEvent}
        data={{ fields: [], values: { name: 'Ana' } }}
      />,
    );
    open();
    fireEvent.click(document.querySelector('[data-part="wizard-submit"]') as Element);
    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mutate',
          intent: 'insert',
          connectionId: 'c1',
          table: 'public.customers',
          values: expect.objectContaining({ name: 'Ana' }),
        }),
      ),
    );
  });

  it('advances to the success phase only AFTER the host commits', async () => {
    let resolveCommit: (() => void) | undefined;
    const onEvent = vi.fn(() => new Promise<void>((resolve) => (resolveCommit = resolve)));
    render(
      <ModalWizardWidget
        config={cfg(modalWizardConfigSchema, {
          fields: FIELDS,
          triggerLabel: 'Create',
          binding: BINDING,
          successTitle: 'Created!',
        })}
        instanceId="w3"
        onEvent={onEvent}
        data={{ fields: [], values: { name: 'Ana' } }}
      />,
    );
    open();
    fireEvent.click(document.querySelector('[data-part="wizard-submit"]') as Element);
    // In flight: no confirmation yet.
    expect(screen.queryByText('Created!')).toBeNull();
    resolveCommit?.();
    await waitFor(() => expect(screen.getByText('Created!')).toBeTruthy());
  });

  it('does NOT show success when the host REJECTS the insert', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('CONSTRAINT_VIOLATION')));
    render(
      <ModalWizardWidget
        config={cfg(modalWizardConfigSchema, {
          fields: FIELDS,
          triggerLabel: 'Create',
          binding: BINDING,
          successTitle: 'Created!',
        })}
        instanceId="w4"
        onEvent={onEvent}
        data={{ fields: [], values: { name: 'Ana' } }}
      />,
    );
    open();
    fireEvent.click(document.querySelector('[data-part="wizard-submit"]') as Element);
    await waitFor(() => expect(onEvent).toHaveBeenCalled());
    // The form stays up with the input intact — a failed write must never read
    // as a successful one.
    expect(screen.queryByText('Created!')).toBeNull();
    expect(document.querySelector('[data-part="form-fields"]')).toBeTruthy();
  });

  it('emits NO intent on an unbound instance but still confirms locally', async () => {
    const onEvent = vi.fn();
    render(
      <ModalWizardWidget
        config={cfg(modalWizardConfigSchema, { fields: FIELDS, triggerLabel: 'Create', successTitle: 'Created!' })}
        instanceId="w5"
        onEvent={onEvent}
        data={{ fields: [], values: { name: 'Ana' } }}
      />,
    );
    open();
    fireEvent.click(document.querySelector('[data-part="wizard-submit"]') as Element);
    await waitFor(() => expect(screen.getByText('Created!')).toBeTruthy());
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('clears a field error as soon as the field is edited', async () => {
    render(
      <ModalWizardWidget
        config={cfg(modalWizardConfigSchema, { fields: FIELDS, triggerLabel: 'Create' })}
        instanceId="w6"
        onEvent={noop}
        data={{ fields: [], values: {} }}
      />,
    );
    open();
    fireEvent.click(document.querySelector('[data-part="wizard-submit"]') as Element);
    await waitFor(() => expect(screen.getByText('This field is required.')).toBeTruthy());
    fireEvent.change(document.querySelector('#w6-name') as Element, { target: { value: 'A' } });
    await waitFor(() => expect(screen.queryByText('This field is required.')).toBeNull());
  });
});

// ── drawer-form ────────────────────────────────────────────────────────────

describe('DrawerFormWidget (annex §10)', () => {
  it('emits an insert intent and closes on a successful commit', async () => {
    const onEvent = vi.fn();
    render(
      <DrawerFormWidget
        config={cfg(drawerFormConfigSchema, { fields: FIELDS, triggerLabel: 'New', binding: BINDING })}
        instanceId="d1"
        onEvent={onEvent}
        data={{ fields: [], values: { name: 'Ana' } }}
      />,
    );
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(document.querySelector('[data-part="drawer-submit"]') as Element);
    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mutate', intent: 'insert', table: 'public.customers' })),
    );
  });

  it('stays open when the host rejects the write', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('nope')));
    render(
      <DrawerFormWidget
        config={cfg(drawerFormConfigSchema, { fields: FIELDS, triggerLabel: 'New', binding: BINDING })}
        instanceId="d2"
        onEvent={onEvent}
        data={{ fields: [], values: { name: 'Ana' } }}
      />,
    );
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(document.querySelector('[data-part="drawer-submit"]') as Element);
    await waitFor(() => expect(onEvent).toHaveBeenCalled());
    expect(document.querySelector('[data-part="form-fields"]')).toBeTruthy();
  });
});

// ── toggle-switch-list: optimistic + rollback ──────────────────────────────

describe('booleanEntriesOf (04 §3 boolean-map)', () => {
  it('reads the entries map', () => {
    expect(booleanEntriesOf({ entries: { a: true, b: false } })).toEqual({ a: true, b: false });
  });

  it('accepts a bare map', () => {
    expect(booleanEntriesOf({ a: true })).toEqual({ a: true });
  });

  it('DROPS non-boolean values rather than coercing them', () => {
    // Coercing "false" to true would silently flip a user's setting.
    expect(booleanEntriesOf({ entries: { a: 'false', b: 1, c: true } })).toEqual({ c: true });
  });

  it('returns {} for junk', () => {
    expect(booleanEntriesOf(null)).toEqual({});
    expect(booleanEntriesOf('x')).toEqual({});
  });
});

describe('ToggleSwitchListWidget (annex §10)', () => {
  const ROWS = [{ key: 'mentions', label: 'Mentions' }, { key: 'deploys', label: 'Deploys' }];

  it('reflects the bound boolean-map', () => {
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS })}
        instanceId="t1"
        onEvent={noop}
        data={{ entries: { mentions: true, deploys: false } }}
      />,
    );
    expect(screen.getByLabelText('Mentions').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Deploys').getAttribute('aria-checked')).toBe('false');
  });

  it('optimistic mode emits an update intent per toggle', async () => {
    const onEvent = vi.fn();
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS, binding: BINDING, persistMode: 'optimistic' })}
        instanceId="t2"
        onEvent={onEvent}
        data={{ entries: { mentions: false } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mentions'));
    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mutate', intent: 'update', values: expect.objectContaining({ mentions: true }) }),
      ),
    );
  });

  it('ROLLS BACK the switch when the host rejects the write', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('FORBIDDEN')));
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS, binding: BINDING, persistMode: 'optimistic' })}
        instanceId="t3"
        onEvent={onEvent}
        data={{ entries: { mentions: false } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mentions'));
    // The UI must never claim a setting is on when the server said no.
    await waitFor(() => expect(screen.getByLabelText('Mentions').getAttribute('aria-checked')).toBe('false'));
  });

  it('save-bar mode batches: no intent until Save is pressed', async () => {
    const onEvent = vi.fn();
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS, binding: BINDING, persistMode: 'save-bar' })}
        instanceId="t4"
        onEvent={onEvent}
        data={{ entries: { mentions: false, deploys: false } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mentions'));
    fireEvent.click(screen.getByLabelText('Deploys'));
    expect(onEvent).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('[data-part="save-button"]') as Element);
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ mentions: true, deploys: true }) }),
    );
  });

  it('save-bar rollback undoes the WHOLE batch, not just the last toggle', async () => {
    const onEvent = vi.fn(() => Promise.reject(new Error('nope')));
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS, binding: BINDING, persistMode: 'save-bar' })}
        instanceId="t5"
        onEvent={onEvent}
        data={{ entries: { mentions: false, deploys: false } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mentions'));
    fireEvent.click(screen.getByLabelText('Deploys'));
    fireEvent.click(document.querySelector('[data-part="save-button"]') as Element);
    await waitFor(() => expect(screen.getByLabelText('Mentions').getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByLabelText('Deploys').getAttribute('aria-checked')).toBe('false');
  });

  it('shows no save bar until something is dirty', () => {
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS, persistMode: 'save-bar' })}
        instanceId="t6"
        onEvent={noop}
        data={{ entries: { mentions: false } }}
      />,
    );
    expect(document.querySelector('[data-part="save-bar"]')).toBeNull();
  });

  it('emits no intent on an unbound instance', async () => {
    const onEvent = vi.fn();
    render(
      <ToggleSwitchListWidget
        config={cfg(toggleSwitchListConfigSchema, { rows: ROWS, persistMode: 'optimistic' })}
        instanceId="t7"
        onEvent={onEvent}
        data={{ entries: { mentions: false } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Mentions'));
    await waitFor(() => expect(screen.getByLabelText('Mentions').getAttribute('aria-checked')).toBe('true'));
    expect(onEvent).not.toHaveBeenCalled();
  });
});

// ── filter-chip-bar: derived counts ────────────────────────────────────────

describe('facetCountsOf / facetsOf (annex §10)', () => {
  const data = {
    rows: [{ status: 'running' }, { status: 'completed' }, { status: 'completed' }, { status: 'failed' }],
    total: 4,
  };

  it('counts by field', () => {
    expect(facetCountsOf(data.rows, 'status')).toEqual(new Map([['running', 1], ['completed', 2], ['failed', 1]]));
  });

  it('derives counts from the sibling list, not from config', () => {
    const { facets, total } = facetsOf(data, cfg(filterChipBarConfigSchema));
    expect(total).toBe(4);
    expect(facets.find((f) => f.key === 'completed')?.count).toBe(2);
  });

  it('keeps a configured facet with zero rows ("Failed 0" is meaningful)', () => {
    const { facets } = facetsOf(
      { rows: [{ status: 'running' }], total: 1 },
      cfg(filterChipBarConfigSchema, { order: [{ key: 'running' }, { key: 'failed' }] }),
    );
    expect(facets.find((f) => f.key === 'failed')?.count).toBe(0);
  });

  it('appends an undiscovered facet the config order omits', () => {
    const { facets } = facetsOf(data, cfg(filterChipBarConfigSchema, { order: [{ key: 'running' }] }));
    // A new enum value must not become invisible (and unfilterable).
    expect(facets.map((f) => f.key)).toEqual(['running', 'completed', 'failed']);
  });

  it('ignores rows with no facet value', () => {
    const { facets } = facetsOf({ rows: [{ status: 'a' }, {}], total: 2 }, cfg(filterChipBarConfigSchema));
    expect(facets).toHaveLength(1);
  });
});

describe('FilterChipBarWidget', () => {
  const data = { rows: [{ status: 'running' }, { status: 'completed' }], total: 2 };

  it('renders the All chip plus one per facet', () => {
    render(<FilterChipBarWidget config={cfg(filterChipBarConfigSchema)} instanceId="f1" onEvent={noop} data={data} />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('emits a filtered drill-through when a facet is chosen', () => {
    const onEvent = vi.fn();
    render(
      <FilterChipBarWidget
        config={cfg(filterChipBarConfigSchema, { href: '/runs' })}
        instanceId="f2"
        onEvent={onEvent}
        data={data}
      />,
    );
    fireEvent.click(screen.getByText('running'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/runs?status=running' });
  });

  it('the All chip clears the filter', () => {
    const onEvent = vi.fn();
    render(
      <FilterChipBarWidget
        config={cfg(filterChipBarConfigSchema, { href: '/runs', value: 'running' })}
        instanceId="f3"
        onEvent={onEvent}
        data={data}
      />,
    );
    fireEvent.click(screen.getByText('All'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/runs' });
  });

  it('the All sentinel cannot collide with a real enum value', () => {
    // A row literally valued "__all__" would otherwise hijack the All chip.
    expect(ALL_KEY).toBe('__all__');
  });

  it('renders the N-of-M meta when enabled', () => {
    render(
      <FilterChipBarWidget
        config={cfg(filterChipBarConfigSchema, { showMeta: true })}
        instanceId="f4"
        onEvent={noop}
        data={data}
      />,
    );
    expect(document.querySelector('[data-part="facet-meta"]')?.textContent).toBe('2 of 2');
  });
});

// ── stepper ────────────────────────────────────────────────────────────────

describe('stepsOf (annex §10)', () => {
  const rows = { rows: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], total: 3 };

  it('DERIVES done/active/pending from activeIndex when the payload carries no state', () => {
    const steps = stepsOf(rows, cfg(stepperConfigSchema, { activeIndex: 1 }));
    expect(steps.map((s) => s.state)).toEqual(['done', 'active', 'pending']);
  });

  it("an explicit row state wins over the derived one", () => {
    const steps = stepsOf(
      { rows: [{ label: 'A', state: 'error' }, { label: 'B' }], total: 2 },
      cfg(stepperConfigSchema, { activeIndex: 1 }),
    );
    expect(steps[0]?.state).toBe('error');
  });

  it('falls back to pending for an unrecognised state', () => {
    const steps = stepsOf({ rows: [{ label: 'A', state: 'wat' }], total: 1 }, cfg(stepperConfigSchema));
    expect(steps[0]?.state).toBe('pending');
  });

  it('omits descriptions when showDescriptions is off', () => {
    const steps = stepsOf(
      { rows: [{ label: 'A', description: 'sub' }], total: 1 },
      cfg(stepperConfigSchema, { showDescriptions: false }),
    );
    expect(steps[0]?.description).toBeUndefined();
  });
});

describe('StepperWidget', () => {
  it('renders steps', () => {
    render(
      <StepperWidget
        config={cfg(stepperConfigSchema)}
        instanceId="s1"
        onEvent={noop}
        data={{ rows: [{ label: 'Connect' }, { label: 'Tables' }], total: 2 }}
      />,
    );
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  it('renders nothing with no steps', () => {
    const { container } = render(
      <StepperWidget config={cfg(stepperConfigSchema)} instanceId="s2" onEvent={noop} data={{ rows: [], total: 0 }} />,
    );
    expect(container.querySelector('[data-widget="stepper"]')).toBeNull();
  });
});

// ── progress-bar ───────────────────────────────────────────────────────────

describe('ProgressBarWidget (annex §10)', () => {
  it('renders the bound percent', () => {
    render(<ProgressBarWidget config={cfg(progressBarConfigSchema)} instanceId="p1" onEvent={noop} data={{ value: 42 }} />);
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('flips to complete at 100', () => {
    render(<ProgressBarWidget config={cfg(progressBarConfigSchema)} instanceId="p2" onEvent={noop} data={{ value: 100 }} />);
    expect(document.querySelector('[data-widget="progress-bar"]')?.getAttribute('data-complete')).toBe('true');
  });

  it('clamps an out-of-range value instead of overflowing the track', () => {
    render(<ProgressBarWidget config={cfg(progressBarConfigSchema)} instanceId="p3" onEvent={noop} data={{ value: 250 }} />);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('renders 0% for a malformed payload rather than a NaN-width bar', () => {
    render(<ProgressBarWidget config={cfg(progressBarConfigSchema)} instanceId="p4" onEvent={noop} data={'junk'} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });
});

// ── validation-issues-list ─────────────────────────────────────────────────

describe('sortIssues (annex §10)', () => {
  it('orders errors before warnings before info', () => {
    const issues = issuesOf(
      {
        rows: [
          { severity: 'info', title: 'I' },
          { severity: 'error', title: 'E' },
          { severity: 'warn', title: 'W' },
        ],
        total: 3,
      },
      cfg(validationIssuesListConfigSchema),
    );
    // A blocking error must not sit below a cosmetic notice just because the
    // server emitted the notice first.
    expect(issues.map((i) => i.title)).toEqual(['E', 'W', 'I']);
  });

  it('is stable within a severity (deterministic for the same payload)', () => {
    const sorted = sortIssues([
      { key: '1', severity: 'warn', title: 'W1' },
      { key: '2', severity: 'warn', title: 'W2' },
      { key: '3', severity: 'error', title: 'E' },
    ]);
    expect(sorted.map((i) => i.title)).toEqual(['E', 'W1', 'W2']);
  });

  it('degrades an unrecognised severity to info rather than dropping the row', () => {
    const issues = issuesOf({ rows: [{ severity: 'catastrophe', title: 'X' }], total: 1 }, cfg(validationIssuesListConfigSchema));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('info');
  });
});

describe('ValidationIssuesListWidget', () => {
  it('tones a row by its severity', () => {
    render(
      <ValidationIssuesListWidget
        config={cfg(validationIssuesListConfigSchema)}
        instanceId="v1"
        onEvent={noop}
        data={{ rows: [{ severity: 'error', title: 'Bad emails', desc: 'skipped', count: 12 }], total: 1 }}
      />,
    );
    expect(document.querySelector('[data-part="issue-row"]')?.getAttribute('data-tone')).toBe('danger');
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('honours a severityMap override', () => {
    render(
      <ValidationIssuesListWidget
        config={cfg(validationIssuesListConfigSchema, { severityMap: { warn: 'info' } })}
        instanceId="v2"
        onEvent={noop}
        data={{ rows: [{ severity: 'warn', title: 'W' }], total: 1 }}
      />,
    );
    expect(document.querySelector('[data-part="issue-row"]')?.getAttribute('data-tone')).toBe('info');
  });

  it('renders an all-clear empty state', () => {
    render(
      <ValidationIssuesListWidget
        config={cfg(validationIssuesListConfigSchema, { emptyTitle: 'All good' })}
        instanceId="v3"
        onEvent={noop}
        data={{ rows: [], total: 0 }}
      />,
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });
});

// ── option-cards ───────────────────────────────────────────────────────────

describe('OptionCardsWidget (annex §10)', () => {
  const data = { rows: [{ key: 'pg', label: 'PostgreSQL', description: 'Postgres 12+' }], total: 1 };

  it('renders cards from the payload', () => {
    render(<OptionCardsWidget config={cfg(optionCardsConfigSchema)} instanceId="o1" onEvent={noop} data={data} />);
    expect(screen.getByText('PostgreSQL')).toBeTruthy();
  });

  it('skips rows with no label', () => {
    expect(optionsOf({ rows: [{ key: 'x' }], total: 1 }, cfg(optionCardsConfigSchema))).toHaveLength(0);
  });

  it('renders nothing with no options', () => {
    const { container } = render(
      <OptionCardsWidget config={cfg(optionCardsConfigSchema)} instanceId="o2" onEvent={noop} data={{ rows: [], total: 0 }} />,
    );
    expect(container.querySelector('[data-widget="option-cards"]')).toBeNull();
  });
});

// ── input widgets ──────────────────────────────────────────────────────────

describe('SegmentedControlWidget', () => {
  it('emits an update intent on change', () => {
    const onEvent = vi.fn();
    render(
      <SegmentedControlWidget
        config={cfg(segmentedControlConfigSchema, {
          options: [{ key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }],
          binding: BINDING,
        })}
        instanceId="sc1"
        onEvent={onEvent}
        data={{ fields: [], values: { value: '7d' } }}
      />,
    );
    fireEvent.click(screen.getByText('30 days'));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mutate', values: { value: '30d' } }));
  });

  it('emits nothing on an unbound instance', () => {
    const onEvent = vi.fn();
    render(
      <SegmentedControlWidget
        config={cfg(segmentedControlConfigSchema, { options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] })}
        instanceId="sc2"
        onEvent={onEvent}
        data={{ fields: [], values: {} }}
      />,
    );
    fireEvent.click(screen.getByText('B'));
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('ChipInputWidget', () => {
  it('seeds chips from the bound values', () => {
    render(
      <ChipInputWidget
        config={cfg(chipInputConfigSchema)}
        instanceId="ci1"
        onEvent={noop}
        data={{ fields: [], values: { chips: ['ana@acme.com'] } }}
      />,
    );
    expect(screen.getByText('ana@acme.com')).toBeTruthy();
  });

  it('ignores non-string entries in the bound array', () => {
    expect(() =>
      render(
        <ChipInputWidget
          config={cfg(chipInputConfigSchema)}
          instanceId="ci2"
          onEvent={noop}
          data={{ fields: [], values: { chips: ['ok', 3, null] } }}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('ok')).toBeTruthy();
  });
});

describe('PasswordStrengthMeterWidget', () => {
  it('scores a weak password low and a strong one high', () => {
    const { unmount } = render(
      <PasswordStrengthMeterWidget
        config={cfg(passwordStrengthMeterConfigSchema)}
        instanceId="ps1"
        onEvent={noop}
        data={{ fields: [], values: { password: 'abc' } }}
      />,
    );
    const weak = Number(document.querySelector('[data-widget="password-strength-meter"]')?.getAttribute('data-score'));
    unmount();

    render(
      <PasswordStrengthMeterWidget
        config={cfg(passwordStrengthMeterConfigSchema)}
        instanceId="ps2"
        onEvent={noop}
        data={{ fields: [], values: { password: 'correct horse battery staple 9!' } }}
      />,
    );
    const strong = Number(document.querySelector('[data-widget="password-strength-meter"]')?.getAttribute('data-score'));
    expect(strong).toBeGreaterThan(weak);
  });
});

// ── payload leniency (04 §3) ───────────────────────────────────────────────

describe('malformed payloads never throw into the error boundary', () => {
  const cases: [string, unknown][] = [
    ['null', null],
    ['a string', 'nope'],
    ['an array', [1, 2, 3]],
    ['a number', 42],
    ['an empty object', {}],
    ['rows of nonsense', { rows: [null, 'x', 3], total: 3 }],
  ];

  for (const [label, data] of cases) {
    it(`filter-chip-bar tolerates ${label}`, () => {
      expect(() =>
        render(<FilterChipBarWidget config={cfg(filterChipBarConfigSchema)} instanceId="l1" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`validation-issues-list tolerates ${label}`, () => {
      expect(() =>
        render(
          <ValidationIssuesListWidget
            config={cfg(validationIssuesListConfigSchema)}
            instanceId="l2"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });

    it(`stepper tolerates ${label}`, () => {
      expect(() =>
        render(<StepperWidget config={cfg(stepperConfigSchema)} instanceId="l3" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`toggle-switch-list tolerates ${label}`, () => {
      expect(() =>
        render(
          <ToggleSwitchListWidget config={cfg(toggleSwitchListConfigSchema)} instanceId="l4" onEvent={noop} data={data} />,
        ),
      ).not.toThrow();
    });

    it(`modal-wizard tolerates ${label}`, () => {
      expect(() =>
        render(<ModalWizardWidget config={cfg(modalWizardConfigSchema)} instanceId="l5" onEvent={noop} data={data} />),
      ).not.toThrow();
    });
  }
});
