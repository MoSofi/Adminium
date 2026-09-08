// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector aside (comp 588-592, 625; Appendix A §E3): the *Sections /
 * Design* tray, the Sections tab, or the Design tab's context header — the
 * selected thing's icon, title and hint on an accent-soft card with a way
 * back — over the panel the editor composes for the selection.
 *
 * The comp's aside scrolls inside a fixed-height row; this shell scrolls the
 * page, so the aside is STICKY under the topbar and the editor header (both
 * heights measured by the editor) and scrolls on its own within the viewport
 * while the canvas flows with the page.
 */
import { ArrowLeft, LayoutList, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { emailIcon } from '../../icons.js';
import { SectionsTab, type SectionsTabProps } from './SectionsTab.js';

export type InspectorTab = 'sections' | 'design';

export interface DesignHeader {
  icon: string;
  title: string;
  hint: string;
}

export interface InspectorProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  sections: SectionsTabProps;
  design: DesignHeader;
  /** The panel for the current selection (branding, subject, footer, attachments, a block). */
  panel: ReactNode;
}

export function Inspector({ tab, onTabChange, sections, design, panel }: InspectorProps) {
  const HeaderIcon = emailIcon(design.icon);
  return (
    <aside
      data-testid="email-inspector"
      className="nb-scroll sticky top-[calc(var(--adm-topbar-h,0px)+var(--adm-editor-header-h,0px))] hidden max-h-[calc(100dvh-var(--adm-topbar-h,0px)-var(--adm-editor-header-h,0px))] w-72 shrink-0 self-start overflow-auto border-s border-border bg-surface px-4 pb-10 pt-[18px] lg:block"
    >
      <Tabs variant="pill" value={tab} onValueChange={(value) => onTabChange(value === 'design' ? 'design' : 'sections')}>
        <TabsList aria-label={t('email:inspector.tabs', 'Inspector')} className="mb-4 w-full">
          <TabsTrigger value="sections" className="flex-1">
            <LayoutList className="size-3.5" aria-hidden="true" />
            {t('email:inspector.sections', 'Sections')}
          </TabsTrigger>
          <TabsTrigger value="design" className="flex-1">
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            {t('email:inspector.design', 'Design')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sections">
          <SectionsTab {...sections} />
        </TabsContent>
        <TabsContent value="design">
        <div data-testid="email-design-tab">
          <div data-testid="email-design-header" data-icon={design.icon} className="mb-[18px] flex items-center gap-[9px] rounded-xl bg-accent-soft px-[11px] py-[9px]">
            <IconButton
              variant="bordered"
              size="sm"
              label={t('email:inspector.backToSections', 'Back to sections')}
              onClick={() => onTabChange('sections')}
              className="border-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent"
              data-testid="email-design-back"
            >
              <ArrowLeft className="size-[15px]" />
            </IconButton>
            <HeaderIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[13px] font-extrabold text-accent">{design.title}</div>
              <div className="text-[10.5px] text-accent">{design.hint}</div>
            </div>
          </div>
          {panel}
        </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
