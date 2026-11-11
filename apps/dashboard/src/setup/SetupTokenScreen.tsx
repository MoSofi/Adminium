// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first screen a server's first-run wizard shows: the one-time setup token.
 *
 * A fresh server makes its first visitor the super admin, so a server boot
 * prints a token in its log and the wizard asks for it before anything else
 * (`server/src/setup/token.ts`). It sits in FRONT of the wizard rather than
 * inside it as a step: the connect step already calls the server (the probe,
 * and adopting an existing store), and both need the token, so there is no
 * later point to ask at. The desktop app and `dev` on this computer never show
 * it — their server says `tokenRequired: false`.
 *
 * `AuthScreenLayout`, like `/login`: a single field and a button, the shape of
 * every other "prove who you are" screen in the product.
 */
import { KeyRound } from 'lucide-react';
import { Alert, Button, FormField, IconTile, InputGroup } from '@adminium/ui';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { AuthScreenLayout } from '../auth/AuthScreenLayout.js';
import { checkSetupToken, takeFragmentSetupToken } from './setupApi.js';

export interface SetupTokenScreenProps {
  /** The token opened setup; the wizard may start. */
  onAccepted: () => void;
  /** Setup was finished elsewhere meanwhile (409): send them to sign in. */
  onClosed: () => void;
}

export function SetupTokenScreen({ onAccepted, onClosed }: SetupTokenScreenProps): ReactNode {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromFragment = useRef<boolean>(false);

  function submit(candidate: string): void {
    const value = candidate.trim();
    if (value === '') {
      setError(t('onboarding:token.empty', 'Paste the setup token first.'));
      return;
    }
    setBusy(true);
    setError(null);
    checkSetupToken(value)
      .then(() => {
        setBusy(false);
        onAccepted();
      })
      .catch((cause: unknown) => {
        setBusy(false);
        if (cause instanceof ApiError && cause.status === 409) {
          onClosed();
          return;
        }
        setError(
          cause instanceof ApiError && cause.status === 403
            ? t('onboarding:token.wrong', 'That is not this server’s setup token. Copy it again from the log.')
            : cause instanceof ApiError && cause.status === 429
              ? t('onboarding:token.rateLimited', 'Too many tries. Wait a minute, then try again.')
              : t('onboarding:token.failed', 'Could not check the token. Check your connection and try again.'),
        );
      });
  }

  // `adminium try` opens this browser with the token in the fragment.
  useEffect(() => {
    if (fromFragment.current) return;
    fromFragment.current = true;
    const handed = takeFragmentSetupToken();
    if (handed === null) return;
    setToken(handed);
    submit(handed);
    // Once, on mount (the ref also keeps StrictMode's second run from re-submitting).
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit(token);
  }

  return (
    <AuthScreenLayout documentTitle={null}>
      <form noValidate data-part="setup-token-form" className="flex w-full flex-col" onSubmit={onSubmit}>
        <IconTile tone="accent" size="lg" icon={<KeyRound />} />
        <h1 className="mt-4 text-[23px] font-extrabold tracking-[-0.02em] text-fg">
          {t('onboarding:token.title', 'Enter your setup token')}
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">
          {t(
            'onboarding:token.body',
            'Adminium printed a one-time setup token in its log when it started. It proves you run this server before you create its first account.',
          )}
        </p>

        {error === null ? null : <Alert tone="danger" role="alert" title={error} className="mt-4" />}

        <div className="mt-6 flex flex-col gap-4">
          <FormField
            label={t('onboarding:token.label', 'Setup token')}
            helper={t(
              'onboarding:token.helper',
              'Look for the line that starts with “Setup token:” in the server or container log.',
            )}
          >
            <InputGroup
              name="setup-token"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="font-mono"
              iconLeading={<KeyRound />}
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
            />
          </FormField>
          <Button type="submit" loading={busy} className="w-full">
            {t('onboarding:token.submit', 'Continue')}
          </Button>
        </div>
      </form>
    </AuthScreenLayout>
  );
}
