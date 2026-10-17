// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signature pad, mounted on an app's own screen (a crew's phone signing
 * a job off).
 *
 * A person signs with a finger, a pen or the mouse on a pad drawn as paper
 * (dark ink on white, in a dark theme too: it is what is printed). Somebody
 * who cannot draw (a keyboard alone, a screen reader) types the name instead,
 * and the name is written on the pad. "Keep this signature" sends the pad as
 * a PNG for the app's column (`KitFileTarget`) and tells the app the file's
 * id, which the app names in the record it saves. Kept, the pad shows the
 * signature as it was sent, with "Sign again".
 *
 * The part throws away on the server a signature it sent that the app has
 * not made its `value` when it is signed again: nothing else would ever name
 * it. One the app gave as `value` is the record's, and is left alone.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import type { KitMounted, SignatureProps } from '../contract.js';
import { contentHref, fileClient, FileRefused } from '../file-client.js';
import { mountReact } from '../root.js';
import { refusalWords } from './file-words.js';

import './files.css';

/** The pad's drawing size, in CSS pixels: wide and low, as a signature is. */
const PAD_WIDTH = 600;
const PAD_HEIGHT = 200;
/** The PNG is drawn at twice that, for a crisp print. */
const SCALE = 2;
const INK = '#111827';

type Mode = 'draw' | 'type';
type Stage = { kind: 'empty' } | { kind: 'drawn' } | { kind: 'saving' } | { kind: 'kept'; fileId: string; href: string };

function Signature({ props }: { props: SignatureProps }): ReactNode {
  const t = useMaybeT();
  const labelId = useId();
  const hintId = useId();
  const typedId = useId();
  const latest = useRef(props);
  latest.current = props;
  const client = useRef(fileClient(() => latest.current)).current;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // Where the keyboard goes once a signature is kept, and once it is cleared: the button that undoes what was done.
  const againButton = useRef<HTMLButtonElement | null>(null);
  const modeButton = useRef<HTMLButtonElement | null>(null);
  // Moved there once the stage it asks for is drawn: before that the button is not in the page.
  const focusNext = useRef<'again' | 'mode' | null>(null);
  const focusSoon = (button: { current: HTMLButtonElement | null }): void => {
    focusNext.current = button === againButton ? 'again' : 'mode';
  };
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  // A file this mount sent and the app has not made its own: thrown away when it is signed again.
  const sent = useRef<string | null>(null);
  const [stage, setStage] = useState<Stage>(() => (props.value ? { kind: 'kept', fileId: props.value, href: contentHref(props.value) } : { kind: 'empty' }));

  // A value from the app is what the column holds: shown kept. Null or cleared, the pad is empty again.
  useEffect(() => {
    const value = props.value ?? null;
    if (value !== null && value === sent.current) sent.current = null;
    setStage((now) => {
      if (value === null) return now.kind === 'kept' && now.fileId !== sent.current ? { kind: 'empty' } : now;
      return now.kind === 'kept' && now.fileId === value ? now : { kind: 'kept', fileId: value, href: contentHref(value) };
    });
  }, [props.value]);

  const pad = (): CanvasRenderingContext2D | null => {
    const context = canvas.current?.getContext('2d') ?? null;
    if (context === null) return null;
    context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2.4;
    context.strokeStyle = INK;
    context.fillStyle = INK;
    return context;
  };
  const wipe = (): void => {
    const element = canvas.current;
    if (element === null) return;
    element.getContext('2d')?.clearRect(0, 0, element.width, element.height);
  };
  const point = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / Math.max(box.width, 1)) * PAD_WIDTH, y: ((event.clientY - box.top) / Math.max(box.height, 1)) * PAD_HEIGHT };
  };
  const ready = props.disabled !== true && stage.kind !== 'saving' && stage.kind !== 'kept';

  useEffect(() => {
    const next = focusNext.current;
    if (next === 'again' && stage.kind === 'kept') againButton.current?.focus();
    else if (next === 'mode' && stage.kind !== 'kept') modeButton.current?.focus();
    else return;
    focusNext.current = null;
  }, [stage]);

  const onDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!ready || mode !== 'draw') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const at = point(event);
    drawing.current = at;
    const context = pad();
    context?.beginPath();
    context?.arc(at.x, at.y, 1.2, 0, Math.PI * 2);
    context?.fill();
    setFailed(null);
    setStage({ kind: 'drawn' });
  };
  const onMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const from = drawing.current;
    if (from === null) return;
    const to = point(event);
    const context = pad();
    context?.beginPath();
    context?.moveTo(from.x, from.y);
    context?.lineTo(to.x, to.y);
    context?.stroke();
    drawing.current = to;
  };
  const onUp = (): void => {
    drawing.current = null;
  };

  /** The typed name, written on the pad as a signature is. */
  const writeTyped = (name: string): void => {
    wipe();
    const context = pad();
    if (context === null || name.trim() === '') return;
    let size = 56;
    context.font = `italic ${String(size)}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
    while (size > 18 && context.measureText(name).width > PAD_WIDTH - 48) {
      size -= 4;
      context.font = `italic ${String(size)}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
    }
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.direction = latest.current.dir;
    context.fillText(name.trim(), PAD_WIDTH / 2, PAD_HEIGHT - 62);
  };

  const clear = (): void => {
    wipe();
    setTyped('');
    setFailed(null);
    setStage({ kind: 'empty' });
  };

  const switchTo = (next: Mode): void => {
    clear();
    setMode(next);
  };

  const keep = async (): Promise<void> => {
    if (!ready) return;
    const empty = mode === 'draw' ? stage.kind !== 'drawn' : typed.trim() === '';
    if (empty) {
      setFailed(t('ui:widgets.files.signature.empty', 'Sign first, then keep the signature.'));
      return;
    }
    if (mode === 'type') writeTyped(typed);
    const element = canvas.current;
    const blob = element === null || typeof element.toBlob !== 'function' ? null : await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'));
    if (blob === null) {
      setFailed(t('ui:widgets.files.notSent', 'It could not be sent. Try again.'));
      return;
    }
    setStage({ kind: 'saving' });
    setSaid(t('ui:widgets.files.signature.saving', 'Sending the signature…'));
    try {
      const fileId = await client.upload(blob, 'signature.png');
      sent.current = fileId;
      setStage({ kind: 'kept', fileId, href: URL.createObjectURL(blob) });
      setSaid(t('ui:widgets.files.signature.kept', 'Signature kept.'));
      latest.current.onChange(fileId);
      focusSoon(againButton);
    } catch (error) {
      setStage({ kind: 'drawn' });
      const reason = error instanceof FileRefused ? error.reason : 'notSent';
      const words = refusalWords(t, reason);
      setFailed(words);
      setSaid(words);
    }
  };

  const again = (): void => {
    if (props.disabled === true) return;
    // A signature this mount sent and the app never made its own: nothing else will name it.
    if (sent.current !== null) void client.discard(sent.current);
    sent.current = null;
    if (stage.kind === 'kept' && stage.href.startsWith('blob:')) URL.revokeObjectURL(stage.href);
    clear();
    setSaid(t('ui:widgets.files.signature.cleared', 'Signature cleared. Sign again.'));
    latest.current.onChange(null);
    focusSoon(modeButton);
  };

  const name = props.label !== undefined ? { 'aria-labelledby': labelId } : { 'aria-label': props.ariaLabel ?? t('ui:widgets.files.signature.name', 'Signature') };

  return (
    <div className="adm-kit-field adm-kit-signature" role="group" {...name} data-part="kit-signature" data-stage={stage.kind}>
      {props.label === undefined ? null : (
        <span className="adm-kit-label" id={labelId}>
          {props.label}
        </span>
      )}
      <div className={`adm-kit-pad${props.invalid === true ? ' adm-kit-pad-invalid' : ''}`} aria-invalid={props.invalid === true ? true : undefined}>
        {stage.kind === 'kept' ? (
          <img className="adm-kit-pad-kept" src={stage.href} alt={t('ui:widgets.files.signature.keptAlt', 'The signature as kept')} />
        ) : (
          <canvas
            ref={canvas}
            width={PAD_WIDTH * SCALE}
            height={PAD_HEIGHT * SCALE}
            className="adm-kit-pad-canvas"
            role="img"
            aria-label={mode === 'draw' ? t('ui:widgets.files.signature.pad', 'Sign here with a finger, a pen or the mouse.') : t('ui:widgets.files.signature.typedPad', 'The name, written as the signature.')}
            aria-describedby={hintId}
            data-testid="kit-signature-pad"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
          />
        )}
        <span className="adm-kit-pad-line" id={hintId} aria-hidden={stage.kind === 'kept'}>
          {t('ui:widgets.files.signature.line', 'Sign above the line')}
        </span>
      </div>
      {mode === 'type' && stage.kind !== 'kept' ? (
        <div className="adm-kit-field">
          <label className="adm-kit-label" htmlFor={typedId}>
            {t('ui:widgets.files.signature.typedLabel', 'Name, as the signature')}
          </label>
          <input
            id={typedId}
            className="adm-kit-input"
            value={typed}
            disabled={!ready}
            autoComplete="name"
            maxLength={80}
            onChange={(event) => {
              // The name is written on the pad as it is typed.
              const name = event.currentTarget.value;
              setFailed(null);
              setTyped(name);
              writeTyped(name);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void keep();
              }
            }}
          />
        </div>
      ) : null}
      {failed === null ? null : (
        <p className="adm-kit-files-error" role="alert">
          {failed}
        </p>
      )}
      <div className="adm-kit-files-actions">
        {stage.kind === 'kept' ? (
          <button ref={againButton} type="button" className="adm-kit-button nb-press" disabled={props.disabled === true} onClick={again}>
            {t('ui:widgets.files.signature.again', 'Sign again')}
          </button>
        ) : (
          <>
            <button ref={modeButton} type="button" className="adm-kit-button adm-kit-button-quiet nb-press" disabled={!ready} onClick={() => switchTo(mode === 'draw' ? 'type' : 'draw')}>
              {mode === 'draw' ? t('ui:widgets.files.signature.typeInstead', 'Type the name instead') : t('ui:widgets.files.signature.drawInstead', 'Sign by hand instead')}
            </button>
            <button type="button" className="adm-kit-button adm-kit-button-quiet nb-press" disabled={!ready || (mode === 'draw' ? stage.kind !== 'drawn' : typed === '')} onClick={clear}>
              {t('ui:widgets.files.signature.clear', 'Clear')}
            </button>
            <button type="button" className="adm-kit-button adm-kit-button-primary nb-press" disabled={!ready} aria-busy={stage.kind === 'saving' ? true : undefined} onClick={() => void keep()}>
              {stage.kind === 'saving' ? t('ui:widgets.files.signature.saving', 'Sending the signature…') : t('ui:widgets.files.signature.keep', 'Keep this signature')}
            </button>
          </>
        )}
      </div>
      <p className="adm-kit-sr" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

export default function mountSignature(element: Element, props: SignatureProps): Promise<KitMounted<SignatureProps>> {
  return mountReact<SignatureProps>('signature', element, props, (now) => <Signature props={now} />);
}
