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
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Eye, LoaderCircle } from 'lucide-react';
import { Tabs, TabsContent } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { DesignerSession } from '../api.js';
import { AddressBar } from './AddressBar.js';
import { CodeBarEnd } from './CodeBar.js';
import { firstLevel, nextLevel, type BarLevel } from './barLevel.js';
import { useKnownPages } from './knownPages.js';
import { Preview } from './Preview.js';
import type { TurnView } from './turns.js';
import type { CodeFiles } from './useCodeFiles.js';
import { usePreview } from './usePreview.js';
import { seenAs, WorkBar, type WorkTab } from './WorkBar.js';

/** The diagram library is loaded only when the tab opens. */
const ArchitectureTab = lazy(() => import('../architecture/ArchitectureTab.js'));

/** The editor's own part of the page did not arrive (the network, or a server restarted under the tab): said, with a way to ask again. */
class EditorBoundary extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] leading-[normal] text-fg-muted">
        <p className="m-0 font-semibold">{t('designer:code.editorFailed', 'The editor could not be loaded.')}</p>
        <button type="button" onClick={this.props.onRetry} className="rounded-[9px] border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
          {t('designer:code.tryAgain', 'Try again')}
        </button>
      </div>
    );
  }
}

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
  code,
  codeAsked = 0,
  onFix,
  onNotice,
  onFoldedNeed,
}: {
  session: DesignerSession;
  turns: readonly TurnView[];
  /** The files a person may change by hand, and what they have typed. */
  code: CodeFiles;
  /** Each time this grows the Code tab is opened: the page has something there for the person to see. */
  codeAsked?: number;
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
  const tabs: WorkTab[] = [
    { value: 'preview', label: t('designer:work.preview', 'Preview') },
    { value: 'architecture', label: t('designer:work.architecture', 'Architecture') },
    { value: 'code', label: t('designer:work.code', 'Code') },
  ];
  // The editor is loaded when the tab is first opened, and its panel is kept from then on: what was typed lives in it.
  const [attempt, setAttempt] = useState(0);
  // A new attempt asks for the chunk again: a failed one is remembered by the component it made.
  const CodeTab = useMemo(() => lazy(() => import('./CodeTab.js')), [attempt]);
  const { activate } = code;
  useEffect(() => {
    if (tab === 'code') activate();
  }, [tab, activate]);
  useEffect(() => {
    if (codeAsked > 0) setTab('code');
  }, [codeAsked]);

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
        endFills={tab === 'code'}
        end={
          tab === 'code' ? (
            <CodeBarEnd code={code} />
          ) : (
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
          )
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
        {code.active ? (
          <TabsContent value="code" forceMount hidden={tab !== 'code'} className={`min-h-0 flex-1 flex-col pt-0 ${tab === 'code' ? 'flex' : 'hidden'}`}>
            <EditorBoundary key={attempt} onRetry={() => setAttempt((count) => count + 1)}>
              <Suspense
                fallback={
                  <p role="status" className="m-0 flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] font-semibold leading-[normal] text-fg-muted">
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
                    {t('designer:code.editorLoading', 'Opening the editor…')}
                  </p>
                }
              >
                <CodeTab code={code} compact={narrow} onFix={onFix} />
              </Suspense>
            </EditorBoundary>
          </TabsContent>
        ) : null}
      </div>
    </Tabs>
  );
}
