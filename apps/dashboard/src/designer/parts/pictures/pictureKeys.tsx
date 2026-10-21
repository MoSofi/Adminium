// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture dialog's keys: Pexels and Unsplash, each with a free key of the
 * person's own. Shown only where the host keeps keys (the desktop app, in the
 * system's key store, one set for every project); a server reads them from
 * its environment.
 *
 * Each source says its terms in a line and where to get a key. A key saved
 * is in use from the next search, and the source is in the Source list at
 * once: nothing is started again. The key goes to the server and never comes
 * back; a source with one says "Added" and takes a new key to replace it.
 */
import { CircleCheck, FileText, LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { FormField, SecretInput } from '@adminium/ui';

import { ApiError } from '../../../app/api.js';
import { t } from '../../../i18n/t.js';
import { getDesktopApi } from '../../../lib/desktop-runtime.js';
import { designerApi, type KeyedPictureSource, type PictureKeys } from '../../api.js';
import { keptByAppWords } from '../../models/AddModelDialog.js';

export const KEYED_SOURCES: readonly KeyedPictureSource[] = ['Pexels', 'Unsplash'];

/** A source's terms, in a line. */
const termsOf = (source: KeyedPictureSource): string =>
  source === 'Pexels'
    ? t('designer:pictureKeys.pexelsTerms', 'A free key gets 200 searches an hour and 20,000 a month. Its pictures are free to use, with no credit needed.')
    : t('designer:pictureKeys.unsplashTerms', 'A demo key gets 50 searches an hour. Its pictures are shown from Unsplash’s own site, never copied into your app.');

/** What the button that opens the keys says: the sources still to add, or the keys themselves when both are in. */
export function keysButtonLabel(keys: PictureKeys): string {
  const missing = KEYED_SOURCES.filter((source) => !keys[source]);
  if (missing.length === 2) return t('designer:pictureKeys.addBoth', 'Add Pexels or Unsplash');
  const [one] = missing;
  return one === undefined ? t('designer:pictureKeys.open', 'Picture keys') : t('designer:pictureKeys.addOne', 'Add {source}', { source: one });
}

export interface PictureKeysPanelProps {
  keys: PictureKeys;
  /** The id the panel's heading takes, for focus. */
  headingId: string;
  /** A key was kept (`added`) or taken away: the dialog reads its sources again. */
  onSaved: (source: KeyedPictureSource, added: boolean) => Promise<void>;
  onClose: () => void;
}

export function PictureKeysPanel({ keys, headingId, onSaved, onClose }: PictureKeysPanelProps): ReactNode {
  return (
    <section aria-labelledby={headingId} data-part="picture-keys" className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={headingId} tabIndex={-1} className="m-0 text-body font-bold outline-none">
            {t('designer:pictureKeys.title', 'Pexels and Unsplash')}
          </h3>
          <p className="m-0 text-pretty text-body-sm text-fg-muted">
            {t('designer:pictureKeys.lead', 'Openverse needs no key. Pexels and Unsplash each give a free key of your own: paste it here and the source is in the Source list at once.')}
          </p>
        </div>
        <button type="button" onClick={onClose} className="nb-ib h-[34px] shrink-0 rounded-[10px] border border-border-strong bg-surface px-3.5 text-body font-bold text-fg">
          {t('designer:pictureKeys.done', 'Done')}
        </button>
      </div>
      {KEYED_SOURCES.map((source) => (
        <KeyRow key={source} source={source} added={keys[source]} page={keys.pages[source]} onSaved={onSaved} />
      ))}
      <div className={`flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 ${keys.keeping === 'plain' ? 'border-warn/30 bg-warn-soft' : 'border-border bg-surface'}`}>
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <p className="m-0 text-pretty text-[12.5px] leading-normal text-fg-muted">
          <span className="font-bold text-fg">{t('designer:model.keptLead', 'Where this is kept:')}</span> {keptByAppWords(keys.keeping, getDesktopApi()?.platform)}
        </p>
      </div>
    </section>
  );
}

function KeyRow({ source, added, page, onSaved }: { source: KeyedPictureSource; added: boolean; page: string; onSaved: PictureKeysPanelProps['onSaved'] }): ReactNode {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keep = async (value: string | null): Promise<void> => {
    setBusy(value === null ? 'remove' : 'save');
    setError(null);
    try {
      await designerApi.keepPictureKey(source, value);
      setKey('');
      await onSaved(source, value !== null);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 422
          ? t('designer:pictureKeys.notAKey', 'This is not a key: a key is letters, digits, - and _, with no spaces.')
          : caught instanceof Error && caught.message !== ''
            ? caught.message
            : t('designer:pictureKeys.failed', 'The key could not be saved.'),
      );
    } finally {
      setBusy(null);
    }
  };
  const fieldLabel = source === 'Pexels' ? t('designer:pictureKeys.pexelsKey', 'Pexels API key') : t('designer:pictureKeys.unsplashKey', 'Unsplash access key');
  return (
    <form
      data-source={source}
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim() !== '' && busy === null) void keep(key.trim());
      }}
      className="flex flex-col gap-2 rounded-[12px] border border-border bg-surface p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-bold">{source}</span>
        {added ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-pos-soft px-2 py-0.5 text-[11.5px] font-bold text-pos">
            <CircleCheck aria-hidden="true" className="size-3" />
            {t('designer:pictureKeys.added', 'Added')}
          </span>
        ) : (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11.5px] font-bold text-fg-muted">{t('designer:pictureKeys.noKey', 'No key')}</span>
        )}
        <a href={page} target="_blank" rel="noopener noreferrer" className="ms-auto text-body-sm font-bold text-accent hover:underline">
          {t('designer:pictureKeys.getKey', 'Get a key')}
          <span className="sr-only"> {t('designer:pictureKeys.getKeyAt', 'at {source}, in your browser', { source })}</span>
        </a>
      </div>
      <p className="m-0 text-pretty text-body-sm text-fg-muted">{termsOf(source)}</p>
      <FormField label={fieldLabel} helper={added ? t('designer:pictureKeys.saved', 'A key is saved. Paste a new one to replace it.') : undefined} error={error ?? undefined}>
        <SecretInput
          value={key}
          spellCheck={false}
          autoComplete="off"
          revealLabel={t('designer:model.showKey', 'Show the key')}
          hideLabel={t('designer:model.hideKey', 'Hide the key')}
          copyLabel={t('designer:model.copyKey', 'Copy the key')}
          copiedLabel={t('designer:model.copied', 'Copied')}
          onChange={(event) => {
            setKey(event.target.value);
            setError(null);
          }}
        />
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        {added ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void keep(null)}
            className="nb-ib inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-border-strong bg-surface px-3.5 text-body font-bold text-danger disabled:opacity-60"
          >
            {busy === 'remove' ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t('designer:pictureKeys.remove', 'Remove the key')}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={busy !== null || key.trim() === ''}
          className="nb-btn inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-body font-bold text-accent-fg disabled:opacity-60"
        >
          {busy === 'save' ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          {added ? t('designer:pictureKeys.replace', 'Replace the key') : t('designer:pictureKeys.save', 'Save the key')}
        </button>
      </div>
      {/* The field's caption shows it; this says it, as the caption is not a live region. */}
      <p className="sr-only" role="alert">
        {error ?? ''}
      </p>
    </form>
  );
}
