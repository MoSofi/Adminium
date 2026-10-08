// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page's other half: the app itself (Preview) and how it is made
 * (Architecture), under one bar. The preview's state is held here, above the
 * bar and the frame, and the frame is kept while another tab shows.
 *
 * The bar is measured here and folds as it narrows (`barLevel.ts`). A copy of
 * the preview's bar at its most folded is measured off-screen, once and when
 * its words change: that one number says whether the chat and the work area
 * fit side by side at all, whatever tab is open.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import { Tabs, TabsContent } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { DesignerSession } from '../api.js';
import { AddressBar } from './AddressBar.js';
import { firstLevel, nextLevel, type BarLevel } from './barLevel.js';
import { useKnownPages } from './knownPages.js';
import { Preview } from './Preview.js';
import type { TurnView } from './turns.js';
import { usePreview } from './usePreview.js';
import { seenAs, WorkBar, type WorkTab } from './WorkBar.js';

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

/** A sentence with one part of it drawn its own way: the words come whole from the catalogue, the part is cut out of them. */
function withMark(sentence: (mark: string) => string, part: ReactNode): ReactNode {
  const [before, after] = sentence('\u0001').split('\u0001');
  return (
    <>
      {before}
      {part}
      {after}
    </>
  );
}

export function WorkArea({
  session,
  turns,
  onFix,
  onNotice,
  onFoldedNeed,
}: {
  session: DesignerSession;
  turns: readonly TurnView[];
  onFix: (message: string) => void;
  /** A word for the person, said as the page says such things. */
  onNotice: (text: string) => void;
  /** What the preview's bar needs at its most folded, once it has been measured. */
  onFoldedNeed?: (need: number) => void;
}): ReactNode {
  const [tab, setTab] = useState('preview');
  const narrow = useNarrow();
  const preview = usePreview(session, turns);
  const onPreview = tab === 'preview';
  // The third tab is added where its panel is: the bar takes whatever list it is given.
  const tabs: WorkTab[] = [
    { value: 'preview', label: t('designer:work.preview', 'Preview') },
    { value: 'architecture', label: t('designer:work.architecture', 'Architecture') },
  ];

  const hasTools = !preview.noPreview && preview.app !== null;
  const pages = useKnownPages(session.id, session.appKey, preview.side, preview.visited, hasTools);
  const language = getI18nInstance()?.language ?? '';
  // Everything that changes a width in the bar. Anything measured under another key is forgotten.
  const words = `${language}|${preview.sides.join(',')}|${hasTools ? seenAs(preview.side, preview.ticket?.seenAs ?? null).label : ''}`;
  const key = `${words}|${preview.side}|${tab}`;
  const keyNow = useRef(key);
  keyNow.current = key;
  const bar = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState(() => firstLevel(key));
  const measure = useCallback((): void => {
    const element = bar.current;
    if (element === null) return;
    setFold((state) => nextLevel(state, { width: element.clientWidth, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, key: keyNow.current }));
  }, []);
  // After every layout, until it settles: a level that overflows is never painted.
  useLayoutEffect(measure);
  useEffect(() => {
    const element = bar.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  // The page's own letters arriving change every width: what was measured in the stand-in face is forgotten.
  const [faces, setFaces] = useState(0);
  useEffect(() => {
    let live = true;
    void (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(() => {
      if (!live) return;
      setFold(firstLevel(keyNow.current));
      setFaces((value) => value + 1);
    });
    return () => {
      live = false;
    };
  }, []);
  // A phone-wide window is two rows whatever fits.
  const level: BarLevel = narrow ? 4 : fold.key === key ? fold.level : 0;

  const probe = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!hasTools || probe.current === null) return;
    const need = Math.max(...Array.from(probe.current.children, (child) => child.scrollWidth));
    if (need > 0) onFoldedNeed?.(need);
    // Measured again only when the words that set its width change.
  }, [words, hasTools, faces]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <WorkBar
        barRef={bar}
        tabs={tabs}
        tab={tab}
        level={level}
        preview={preview}
        address={
          <AddressBar
            side={preview.side}
            path={preview.path}
            prefix={preview.prefix}
            spoken={preview.spoken}
            pages={pages}
            listLabel={preview.side === 'customer' ? t('designer:preview.pagesOpened', 'Pages you have opened') : t('designer:preview.pages', 'Pages on this side')}
            onGo={preview.go}
          />
        }
        onNotice={onNotice}
        end={
          <span className="flex items-center gap-[7px] whitespace-nowrap text-[12px] font-semibold text-fg-muted">
            <Eye aria-hidden="true" className="size-3.5" />
            {session.version === null ? (
              t('designer:arch.readOnly', 'Read only')
            ) : (
              <span>
                {withMark(
                  (mark) => t('designer:arch.readOnlyFrom', 'Read only · drawn from {version}', { version: mark }),
                  <span className="font-mono font-semibold text-fg">{`v${String(session.version)}`}</span>,
                )}
              </span>
            )}
          </span>
        }
      />
      {hasTools ? (
        // The preview's bar at its most folded, once for each side the app has: never seen, never reached, only measured.
        <div ref={probe} aria-hidden="true" inert className="pointer-events-none invisible absolute start-0 top-0 h-0 w-0 overflow-hidden">
          {preview.sides.map((side) => (
            <WorkBar key={side} measuring tabs={tabs} tab="preview" level={3} preview={{ ...preview, side }} address={<AddressBar side={side} path="/" measuring />} onNotice={() => undefined} />
          ))}
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/*
          The preview stays on every tab, at its full size: a frame taken away is a ticket spent to bring it
          back, and one with no size cannot be looked at by the Designer. Out of sight it is out of reach
          too, for a pointer, the keyboard and a screen reader.
        */}
        <TabsContent value="preview" forceMount inert={!onPreview} className={`absolute inset-0 flex flex-col pt-0 ${onPreview ? '' : 'invisible'}`}>
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
