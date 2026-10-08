// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page's other half: the app itself (Preview) and how it is made
 * (Architecture). The preview's state is held here, above its bar and its
 * frame, and the frame is kept while the other tab shows.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { DesignerSession } from '../api.js';
import { Preview, PreviewTools } from './Preview.js';
import type { TurnView } from './turns.js';
import { usePreview } from './usePreview.js';

/** The diagram library is loaded only when the tab opens. */
const ArchitectureTab = lazy(() => import('../architecture/ArchitectureTab.js'));

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
  const preview = usePreview(session, turns);
  const onPreview = tab === 'preview';
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <TabsList className="border-b-0">
          <TabsTrigger value="preview">{t('designer:work.preview', 'Preview')}</TabsTrigger>
          <TabsTrigger value="architecture">{t('designer:work.architecture', 'Architecture')}</TabsTrigger>
        </TabsList>
      </div>
      {onPreview ? <PreviewTools preview={preview} compact={narrow} /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/*
          The preview stays on every tab, at its full size: a frame taken away is a ticket spent to bring it
          back, and one with no size cannot be looked at by the Designer. Out of sight it is out of reach
          too, for a pointer, the keyboard and a screen reader.
        */}
        <TabsContent value="preview" forceMount inert={!onPreview} className={`absolute inset-0 flex flex-col ${onPreview ? '' : 'invisible'}`}>
          <Preview preview={preview} session={session} turns={turns} onFix={onFix} compact={narrow} />
        </TabsContent>
        <TabsContent value="architecture" className="relative flex min-h-0 flex-1 flex-col bg-surface-2">
          {tab === 'architecture' ? (
            <Suspense fallback={null}>
              <ArchitectureTab session={session} />
            </Suspense>
          ) : null}
        </TabsContent>
      </div>
    </Tabs>
  );
}
