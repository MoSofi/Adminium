// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The create dialog as a person meets it.
 *
 * One story per shape wave 1 can render: the DERIVED form every table gets for
 * free, and a DESIGNED one with sections, spans and chosen controls. Both use
 * neutral samples — a clinic booking — because the comp's own dialog 7 is a
 * subscription flow whose words never reach a story (Appendix B).
 *
 * `modal={false}` + `open` render it inline so VRT and the axe sweep see the
 * dialog without driving a click.
 */
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';
import { RecordFormDialog } from './RecordFormDialog.js';
import { deriveFormDocument, type CrudFormConfig, type FormColumnFact } from '../../page-config/index.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'full_name', label: 'Full name', logicalType: 'varchar', nullable: false }),
  spec({ name: 'email', label: 'Email', logicalType: 'varchar', semantic: 'email' }),
  spec({ name: 'phone', label: 'Phone', logicalType: 'varchar', semantic: 'phone' }),
  spec({
    name: 'status',
    label: 'Status',
    logicalType: 'enum',
    enumValues: ['new', 'seen', 'closed'],
    nullable: false,
  }),
  spec({ name: 'party', label: 'Party size', logicalType: 'integer' }),
  spec({ name: 'notes', label: 'Notes', logicalType: 'text' }),
  spec({ name: 'reminders', label: 'Send reminders', logicalType: 'boolean' }),
];

const FACTS: FormColumnFact[] = COLUMNS.map((column, index) => ({
  spec: column as never,
  ordinal: index + 1,
  writable: true,
  filledBy: null,
  required: column.name === 'full_name',
}));

/** What a table with no designed form gets: one section, two columns. */
const DERIVED: CrudFormConfig = deriveFormDocument({ columns: FACTS });

/** What the designer writes: sections, spans, and controls chosen per field. */
const DESIGNED: CrudFormConfig = {
  v: 2,
  preset: 'sectioned',
  dialog: { title: 'New booking', subtitle: 'Who is coming, and when' },
  sections: [
    {
      id: 'who',
      label: 'Who',
      columns: 2,
      fields: [
        { column: 'full_name', control: 'text', required: true },
        { column: 'email', control: 'email' },
        { column: 'phone', control: 'phone', prefix: '+1' },
        { column: 'status', control: 'segmented' },
      ],
    },
    {
      id: 'visit',
      label: 'The visit',
      columns: 2,
      fields: [
        { column: 'party', control: 'stepper', min: 1, max: 12, unit: 'guests' },
        { column: 'notes', control: 'textarea', span: 2 },
        { column: 'reminders', control: 'toggle-row', span: 2, help: 'A message the day before.' },
      ],
    },
  ],
};

const meta = {
  title: 'Widgets/Templates/RecordFormDialog',
};
export default meta;

function Dialog({ document: form }: { document: CrudFormConfig }) {
  return (
    <div className="min-h-[560px]">
      <RecordFormDialog
        open
        modal={false}
        onOpenChange={() => {}}
        mode="create"
        entity="booking"
        tableName="public.bookings"
        document={form}
        columns={COLUMNS}
        onSubmit={() => {}}
      />
    </div>
  );
}

export const Derived = {
  tags: ['vrt'],
  render: () => <Dialog document={DERIVED} />,
};

export const Designed = {
  tags: ['vrt'],
  render: () => <Dialog document={DESIGNED} />,
};

/** The wizard: one section per step, with the comp's rail above them. */
const WIZARD: CrudFormConfig = {
  v: 2,
  preset: 'wizard',
  dialog: { title: 'New booking', subtitle: 'Three steps · who, when, reminders' },
  sections: [
    {
      id: 'who',
      label: 'Who',
      hint: 'Name and contact',
      columns: 2,
      fields: [
        { column: 'full_name', control: 'text', required: true },
        { column: 'email', control: 'email' },
      ],
    },
    {
      id: 'visit',
      label: 'The visit',
      hint: 'Party and notes',
      columns: 2,
      fields: [
        { column: 'party', control: 'stepper', min: 1, max: 12, unit: 'guests' },
        { column: 'notes', control: 'textarea', span: 2 },
      ],
    },
    {
      id: 'reminders',
      label: 'Reminders',
      hint: 'What we send',
      intro: 'Nothing is sent until the day before.',
      columns: 1,
      fields: [{ column: 'reminders', control: 'check-row' }],
    },
  ],
};

/** Quick create: a title, a detail box, and the rest as pills. */
const QUICK: CrudFormConfig = {
  v: 2,
  preset: 'quick-create',
  dialog: { title: 'New booking', subtitle: 'Quick create · press Enter to save' },
  sections: [
    {
      id: 'main',
      columns: 1,
      fields: [
        { column: 'full_name', placeholder: 'Who is coming?' },
        { column: 'notes', placeholder: 'Add detail\u2026' },
        { column: 'status' },
        { column: 'reminders' },
        { column: 'party' },
      ],
    },
  ],
};

export const Wizard = {
  tags: ['vrt'],
  render: () => <Dialog document={WIZARD} />,
};

export const QuickCreate = {
  tags: ['vrt'],
  render: () => <Dialog document={QUICK} />,
};
