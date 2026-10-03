// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two things the dashboard says on a server run by `adminium design`.
 *
 * 1. WHOSE EYES THIS IS. The Designer's preview signs in as a user that holds
 *    only the roles of the app being built, on the preview's own name
 *    (`localhost`). Opened in a tab of its own, that dashboard has no Studio,
 *    no people and no settings, and looked like a broken install to the
 *    person who owns it. A bar says it is a preview, as whom, and where their
 *    own dashboard is. Inside the Designer's frame the preview's own bar says
 *    so, and this one stays out of the picture.
 *
 * 2. THE OWNER'S PASSWORD. `design` makes its owner with no password: the
 *    link it prints signs them in, on this machine. Before the project runs
 *    anywhere else they need an address and a password, and were told so only
 *    in the terminal. The banner offers the form in place; it does what
 *    `adminium owner set` does, once.
 *
 * Loaded only on a `design` server: the shell asks for this file when the
 * server says so, so no other install carries it.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, KeyRound, X } from 'lucide-react';
import { Button, FormField, Input } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { designerApi, designerKeys, designerStateQuery, PREVIEW_USER_EMAIL } from './api.js';
import { t } from '../i18n/t.js';
import { useDesignerMessages } from './designerMessages.js';
import { useAppToasts } from '../pages/toasts.js';

/** Put away for this tab: it comes back when the dashboard is opened again. */
const PUT_AWAY = 'adminium.design.owner-banner';

const framed = (): boolean => {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
};

function putAway(): boolean {
  try {
    return window.sessionStorage.getItem(PUT_AWAY) === '1';
  } catch {
    return false;
  }
}

/** The Designer's own name for this server: where the person is themselves. */
export function ownDashboardUrl(location: { protocol: string; port: string } = window.location): string {
  return `${location.protocol}//127.0.0.1${location.port === '' ? '' : `:${location.port}`}/`;
}

export function DesignBanners({ email, roles }: { email: string; roles: readonly string[] }): ReactNode {
  // The words are the Designer's own, loaded with it: this waits for them (inside the shell's Suspense).
  useDesignerMessages();
  if (email === PREVIEW_USER_EMAIL) return framed() ? null : <PreviewBar roles={roles} />;
  return <OwnerPassword />;
}

function PreviewBar({ roles }: { roles: readonly string[] }): ReactNode {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-surface-2 px-4 py-2 text-[12.5px] leading-normal text-fg-muted">
      <Eye aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        {roles.length === 0
          ? t('designer:banner.previewNoRole', 'This is a preview of the app, seen as a person with no role. It is not your own sign-in: you cannot reach Studio, people or settings here.')
          : t('designer:banner.preview', 'This is a preview of the app, seen as its staff ({roles}). It is not your own sign-in: you cannot reach Studio, people or settings here.', { roles: roles.join(', ') })}
      </span>
      <a href={ownDashboardUrl()} className="font-bold text-accent hover:underline">
        {t('designer:banner.openOwn', 'Open the dashboard as yourself')}
      </a>
    </div>
  );
}

function OwnerPassword(): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const state = useQuery({ ...designerStateQuery(), retry: false, staleTime: 60_000 });
  const [hidden, setHidden] = useState(putAway);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<{ field: 'email' | 'password' | 'again' | 'form'; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () => designerApi.setOwnerPassword({ email: email.trim(), password }),
    onSuccess: async (reply) => {
      setPassword('');
      setAgain('');
      toasts.push({ variant: 'success', title: t('designer:banner.ownerDone', 'You now sign in as {email}, with your password.', { email: reply.email }) });
      await queryClient.invalidateQueries({ queryKey: designerKeys.state });
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    onError: (error) => {
      const details = error instanceof ApiError ? (error.details as { reason?: string } | undefined) : undefined;
      const text = error instanceof ApiError || error instanceof Error ? error.message : String(error);
      setProblem({ field: details?.reason === 'EMAIL' ? 'email' : details?.reason === 'PASSWORD' ? 'password' : 'form', text });
    },
  });

  if (state.data?.ownerNeedsPassword !== true || hidden) return null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (password !== again) {
      setProblem({ field: 'again', text: t('designer:banner.ownerMismatch', 'The two passwords are not the same.') });
      return;
    }
    setProblem(null);
    save.mutate();
  };

  return (
    <div role="region" aria-label={t('designer:banner.ownerLabel', 'Your owner account')} className="border-b border-border bg-accent-soft px-4 py-2.5 text-[12.5px] leading-normal text-fg">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <KeyRound aria-hidden="true" className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          {t('designer:banner.owner', 'You are this project’s owner, signed in by the link Adminium Designer printed. Set an address and a password before the project runs anywhere else.')}
        </span>
        {open ? null : (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('designer:banner.ownerSet', 'Set your password')}
          </Button>
        )}
        <button
          type="button"
          onClick={() => {
            try {
              window.sessionStorage.setItem(PUT_AWAY, '1');
            } catch {
              // Private mode: it is put away until the page is loaded again.
            }
            setHidden(true);
          }}
          aria-label={t('designer:banner.ownerLater', 'Not now')}
          title={t('designer:banner.ownerLater', 'Not now')}
          className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      {open ? (
        <form onSubmit={submit} className="mt-3 flex max-w-[720px] flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t('designer:banner.ownerEmail', 'Your email address')} required error={problem?.field === 'email' ? problem.text : undefined}>
              <Input type="email" autoComplete="username" value={email} required maxLength={254} onChange={(event) => setEmail(event.target.value)} />
            </FormField>
            <FormField label={t('designer:banner.ownerPassword', 'A password')} required error={problem?.field === 'password' ? problem.text : undefined}>
              <Input type="password" autoComplete="new-password" value={password} required maxLength={1024} onChange={(event) => setPassword(event.target.value)} />
            </FormField>
            <FormField label={t('designer:banner.ownerAgain', 'The same password again')} required error={problem?.field === 'again' ? problem.text : undefined}>
              <Input type="password" autoComplete="new-password" value={again} required maxLength={1024} onChange={(event) => setAgain(event.target.value)} />
            </FormField>
          </div>
          {problem?.field === 'form' ? (
            <p role="alert" className="m-0 text-[12.5px] font-semibold text-danger">
              {problem.text}
            </p>
          ) : null}
          <p className="m-0 text-[12px] text-fg-muted">
            {t('designer:banner.ownerAfter', 'From then on you sign in with them, here and wherever the project runs. Adminium Designer will ask for them too: its one-time link is only for an owner with no password.')}
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {t('designer:banner.ownerSave', 'Save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('designer:banner.ownerCancel', 'Cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
