// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The form's fields, in sections, in order.
 *
 * ─── Two ways to reorder, because one of them is not enough ────────────────
 *
 * A pointer drag (dnd-kit, the same sortable the Columns card uses) and the
 * arrow buttons beside each handle. The buttons are not a fallback nobody uses:
 * they are how the list is reordered with a keyboard, how it is reordered on a
 * touch screen, and how a field crosses into the next section — which a
 * vertical drag inside one list cannot express.
 *
 * ─── The missing-column notice (F17) ───────────────────────────────────────
 *
 * A designed form is a snapshot; the table moves. A column the form does not
 * name is offered at the bottom with an Add button, and one the database
 * DEMANDS is offered in the danger tone — because the dialog appends it at read
 * time anyway (D10), and a designer who cannot see that is a designer surprised
 * by a field they did not place.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical, Plus, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, IconButton, Input, MonoText, Select } from '@adminium/ui';
import type { CrudFormConfig, FormColumnFact, FormRelationFact } from '@adminium/engine/config';

import { t } from '../../../i18n/t.js';
import type { FormChildFactReply as ChildFactReply, FormColumnFactReply } from '../../../api/pages.js';
import { FieldSettings } from './FieldSettings.js';
import { fieldKey, fieldsOf, type DesignerField, type FieldAddress } from './model.js';

export interface FieldListProps {
  document: CrudFormConfig;
  /** Every writable column, for the missing notice and each field's rules. */
  columns: readonly FormColumnFactReply[];
  relations: readonly FormRelationFact[];
  /** Which controls each column may be given, by column name. */
  legalFor: (field: DesignerField) => readonly string[];
  onOpenRules?: (() => void) | undefined;
  onMove: (from: FieldAddress, to: FieldAddress) => void;
  onNudge: (at: FieldAddress, by: -1 | 1) => void;
  onRemove: (at: FieldAddress) => void;
  onPatch: (at: FieldAddress, patch: Partial<DesignerField>) => void;
  onPatchSection: (index: number, patch: { label?: string; columns?: 1 | 2 | 3 }) => void;
  onRemoveSection: (index: number) => void;
  onAddSection: () => void;
  onAddColumn: (fact: FormColumnFact) => void;
  onAddRelation: (relation: FormRelationFact) => void;
  /** Tables this one can hold a list of rows from, minus the ones placed. */
  children?: readonly ChildFactReply[] | undefined;
  onAddChild: (child: ChildFactReply) => void;
  missing: { columns: FormColumnFact[]; relations: FormRelationFact[] };
}

export function FieldList(props: FieldListProps) {
  const { document } = props;
  const [open, setOpen] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const addressOf = (key: string): FieldAddress | null =>
    fieldsOf(document).find((entry) => fieldKey(entry.field) === key)?.at ?? null;

  const handleDragEnd = (event: DragEndEvent): void => {
    const from = addressOf(String(event.active.id));
    const overId = event.over?.id;
    if (from === null || overId === undefined) return;
    const to = addressOf(String(overId));
    if (to === null) return;
    props.onMove(from, to);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="form-field-list">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        {document.sections.map((section, sectionIndex) => (
          <section key={section.id} className="rounded-lg border border-border">
            <header className="flex flex-wrap items-center gap-2 border-b border-border p-2">
              <Input
                className="w-48"
                value={section.label ?? ''}
                placeholder={t('studio:pages.form.section.unnamed', 'Unnamed section')}
                aria-label={t('studio:pages.form.section.label', 'Section name')}
                onChange={(event) => props.onPatchSection(sectionIndex, { label: event.target.value })}
                data-testid="form-section-label"
              />
              <Select
                className="w-28"
                value={String(section.columns)}
                aria-label={t('studio:pages.form.section.columns', 'Columns')}
                onChange={(event) =>
                  props.onPatchSection(sectionIndex, { columns: Number(event.target.value) as 1 | 2 | 3 })
                }
              >
                {[1, 2, 3].map((columns) => (
                  <option key={columns} value={columns}>
                    {t('studio:pages.form.section.columnCount', '{count} columns', { count: columns })}
                  </option>
                ))}
              </Select>
              <span className="flex-1" />
              {document.sections.length > 1 ? (
                <IconButton
                  variant="ghost"
                  size="sm"
                  tooltip
                  label={t('studio:pages.form.section.remove', 'Remove this section')}
                  onClick={() => props.onRemoveSection(sectionIndex)}
                  data-testid="form-section-remove"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              ) : null}
            </header>

            <SortableContext
              items={section.fields.map((field) => fieldKey(field))}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {section.fields.map((field, index) => {
                  const key = fieldKey(field);
                  const at = { section: sectionIndex, index };
                  const column = 'column' in field ? field.column : null;
                  const fact = props.columns.find((candidate) => candidate.spec.name === column);
                  return (
                    <SortableFieldRow
                      key={key}
                      id={key}
                      field={field}
                      open={open === key}
                      onToggle={() => setOpen(open === key ? null : key)}
                      onUp={() => props.onNudge(at, -1)}
                      onDown={() => props.onNudge(at, 1)}
                      onRemove={() => props.onRemove(at)}
                      settings={
                        <FieldSettings
                          field={field}
                          columns={props.columns.map((column) => String(column.spec.name ?? ''))}
                          {...(fact === undefined ? {} : { fact })}
                          legal={props.legalFor(field)}
                          {...(props.onOpenRules === undefined ? {} : { onOpenRules: props.onOpenRules })}
                          onPatch={(patch) => props.onPatch(at, patch)}
                        />
                      }
                    />
                  );
                })}
                {section.fields.length === 0 ? (
                  <li className="p-3 text-body-sm text-fg-muted">
                    {t('studio:pages.form.section.empty', 'No fields here yet — move one in, or add one below.')}
                  </li>
                ) : null}
              </ul>
            </SortableContext>
          </section>
        ))}
      </DndContext>

      <div>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Plus className="size-4" />}
          onClick={props.onAddSection}
          data-testid="form-add-section"
        >
          {t('studio:pages.form.section.add', 'Add a section')}
        </Button>
      </div>

      {props.missing.columns.length === 0 && props.missing.relations.length === 0 ? null : (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="form-missing">
          <p className="text-caption text-fg-muted">
            {t(
              'studio:pages.form.missing.title',
              'Not on this form. A column the database demands is added back automatically when the dialog opens.',
            )}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {props.missing.columns.map((fact) => (
              <li key={fact.spec.name}>
                <Button
                  size="sm"
                  variant={fact.required ? 'destructive' : 'ghost'}
                  iconLeft={<Plus className="size-4" />}
                  onClick={() => props.onAddColumn(fact)}
                  data-testid="form-missing-add"
                >
                  {fact.spec.name}
                </Button>
              </li>
            ))}
            {props.missing.relations.map((relation) => (
              <li key={relation.relationId}>
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<Plus className="size-4" />}
                  onClick={() => props.onAddRelation(relation)}
                >
                  {relation.label}
                </Button>
              </li>
            ))}
            {/* The tables this one holds a LIST of rows from. Named apart from
                the link relations above because the field they make is a
                different thing: a table of lines, not a box of chips. */}
            {(props.children ?? []).map((child) => (
              <li key={child.relationId}>
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<Plus className="size-4" />}
                  onClick={() => props.onAddChild(child)}
                  data-testid="form-add-child"
                >
                  {t('studio:pages.form.addLines', '{label} as lines', { label: child.label })}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SortableFieldRow({
  id,
  field,
  open,
  onToggle,
  onUp,
  onDown,
  onRemove,
  settings,
}: {
  id: string;
  field: DesignerField;
  open: boolean;
  onToggle: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  settings: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const name =
    'column' in field
      ? field.column
      : 'relation' in field
        ? field.relation
        : t('studio:pages.form.field.recap', 'Recap');
  const words = 'recap' in field ? field.recap.sentence : (field.label ?? name);
  const control = 'recap' in field ? undefined : field.control;

  return (
    <li
      ref={setNodeRef}
      // Custom properties only — dnd-kit's per-frame transform has to reach the
      // element somehow, and the arbitrary properties below read exactly these.
      style={{
        '--adm-sort-transform': CSS.Transform.toString(transform) ?? 'none',
        '--adm-sort-transition': transition ?? 'none',
      }}
      className={`border-b border-border bg-surface last:border-b-0 [transform:var(--adm-sort-transform)] [transition:var(--adm-sort-transition)] ${
        isDragging ? 'relative z-10 shadow-card' : ''
      }`}
      data-testid="form-field-row"
      // The field's own key, so a browser test can address a row and a handle
      // by the column they belong to rather than by their position.
      data-field={id}
    >
      <div className="flex flex-wrap items-center gap-2 p-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="nb-ib inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          aria-label={t('studio:pages.form.field.drag', 'Reorder {name}', { name })}
          data-testid="form-field-handle"
          data-field={id}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1">
          <span className="text-body-sm text-fg">{words}</span>{' '}
          <MonoText className="text-[11px] text-fg-subtle">{name}</MonoText>
        </span>
        {control === undefined ? null : <Badge tone="neutral">{control}</Badge>}
        <IconButton
          variant="ghost"
          size="sm"
          tooltip
          label={t('studio:pages.form.field.up', 'Move {name} up', { name })}
          onClick={onUp}
          data-testid="form-field-up"
        >
          <ChevronUp className="size-4" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          tooltip
          label={t('studio:pages.form.field.down', 'Move {name} down', { name })}
          onClick={onDown}
          data-testid="form-field-down"
        >
          <ChevronDown className="size-4" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          tooltip
          label={t('studio:pages.form.field.settings', 'Settings for {name}', { name })}
          onClick={onToggle}
          data-testid="form-field-settings-open"
        >
          <Settings2 className="size-4" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          tooltip
          label={t('studio:pages.form.field.remove', 'Remove {name}', { name })}
          onClick={onRemove}
          data-testid="form-field-remove"
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {open ? settings : null}
    </li>
  );
}
