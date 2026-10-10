// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's own screens, one at a time, named by the hash so "Back" and the
 * window's own back gesture mean the same thing.
 */
import { useT } from '@adminium/i18n/react';
import { ToastStack, useToastQueue } from '@adminium/ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { DesktopStartState } from '../../preload/api.js';
import { NewProjectScreen } from './new/NewProjectScreen.js';
import { PlainShell } from './shell/PlainShell.js';
import { StartScreen } from './start/StartScreen.js';

export type Screen = 'start' | 'new';

export function screenFromHash(hash: string): Screen {
  return hash === '#/new' ? 'new' : 'start';
}

export function App({ initial }: { initial: DesktopStartState }): ReactNode {
  const t = useT();
  const [screen, setScreen] = useState<Screen>(() => screenFromHash(window.location.hash));
  const toasts = useToastQueue();

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
    window.location.hash = next === 'new' ? '#/new' : '#/';
  }, []);

  const say = useCallback(
    (title: string, variant: 'success' | 'error' | 'info' = 'info'): void => {
      toasts.push({ title, variant });
    },
    [toasts],
  );

  return (
    <PlainShell>
      {screen === 'new' ? (
        <NewProjectScreen
          proposedParent={initial.proposedParent}
          proposedParentDisplay={initial.proposedParentDisplay}
          onBack={() => {
            go('start');
          }}
          say={say}
        />
      ) : (
        <StartScreen
          initial={initial}
          onBuild={() => {
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
