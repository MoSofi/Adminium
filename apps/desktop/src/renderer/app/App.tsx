// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's own screens, one at a time, named by the hash so "Back" and the
 * window's own back gesture mean the same thing.
 */
import { useT } from '@adminium/i18n/react';
import { ToastStack, useToastQueue } from '@adminium/ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { DesktopShareInfo, DesktopStartState } from '../../preload/api.js';
import { ConnectScreen } from './connect/ConnectScreen.js';
import { NewProjectScreen } from './new/NewProjectScreen.js';
import { PlainShell } from './shell/PlainShell.js';
import { SharedScreen } from './shared/SharedScreen.js';
import { StartScreen } from './start/StartScreen.js';

export type Screen = 'start' | 'new' | 'connect';

export function screenFromHash(hash: string): Screen {
  return hash === '#/new' ? 'new' : hash === '#/connect' ? 'connect' : 'start';
}

export function App({ initial }: { initial: DesktopStartState }): ReactNode {
  const t = useT();
  const [screen, setScreen] = useState<Screen>(() => screenFromHash(window.location.hash));
  const toasts = useToastQueue();
  /** "Make a new project here", from a folder that was not a project: where New app proposes to keep it. */
  const [makeIn, setMakeIn] = useState<string | null>(null);

  useEffect(() => {
    const onHash = (): void => {
      setScreen(screenFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const go = useCallback((next: Screen): void => {
    window.location.hash = next === 'new' ? '#/new' : next === 'connect' ? '#/connect' : '#/';
  }, []);

  const say = useCallback(
    (title: string, variant: 'success' | 'error' | 'info' = 'info'): void => {
      toasts.push({ title, variant });
    },
    [toasts],
  );

  return (
    <PlainShell>
      {screen === 'connect' ? (
        <ConnectScreen
          onBack={() => {
            go('start');
          }}
          say={say}
        />
      ) : screen === 'new' ? (
        <NewProjectScreen
          proposedParent={makeIn ?? initial.proposedParent}
          proposedParentDisplay={makeIn ?? initial.proposedParentDisplay}
          onBack={() => {
            setMakeIn(null);
            go('start');
          }}
          say={say}
        />
      ) : (
        <StartScreen
          initial={initial}
          onBuild={() => {
            setMakeIn(null);
            go('new');
          }}
          onConnect={() => {
            go('connect');
          }}
          onMakeIn={(parent) => {
            setMakeIn(parent);
            go('new');
          }}
          say={say}
        />
      )}
      <ToastStack
        toasts={toasts.toasts}
        onDismissToast={toasts.dismiss}
        dismissLabel={t('desktop:toast.dismiss', 'Dismiss')}
        label={t('desktop:toast.region', 'Notices')}
        className="inset-x-0 bottom-6 end-auto mx-auto"
      />
    </PlainShell>
  );
}

/** The app's own page while a project is shared: the same shell, one screen. */
export function SharedApp({ initial }: { initial: DesktopShareInfo }): ReactNode {
  const t = useT();
  const toasts = useToastQueue();
  const say = useCallback(
    (title: string, variant: 'success' | 'error' | 'info' = 'info'): void => {
      toasts.push({ title, variant });
    },
    [toasts],
  );
  return (
    <PlainShell>
      <SharedScreen initial={initial} say={say} />
      <ToastStack toasts={toasts.toasts} onDismissToast={toasts.dismiss} dismissLabel={t('desktop:toast.dismiss', 'Dismiss')} label={t('desktop:toast.region', 'Notices')} className="inset-x-0 bottom-6 end-auto mx-auto" />
    </PlainShell>
  );
}
