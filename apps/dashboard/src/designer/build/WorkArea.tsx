// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page's other half: the app itself (Preview) and how it is made
 * (Architecture).
 */
import { useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { DesignerSession } from '../api.js';

export function WorkArea({ session }: { session: DesignerSession }): ReactNode {
  const [tab, setTab] = useState('preview');
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <TabsList className="border-b-0">
          <TabsTrigger value="preview">{t('designer:work.preview', 'Preview')}</TabsTrigger>
          <TabsTrigger value="architecture">{t('designer:work.architecture', 'Architecture')}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col bg-surface-2">
        <div className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
          {t('designer:work.previewSoon', 'The preview of {name} shows here.', { name: session.title })}
        </div>
      </TabsContent>
      <TabsContent value="architecture" className="flex min-h-0 flex-1 flex-col bg-surface-2">
        <div className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
          {t('designer:work.architectureSoon', 'How {name} is made shows here.', { name: session.title })}
        </div>
      </TabsContent>
    </Tabs>
  );
}
