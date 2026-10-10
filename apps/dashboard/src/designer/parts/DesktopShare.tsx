// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Share", from the Designer inside the desktop app: the steps before a
 * project is put on the network. First how the owner signs in from other
 * devices (only when they have no password yet: on this computer they never
 * needed one), then what sharing means, then the switch. The switch is the
 * app's: the Designer goes off, and the window shows the addresses.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, LockOpen, RadioTower, ShieldCheck, Wifi } from 'lucide-react';
import { Button, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';
import { designerApi, designerKeys, designerStateQuery } from '../api.js';

export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactNode {
  const queryClient = useQueryClient();
  const state = useQuery({ ...designerStateQuery(), enabled: open, retry: false });
  /** The app said so too: a password is asked for even if this page thought there was one. */
  const [mustSet, setMustSet] = useState(false);
  const needsPassword = mustSet || state.data?.ownerNeedsPassword === true;
  const [passwordDone, setPasswordDone] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<{ field: 'email' | 'password' | 'again' | 'form'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onPassword = needsPassword && !passwordDone;
  // Two steps once a password was asked for in this dialog, also after it was set (the count does not shrink under the person).
  const steps = needsPassword || passwordDone ? 2 : 1;
  const step = onPassword ? 1 : steps;

  const savePassword = (event: FormEvent): void => {
    event.preventDefault();
    if (password !== again) {
      setProblem({ field: 'again', text: t('designer:banner.ownerMismatch', 'The two passwords are not the same.') });
      return;
    }
    setProblem(null);
    setBusy(true);
    designerApi
      .setOwnerPassword({ email: email.trim(), password })
      .then(async () => {
        setPassword('');
        setAgain('');
        setPasswordDone(true);
        await queryClient.invalidateQueries({ queryKey: designerKeys.state });
      })
      .catch((error: unknown) => {
        const details = error instanceof ApiError ? (error.details as { reason?: string } | undefined) : undefined;
        setProblem({ field: details?.reason === 'EMAIL' ? 'email' : details?.reason === 'PASSWORD' ? 'password' : 'form', text: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => setBusy(false));
  };

  const share = (): void => {
    const project = getDesktopApi()?.project;
    if (project?.share === undefined) return;
    setProblem(null);
    setBusy(true);
    project
      .share()
      .then((result) => {
        // 'shared': the app is already taking the window to the addresses; this page is about to be gone.
        if (result.status === 'shared') return;
        setBusy(false);
        if (result.status === 'needs-password') {
          setMustSet(true);
          setPasswordDone(false);
        } else if (result.status === 'kept-working') onOpenChange(false);
        else setProblem({ field: 'form', text: result.detail });
      })
      .catch((error: unknown) => {
        setBusy(false);
        setProblem({ field: 'form', text: error instanceof Error ? error.message : String(error) });
      });
  };

  return (
    <Modal open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))} size="lg" className="max-w-[560px] rounded-[20px] leading-[normal]">
      <ModalHeader
        closeLabel={t('designer:model.close', 'Close')}
        icon={<RadioTower />}
        title={onPassword ? t('designer:share.passwordTitle', 'Choose how you sign in from other devices') : t('designer:share.beforeTitle', 'Before you share')}
        subtitle={<span className="font-mono text-[11.5px] text-fg-subtle">{t('designer:share.step', 'Share · {step} of {steps}', { step, steps })}</span>}
      />
      {onPassword ? (
        <form onSubmit={savePassword}>
          <ModalBody className="flex flex-col gap-3.5">
            <FormField label={t('designer:share.email', 'Your email')} required error={problem?.field === 'email' ? problem.text : undefined}>
              <Input type="email" autoComplete="username" value={email} required maxLength={254} onChange={(event) => setEmail(event.target.value)} />
            </FormField>
            <FormField label={t('designer:share.password', 'Password')} required error={problem?.field === 'password' ? problem.text : undefined}>
              <Input type="password" autoComplete="new-password" value={password} required maxLength={1024} onChange={(event) => setPassword(event.target.value)} />
            </FormField>
            <FormField label={t('designer:share.again', 'The same password again')} required error={problem?.field === 'again' ? problem.text : undefined}>
              <Input type="password" autoComplete="new-password" value={again} required maxLength={1024} onChange={(event) => setAgain(event.target.value)} />
            </FormField>
            {problem?.field === 'form' ? (
              <p role="alert" className="m-0 text-[12.5px] font-semibold text-danger">
                {problem.text}
              </p>
            ) : null}
            <p className="m-0 text-pretty text-[12.5px] leading-normal text-fg-muted">{t('designer:share.passwordNote', 'On this computer you never need them. You will type them on a phone or another computer.')}</p>
          </ModalBody>
          <ModalFooter>
            <Button type="submit" variant="primary" disabled={busy}>
              {t('designer:share.next', 'Next')}
            </Button>
          </ModalFooter>
        </form>
      ) : (
        <>
          <ModalBody className="flex flex-col gap-3">
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[13.5px] leading-normal text-fg">
              <li className="flex items-start gap-2.5">
                <Wifi aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                {t('designer:share.reach', 'People on this network can reach this project while it is shared. Each of them signs in.')}
              </li>
              <li className="flex items-start gap-2.5">
                <HardDrive aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                {t('designer:share.dataStays', 'Your project’s data stays on this computer.')}
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                {t('designer:share.firewall', 'Your computer may ask whether Adminium may accept connections. Choose Allow.')}
              </li>
            </ul>
            <p className="m-0 flex items-start gap-2 rounded-[12px] border border-warn/30 bg-warn-soft px-3.5 py-3 text-[12.5px] leading-normal text-fg">
              <LockOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warn" />
              {t('designer:share.notEncrypted', 'Traffic on your local network is not encrypted. Share only on a network you trust. An app you opened to the public can be used there without a sign-in.')}
            </p>
            <p className="m-0 text-[12.5px] leading-normal text-fg-muted">{t('designer:share.designerOff', 'The Designer is off while the project is shared. You come back to it with “Go back to building”.')}</p>
            {problem?.field === 'form' ? (
              <p role="alert" className="m-0 text-[12.5px] font-semibold text-danger">
                {problem.text}
              </p>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" className="me-auto" disabled={busy} onClick={() => onOpenChange(false)}>
              {t('designer:share.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" disabled={busy || state.isPending} onClick={share}>
              <RadioTower aria-hidden="true" className="size-4" />
              {busy ? t('designer:share.sharing', 'Sharing…') : t('designer:share.now', 'Share now')}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
