// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORM DESIGNER, as a card in the page editor.
 *
 * ─── The draft starts as the form people already see ───────────────────────
 *
 * A page with no stored document gets the DERIVED one — the same function the
 * running dialog uses — so the designer opens on exactly what the create dialog
 * draws today, rather than on an empty canvas somebody has to rebuild. And a
 * draft that still says what the derived form says is NOT stored: freezing it
 * would stop the form following the table the day a column is added, which is
 * the whole point of deriving it.
 *
 * ─── One Save, the screen's ─────────────────────────────────────────────────
 *
 * This card reports its draft upwards and saves nothing itself. Two Save
 * buttons over one document is how the page editor used to lose whichever
 * draft the other button did not cover.
 */
import { useMemo, useState } from 'react';
import { Eye, RotateCcw } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '@adminium/ui';
import {
  deriveFormDocument,
  legalControls,
  type CrudFormConfig,
  type FormColumnFact,
  type FormPreset,
  type FormRelationFact,
} from '@adminium/engine/config';

import { t } from '../../../i18n/t.js';
import type {
  FormChildFactReply,
  FormColumnFactReply,
  FormRelationFactReply,
} from '../../../api/pages.js';
import { DialogSettings } from './DialogSettings.js';
import { FieldList } from './FieldList.js';
import { LayoutGallery } from './LayoutGallery.js';
import { FormPreview } from './FormPreview.js';
import {
  addColumnField,
  addChildRowsField,
  addRelationField,
  addSection,
  isDerived,
  missingFields,
  moveField,
  nudgeField,
  patchDialog,
  patchField,
  patchSection,
  removeField,
  removeSection,
  setPreset,
  type DesignerField,
} from './model.js';

export interface FormDesignerCardProps {
  /** The page's stored `config.form`, or null when it has none. */
  stored: CrudFormConfig | null;
  columns: readonly FormColumnFactReply[];
  relations: readonly FormRelationFactReply[];
  /** Tables this one can hold a LIST of rows from — an invoice's lines. */
  children?: readonly FormChildFactReply[] | undefined;
  /** The draft, reported upward on every edit. `null` ⇒ back to untouched. */
  onChange: (document: CrudFormConfig | null) => void;
  /** Studio → Schema for this connection, where a column's rules live. */
  onOpenRules?: (() => void) | undefined;
  /** The entity's singular noun, for the preview's words. */
  entity?: string | undefined;
}

export function FormDesignerCard({
  stored,
  columns,
  relations,
  children,
  onChange,
  onOpenRules,
  entity,
}: FormDesignerCardProps) {
  /*
   * The reply's own shape is the derivation's input. The cast is the copied
   * mirror this app uses for every page-reply block: the server validates it
   * with the same Zod schema the leaf declares, and re-parsing it here would be
   * a second opinion about a document that has already been checked.
   */
  const facts = useMemo(
    () => ({
      columns: columns as unknown as readonly FormColumnFact[],
      relations: relations as readonly FormRelationFact[],
    }),
    [columns, relations],
  );
  const derived = useMemo(() => deriveFormDocument(facts), [facts]);
  const [draft, setDraft] = useState<CrudFormConfig>(() => stored ?? derived);
  const [previewOpen, setPreviewOpen] = useState(false);

  /**
   * Report the draft, and report NULL when it says what the derived form says
   * — which is what makes "reset to generated" a real reset rather than a
   * stored copy of today's default.
   */
  const apply = (next: CrudFormConfig): void => {
    setDraft(next);
    onChange(isDerived(next, facts) ? null : next);
  };

  /** The line-items relations this document does not already hold. */
  const unplacedChildren = (children ?? []).filter(
    (child) =>
      !draft.sections.some((section) =>
        section.fields.some((field) => 'relation' in field && field.relation === child.relationId),
      ),
  );
  const missing = useMemo(() => missingFields(draft, facts), [draft, facts]);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section text-fg">{t('studio:pages.form.title', 'Create form')}</h2>
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio:pages.form.subtitle',
              'What the New and Edit dialogs show. Untouched, it follows the table.',
            )}
          </p>
        </div>
        <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Eye className="size-4" />}
              onClick={() => setPreviewOpen(true)}
              data-testid="form-preview-open"
            >
              {t('studio:pages.form.preview', 'Preview')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<RotateCcw className="size-4" />}
              disabled={isDerived(draft, facts)}
              onClick={() => {
                setDraft(derived);
                onChange(null);
              }}
              data-testid="form-reset"
            >
              {t('studio:pages.form.reset', 'Reset to generated')}
            </Button>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <LayoutGallery preset={draft.preset} onChoose={(preset: FormPreset) => apply(setPreset(draft, preset))} />

        <FieldList
          document={draft}
          columns={columns}
          relations={relations as readonly FormRelationFact[]}
          missing={missing}
          legalFor={(field: DesignerField) => {
            if (!('column' in field)) return ['reference-chips', 'check-rows'];
            const fact = columns.find((candidate) => candidate.spec.name === field.column);
            if (fact === undefined) return field.control === undefined ? [] : [field.control];
            return legalControls(
              (fact.options === undefined ? fact.spec : { ...fact.spec, options: fact.options }) as never,
            );
          }}
          {...(onOpenRules === undefined ? {} : { onOpenRules })}
          onMove={(from, to) => apply(moveField(draft, from, to))}
          onNudge={(at, by) => apply(nudgeField(draft, at, by))}
          onRemove={(at) => apply(removeField(draft, at))}
          onPatch={(at, patch) => apply(patchField(draft, at, patch))}
          onPatchSection={(index, patch) => apply(patchSection(draft, index, patch))}
          onRemoveSection={(index) => apply(removeSection(draft, index))}
          onAddSection={() => apply(addSection(draft))}
          onAddColumn={(fact) => apply(addColumnField(draft, fact))}
          onAddRelation={(relation) => apply(addRelationField(draft, relation))}
          {...(children === undefined ? {} : { children: unplacedChildren })}
          onAddChild={(child) => apply(addChildRowsField(draft, child))}
        />

        <DialogSettings dialog={draft.dialog} onPatch={(patch) => apply(patchDialog(draft, patch))} />
      </CardBody>

      <FormPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        document={draft}
        columns={columns}
        relations={relations as readonly FormRelationFact[]}
        {...(entity === undefined ? {} : { entity })}
      />
    </Card>
  );
}
