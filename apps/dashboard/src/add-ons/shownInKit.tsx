// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "SHOWN IN", AS AN ADD-ON'S PAGE GETS IT: the host's own parts, published in
 * the `app` namespace (`ShownInChips`, `ShownInControl`, `ShownInField`,
 * `ShownInHeader`, `WorkspaceFilter`, `CurrentWorkspaceChip`,
 * `HiddenHereNote`) and its hooks (`useShownInList`, `useShownInPicker`,
 * `useShownInScope`). The workspaces come from the session (bootstrap), so a
 * page needs no workspace-managing permission to draw them.
 *
 * The parts are loaded with their first draw, not with the runtime: they sit
 * in the chunk the Library pages already share, and each waits for it in a
 * boundary of its own, drawing nothing meanwhile, so a page is never blanked
 * by a chip. The hooks are small and read the session only.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

export { useShownInList, useShownInPicker } from '../shown-in/useShownInList.js';
export { useShownInScope } from '../shown-in/scope.js';

type Parts = typeof import('../shown-in/ShownIn.js') & typeof import('../shown-in/ShownInField.js');

let parts: Promise<Parts> | null = null;
function loadParts(): Promise<Parts> {
  parts ??= Promise.all([import('../shown-in/ShownIn.js'), import('../shown-in/ShownInField.js')]).then(([shownIn, field]) => ({ ...shownIn, ...field }));
  // A chunk that would not load is asked for again by the next part that is drawn.
  parts.catch(() => {
    parts = null;
  });
  return parts;
}

/** One part, loaded on its first draw, in a boundary of its own. */
function part<P extends object>(name: keyof Parts): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: (await loadParts())[name] as unknown as ComponentType<P> }));
  function Part(props: P): ReactNode {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  Part.displayName = String(name);
  return Part;
}

type PropsOf<K extends keyof Parts> = Parts[K] extends (props: infer P) => unknown ? P : never;

export const ShownInChips = part<PropsOf<'ShownInChips'>>('ShownInChips');
export const ShownInControl = part<PropsOf<'ShownInControl'>>('ShownInControl');
export const ShownInField = part<PropsOf<'ShownInField'>>('ShownInField');
export const ShownInHeader = part<object>('ShownInHeader');
export const WorkspaceFilter = part<PropsOf<'WorkspaceFilter'>>('WorkspaceFilter');
export const CurrentWorkspaceChip = part<object>('CurrentWorkspaceChip');
export const HiddenHereNote = part<PropsOf<'HiddenHereNote'>>('HiddenHereNote');
