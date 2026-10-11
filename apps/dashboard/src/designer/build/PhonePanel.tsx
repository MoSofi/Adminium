// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Phone side of the preview: the app's phone app, built for the web by
 * Expo and shown in a phone's frame; what stands in for it while there is
 * none to show (not added, packages missing, did not build); and "Open on a
 * phone", the code a real phone scans.
 *
 * This side is built from the build page's own parts: the preview's dotted
 * ground and device, the failed-build card, the kit's Modal.
 */
import { useId, useState, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle, QrCode, Smartphone, WandSparkles } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { PhoneDoorState, PhoneStanding } from '../api.js';
import type { PreviewModel } from './usePreview.js';

const GROUND = 'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-[14px] bg-surface-3 bg-[radial-gradient(var(--border-strong)_1px,transparent_1px)] bg-[size:16px_16px] p-[22px]';

function workingWords(step: 'adding' | 'installing' | 'building'): string {
  switch (step) {
    case 'adding':
      return t('designer:phone.adding', 'Adding the phone app…');
    case 'installing':
      return t('designer:phone.installing', 'Installing Expo’s packages (about 350 MB)…');
    case 'building':
      return t('designer:phone.building', 'Building the phone app…');
  }
}

/** What stands where the phone would be, while there is no phone app to show. */
function Standing({ phone, onAdd, onFix, error, running }: { phone: PhoneStanding; onAdd: () => void; onFix: (message: string) => void; error: string | null; running: boolean }): ReactNode {
  if (phone.state === 'working') {
    return (
      <div aria-live="polite" className="m-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] font-bold text-fg shadow-sm">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
        {workingWords(phone.step)}
      </div>
    );
  }
  const asks = phone.state === 'none' || phone.state === 'unapproved';
  const title =
    phone.state === 'none'
      ? t('designer:phone.addTitle', 'Add a phone app?')
      : phone.state === 'unapproved'
        ? t('designer:phone.approveTitle', 'This app has a phone app. Build it on this computer?')
        : phone.state === 'no-packages'
          ? t('designer:phone.packagesTitle', 'The phone app’s packages are not installed.')
          : phone.state === 'shape'
            ? t('designer:phone.shapeTitle', 'The phone app’s folder cannot be built as it is.')
            : t('designer:phone.failedTitle', 'The phone app did not build.');
  const words = phone.state === 'failed' || phone.state === 'shape' ? phone.words : null;
  return (
    <div role={asks ? undefined : 'alert'} className="m-auto flex w-full max-w-[460px] flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-md">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
          <Smartphone className="size-[17px]" />
        </span>
        <span className="text-[15px] font-extrabold tracking-tight">{title}</span>
      </div>
      {asks || phone.state === 'no-packages' ? (
        <p className="text-[13px] leading-[1.5] text-fg-muted">
          {t('designer:phone.addLine', 'It installs Expo’s packages (about 350 MB, about a minute) and builds with Expo on this computer. This needs the network.')}
        </p>
      ) : null}
      {words === null ? null : (
        <code dir="ltr" className="adm-always-dark block max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-bg px-3 py-2.5 text-start font-mono text-xs leading-normal text-danger">
          {words}
        </code>
      )}
      {error === null ? null : (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {phone.state === 'shape' ? null : (
          <Button type="button" variant="primary" size="sm" disabled={running} onClick={onAdd}>
            {phone.state === 'none'
              ? t('designer:phone.add', 'Add the phone app')
              : phone.state === 'unapproved'
                ? t('designer:phone.approve', 'Build it here')
                : phone.state === 'no-packages'
                  ? t('designer:phone.getPackages', 'Get its packages')
                  : t('designer:phone.tryAgain', 'Try again')}
          </Button>
        )}
        {phone.state === 'failed' || phone.state === 'shape' ? (
          <button
            type="button"
            disabled={running}
            onClick={() => onFix(t('designer:phone.fixMessage', 'The phone app did not build: {error} Please fix it.', { error: words ?? '' }))}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-bold text-accent hover:underline disabled:opacity-60"
          >
            <WandSparkles aria-hidden="true" className="size-3.5" />
            {t('designer:preview.fix', 'Ask the Designer to fix it')}
          </button>
        ) : null}
      </div>
      {running ? <p className="text-[12px] text-fg-subtle">{t('designer:phone.waitTurn', 'The Designer is working. This waits until it is done.')}</p> : null}
    </div>
  );
}

/** The code's picture: the server drew it; it is shown as an image, never put into the page as markup. */
function Code({ svg, label }: { svg: string; label: string }): ReactNode {
  return <img alt={label} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} className="size-[208px] rounded-[10px] border border-border bg-white" />;
}

function DoorDialog({ door, addresses, error, open, onOpenChange, onOpen, onStop }: { door: PhoneDoorState; addresses: readonly { address: string; name: string }[]; error: string | null; open: boolean; onOpenChange: (open: boolean) => void; onOpen: (address: string) => void; onStop: () => void }): ReactNode {
  const pick = useId();
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const chosen = address !== null && addresses.some((entry) => entry.address === address) ? address : (addresses[0]?.address ?? null);
  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" className="max-w-[520px] rounded-[20px] leading-[normal]">
      <ModalHeader closeLabel={t('designer:model.close', 'Close')} icon={<QrCode />} title={t('designer:phone.doorTitle', 'Open on a phone')} />
      <ModalBody className="flex flex-col gap-3.5 text-[13px] leading-[1.5]">
        {door.state === 'open' ? (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <Code svg={door.qr} label={t('designer:phone.code', 'A code to scan with the phone')} />
              <ol className="flex min-w-[200px] flex-1 list-decimal flex-col gap-1.5 ps-4 text-fg-muted">
                <li>{door.sdk === null ? t('designer:phone.stepGo', 'Install Expo Go on the phone.') : t('designer:phone.stepGoSdk', 'Install Expo Go on the phone (the one for SDK {sdk}).', { sdk: door.sdk })}</li>
                <li>{t('designer:phone.stepNetwork', 'Put the phone on the same network as this computer.')}</li>
                <li>{t('designer:phone.stepScan', 'Scan the code with the phone’s camera, or in Expo Go.')}</li>
              </ol>
            </div>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 select-all overflow-hidden text-ellipsis whitespace-nowrap rounded-[8px] bg-surface-3 px-2.5 py-1.5 font-mono text-[12px] text-fg">
                {door.url}
              </code>
              <button type="button" onClick={() => copy(door.url)} aria-label={t('designer:phone.copy', 'Copy the address')} className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
                {copied ? <Check aria-hidden="true" className="size-3.5 text-pos" /> : <Copy aria-hidden="true" className="size-3.5" />}
              </button>
              <span aria-live="polite" className="sr-only">
                {copied ? t('designer:phone.copied', 'Copied') : ''}
              </span>
            </div>
            <p aria-live="polite" className={`flex items-center gap-2 font-bold ${door.connected ? 'text-pos' : 'text-fg-muted'}`}>
              <span aria-hidden="true" className={`size-2 rounded-full ${door.connected ? 'bg-pos' : 'bg-fg-subtle'}`} />
              {door.connected ? t('designer:phone.connected', 'A phone is connected.') : t('designer:phone.waiting', 'No phone has connected yet.')}
            </p>
            {door.phoneSdk === null ? null : (
              <p role="alert" className="text-warn">
                {t('designer:phone.sdkMismatch', 'That phone’s Expo Go is for SDK {phone}, and this app is written for SDK {app}. Install the Expo Go for SDK {app}.', { phone: door.phoneSdk, app: door.sdk ?? '' })}
              </p>
            )}
            <p className="text-[12px] text-fg-subtle">
              {t(
                'designer:phone.doorNote',
                'While this is open, the phone that scans the code can open this app’s phone preview and reach what the app makes public, and nothing else on this computer. Only the first phone to scan it is let in. It closes when you stop it, and after half an hour with no phone using it. If nothing happens on the phone, check that both are on the same network and that this computer’s firewall lets it in.',
              )}
            </p>
          </>
        ) : door.state === 'starting' ? (
          <p aria-live="polite" className="inline-flex items-center gap-2 font-bold text-fg">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
            {t('designer:phone.starting', 'Starting Expo’s bundler…')}
          </p>
        ) : (
          <>
            <p className="text-fg-muted">
              {t(
                'designer:phone.doorLead',
                'This shows a code. A phone with Expo Go, on the same network as this computer, scans it and runs the real app with this computer’s data. Nothing is sent anywhere else.',
              )}
            </p>
            {door.state !== 'closed' || door.why === 'stopped' ? null : door.why === 'failed' ? (
              // Why it could not start, in the engine's own words (Expo's last lines among them).
              <p role="alert" dir="ltr" className="whitespace-pre-wrap rounded-[10px] bg-danger-soft px-3 py-2 text-start text-danger">
                {door.words}
              </p>
            ) : (
              <p role="status" className="rounded-[10px] bg-surface-3 px-3 py-2 text-fg-muted">
                {door.why === 'idle'
                  ? t('designer:phone.closedIdle', 'It closed after half an hour with no phone using it.')
                  : t('designer:phone.closedNetwork', 'This computer’s network changed, so the code led nowhere. Show a new one.')}
              </p>
            )}
            {addresses.length === 0 ? (
              <p role="alert" className="text-warn">
                {t('designer:phone.noNetwork', 'This computer is on no network a phone could reach. Connect it to Wi-Fi first.')}
              </p>
            ) : addresses.length > 1 ? (
              <label htmlFor={pick} className="flex flex-col gap-1.5">
                <span className="font-bold text-fg">{t('designer:phone.address', 'This computer’s address on the phone’s network')}</span>
                <select id={pick} value={chosen ?? ''} onChange={(event) => setAddress(event.target.value)} className="h-9 rounded-[9px] border border-border bg-surface px-2.5 text-[13px] text-fg">
                  {addresses.map((entry) => (
                    <option key={entry.address} value={entry.address}>
                      {entry.address} ({entry.name})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        )}
        {error === null ? null : (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        {door.state === 'open' || door.state === 'starting' ? (
          <Button type="button" variant="secondary" onClick={onStop}>
            {t('designer:phone.stop', 'Stop')}
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled={chosen === null} onClick={() => (chosen === null ? undefined : onOpen(chosen))}>
            {t('designer:phone.show', 'Show the code')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

/**
 * The Phone side's body. `frame` is the preview's own frame element (made by
 * the preview, so a reload and a ticket work as for any side); `over` is what
 * the preview draws over a frame (still opening, building, an error).
 */
export function PhonePanel({ preview, frame, over, onFix, compact }: { preview: PreviewModel; frame: ReactNode; over: ReactNode; onFix: (message: string) => void; compact: boolean }): ReactNode {
  const [dialog, setDialog] = useState(false);
  const status = preview.phone;
  if (status === null) return null;
  const built = status.phone.state === 'built';
  return (
    <div className={`${GROUND} ${compact ? 'm-2.5' : 'm-3'}`}>
      {built ? (
        <>
          <div className="adm-always-dark relative flex max-h-[844px] min-h-0 w-[390px] max-w-full flex-1 rounded-[30px] bg-bg p-2 shadow-lg">
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[22px] bg-surface">
              {frame}
              {over}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={() => setDialog(true)}>
              <QrCode aria-hidden="true" className="size-3.5" />
              {t('designer:phone.open', 'Open on a phone')}
              {status.door.state === 'open' ? <span aria-hidden="true" className={`ms-1 size-2 rounded-full ${status.door.connected ? 'bg-pos' : 'bg-warn'}`} /> : null}
            </Button>
            <span className="text-[12px] text-fg-subtle">{t('designer:phone.webNote', 'Drawn by the browser: close to the phone, not the phone. The Designer does not look at this side.')}</span>
          </div>
        </>
      ) : (
        <Standing phone={status.phone} onAdd={preview.addPhone} onFix={onFix} error={preview.phoneError} running={preview.running} />
      )}
      {dialog ? (
        <DoorDialog
          door={status.door}
          addresses={status.addresses}
          error={preview.phoneError}
          open
          onOpenChange={setDialog}
          onOpen={preview.openPhoneDoor}
          onStop={preview.stopPhoneDoor}
        />
      ) : null}
    </div>
  );
}
