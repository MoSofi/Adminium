// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect to another Adminium": an address is typed, the app asks whether an
 * Adminium answers there, and opens it in a window of its own. An address that
 * is not encrypted is said to be so before anything is sent to it.
 */
import { useT } from '@adminium/i18n/react';
import { LoaderCircle, LockOpen, MonitorSmartphone } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';

import type { DesktopConnectResult, DesktopGuest } from '../../../preload/api.js';
import { startApi } from '../bridge.js';
import { BackLink } from '../shell/PlainShell.js';

type Say = (title: string, variant?: 'success' | 'error' | 'info') => void;

export function ConnectScreen({ onBack, say }: { onBack: () => void; say: Say }): ReactNode {
  const t = useT();
  const field = useId();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The address that is not encrypted, waiting for "Connect anyway". */
  const [plain, setPlain] = useState<string | null>(null);
  const [guests, setGuests] = useState<readonly DesktopGuest[]>([]);

  useEffect(() => {
    let live = true;
    void startApi()
      .guests()
      .then((list) => {
        if (live) setGuests(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const words = (result: Exclude<DesktopConnectResult, { status: 'opened' | 'not-encrypted' }>): string => {
    switch (result.status) {
      case 'not-an-address':
        return t('desktop:connect.notAnAddress', 'That is not an address. Type one like office-pc.local:4600.');
      case 'not-private':
        return t('desktop:connect.notPrivate', 'Adminium connects without encryption only on your own network. Use an https address.');
      case 'no-answer':
        return t('desktop:connect.noAnswer', 'Nothing answered at that address. Check that the other computer is on and sharing.');
      case 'not-adminium':
        return t('desktop:connect.notAdminium', 'Nothing that looks like Adminium answered at that address.');
    }
  };

  const connect = (to: string, anyway: boolean): void => {
    setBusy(true);
    setRefusal(null);
    void startApi()
      .connect({ address: to, ...(anyway ? { anyway: true } : {}) })
      .then((result) => {
        if (result.status === 'opened') {
          setGuests(result.guests);
          setPlain(null);
          setAddress('');
        } else if (result.status === 'not-encrypted') setPlain(result.address);
        else {
          setPlain(null);
          setRefusal(words(result));
        }
      })
      .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => setBusy(false));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (address.trim() !== '') connect(address, false);
  };

  const forget = (guest: DesktopGuest): void => {
    void startApi()
      .forgetGuest(guest.address)
      .then(setGuests)
      .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), 'error'));
  };

  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-2">
      <BackLink label={t('desktop:new.back', 'Back')} onBack={onBack} />
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{t('desktop:start.choice.connect.title', 'Connect to another Adminium')}</h1>
      <form onSubmit={submit} className="mt-7 flex flex-col gap-2">
        <label htmlFor={field} className="text-[12.5px] font-bold">
          {t('desktop:connect.address', 'Address')}
        </label>
        <div className="flex items-stretch gap-2.5">
          <input
            id={field}
            dir="ltr"
            value={address}
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="office-pc.local:4600"
            aria-invalid={refusal !== null}
            aria-describedby={refusal === null ? undefined : `${field}-refusal`}
            onChange={(event) => {
              setAddress(event.target.value);
              setRefusal(null);
              setPlain(null);
            }}
            className={`h-11 min-w-0 flex-1 rounded-[10px] border bg-surface px-3.5 font-mono text-[13px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-60 ${refusal === null ? 'border-border-strong' : 'border-danger'}`}
          />
          <button type="submit" disabled={busy || address.trim() === ''} className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-accent px-5 text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <LoaderCircle aria-hidden="true" className="size-[15px] animate-spin" /> : null}
            {busy ? t('desktop:connect.checking', 'Checking…') : t('desktop:connect.go', 'Connect')}
          </button>
        </div>
        {refusal === null ? null : (
          <p id={`${field}-refusal`} role="alert" className="m-0 text-[13px] font-semibold leading-normal text-danger">
            {refusal}
          </p>
        )}
      </form>

      {plain === null ? null : (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-[14px] border border-warn/30 bg-warn-soft px-[18px] py-4">
          <LockOpen aria-hidden="true" className="mt-px size-[18px] shrink-0 text-warn" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <span className="text-[13.5px] leading-[1.55]">{t('desktop:connect.notEncrypted', 'This address is not encrypted. Use it only on a network you trust.')}</span>
            <button type="button" disabled={busy} onClick={() => connect(plain, true)} className="cursor-pointer self-start rounded-[9px] border border-border-strong bg-surface px-[14px] py-2 text-[13px] font-bold text-fg hover:border-accent disabled:opacity-50">
              {t('desktop:connect.anyway', 'Connect anyway')}
            </button>
          </div>
        </div>
      )}

      {guests.length === 0 ? null : (
        <section className="mt-9">
          <h2 className="m-0 mb-3 text-[15px] font-extrabold tracking-[-0.015em]">{t('desktop:connect.recent', 'Recent')}</h2>
          <ul className="m-0 list-none overflow-hidden rounded-[14px] border border-border bg-surface p-0 shadow-card">
            {guests.map((guest, index) => (
              <li key={guest.address} className={`flex items-center gap-3 px-[18px] py-3 ${index === 0 ? '' : 'border-t border-border'}`}>
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-fg-muted">
                  <MonitorSmartphone className="size-[17px]" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <button type="button" dir="ltr" disabled={busy} onClick={() => connect(guest.address, true)} className="cursor-pointer self-start truncate border-0 bg-transparent p-0 text-start font-mono text-[13px] font-bold text-fg hover:text-accent">
                    {guest.address}
                  </button>
                  <span className="text-[12px] text-fg-subtle">{t('desktop:connect.version', 'Adminium {version}', { version: guest.version })}</span>
                </div>
                <button type="button" onClick={() => forget(guest)} aria-label={t('desktop:connect.forgetOf', 'Forget {address}', { address: guest.address })} className="cursor-pointer rounded-[9px] border border-transparent bg-transparent px-[11px] py-[7px] text-[12.5px] font-bold text-fg-muted hover:border-border-strong">
                  {t('desktop:connect.forget', 'Forget')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
