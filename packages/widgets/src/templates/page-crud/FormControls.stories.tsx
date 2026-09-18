// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONTROL CATALOG, on one page (plan 50 phase E, Appendix C).
 *
 * Every control the form can render, with neutral samples — a delivery choice,
 * a party size, a set of systems to switch on. The comp's own samples are not
 * used here on purpose (Appendix B): its dialog 7 is a subscription flow, and
 * those words never reach a story, a doc or a fixture.
 *
 * Dark, RTL, density and accent are the Storybook globals and the VRT matrix,
 * not separate stories. The axe sweep runs over this page too, which is the
 * point of having every control in one place.
 */
import { FormField } from '@adminium/ui';
import { useState } from 'react';

import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { CONTROL_COMPONENTS, CheckRowsControl, type ControlOption } from './controls/index.js';
import type { CrudApi } from './crud-api.js';
import type { FormControl } from '../../page-config/index.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

interface Sample {
  control: FormControl | 'check-rows';
  label: string;
  column: GridColumnSpecInput;
  field?: Record<string, unknown>;
  options?: ControlOption[];
  initial?: unknown;
  /** A reference control needs a transport; the story fakes one. */
  lookup?: CrudApi['lookup'];
}

/** Three rows of a `providers` table, as the picker's transport answers them. */
const PROVIDERS = [
  { value: '1', label: 'Amara Osei', detail: 'Internal medicine · Bldg 2' },
  { value: '2', label: 'Ben Halloran', detail: 'Family practice · Bldg 1' },
  { value: '3', label: 'Ines Marchetti', detail: 'Pediatrics · Annex' },
];

const lookupProviders: CrudApi['lookup'] = (_fk, query) =>
  Promise.resolve(
    PROVIDERS.filter((row) => row.label.toLowerCase().includes(query.trim().toLowerCase())),
  );

/** A target the caller may not read: the field disables itself and says so. */
const lookupForbidden: CrudApi['lookup'] = () =>
  Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));

const SAMPLES: Sample[] = [
  { control: 'text', label: 'Name', column: { name: 'name', label: 'Name' }, initial: 'Ada Lovelace' },
  { control: 'title', label: 'Title', column: { name: 'title', label: 'Title' }, initial: 'Follow-up visit' },
  {
    control: 'textarea',
    label: 'Notes',
    column: { name: 'notes', label: 'Notes', logicalType: 'text' },
    initial: 'Bring the paperwork from last time.',
  },
  { control: 'mono', label: 'Reference', column: { name: 'ref', label: 'Reference' }, initial: 'INV-1042' },
  {
    control: 'email',
    label: 'Email',
    column: { name: 'email', label: 'Email', semantic: 'email' },
    initial: 'ada@example.com',
  },
  { control: 'url', label: 'Website', column: { name: 'site', label: 'Website', semantic: 'url' }, initial: 'https://example.com' },
  {
    control: 'phone',
    label: 'Phone',
    column: { name: 'phone', label: 'Phone', semantic: 'phone' },
    field: { prefix: '+1' },
    initial: '+1 (555) 000-0000',
  },
  { control: 'password', label: 'Passphrase', column: { name: 'secret', label: 'Passphrase' }, initial: 'correct horse' },
  { control: 'number', label: 'Quantity', column: { name: 'qty', label: 'Quantity', logicalType: 'integer' }, initial: 12 },
  {
    control: 'currency',
    label: 'Total',
    column: { name: 'total', label: 'Total', logicalType: 'decimal', semantic: 'money' },
    initial: '412.50',
  },
  {
    control: 'stepper',
    label: 'Party size',
    column: { name: 'party', label: 'Party size', logicalType: 'integer' },
    field: { min: 1, max: 12, unit: 'guests' },
    initial: 4,
  },
  {
    control: 'slider',
    label: 'Seats',
    column: { name: 'seats', label: 'Seats', logicalType: 'integer' },
    field: { min: 0, max: 20, unit: 'seats' },
    initial: 6,
  },
  { control: 'date', label: 'Visit day', column: { name: 'day', label: 'Visit day', logicalType: 'date' }, initial: '2026-09-18' },
  { control: 'time', label: 'Starts', column: { name: 'at', label: 'Starts', logicalType: 'time' }, initial: '09:30' },
  {
    control: 'datetime',
    label: 'Seen at',
    column: { name: 'seen', label: 'Seen at', logicalType: 'timestamptz' },
    initial: '2026-09-18T09:30',
  },
  {
    control: 'select',
    label: 'Department',
    column: { name: 'dept', label: 'Department', logicalType: 'enum', enumValues: ['support', 'sales', 'ops', 'field', 'labs'] },
    options: [
      { value: 'support', label: 'Support' },
      { value: 'sales', label: 'Sales' },
      { value: 'ops', label: 'Operations' },
      { value: 'field', label: 'Field' },
      { value: 'labs', label: 'Labs' },
    ],
    initial: 'ops',
  },
  {
    control: 'segmented',
    label: 'Status',
    column: { name: 'status', label: 'Status', logicalType: 'enum', enumValues: ['new', 'open', 'done'], nullable: false },
    options: [
      { value: 'new', tone: 'info' },
      { value: 'open', tone: 'accent' },
      { value: 'done', tone: 'pos' },
    ],
    initial: 'open',
  },
  {
    control: 'pill-switch',
    label: 'Visibility',
    column: { name: 'visibility', label: 'Visibility', logicalType: 'enum', enumValues: ['team', 'everyone'] },
    options: [
      { value: 'team', label: 'My team' },
      { value: 'everyone', label: 'Everyone' },
    ],
    initial: 'team',
  },
  {
    control: 'choice-cards',
    label: 'Delivery',
    column: { name: 'delivery', label: 'Delivery', logicalType: 'enum', enumValues: ['standard', 'express', 'pickup'] },
    options: [
      { value: 'standard', label: 'Standard', description: '3–5 days, tracked' },
      { value: 'express', label: 'Express', description: 'Next day, signed for' },
      { value: 'pickup', label: 'Pickup', description: 'Today, from the counter' },
    ],
    initial: 'express',
  },
  {
    control: 'toggle-row',
    label: 'Published',
    column: { name: 'published', label: 'Published', logicalType: 'boolean' },
    field: { help: 'Off keeps it as a draft nobody outside your team can open.' },
    initial: true,
  },
  {
    control: 'check-row',
    label: 'Send a receipt',
    column: { name: 'receipt', label: 'Send a receipt', logicalType: 'boolean' },
    field: { help: 'The customer gets an email with the details.' },
    initial: true,
  },
  {
    control: 'check-rows',
    label: 'Access',
    column: { name: 'access', label: 'Access', logicalType: 'json' },
    options: [
      { value: 'email', label: 'Email', description: 'Send and receive from the shared address' },
      { value: 'calendar', label: 'Calendar', description: "See and book the team's time" },
      { value: 'files', label: 'Files', description: 'Open and upload to the shared folder' },
    ],
    initial: ['email', 'calendar'],
  },
  {
    control: 'chips',
    label: 'Tags',
    column: { name: 'tags', label: 'Tags', logicalType: 'json' },
    initial: ['urgent', 'follow-up'],
  },
  {
    control: 'chips',
    label: 'Invite by email',
    column: { name: 'invites', label: 'Invite by email', logicalType: 'json' },
    field: { itemFormat: 'email' },
    initial: ['ada@example.com', 'grace@example.com'],
  },
  {
    control: 'json',
    label: 'Settings',
    column: { name: 'settings', label: 'Settings', logicalType: 'json' },
    initial: '{\n  "reminders": true\n}',
  },
  {
    control: 'reference',
    label: 'Primary physician',
    column: {
      name: 'doctor_id',
      label: 'Primary physician',
      logicalType: 'integer',
      fk: { table: 'public.providers', column: 'id', display: 'full_name' },
    },
    field: { reference: { name: 'full_name', detail: ['speciality', 'building'], avatar: true } },
    lookup: lookupProviders,
    initial: '2',
  },
  {
    control: 'readonly',
    label: 'Line total',
    column: { name: 'line_total', label: 'Line total', logicalType: 'decimal', readOnly: true },
    initial: '1,204.00',
  },
];

function ControlSample({ sample }: { sample: Sample }) {
  const [value, setValue] = useState<unknown>(sample.initial ?? null);
  const column = spec(sample.column);
  const props = {
    column,
    value,
    onChange: setValue,
    options: sample.options ?? [],
    mode: 'create' as const,
    currency: 'USD',
    ...(sample.lookup === undefined ? {} : { lookup: sample.lookup }),
    ...(sample.field === undefined ? {} : { field: { column: column.name, ...sample.field } as never }),
  };
  if (sample.control === 'check-rows') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold text-fg">{sample.label}</span>
        <CheckRowsControl {...props} />
      </div>
    );
  }
  const entry = CONTROL_COMPONENTS[sample.control];
  const Control = entry.component;
  if (entry.ownsLabel === true) return <Control {...props} />;
  return (
    <FormField label={sample.label}>
      <Control {...props} />
    </FormField>
  );
}

const meta = {
  title: 'Widgets/Templates/FormControls',
};
export default meta;

export const Catalog = {
  tags: ['vrt'],
  render: () => (
    <div className="grid max-w-[900px] grid-cols-1 gap-5 sm:grid-cols-2">
      {SAMPLES.map((sample) => (
        <ControlSample key={`${sample.control}-${sample.label}`} sample={sample} />
      ))}
    </div>
  ),
};

/**
 * A reference whose target the caller cannot read (F16): the field is disabled
 * and says which table, rather than offering an empty list — which would read
 * as "there is nothing to choose".
 */
export const ReferenceNoAccess = {
  tags: ['vrt'],
  render: () => (
    <div className="max-w-[440px]">
      <ControlSample
        sample={{
          control: 'reference',
          label: 'Primary physician',
          column: {
            name: 'doctor_id',
            label: 'Primary physician',
            logicalType: 'integer',
            fk: { table: 'public.providers', column: 'id' },
          },
          lookup: lookupForbidden,
          initial: '2',
        }}
      />
    </div>
  ),
};
