// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ground every mounted part stands on: a React root of the kit's own
 * inside the app's element, the part's words in the person's language, and
 * the wrapper the kit's styles hang from.
 *
 * The props are kept here, outside React, because the app that gave them may
 * have no React at all: `update` writes the new ones and the root draws again
 * in place, so what the person is typing into keeps its focus and its caret.
 */
import { I18nProvider } from '@adminium/i18n/react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type { I18nInstance } from '@adminium/i18n';

import type { KitCommonProps, KitMounted, KitPartName } from './contract.js';
import { kitI18n, kitLocaleOf, loadKitWords } from './words.js';

import './kit.css';

interface Drawn<P> {
  props: P;
  tag: string;
  i18n: I18nInstance;
}

interface Store<P> {
  get(): Drawn<P>;
  set(next: Drawn<P>): void;
  subscribe(listener: () => void): () => void;
}

function storeOf<P>(first: Drawn<P>): Store<P> {
  let now = first;
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set: (next) => {
      now = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** How a part draws itself from its props; `patch` is how it changes one of them itself (a box keeping what was typed). */
export type KitRender<P> = (props: P, patch: (change: Partial<P>) => void) => ReactNode;

function Host<P extends KitCommonProps>({ part, store, patch, render }: { part: KitPartName; store: Store<P>; patch: (change: Partial<P>) => void; render: KitRender<P> }): ReactNode {
  const { props, tag, i18n } = useSyncExternalStore(store.subscribe, store.get);
  return (
    <I18nProvider i18n={i18n}>
      <div className="adm-kit" data-kit-part={part} dir={props.dir} lang={tag} {...(props.theme === undefined ? {} : { 'data-kit-theme': props.theme })}>
        {render(props, patch)}
      </div>
    </I18nProvider>
  );
}

/** Draws a part inside `element` and answers the handle the app keeps. Resolves once the part is in the page. */
export async function mountReact<P extends KitCommonProps>(part: KitPartName, element: Element, props: P, render: KitRender<P>): Promise<KitMounted<P>> {
  const first = await loadKitWords(props.locale);
  const store = storeOf<P>({ props, tag: first.tag, i18n: kitI18n(part, first.tag, first.words) });
  let mounted = true;

  const patch = (change: Partial<P>): void => {
    if (!mounted) return;
    const before = store.get();
    const next = { ...before.props, ...change };
    store.set({ ...before, props: next });
    // Another language: its words are fetched, and the part speaks the old one until they are in.
    const wanted = kitLocaleOf(next.locale);
    if (wanted !== before.tag) {
      void loadKitWords(next.locale).then((loaded) => {
        const now = store.get();
        if (!mounted || kitLocaleOf(now.props.locale) !== loaded.tag || now.tag === loaded.tag) return;
        store.set({ ...now, tag: loaded.tag, i18n: kitI18n(part, loaded.tag, loaded.words) });
      });
    }
  };

  const root = createRoot(element);
  // In the page before the promise answers: the app may reach for the box at once.
  flushSync(() => {
    root.render(<Host part={part} store={store} patch={patch} render={render} />);
  });

  return {
    update: patch,
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      root.unmount();
    },
  };
}
