// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project that is shared on the network: the addresses another device opens
 * (the one to give out first, a code to scan), what sharing means while it
 * lasts, and the two ways on (the project's dashboard, or back to building).
 *
 * The app's own page: while a project is shared its Designer is off, so there
 * is no page of the project's that could draw this.
 */
import { useT } from '@adminium/i18n/react';
import { Modal, ModalFooter, ModalHeader } from '@adminium/ui';
import { Check, Coffee, Copy, Hammer, Info, LayoutDashboard, LockOpen, WifiOff } from 'lucide-react';
import encodeQR from 'qr';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { DesktopShareAddress, DesktopShareInfo } from '../../../preload/api.js';
import { desktopApi } from '../bridge.js';

type Say = (title: string, variant?: 'success' | 'error' | 'info') => void;

/** A code a phone's camera reads, drawn as squares: no picture is fetched or made. White in both themes, as a camera needs. */
function QrCode({ text, label }: { text: string; label: string }): ReactNode {
  const cells = useMemo(() => {
    try {
      return encodeQR(text, 'raw', { border: 2 });
    } catch {
      return null;
    }
  }, [text]);
  if (cells === null) return null;
  const size = cells.length;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${String(size)} ${String(size)}`} shapeRendering="crispEdges" className="size-[132px] shrink-0 rounded-[12px] border border-border bg-white">
      {cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={1} height={1} fill="#000" /> : null)))}
    </svg>
  );
}

function AddressRow({ address, first, say }: { address: DesktopShareAddress; first: boolean; say: Say }): ReactNode {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (): void => {
    void navigator.clipboard.writeText(address.url).then(
      () => setCopied(true),
      () => say(t('desktop:shared.copyFailed', 'The address could not be copied.'), 'error'),
    );
  };
  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-2.5 ${first ? '' : 'border-t border-border'}`}>
      <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-fg [unicode-bidi:isolate]">
        {address.url}
      </span>
      {address.best ? <span className="shrink-0 rounded-[20px] bg-pos-soft px-2 py-0.5 text-[11px] font-bold text-pos">{t('desktop:shared.best', 'Best')}</span> : null}
      {address.via === null ? null : <span className="shrink-0 text-[12px] text-fg-subtle">{address.via}</span>}
      <button
        type="button"
        onClick={copy}
        aria-label={t('desktop:shared.copy', 'Copy {address}', { address: address.url })}
        className="flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:border-border-strong"
      >
        {copied ? <Check aria-hidden="true" className="size-4 text-pos" /> : <Copy aria-hidden="true" className="size-4" />}
      </button>
    </div>
  );
}

export function SharedScreen({ initial, say }: { initial: DesktopShareInfo; say: Say }): ReactNode {
  const t = useT();
  const [info, setInfo] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  // The network may come and go under a shared project: the list is asked for again, quietly.
  useEffect(() => {
    const timer = setInterval(() => {
      void desktopApi()
        .project.shareInfo?.()
        .then((next) => {
          if (next != null) setInfo(next);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const best = info.addresses.find((address) => address.best) ?? info.addresses[0] ?? null;
  const toBuild = (): void => {
    setBusy(true);
    void desktopApi()
      .project.build?.()
      .catch((error: unknown) => {
        setBusy(false);
        setAsking(false);
        say(error instanceof Error ? error.message : String(error), 'error');
      });
    // On a yes main takes the window to the Designer: this page is about to be gone.
  };

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col pt-[52px]">
      {info.changedFrom === null ? null : (
        <div role="status" className="mb-5 flex items-start gap-2.5 rounded-[12px] border border-info/25 bg-info-soft px-3.5 py-3 text-[13px] leading-normal">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            {t('desktop:shared.portChanged', 'Port {was} was taken, so the address changed to {now}.', { was: info.changedFrom, now: info.port })}
          </span>
        </div>
      )}
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{t('desktop:shared.heading', '{name} is shared', { name: info.name })}</h1>

      {best === null ? (
        <div role="alert" className="mt-6 flex items-start gap-3 rounded-[14px] border border-warn/30 bg-warn-soft px-[18px] py-4">
          <WifiOff aria-hidden="true" className="mt-px size-[18px] shrink-0 text-warn" />
          <span className="text-[13.5px] leading-[1.55]">{t('desktop:shared.noNetwork', 'This computer is not on a network, so no other device can reach it yet. Join a Wi-Fi or plug in a cable: the address appears here.')}</span>
        </div>
      ) : (
        <>
          <p className="m-0 mt-6 text-[13px] font-bold text-fg-muted">{t('desktop:shared.open', 'Open this on another device')}</p>
          <div className="mt-2.5 flex items-start gap-4">
            <div className="min-w-0 flex-1 overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
              {info.addresses.map((address, index) => (
                <AddressRow key={address.url} address={address} first={index === 0} say={say} />
              ))}
            </div>
            <QrCode text={best.url} label={t('desktop:shared.qr', 'A code to scan for {address}', { address: best.url })} />
          </div>
        </>
      )}

      <ul className="m-0 mt-5 flex list-none flex-col gap-2 p-0 text-[12.5px] leading-normal text-fg-muted">
        <li className="flex items-start gap-2">
          <LockOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warn" />
          {t('desktop:shared.notEncrypted', 'Traffic on your local network is not encrypted. Share only on a network you trust.')}
        </li>
        <li className="flex items-start gap-2">
          <Coffee aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {t('desktop:shared.awake', 'Your computer stays awake while the project is shared. Closing the lid stops it.')}
        </li>
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-border pt-5">
        <button
          type="button"
          onClick={() => void desktopApi().project.openDashboard?.()}
          className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-[18px] py-2.5 text-[13.5px] font-bold text-fg hover:border-accent"
        >
          <LayoutDashboard aria-hidden="true" className="size-4" />
          {t('desktop:shared.dashboard', 'Open the dashboard')}
        </button>
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="ms-auto inline-flex cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-accent px-5 py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105"
        >
          <Hammer aria-hidden="true" className="size-4" />
          {t('desktop:shared.build', 'Go back to building')}
        </button>
      </div>
      <p className="m-0 mt-4 text-[12.5px] leading-normal text-fg-subtle">{t('desktop:shared.designerOff', 'The Designer is off while the project is shared. Go back to building to change your apps.')}</p>

      <Modal open={asking} onOpenChange={(open) => (busy ? undefined : setAsking(open))} size="sm" className="max-w-[440px] rounded-[16px]">
        <div className="px-6 pt-6">
          <span aria-hidden="true" className="flex size-[38px] items-center justify-center rounded-[11px] bg-accent-soft text-accent">
            <Hammer className="size-[18px]" />
          </span>
        </div>
        <ModalHeader
          hideClose
          closeLabel={t('desktop:shared.keep', 'Keep sharing')}
          className="px-6 pb-5 pt-3.5"
          title={<span className="text-[18px] font-extrabold tracking-[-0.02em]">{t('desktop:shared.buildAsk', 'Go back to building?')}</span>}
          subtitle={<span className="mt-2 block text-[13.5px] leading-[1.6] text-fg-muted">{t('desktop:shared.buildAskBody', 'People using it on other devices will be disconnected.')}</span>}
        />
        <ModalFooter className="flex justify-end gap-2 px-6 pb-6 pt-0">
          <button type="button" autoFocus disabled={busy} onClick={() => setAsking(false)} className="cursor-pointer rounded-[10px] border border-border-strong bg-surface px-[18px] py-2.5 text-[13.5px] font-bold text-fg hover:bg-surface-2 disabled:opacity-45">
            {t('desktop:shared.keep', 'Keep sharing')}
          </button>
          <button type="button" disabled={busy} onClick={toBuild} className="cursor-pointer rounded-[10px] border-0 bg-accent px-5 py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:opacity-45">
            {t('desktop:shared.build', 'Go back to building')}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
