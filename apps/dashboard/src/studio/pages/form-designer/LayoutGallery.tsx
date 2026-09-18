// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The layout gallery: one card per preset, as the comp's catalog page draws
 * them (D9).
 *
 * The cards are titled by PATTERN — "Quick create", "Sectioned" — rather than
 * by the comp's samples ("New task", "New patient"): a layout is not a patient,
 * and a gallery named after somebody's sample data reads as a template store
 * (DP3). Seven cards here; the repeater and split-pane layouts arrive with the
 * controls they need.
 */
import { CalendarDays, CreditCard, FileText, LayoutList, ListChecks, Mails, Rows3, Table2, UploadCloud } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FormPreset } from '@adminium/engine/config';

import { t } from '../../../i18n/t.js';

interface Card {
  preset: FormPreset;
  icon: ReactNode;
  title: string;
  description: string;
  note: string;
}

function cards(): Card[] {
  return [
    {
      preset: 'sectioned',
      icon: <Rows3 className="size-[17px]" />,
      title: t('studio:pages.form.gallery.sectioned.title', 'Sectioned'),
      description: t(
        'studio:pages.form.gallery.sectioned.body',
        'Long record split into labelled sections with a scrolling body.',
      ),
      note: 'sectioned · scroll · 640px',
    },
    {
      preset: 'quick-create',
      icon: <FileText className="size-[17px]" />,
      title: t('studio:pages.form.gallery.quick.title', 'Quick create'),
      description: t(
        'studio:pages.form.gallery.quick.body',
        'One title field with inline meta pills. No section chrome.',
      ),
      note: 'quick-create · 440px',
    },
    {
      preset: 'wizard',
      icon: <ListChecks className="size-[17px]" />,
      title: t('studio:pages.form.gallery.wizard.title', 'Wizard'),
      description: t(
        'studio:pages.form.gallery.wizard.body',
        'Step-by-step wizard with a progress rail and Back / Next footer.',
      ),
      note: 'wizard · steps · 640px',
    },
    {
      preset: 'multi-entry',
      icon: <Mails className="size-[17px]" />,
      title: t('studio:pages.form.gallery.multi.title', 'Multi-entry'),
      description: t(
        'studio:pages.form.gallery.multi.body',
        'Email chips input, role select, permission checkbox list.',
      ),
      note: 'multi-entry · 560px',
    },
    {
      preset: 'segmented-files',
      icon: <LayoutList className="size-[17px]" />,
      title: t('studio:pages.form.gallery.segmented.title', 'Segmented and files'),
      description: t(
        'studio:pages.form.gallery.segmented.body',
        'Segmented priority, long description, attachment list, assignee.',
      ),
      note: 'segmented · files · 580px',
    },
    {
      preset: 'choice-cards',
      icon: <CreditCard className="size-[17px]" />,
      title: t('studio:pages.form.gallery.choice.title', 'Choice cards'),
      description: t(
        'studio:pages.form.gallery.choice.body',
        'Selectable choice cards, a pill switch and a slider.',
      ),
      note: 'choice-cards · 660px',
    },
    {
      preset: 'upload-chips',
      icon: <UploadCloud className="size-[17px]" />,
      title: t('studio:pages.form.gallery.upload.title', 'Upload and chips'),
      description: t(
        'studio:pages.form.gallery.upload.body',
        'Media dropzone, currency inputs, tag chips and a publish toggle.',
      ),
      note: 'upload · chips · 680px',
    },
    {
      preset: 'split-pane',
      icon: <CalendarDays className="size-[17px]" />,
      title: t('studio:pages.form.gallery.split.title', 'Split pane'),
      description: t(
        'studio:pages.form.gallery.split.body',
        'Two panes: the first section beside the rest. Made for a calendar.',
      ),
      note: 'split-pane · 820px',
    },
    {
      preset: 'repeater-totals',
      icon: <Table2 className="size-[17px]" />,
      title: t('studio:pages.form.gallery.repeater.title', 'Repeater and totals'),
      description: t(
        'studio:pages.form.gallery.repeater.body',
        'A reference, repeatable line items and live totals.',
      ),
      note: 'repeater · totals · 780px',
    },
  ];
}

export function LayoutGallery({
  preset,
  onChoose,
}: {
  preset: FormPreset;
  onChoose: (preset: FormPreset) => void;
}) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="form-layout-gallery">
      {cards().map((card) => (
        <li key={card.preset}>
          <button
            type="button"
            onClick={() => onChoose(card.preset)}
            aria-pressed={card.preset === preset}
            // The chosen card wears the comp's hover state at rest, which is
            // how the gallery says which layout this form is on.
            className={`flex h-full w-full flex-col gap-2 rounded-[14px] border p-[18px] text-start shadow-card transition-colors ${
              card.preset === preset
                ? 'border-accent bg-accent-soft/40'
                : 'border-border bg-surface hover:border-border-strong'
            }`}
            data-testid={`form-layout-${card.preset}`}
          >
            <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              {card.icon}
            </span>
            <span className="text-[14.5px] font-extrabold text-fg">{card.title}</span>
            <span className="text-[12.5px] leading-[1.5] text-fg-muted">{card.description}</span>
            <span className="font-mono text-[10.5px] text-fg-subtle">{card.note}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
