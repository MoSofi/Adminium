// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect Supabase" at the top of a connect wizard's source step
 * (`Trial Mode.dc.html` view 11; design map H1.47–H1.50, H1-D5, H1-D10).
 *
 * Shown only when the operator set a connect address (`/system/info`
 * `connect`); otherwise nothing renders and the step is exactly what it was.
 * Today's form stays below an "or" divider, for everyone.
 *
 * Two modes, because two of the three front doors have no session yet:
 *
 *  - `connect` (Studio's wizard, signed in): the button starts the hand-off
 *    and the browser goes to the operator. When it comes back
 *    (`connectReturn.ts`), this redeems the code and either hands the new,
 *    introspected connection to the wizard, asks for an existing project's
 *    password (typed here; the operator never sees it), or says the hand-off
 *    expired with a button to start again.
 *  - `pick` (first-run setup, the desktop's first run: the account does not
 *    exist yet, and every route that could start a hand-off needs one): the
 *    button records the choice, and the wizard sends the person on to
 *    Studio's connect wizard, which starts the sign-in, once the account
 *    exists.
 *
 * Its words are in `common`'s deferred `onboarding` group, read by the three
 * doors alike; it waits for them itself.
 */
import { useQuery } from '@tanstack/react-query';
import { Check, PlugZap, ShieldCheck, SquareArrowOutUpRight } from 'lucide-react';
import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, FormField, Input } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { systemInfoQuery } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { connectApi, leaveFor, offersProvider, type ConnectedConnection, type ConnectResult } from './connectApi.js';
import { takeConnectReturn, type ConnectReturn } from './connectReturn.js';
import { SupabaseMark } from './SupabaseMark.js';

export type ProviderConnectProps =
  | {
      mode: 'connect';
      /** The new connection, tested and introspected: the wizard goes on with it. */
      onConnected: (connection: ConnectedConnection) => void;
      /** Start the sign-in at once: the person already chose it, before their account existed. */
      autoStart?: boolean | undefined;
      /** Called once an auto start has been used, so a reload does not start it again. */
      onAutoStarted?: (() => void) | undefined;
    }
  | {
      mode: 'pick';
      picked: boolean;
      onPick: () => void;
      disabled?: boolean | undefined;
    };

type Phase =
  | { kind: 'start' }
  | { kind: 'busy' }
  | { kind: 'password'; pendingId: string; project: string | null; error: string | null }
  | { kind: 'error'; expired: boolean; message: string | null };

/** A 42 px tile, as drawn. */
function Tile({ tone, children }: { tone: 'mark' | 'danger'; children: ReactNode }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={
        tone === 'mark'
          ? 'flex size-[42px] shrink-0 items-center justify-center rounded-[11px] border border-border bg-surface-2'
          : 'flex size-[42px] shrink-0 items-center justify-center rounded-[11px] bg-danger-soft text-danger [&_svg]:size-[19px]'
      }
    >
      {children}
    </span>
  );
}

function Divider(): ReactNode {
  return (
    <div className="flex items-center gap-3 text-[11.5px] font-bold uppercase tracking-[.05em] text-fg-subtle" data-testid="connect-provider-or">
      <span aria-hidden="true" className="h-px flex-1 bg-border-strong" />
      {t('onboarding.connectProvider.or', 'or')}
      <span aria-hidden="true" className="h-px flex-1 bg-border-strong" />
    </div>
  );
}

const outIcon = <SquareArrowOutUpRight className="size-[14px]" aria-hidden="true" />;

function StartCard({ body, action, onAction, busy, disabled, done }: { body: string; action: string; onAction: () => void; busy: boolean; disabled?: boolean | undefined; done?: boolean | undefined }): ReactNode {
  return (
    <Card className="flex flex-wrap items-center gap-3.5" data-testid="connect-provider-start">
      <Tile tone="mark">
        <SupabaseMark />
      </Tile>
      <div className="min-w-[200px] flex-1">
        <h2 className="text-[14.5px] font-bold">{t('onboarding.connectProvider.supabase.title', 'Connect Supabase')}</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">{body}</p>
      </div>
      <Button onClick={onAction} loading={busy} disabled={disabled === true || busy} iconRight={done === true ? <Check className="size-[14px]" aria-hidden="true" /> : outIcon}>
        {action}
      </Button>
    </Card>
  );
}

/**
 * What the error card says. An answer of the operator's that this instance
 * refused (a redirect, a bad field, too large, too slow) is the same to the
 * person as an expired one: start again. A host the operator does not allow
 * is said in the person's words (`OFF_BY_OPERATOR`, `app/refusalWords.ts`).
 * The server's own English is never on the card.
 */
function messageOf(cause: unknown): { expired: boolean; message: string | null } {
  if (!(cause instanceof ApiError)) return { expired: false, message: null };
  if (cause.code === 'CONNECT_EXPIRED' || cause.code === 'CONNECT_REFUSED' || cause.status === 410) return { expired: true, message: null };
  return { expired: false, message: cause.code === 'OFF_BY_OPERATOR' ? cause.message : null };
}

function ConnectMode({ onConnected, autoStart, onAutoStarted }: Extract<ProviderConnectProps, { mode: 'connect' }>): ReactNode {
  // Taken in an initialiser, not an effect: a second render (StrictMode) must not find it gone and miss it.
  const [back] = useState<ConnectReturn | null>(takeConnectReturn);
  const [phase, setPhase] = useState<Phase>(back === null ? { kind: 'start' } : { kind: 'busy' });
  const [password, setPassword] = useState('');
  const ran = useRef(false);

  const settle = (result: ConnectResult): void => {
    if (result.status === 'connected') {
      onConnected(result.connection);
      return;
    }
    setPassword('');
    setPhase({ kind: 'password', pendingId: result.pendingId, project: result.project, error: null });
  };

  const fail = (cause: unknown): void => setPhase({ kind: 'error', ...messageOf(cause) });

  const begin = (): void => {
    setPhase({ kind: 'busy' });
    void connectApi.start('supabase').then(leaveFor.go, fail);
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (back !== null) {
      void connectApi.finish(back).then(settle, fail);
      return;
    }
    if (autoStart === true) {
      onAutoStarted?.();
      begin();
    }
    // Once, on mount: what came back, or the start the person already asked for.
  }, []);

  if (phase.kind === 'password') {
    const submit = (event: FormEvent): void => {
      event.preventDefault();
      if (password === '') return;
      const held = phase;
      setPhase({ ...held, error: null });
      void connectApi.complete(held.pendingId, password).then(settle, (cause: unknown) => {
        const why = messageOf(cause);
        // Spent or expired: start again. Anything else (a wrong password): type it again, with what the database said.
        if (why.expired) setPhase({ kind: 'error', ...why });
        else setPhase({ ...held, error: (cause instanceof ApiError ? cause.message : null) ?? t('onboarding.connectProvider.existing.failed', 'That password did not connect. Check it and try again.') });
      });
    };
    return (
      <Card className="flex flex-col gap-3.5" data-testid="connect-provider-password">
        <div className="flex items-center gap-3">
          <Tile tone="mark">
            <SupabaseMark />
          </Tile>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14.5px] font-bold">{t('onboarding.connectProvider.existing.title', 'Use an existing project')}</h2>
            {phase.project === null ? null : <p className="mt-0.5 truncate font-mono text-[12px] text-fg-muted">{phase.project}</p>}
          </div>
          <button type="button" onClick={begin} className="text-[12.5px] font-bold text-accent hover:underline">
            {t('onboarding.connectProvider.existing.change', 'Change')}
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <FormField
            label={
              phase.project === null
                ? t('onboarding.connectProvider.existing.labelNoName', 'Enter the database password for this project')
                : t('onboarding.connectProvider.existing.label', 'Enter the database password for project {project}', { project: phase.project })
            }
            {...(phase.error === null
              ? {
                  helper: (
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="size-[14px] shrink-0 text-pos" aria-hidden="true" />
                      {t('onboarding.connectProvider.existing.help', 'The operator never sees it: it goes straight to this installation.')}
                    </span>
                  ),
                }
              : { error: phase.error })}
          >
            <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="max-w-[400px]" />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" disabled={password === ''}>
              {t('onboarding.connectProvider.existing.connect', 'Connect')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPhase({ kind: 'start' })}>
              {t('onboarding.connectProvider.existing.back', 'Back')}
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  if (phase.kind === 'error') {
    return (
      <Card role="alert" className="flex flex-wrap items-center gap-3.5 border-[color-mix(in_srgb,var(--danger)_40%,var(--border))]" data-testid="connect-provider-error">
        <Tile tone="danger">
          <PlugZap />
        </Tile>
        <div className="min-w-[200px] flex-1">
          <h2 className="text-[14.5px] font-bold">
            {phase.expired ? t('onboarding.connectProvider.supabase.expired', 'Supabase connection expired.') : t('onboarding.connectProvider.supabase.failed', 'Supabase could not be connected.')}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {phase.expired || phase.message === null ? t('onboarding.connectProvider.supabase.body', 'Sign in to Supabase and pick a project.') : phase.message}
          </p>
        </div>
        <Button onClick={begin} iconRight={outIcon}>
          {t('onboarding.connectProvider.supabase.again', 'Connect Supabase again')}
        </Button>
      </Card>
    );
  }

  return (
    <StartCard
      body={phase.kind === 'busy' && back !== null ? t('onboarding.connectProvider.supabase.connecting', 'Connecting your Supabase project…') : t('onboarding.connectProvider.supabase.body', 'Sign in to Supabase and pick a project.')}
      action={t('onboarding.connectProvider.supabase.action', 'Connect Supabase')}
      onAction={begin}
      busy={phase.kind === 'busy'}
    />
  );
}

function PickMode({ picked, onPick, disabled }: Extract<ProviderConnectProps, { mode: 'pick' }>): ReactNode {
  return (
    <StartCard
      body={
        picked
          ? t('onboarding.connectProvider.supabase.picked', 'Picked. You sign in to Supabase once your account exists.')
          : t('onboarding.connectProvider.supabase.body', 'Sign in to Supabase and pick a project.')
      }
      action={t('onboarding.connectProvider.supabase.action', 'Connect Supabase')}
      onAction={onPick}
      busy={false}
      disabled={disabled}
      done={picked}
    />
  );
}

/**
 * Waits for the words, ABOVE the card: a component that suspends on its first
 * render loses its state, and the card's first state is the one-time return
 * it took out of storage.
 */
function WithWords({ children }: { children: ReactNode }): ReactNode {
  useCommonWords();
  return children;
}

/**
 * The card and the "or" under it, or nothing when the operator offers no
 * Supabase connection.
 */
export function ProviderConnect(props: ProviderConnectProps): ReactNode {
  const info = useQuery(systemInfoQuery()).data;
  if (!offersProvider(info, 'supabase')) return null;
  return (
    <div className="flex flex-col gap-[18px]" data-testid="connect-provider">
      <Suspense fallback={null}>
        <WithWords>
          {props.mode === 'connect' ? <ConnectMode {...props} /> : <PickMode {...props} />}
          <Divider />
        </WithWords>
      </Suspense>
    </div>
  );
}
