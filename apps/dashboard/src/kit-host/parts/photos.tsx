// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The photo field, mounted on an app's own screen (the photos of a job a
 * crew signs off).
 *
 * "Add a photo" opens the phone's camera or its pictures (the browser's own
 * choice: nothing is asked of the camera here). Each photo chosen is turned
 * upright by the browser, drawn again at most `maxSide` pixels a side as a
 * JPEG — which leaves behind what the camera wrote beside it — and sent for
 * the app's column (`KitFileTarget`). The server takes those notes out again
 * whatever was sent, so a photo is never kept with the place it was taken.
 *
 * The field shows each photo small, in order, with a button that takes it
 * out, and tells the app the ids it holds after every change. A photo being
 * sent is shown as such, and one refused says why and can be taken out. The
 * part throws away on the server a photo it sent that the person took out
 * and the app never made its `value`: nothing else would ever name it.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { KitMounted, PhotosProps } from '../contract.js';
import { contentHref, fileClient, FileRefused } from '../file-client.js';
import { mountReact } from '../root.js';
import { refusalWords } from './file-words.js';

import './files.css';

const DEFAULT_MAX = 6;
const DEFAULT_SIDE = 2048;

interface Photo {
  /** This field's own key for it. */
  key: string;
  /** The file's id once it is kept. */
  fileId: string | null;
  /** What the small picture shows: the photo as sent, or the kept file. */
  href: string;
  state: 'sending' | 'kept' | 'refused';
  /** Why it was refused, in the reader's words. */
  reason?: string;
  /** Sent by this mount: thrown away on the server when taken out, unless the app has made it its own. */
  ours: boolean;
}

let keys = 0;
const keyOf = (): string => `photo-${String((keys += 1))}`;

/** A photo upright and at most `side` pixels a side, as a JPEG; the file as it came where the browser cannot draw it. */
async function prepared(file: File, side: number): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (context === null) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ?? file;
}

function Photos({ props }: { props: PhotosProps }): ReactNode {
  const t = useMaybeT();
  const labelId = useId();
  const latest = useRef(props);
  latest.current = props;
  const client = useRef(fileClient(() => latest.current)).current;
  const input = useRef<HTMLInputElement | null>(null);
  const add = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const [photos, setPhotos] = useState<Photo[]>(() => (props.value ?? []).map((fileId) => ({ key: keyOf(), fileId, href: contentHref(fileId), state: 'kept', ours: false })));
  const [said, setSaid] = useState('');
  const max = Math.max(1, props.max ?? DEFAULT_MAX);

  // What the app gives as `value` is what the column holds: those are the record's, never thrown away here.
  const valueKey = (props.value ?? []).join(',');
  useEffect(() => {
    const value = valueKey === '' ? [] : valueKey.split(',');
    setPhotos((now) => {
      const held = new Set(value);
      const same = now.filter((photo) => photo.state === 'kept').map((photo) => photo.fileId).join(',') === valueKey;
      if (same) return now.map((photo) => (photo.fileId !== null && held.has(photo.fileId) ? { ...photo, ours: false } : photo));
      const known = new Map(now.filter((photo) => photo.fileId !== null).map((photo) => [photo.fileId!, photo]));
      return [...value.map((fileId) => ({ ...(known.get(fileId) ?? { key: keyOf(), fileId, href: contentHref(fileId), state: 'kept' as const }), ours: false })), ...now.filter((photo) => photo.state !== 'kept')];
    });
  }, [valueKey]);

  // The app hears the ids it holds, and whether a photo is still on its way, each time either changes.
  const keptIds = photos.filter((photo) => photo.state === 'kept' && photo.fileId !== null).map((photo) => photo.fileId!);
  const busy = photos.some((photo) => photo.state === 'sending');
  const told = useRef({ ids: keptIds.join(','), busy });
  useEffect(() => {
    const ids = keptIds.join(',');
    if (told.current.ids !== ids) latest.current.onChange([...keptIds]);
    if (told.current.busy !== busy) latest.current.onBusy?.(busy);
    told.current = { ids, busy };
  });
  const change = (update: (now: Photo[]) => Photo[]): void => setPhotos(update);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    add.current?.focus();
  }, [photos]);

  const room = max - photos.filter((photo) => photo.state !== 'refused').length;
  const disabled = props.disabled === true;

  const chosen = async (files: readonly File[]): Promise<void> => {
    const taken = files.slice(0, Math.max(0, room));
    if (files.length > taken.length) setSaid(t('ui:widgets.files.photos.full', 'That is as many photos as this takes.'));
    for (const file of taken) {
      const key = keyOf();
      const blob = await prepared(file, latest.current.maxSide ?? DEFAULT_SIDE);
      const href = URL.createObjectURL(blob);
      change((now) => [...now, { key, fileId: null, href, state: 'sending', ours: true }]);
      try {
        const fileId = await client.upload(blob, blob === file ? file.name || 'photo.jpg' : 'photo.jpg');
        change((now) => now.map((photo) => (photo.key === key ? { ...photo, fileId, state: 'kept' } : photo)));
        setSaid(t('ui:widgets.files.photos.added', 'Photo added.'));
      } catch (error) {
        const reason = refusalWords(t, error instanceof FileRefused ? error.reason : 'notSent');
        change((now) => now.map((photo) => (photo.key === key ? { ...photo, state: 'refused', reason } : photo)));
        setSaid(t('ui:widgets.files.photos.refused', 'The photo was not kept: {reason}', { reason }));
      }
    }
  };

  const remove = (key: string, index: number): void => {
    const photo = photos.find((one) => one.key === key);
    if (photo === undefined || disabled) return;
    if (photo.ours && photo.fileId !== null) void client.discard(photo.fileId);
    if (photo.href.startsWith('blob:')) URL.revokeObjectURL(photo.href);
    change((now) => now.filter((one) => one.key !== key));
    setSaid(t('ui:widgets.files.photos.removed', 'Photo {n} taken out.', { n: index + 1 }));
    // The focus goes on to the field's own button, never to the page's start (once it is drawn enabled again).
    refocus.current = true;
  };

  const name = props.label !== undefined ? { 'aria-labelledby': labelId } : { 'aria-label': props.ariaLabel ?? t('ui:widgets.files.photos.name', 'Photos') };
  const count = photos.filter((photo) => photo.state !== 'refused').length;

  return (
    <div className="adm-kit-field adm-kit-photos" role="group" {...name} data-part="kit-photos" aria-invalid={props.invalid === true ? true : undefined}>
      {props.label === undefined ? null : (
        <span className="adm-kit-label" id={labelId}>
          {props.label}
        </span>
      )}
      {photos.length === 0 ? null : (
        <ul className={`adm-kit-photo-list${props.invalid === true ? ' adm-kit-pad-invalid' : ''}`}>
          {photos.map((photo, index) => (
            <li key={photo.key} className="adm-kit-photo" data-state={photo.state}>
              <img src={photo.href} alt={t('ui:widgets.files.photos.alt', 'Photo {n}', { n: index + 1 })} />
              {photo.state === 'sending' ? <span className="adm-kit-photo-note">{t('ui:widgets.files.photos.sending', 'Sending…')}</span> : null}
              {photo.state === 'refused' ? (
                <span className="adm-kit-photo-note adm-kit-photo-refused" role="alert">
                  {photo.reason}
                </span>
              ) : null}
              <button
                type="button"
                className="adm-kit-photo-remove nb-press"
                disabled={disabled || photo.state === 'sending'}
                aria-label={t('ui:widgets.files.photos.remove', 'Take photo {n} out', { n: index + 1 })}
                onClick={() => remove(photo.key, index)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="adm-kit-files-actions">
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple={max > 1}
          hidden
          data-testid="kit-photos-input"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = '';
            void chosen(files);
          }}
        />
        <button ref={add} type="button" className="adm-kit-button adm-kit-button-primary nb-press" disabled={disabled || room <= 0} onClick={() => input.current?.click()}>
          {t('ui:widgets.files.photos.add', 'Add a photo')}
        </button>
        <span className="adm-kit-files-count">{t('ui:widgets.files.photos.count', '{count} of {max}', { count, max })}</span>
      </div>
      <p className="adm-kit-sr" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

export default function mountPhotos(element: Element, props: PhotosProps): Promise<KitMounted<PhotosProps>> {
  return mountReact<PhotosProps>('photos', element, props, (now) => <Photos props={now} />);
}
