// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React binding for the global shortcut manager (app/shortcuts.ts): one
 * window keydown listener for the whole app, `useShortcut` registration that
 * follows component lifecycles, and the chord-pending signal for the topbar
 * "G…" indicator.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createShortcutManager, type ShortcutDef, type ShortcutManager } from '../app/shortcuts.js';

const ShortcutsContext = createContext<ShortcutManager | null>(null);

export function ShortcutsProvider({ children, manager }: { children: ReactNode; manager?: ShortcutManager }) {
  const value = useMemo(() => manager ?? createShortcutManager(), [manager]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      value.handleKeydown(event);
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [value]);

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export function useShortcutManager(): ShortcutManager {
  const manager = useContext(ShortcutsContext);
  if (manager === null) throw new Error('useShortcutManager requires <ShortcutsProvider>');
  return manager;
}

/**
 * Registers a shortcut for the component's lifetime. Inline defs are fine —
 * the registration is keyed on id/keys/label; handler and `when` always see
 * the latest closure via a ref.
 */
export function useShortcut(def: ShortcutDef): void {
  const manager = useShortcutManager();
  const latest = useRef(def);
  latest.current = def;
  const keysSignature = def.keys.join(' ');
  useEffect(
    () =>
      manager.register({
        id: latest.current.id,
        group: latest.current.group,
        label: latest.current.label,
        keys: latest.current.keys,
        when: () => latest.current.when?.() ?? true,
        ...(latest.current.handler === undefined
          ? {}
          : { handler: (event: KeyboardEvent) => latest.current.handler?.(event) }),
      }),
    // Identity deliberately keyed on the stable bits only.
    [manager, def.id, def.group, def.label, keysSignature, def.handler === undefined],
  );
}

/** Live chord-pending value ("g") for the topbar indicator; null when idle. */
export function useChordPending(): string | null {
  const manager = useShortcutManager();
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => manager.onChordPending(setPending), [manager]);
  return pending;
}
