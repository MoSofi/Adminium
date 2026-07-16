/**
 * TRACK FCS `forms` family stories (annex §10): each widget's loaded variant,
 * the four WidgetFrame states through WidgetHost (acceptance #4), and
 * light/dark × LTR/RTL matrices with REAL geometry mirroring (acceptance #9 —
 * the RTL frames set `dir="rtl"` so the stepper's connectors run the other way,
 * the chip bar's `ms-auto` meta swaps edge, the toggle rows' switch knobs travel
 * mirrored, and the issue rows' icon-then-copy order flips; a bare attribute
 * would prove nothing). Widgets resolve through a LOCAL registry override so the
 * stories work before the green loop merges the definitions into the global map.
 * Payloads are the same seeded generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import {
  chipInputDemoData,
  filterChipBarDemoData,
  modalWizardDemoData,
  optionCardsDemoData,
  otpInputDemoData,
  passwordStrengthMeterDemoData,
  progressBarDemoData,
  segmentedControlDemoData,
  stepperDemoData,
  toggleSwitchListDemoData,
  validationIssuesListDemoData,
} from './forms-config.js';
import { formsTrackDefinitions } from './forms-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...formsTrackDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/Forms' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  height = 'h-40',
) {
  return (
    <div className={`${height} w-full`}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('SETTINGS_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const FIELDS = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Acme Corp' },
  { name: 'email', label: 'Email', kind: 'email', required: true, placeholder: 'ana@acme.com' },
  { name: 'seats', label: 'Seats', kind: 'number', unit: 'seats' },
  { name: 'active', label: 'Active', kind: 'switch' },
];

const TOGGLE_ROWS = [
  { key: 'emailDigest', label: 'Weekly digest', description: 'A Monday summary of last week’s activity.', icon: 'mail', tone: 'accent' },
  { key: 'mentions', label: 'Mentions', description: 'Notify me when someone @-mentions me.', icon: 'bell', tone: 'info' },
  { key: 'deploys', label: 'Deploy alerts', description: 'Ping me when a generation run finishes.', icon: 'zap', tone: 'warn' },
  { key: 'security', label: 'Security alerts', description: 'New sign-ins and permission changes.', icon: 'shield', tone: 'danger' },
];

const toggleConfig = { title: 'Notifications', rows: TOGGLE_ROWS, iconTiles: true, persistMode: 'optimistic' };
const issuesConfig = { title: 'Validation' };

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const ModalWizardStory = {
  name: 'modal-wizard',
  render: () =>
    host(
      'modal-wizard',
      's-wizard',
      { title: 'New customer', fields: FIELDS, triggerLabel: 'Create customer', successTitle: 'Customer created' },
      modalWizardDemoData(3),
      'success',
      'h-24',
    ),
};

export const DrawerFormStory = {
  name: 'drawer-form',
  render: () =>
    host('drawer-form', 's-drawer', { title: 'New report', fields: FIELDS, triggerLabel: 'New report' }, modalWizardDemoData(3), 'success', 'h-24'),
};

export const StepperStory = {
  name: 'stepper',
  render: () => host('stepper', 's-stepper', { title: 'Setup' }, stepperDemoData(5), 'success', 'h-32'),
};

export const StepperVertical = {
  name: 'stepper · vertical',
  render: () => host('stepper', 's-stepper-v', { orientation: 'vertical' }, stepperDemoData(5), 'success', 'h-72'),
};

export const ProgressBarStory = {
  name: 'progress-bar',
  render: () => host('progress-bar', 's-progress', { label: 'Importing' }, progressBarDemoData(2), 'success', 'h-20'),
};

export const ProgressBarComplete = {
  name: 'progress-bar · complete',
  render: () => host('progress-bar', 's-progress-done', { label: 'Imported' }, { value: 100 }, 'success', 'h-20'),
};

export const OtpInputStory = {
  name: 'otp-input',
  render: () => host('otp-input', 's-otp', { label: 'Verification code', length: 6 }, otpInputDemoData(4), 'success', 'h-32'),
};

export const ChipInputStory = {
  name: 'chip-input',
  render: () =>
    host('chip-input', 's-chips', { label: 'Invite by email', validator: 'email', placeholder: 'Add an email…' }, chipInputDemoData(6), 'success', 'h-32'),
};

export const SegmentedControlStory = {
  name: 'segmented-control',
  render: () => host('segmented-control', 's-seg', { title: 'Period' }, segmentedControlDemoData(1), 'success', 'h-20'),
};

export const FilterChipBarStory = {
  name: 'filter-chip-bar',
  render: () =>
    host('filter-chip-bar', 's-facets', { facetField: 'status', showMeta: true, href: '/runs' }, filterChipBarDemoData(8), 'success', 'h-20'),
};

export const ToggleSwitchListStory = {
  name: 'toggle-switch-list',
  render: () => host('toggle-switch-list', 's-toggles', toggleConfig, toggleSwitchListDemoData(7), 'success', 'h-80'),
};

export const OptionCardsStory = {
  name: 'option-cards',
  render: () => host('option-cards', 's-options', { title: 'Data source', columns: 2 }, optionCardsDemoData(9), 'success', 'h-64'),
};

export const PasswordStrengthStory = {
  name: 'password-strength-meter',
  render: () =>
    host('password-strength-meter', 's-pw', { label: 'Password strength' }, passwordStrengthMeterDemoData(2), 'success', 'h-20'),
};

export const ValidationIssuesStory = {
  name: 'validation-issues-list',
  render: () => host('validation-issues-list', 's-issues', issuesConfig, validationIssuesListDemoData(4), 'success', 'h-72'),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** toggle-switch-list: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('toggle-switch-list', 'st-loaded', toggleConfig, toggleSwitchListDemoData(7), 'success', 'h-80')}
        {host('toggle-switch-list', 'st-skeleton', toggleConfig, undefined, 'loading', 'h-80')}
        {host('toggle-switch-list', 'st-empty', { ...toggleConfig, emptyState: { titleKey: 'No settings' } }, { entries: {} }, 'success', 'h-80')}
        {host('toggle-switch-list', 'st-error', toggleConfig, undefined, 'error', 'h-80')}
      </div>
    </Frame>
  ),
};

/** validation-issues-list: the same four states on a record-list widget. */
export const IssuesStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('validation-issues-list', 'is-loaded', issuesConfig, validationIssuesListDemoData(4), 'success', 'h-72')}
        {host('validation-issues-list', 'is-skeleton', issuesConfig, undefined, 'loading', 'h-72')}
        {host('validation-issues-list', 'is-empty', { ...issuesConfig, emptyState: { titleKey: 'No issues found' } }, { rows: [], total: 0 }, 'success', 'h-72')}
        {host('validation-issues-list', 'is-error', issuesConfig, undefined, 'error', 'h-72')}
      </div>
    </Frame>
  ),
};

// ── Theme × direction matrix (acceptance #9) ───────────────────────────────

/**
 * REAL mirroring: each cell sets `dir` on a wrapper so the logical utilities
 * resolve for that direction — the stepper's connectors and the switch knob
 * travel reverse, and the chip bar's `ms-auto` meta swaps edge.
 */
function matrixCells(key: string) {
  // Instance ids derive from the cell key, never randomised — VRT captures must
  // be byte-identical across runs (04 §7.7).
  return (
    <div className="grid gap-4">
      {host('stepper', `m-stepper-${key}`, {}, stepperDemoData(5), 'success', 'h-32')}
      {host('filter-chip-bar', `m-facets-${key}`, { facetField: 'status', showMeta: true }, filterChipBarDemoData(8), 'success', 'h-20')}
      {host('toggle-switch-list', `m-toggles-${key}`, toggleConfig, toggleSwitchListDemoData(7), 'success', 'h-72')}
      {host('validation-issues-list', `m-issues-${key}`, issuesConfig, validationIssuesListDemoData(4), 'success', 'h-64')}
      {host('progress-bar', `m-progress-${key}`, { label: 'Importing' }, progressBarDemoData(2), 'success', 'h-20')}
    </div>
  );
}

export const LightLtr = { name: 'light · LTR', render: () => <Frame dir="ltr">{matrixCells('light-ltr')}</Frame> };
export const LightRtl = { name: 'light · RTL', render: () => <Frame dir="rtl">{matrixCells('light-rtl')}</Frame> };
export const DarkLtr = { name: 'dark · LTR', render: () => <Frame dark dir="ltr">{matrixCells('dark-ltr')}</Frame> };
export const DarkRtl = { name: 'dark · RTL', render: () => <Frame dark dir="rtl">{matrixCells('dark-rtl')}</Frame> };
