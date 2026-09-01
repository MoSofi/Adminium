// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two-column shell both page routes share: fields on one side, a live
 * preview of the chosen template on the other.
 *
 * Why the preview is a peer of the form rather than a hint under the template
 * select: the template is the one decision on this screen that is hard to undo
 * and impossible to name well. "Records", "Queue" and "List & detail" are all
 * honest names for layouts you cannot picture from the words, and picking wrong
 * means rebuilding the page. Putting the shape beside the choice makes the
 * choice checkable at the moment it is made.
 *
 * It stacks below `lg`, preview last: on a narrow screen the form is the thing
 * you came to fill in, and a schematic pushed above it would be a screenful of
 * grey blocks between the reader and the first field.
 */

import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { TemplateSchematic } from './TemplatePreview.js';
import {
  templateDefaultIcon,
  templateDescriptionFallback,
  templateDescriptionKey,
  templateTitleFallback,
  templateTitleKey,
} from './templateCatalog.js';

export function templateTitle(id: string): string {
  return t(templateTitleKey(id), templateTitleFallback(id));
}

export function templateDescription(id: string): string {
  return t(templateDescriptionKey(id), templateDescriptionFallback(id));
}

export interface PageEditorLayoutProps {
  heading: string;
  subheading: string;
  /** The template the preview illustrates. */
  template: string;
  /** Page title as typed — shown in the preview's chrome so it feels bound. */
  previewTitle: string;
  /** Kebab-case lucide name, or empty. */
  previewIcon: string;
  /** Qualified source table, when one is bound. */
  previewTable?: string | null;
  /**
   * Action rendered at the end of the preview's header — "Open page" on the
   * edit screen. It belongs to the preview rather than a card of its own:
   * "here is what this page looks like" and "go look at the real one" are the
   * same thought, and the second was previously stranded at the bottom of the
   * form behind a paragraph explaining it.
   */
  previewAction?: ReactNode;
  /** The form fields. */
  children: ReactNode;
  /** Footer actions — save/cancel and any errors. */
  actions: ReactNode;
}

export function PageEditorLayout({
  heading,
  subheading,
  template,
  previewTitle,
  previewIcon,
  previewTable,
  previewAction,
  children,
  actions,
}: PageEditorLayoutProps) {
  // No icon chosen yet ⇒ show the one the template will get, not a generic
  // file. The server stamps exactly this on create, so the preview is honest
  // rather than a placeholder that changes on save.
  const Icon = lucideByName(previewIcon === '' ? templateDefaultIcon(template) : previewIcon);

  return (
    <PageSurface width="wide" className="flex flex-col gap-5">
      {/*
        The heading and the way back live in the TOPBAR, not here. The shell
        already renders an <h1> for every route; a second one under it said the
        same thing twice, and the shell's copy said "Home" because its
        path-derived title only knows `/p/$slug` and `/account`. Publishing both
        puts the name where the eye already looks for it and turns "Back to
        pages" into an arrow beside that name, instead of a text link floating
        above the form.
      */}
      <PageActions title={heading} subtitle={subheading} backTo="/studio/pages" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="flex flex-col gap-4">{children}</div>

        {/* `lg:sticky` keeps the shape in view while the form scrolls past it —
            the preview is only useful if it is still on screen when the
            template select is out of it. */}
        <Card padded={false} className="lg:sticky lg:top-6">
          {/* `justify-start` is load-bearing: CardHeader's own classes include
              `justify-between`, which pushed the icon to one edge and the title
              to the other with a lake of nothing between them. */}
          <CardHeader className="flex items-center justify-start gap-2">
            <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 className="text-section truncate text-fg">
                {previewTitle.trim() === ''
                  ? t('studio:pages.preview.untitled', 'Untitled page')
                  : previewTitle}
              </h2>
              <p className="text-body-sm truncate text-fg-subtle">
                {templateTitle(template)}
                {previewTable === null || previewTable === undefined || previewTable === ''
                  ? ''
                  : ` · ${previewTable}`}
              </p>
            </div>
            {previewAction === undefined ? null : (
              <div className="ms-auto shrink-0">{previewAction}</div>
            )}
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <p className="text-body-sm text-fg-muted">{templateDescription(template)}</p>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <TemplateSchematic template={template} />
            </div>
            <p className="text-body-sm text-fg-subtle">
              {t(
                'studio:pages.preview.note',
                'An illustration of the layout, not your data.',
              )}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-3">{actions}</div>
    </PageSurface>
  );
}
