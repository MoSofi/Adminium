// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "From Figma…": the person's own Figma connection and a frame's link, in one dialog.
 *
 * There is no models panel: the connection lives here. Not connected, the dialog asks for a personal
 * access token and says where Figma makes one; connected, it says whose it is, with "Change token"
 * and "Disconnect" (which asks first), and takes a link. Set by the project's environment, it says so
 * and offers neither. Every read Figma counts is said where the person sees it: the link step's
 * standing line, and a toast when an import came from the copy this server kept.
 *
 * Nothing of the token comes back from the server; the import's bytes stay there too. The two files
 * of an import wait in the composer like dropped ones, and go up with the message.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Eye, EyeOff, Frame, Info, LoaderCircle, Lock, Server, Unplug, WifiOff } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { designerApi, designerKeys, figmaQuery, type FigmaImport, type FigmaRefusal } from '../api.js';
import { AttachMenu, type AttachState } from './attach.js';
import { DisconnectFigma } from './DisconnectFigma.js';
import { VALUE_MARK, withValue } from './sentence.js';

/** A refusal's words, for the link step (or the token step). */
export function figmaRefusalWords(refusal: FigmaRefusal, locale?: string): string {
  switch (refusal.kind) {
    case 'network-off':
      return t('designer:figma.off', 'Figma is off on this server: network features are turned off.');
    case 'token':
      return t('designer:figma.dead', 'Your Figma token no longer works. Paste a new one.');
    case 'no-access':
      return t('designer:figma.err.noAccess', 'Your Figma account cannot open this file. Ask its owner to share it with you.');
    case 'no-frame':
      return t('designer:figma.err.gone', 'That frame is not in the file any more.');
    case 'render-failed':
      return t('designer:figma.err.render', 'Figma could not draw this frame. Try again, or pick another frame.');
    case 'too-large':
      return t('designer:figma.err.big', 'Pick a smaller frame: this one renders over 5 MB.');
    case 'document-too-large':
      return t('designer:figma.err.tooMuch', 'This frame holds more than can be read at once. Pick a smaller frame.');
    case 'not-connected':
      return t('designer:figma.notConnected', 'Not connected to Figma.');
    case 'limit':
      return limitWords(refusal, locale);
    case 'paused':
    case 'unreachable':
      return t('designer:figma.err.unreachable', 'Figma did not answer. Try again in a moment.');
  }
}

/** Figma's limit, in words: the date it gave for a seat's monthly reads, next month without one, or minutes to wait. */
export function limitWords(refusal: Extract<FigmaRefusal, { kind: 'limit' }>, locale?: string, now = Date.now()): string {
  if (refusal.type === 'high') return t('designer:figma.limitWait', 'Figma asked us to wait. Try again in {minutes, plural, one {# minute} other {# minutes}}.', { minutes: Math.max(1, Math.ceil((refusal.retryAfterSeconds ?? 60) / 60)) });
  if (refusal.retryAfterSeconds === null) return t('designer:figma.limitMonth', "Figma's limit for your seat is used up for now. You can read again next month.");
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(now + refusal.retryAfterSeconds * 1000));
  return t('designer:figma.limitDate', "Figma's limit for your seat is used up for now. You can read again on {date}.", { date });
}

const LINK_WORDS: Record<string, () => string> = {
  'not-figma': () => t('designer:figma.err.notFigma', 'That is not a Figma link.'),
  'no-frame': () => t('designer:figma.err.noFrame', 'Pick a frame in Figma and copy its link.'),
  figjam: () => t('designer:figma.err.figjam', 'That is a FigJam board. Paste a link to a design frame.'),
  slides: () => t('designer:figma.err.slides', 'That is a Slides deck. Paste a link to a design frame.'),
  prototype: () => t('designer:figma.err.proto', 'That is a prototype link. Paste a link to a design frame.'),
};

/** What a failed call says: a Figma refusal, a link refused, or an error of its own. */
function failureOf(error: unknown): { refusal: FigmaRefusal } | { link: string } | { words: string } {
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as { reason?: unknown; figma?: unknown; link?: unknown };
    if (details.reason === 'FIGMA' && typeof details.figma === 'object' && details.figma !== null) return { refusal: details.figma as FigmaRefusal };
    if (details.reason === 'FIGMA_LINK' && typeof details.link === 'string' && LINK_WORDS[details.link] !== undefined) return { link: details.link };
    return { words: error.message };
  }
  return { words: t('designer:figma.err.unreachable', 'Figma did not answer. Try again in a moment.') };
}

/** The dialog's buttons: 42 px high and at least 96 wide, equal halves on a phone. */
const BUTTON = 'h-[42px] min-w-[96px] font-bold max-sm:h-[38px] max-sm:min-w-0 max-sm:flex-1';
const field = 'h-[42px] w-full rounded-[10px] border bg-surface-2 px-3 font-mono text-[13px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-sm:h-[38px]';

export interface FromFigmaProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An import is ready: its two files join the message. */
  onImported: (done: FigmaImport) => void;
  /** Where focus goes back once the dialog closes without an import (the Attach button). */
  returnFocus?: () => void;
}

export function FromFigmaDialog({ open, onOpenChange, onImported, returnFocus }: FromFigmaProps): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const status = useQuery({ ...figmaQuery(), enabled: open });
  const [changing, setChanging] = useState(false);
  const [dead, setDead] = useState(false);
  const [token, setToken] = useState('');
  const [shown, setShown] = useState(false);
  const [tokenRefused, setTokenRefused] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const importing = useRef(0);
  const ids = useId();
  const tokenRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A dialog opened afresh starts from what the server says.
  useEffect(() => {
    if (!open) return;
    setChanging(false);
    setDead(false);
    setToken('');
    setShown(false);
    setTokenRefused(null);
    setLink('');
    setLinkError(null);
    setLimit(null);
  }, [open]);

  const data = status.data;
  const off = data?.network === false;
  const environment = data?.source === 'environment';
  const connected = data?.connected === true && data.source === 'mine';
  const tokenStep = !off && data !== undefined && (dead || changing || !data.connected);
  const linkStep = !off && data !== undefined && !tokenStep;

  const connect = useMutation({
    mutationFn: (value: string) => designerApi.saveFigmaToken(value),
    onSuccess: (next) => {
      queryClient.setQueryData(designerKeys.figma, next);
      setChanging(false);
      setDead(false);
      setToken('');
      requestAnimationFrame(() => linkRef.current?.focus());
    },
    onError: (error) => {
      const failed = failureOf(error);
      setTokenRefused(
        'refusal' in failed
          ? failed.refusal.kind === 'token'
            ? t('designer:figma.tokenRefused', 'Figma did not accept this token. Check it and paste it again.')
            : figmaRefusalWords(failed.refusal)
          : 'words' in failed
            ? failed.words
            : t('designer:figma.tokenRefused', 'Figma did not accept this token. Check it and paste it again.'),
      );
      tokenRef.current?.focus();
    },
  });

  const disconnect = useMutation({
    mutationFn: () => designerApi.removeFigma(),
    onSuccess: (next) => {
      queryClient.setQueryData(designerKeys.figma, next);
      setAsking(false);
      setChanging(false);
      toasts.push({ variant: 'info', title: t('designer:figma.disconnected', 'Disconnected from Figma. The token was removed from this server.') });
      requestAnimationFrame(() => tokenRef.current?.focus());
    },
  });

  const doImport = useMutation({
    mutationFn: async (value: string) => {
      importing.current += 1;
      const mine = importing.current;
      const done = await designerApi.importFigma(value);
      return { done, mine };
    },
    onSuccess: ({ done, mine }) => {
      // Cancelled while it read: the import is kept on the server, and nothing joins the message.
      if (mine !== importing.current) return;
      onImported(done);
      if (done.reads === 0) toasts.push({ variant: 'info', title: t('designer:figma.saved', 'Already imported this version of the frame. No Figma read was used.') });
      onOpenChange(false);
    },
    onError: (error) => {
      const failed = failureOf(error);
      if ('link' in failed) setLinkError((LINK_WORDS[failed.link] as () => string)());
      else if ('words' in failed) setLinkError(failed.words);
      else if (failed.refusal.kind === 'token' || failed.refusal.kind === 'not-connected') {
        // A dead token is not a dead end: the token field is there again, in place. A token taken off
        // elsewhere (the Security page) is no dead one: the dialog is simply not connected now.
        setDead(failed.refusal.kind === 'token');
        setToken('');
        void queryClient.invalidateQueries({ queryKey: designerKeys.figma });
        requestAnimationFrame(() => tokenRef.current?.focus());
      } else if (failed.refusal.kind === 'limit') setLimit(limitWords(failed.refusal));
      else if (failed.refusal.kind === 'network-off') void queryClient.invalidateQueries({ queryKey: designerKeys.figma });
      else setLinkError(figmaRefusalWords(failed.refusal));
    },
  });
  const busy = doImport.isPending && importing.current > 0;

  const close = (): void => {
    importing.current += 1;
    onOpenChange(false);
    requestAnimationFrame(() => returnFocus?.());
  };
  const startImport = (): void => {
    if (link.trim() === '' || doImport.isPending || limit !== null) return;
    setLinkError(null);
    doImport.mutate(link.trim());
  };
  const startConnect = (): void => {
    if (token.trim() === '' || connect.isPending) return;
    setTokenRefused(null);
    connect.mutate(token.trim());
  };

  // The header line: whose token, or that there is none (hidden while a dead token's box says it).
  const header: { icon: ReactNode; tone: string; words: ReactNode } | null = off || data === undefined
    ? null
    : environment
      ? { icon: <Server />, tone: 'text-fg-muted', words: t('designer:figma.environment', "Using the Figma token set in this project's environment.") }
      : connected
        ? {
            icon: <CircleCheck />,
            tone: 'text-pos',
            words: (
              withValue(
                t('designer:figma.connectedAs', 'Connected to Figma as {handle}', { handle: VALUE_MARK }),
                <span dir="ltr" className="font-mono font-semibold">
                  {data.handle}
                </span>,
              )
            ),
          }
        : dead
          ? null
          : { icon: <Unplug />, tone: 'text-fg-muted', words: t('designer:figma.notConnected', 'Not connected to Figma.') };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        className="max-w-[520px] max-sm:inset-0 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none"
      >
        <ModalHeader icon={<Frame />} title={t('designer:figma.title', 'From Figma')} closeLabel={t('designer:figma.close', 'Close')} className="items-center border-b border-border pb-5 max-sm:pb-3.5" />
        {header === null ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border bg-surface-2 px-5 py-[13px] max-sm:px-4" data-part="figma-header">
            <span aria-hidden="true" className={`flex shrink-0 [&_svg]:size-[15px] ${header.tone}`}>
              {header.icon}
            </span>
            <span className="min-w-0 flex-[1_1_180px] text-[12.5px] font-semibold leading-normal text-fg">{header.words}</span>
            {connected ? (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setChanging(true);
                    setToken('');
                    setTokenRefused(null);
                    requestAnimationFrame(() => tokenRef.current?.focus());
                  }}
                  className="h-[30px] whitespace-nowrap rounded-[10px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {t('designer:figma.changeToken', 'Change token')}
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(true)}
                  className="h-[30px] whitespace-nowrap rounded-[10px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {t('designer:figma.disconnect', 'Disconnect')}
                </button>
              </span>
            ) : null}
          </div>
        )}
        <ModalBody className="flex flex-col gap-4 pt-5 max-sm:gap-3 max-sm:px-4 max-sm:pt-4">
          {data === undefined ? (
            <div role="status" className="flex items-center gap-2 text-[12.5px] font-semibold text-fg-muted">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
              {t('designer:figma.loading', 'Asking the server…')}
            </div>
          ) : null}
          {off ? (
            <div className="flex items-start gap-[9px] text-[13px] leading-normal">
              <WifiOff aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-fg-muted" />
              <span>{t('designer:figma.off', 'Figma is off on this server: network features are turned off.')}</span>
            </div>
          ) : null}
          {tokenStep ? (
            <>
              {dead ? (
                <div role="alert" className="flex items-start gap-[9px] rounded-[10px] bg-danger-soft px-[13px] py-[11px] text-[13px] font-bold leading-normal text-danger">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                  <span>{t('designer:figma.dead', 'Your Figma token no longer works. Paste a new one.')}</span>
                </div>
              ) : null}
              <p className="m-0 text-pretty text-[13px] leading-normal text-fg-muted">
                {t('designer:figma.instructions', 'In Figma, open Settings, then Security, then Personal access tokens. Make a token that can read your user details, file content and file metadata. Figma shows it once: copy it, then paste it here.')}
              </p>
              <div className="flex flex-col gap-[7px]">
                <label htmlFor={`${ids}-token`} className="text-[12.5px] font-bold">
                  {t('designer:figma.tokenLabel', 'Figma token')}
                </label>
                <div className="relative">
                  <input
                    ref={tokenRef}
                    id={`${ids}-token`}
                    autoFocus
                    type={shown ? 'text' : 'password'}
                    value={token}
                    readOnly={connect.isPending}
                    spellCheck={false}
                    autoComplete="off"
                    dir="ltr"
                    aria-invalid={tokenRefused !== null}
                    aria-describedby={`${tokenRefused === null ? '' : `${ids}-token-error `}${ids}-lock`}
                    onChange={(event) => {
                      setToken(event.target.value);
                      setTokenRefused(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        startConnect();
                      }
                    }}
                    className={`${field} pe-[46px] ${shown ? '' : 'tracking-[.08em]'} ${tokenRefused === null ? 'border-border-strong' : 'border-danger bg-danger-soft'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShown((value) => !value)}
                    aria-label={shown ? t('designer:figma.hideToken', 'Hide the token') : t('designer:figma.showToken', 'Show the token')}
                    aria-pressed={shown}
                    aria-controls={`${ids}-token`}
                    className="absolute inset-y-[5px] end-[5px] flex w-[34px] items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {shown ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                  </button>
                </div>
                {tokenRefused === null ? null : (
                  <div id={`${ids}-token-error`} role="alert" className="flex items-start gap-1.5 text-[12.5px] font-semibold leading-normal text-danger">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span>{tokenRefused}</span>
                  </div>
                )}
                <div id={`${ids}-lock`} className="flex items-start gap-[7px] text-[12.5px] leading-normal text-fg-muted">
                  <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t('designer:figma.kept', 'Kept encrypted on this server for you only. Only your own imports use it.')}</span>
                </div>
              </div>
            </>
          ) : null}
          {linkStep ? (
            <>
              {limit === null ? null : (
                <div role="status" className="flex items-start gap-[9px] rounded-[10px] bg-info-soft px-[13px] py-[11px] text-[13px] leading-normal text-fg">
                  <Info aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-info" />
                  <span>{limit}</span>
                </div>
              )}
              <div className="flex flex-col gap-[7px]">
                <label htmlFor={`${ids}-link`} className="text-[12.5px] font-bold">
                  {t('designer:figma.linkLabel', 'Link to a Figma frame')}
                </label>
                <input
                  ref={linkRef}
                  id={`${ids}-link`}
                  autoFocus
                  type="url"
                  dir="ltr"
                  value={link}
                  placeholder="https://www.figma.com/design/…?node-id=…"
                  readOnly={busy}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={linkError !== null}
                  aria-describedby={`${linkError === null ? '' : `${ids}-link-error `}${ids}-stand`}
                  onChange={(event) => {
                    setLink(event.target.value);
                    setLinkError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      startImport();
                    }
                  }}
                  className={`${field} text-start ${linkError === null ? 'border-border-strong' : 'border-danger bg-danger-soft'}`}
                />
                {linkError === null ? null : (
                  <div id={`${ids}-link-error`} role="alert" className="flex items-start gap-1.5 text-[12.5px] font-semibold leading-normal text-danger">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span>{linkError}</span>
                  </div>
                )}
                {busy ? (
                  <div role="status" className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
                    {t('designer:figma.reading', 'Reading the frame from Figma…')}
                  </div>
                ) : null}
              </div>
              <p id={`${ids}-stand`} className="m-0 text-pretty text-[12.5px] leading-normal text-fg-muted">
                {t('designer:figma.standing', 'Each import reads Figma twice. On a View or Collab seat Figma allows {reads} reads a month, so about ten imports. Importing a frame again is free until the file changes.', { reads: 20 })}
              </p>
              {data?.lasting === false ? (
                <p className="m-0 text-pretty text-[12.5px] leading-normal text-fg-muted">
                  {t('designer:figma.noDisk', 'This server forgets saved copies when it is deployed again, so an import after a deploy reads Figma again.')}
                </p>
              ) : null}
            </>
          ) : null}
        </ModalBody>
        <ModalFooter className="gap-2.5 max-sm:px-4 max-sm:pb-6">
          {off ? (
            <Button ref={closeRef} variant="secondary" onClick={close} autoFocus className={BUTTON}>
              {t('designer:figma.close', 'Close')}
            </Button>
          ) : null}
          {tokenStep ? (
            <>
              <Button variant="secondary" onClick={close} className={BUTTON}>
                {t('designer:figma.cancel', 'Cancel')}
              </Button>
              <Button onClick={startConnect} disabled={token.trim() === '' && !connect.isPending} loading={connect.isPending} className={BUTTON}>
                {connect.isPending ? t('designer:figma.checking', 'Checking…') : t('designer:figma.connect', 'Connect')}
              </Button>
            </>
          ) : null}
          {linkStep ? (
            <>
              <Button
                variant="secondary"
                className={BUTTON}
                onClick={() => {
                  // Cancel while it reads stops waiting for it; otherwise it closes.
                  if (busy) {
                    importing.current += 1;
                    doImport.reset();
                  } else close();
                }}
              >
                {t('designer:figma.cancel', 'Cancel')}
              </Button>
              <Button onClick={startImport} disabled={(link.trim() === '' || limit !== null) && !busy} loading={busy} className={BUTTON}>
                {t('designer:figma.import', 'Import')}
              </Button>
            </>
          ) : null}
        </ModalFooter>
      </Modal>
      {/* Disconnect asks first, here as on the Security page. */}
      <DisconnectFigma
        open={asking}
        onOpenChange={setAsking}
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        words={{
          title: t('designer:figma.disconnectTitle', 'Disconnect Figma?'),
          body: t('designer:figma.disconnectBody', 'Your imports already in the Designer stay.'),
          cancel: t('designer:figma.cancel', 'Cancel'),
          disconnect: t('designer:figma.disconnect', 'Disconnect'),
          close: t('designer:figma.close', 'Close'),
        }}
      />
    </>
  );
}

/**
 * The composer's Attach menu with its "From Figma…" dialog: an import's two files join the message,
 * and the message box has the focus back. With no import, focus goes back to the Attach button.
 */
export function AttachControl({ state, disabled = false, place, focusBox }: { state: AttachState; disabled?: boolean; place: 'home' | 'chat'; focusBox: () => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const figma = useQuery(figmaQuery());
  const wrap = useRef<HTMLSpanElement>(null);
  return (
    <span ref={wrap} className="contents">
      <AttachMenu state={state} disabled={disabled} figma={figma.data} place={place} onFigma={() => setOpen(true)} />
      <FromFigmaDialog
        open={open}
        onOpenChange={setOpen}
        onImported={(done) => {
          state.addFigma(done);
          requestAnimationFrame(focusBox);
        }}
        returnFocus={() => wrap.current?.querySelector<HTMLButtonElement>('[data-part="attach-menu"]')?.focus()}
      />
    </span>
  );
}
