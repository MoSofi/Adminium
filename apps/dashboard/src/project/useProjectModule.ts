// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loads a project page or widget module for a component, with a retry.
 *
 * Not `React.lazy`: a lazy component keeps a failed load forever, and here a
 * failure is often fixed a second later, when `adminium dev` rebuilds the
 * file. A rebuilt file also has a new URL, which starts a new load.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ProjectClientEntry } from './bootstrapProject.js';
import { isComponent, loadProjectModule } from './client.js';

export type ProjectModuleState<D> =
  | { status: 'loading' }
  | { status: 'ready'; definition: D }
  | { status: 'failed'; error: Error };

/** What a page's or widget's default export must have. */
export interface ComponentDefinition {
  component: (props: never) => unknown;
}

export function checkDefinition(value: unknown, source: string, helper: string): ComponentDefinition {
  const component = (value as { component?: unknown } | null | undefined)?.component;
  if (!isComponent(component)) {
    throw new Error(`${source} does not export default ${helper}({ component, … }).`);
  }
  return value as ComponentDefinition;
}

export function useProjectModule<D>(
  entry: ProjectClientEntry | null,
  check: (value: unknown) => D,
): ProjectModuleState<D> & { retry: () => void } {
  const [state, setState] = useState<ProjectModuleState<D>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const url = entry?.module.url ?? null;

  useEffect(() => {
    if (entry === null) return;
    let alive = true;
    setState({ status: 'loading' });
    loadProjectModule(entry).then(
      (value) => {
        if (!alive) return;
        try {
          setState({ status: 'ready', definition: check(value) });
        } catch (error) {
          setState({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
      (error: unknown) => {
        if (alive) setState({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => {
      alive = false;
    };
    // `entry` changes identity with every bootstrap refetch, and `check` with
    // every render; the URL is what decides whether to load again.
  }, [url, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}
