// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page's other half: the app itself (Preview) and how it is made
 * (Architecture).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { DesignerSession } from '../api.js';
import { Preview } from './Preview.js';
import type { TurnView } from './turns.js';

/** A phone-wide window: the preview has no width switch there. */
function useNarrow(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const on = (): void => setNarrow(list.matches);
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function WorkArea({ session, turns, onFix }: { session: DesignerSession; turns: readonly TurnView[]; onFix: (message: string) => void }): ReactNode {
  const [tab, setTab] = useState('preview');
  const narrow = useNarrow();
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <TabsList className="border-b-0">
          <TabsTrigger value="preview">{t('designer:work.preview', 'Preview')}</TabsTrigger>
          <TabsTrigger value="architecture">{t('designer:work.architecture', 'Architecture')}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col">
        <Preview session={session} turns={turns} onFix={onFix} compact={narrow} />
      </TabsContent>
      <TabsContent value="architecture" className="flex min-h-0 flex-1 flex-col bg-surface-2">
        <div className="m-auto max-w-[360px] px-6 text-center text-[13px] text-fg-muted">
          {t('designer:work.architectureSoon', 'How {name} is made shows here.', { name: session.title })}
        </div>
      </TabsContent>
    </Tabs>
  );
}
