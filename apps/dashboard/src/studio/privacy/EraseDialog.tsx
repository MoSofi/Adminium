// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Erase everything about this person?" (comp 7b): what goes, what stays,
 * what is left as it is, and the address typed again to confirm.
 *
 *  - Opening it asks the server what an erasure would do
 *    (`POST /privacy/erase/preview`): the lists are the server's, counted.
 *  - "Erase for good" stays off until the preview is in and the typed
 *    address is the person's (any case, spaces around it or not).
 *  - The erasure (`POST /privacy/erase`) sends the typed text as `confirm`;
 *    the server checks it again and answers 409 without repeating it.
 *  - Focus starts in the confirm field, stays in the dialog, and Escape or
 *    Cancel closes it (not while the erasure runs).
 *
 * Nothing here logs or stores the address: it is the one the person typed
 * to find them, shown back under the title and nowhere else.
 */
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, Input, Modal, ModalBody, ModalFooter, ModalHeader, Skeleton } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { erasePerson, previewErasure, type EraseResult } from './privacyApi.js';
import { confirmMatches, goesWords, lockedWords, staysWords } from './privacyWords.js';

/** Digits in mono, the words around them as they are (the comp's counts). */
function Numbered({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\p{Nd}[\p{Nd},.\u066b\u066c\s]*)/u);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="font-mono font-semibold">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The comp's one-line list ("1 contact, 3 form answers, …"), joined as the reader's language joins a list. */
function JoinedList({ items }: { items: string[] }): ReactNode {
  const language = getI18nInstance()?.language ?? 'en-US';
  const parts = new Intl.ListFormat(language, { style: 'long', type: 'unit' }).formatToParts(items.map((_, index) => `\ue000${String(index)}\ue000`));
  return (
    <>
      {parts.map((part, index) => {
        const at = /^\ue000(\d+)\ue000$/.exec(part.value);
        return at === null ? <span key={index}>{part.value}</span> : <Numbered key={index} text={items[Number(at[1])]!} />;
      })}
    </>
  );
}

const MICRO = 'text-micro uppercase';

export function EraseDialog({ address, onClose, onErased }: { address: string; onClose: () => void; onErased: (result: EraseResult) => Promise<void> }): ReactNode {
  const confirmId = useId();
  const previewKey = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Not cached: each opening asks again (an erasure in another tab changes the answer).
  const preview = useQuery({ queryKey: ['privacy', 'erase-preview', previewKey], queryFn: () => previewErasure(address), gcTime: 0, retry: false });
  const ready = preview.data !== undefined && confirmMatches(typed, preview.data.address);

  async function erase(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onErased(await erasePerson(address, typed));
    } catch (failure) {
      setBusy(false);
      setError(
        failure instanceof ApiError && failure.status === 409
          ? t('studio:privacy.erase.mismatch', 'That isn’t the same address. Type it again.')
          : failure instanceof ApiError && failure.status === 503
            ? lockedWords()
            : t('studio:privacy.erase.failed', 'The erasure did not finish. Erase again to finish it: what was already done stays done.'),
      );
    }
  }

  const goes = preview.data?.goes ?? [];
  const stays = preview.data?.stays ?? [];
  const left = preview.data?.left ?? [];

  return (
    <Modal
      open
      size="md"
      className="max-w-[480px] rounded-xl"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ModalHeader
        tone="danger"
        icon={<Trash2 />}
        title={t('studio:privacy.erase.title', 'Erase everything about this person?')}
        subtitle={
          <span dir="ltr" className="font-mono text-[12px] text-fg-muted [overflow-wrap:anywhere]">
            {address}
          </span>
        }
        closeLabel={t('studio:privacy.erase.cancel', 'Cancel')}
        className="border-b border-border"
      />
      <ModalBody className="flex flex-col gap-3.5 py-5">
        {preview.isError ? (
          <Alert
            tone="danger"
            title={preview.error instanceof ApiError && preview.error.status === 503 ? lockedWords() : t('studio:privacy.erase.previewFailed', 'What an erasure would do could not be worked out. Close this and try again.')}
          />
        ) : preview.data === undefined ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">{t('studio:privacy.erase.loading', 'Working out what goes…')}</span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1" data-testid="erase-goes">
              <span className={`${MICRO} text-danger`}>{t('studio:privacy.erase.goesLabel', 'What goes')}</span>
              <p className="text-body">
                {goes.length === 0 ? t('studio:privacy.erase.nothingGoes', 'Nothing in the apps’ tables or the mail: only what is listed under What stays.') : <JoinedList items={goes.map(goesWords)} />}
              </p>
            </div>
            <div className="flex flex-col gap-1" data-testid="erase-stays">
              <span className={`${MICRO} text-fg-subtle`}>{t('studio:privacy.erase.staysLabel', 'What stays')}</span>
              <ul className="flex flex-col gap-1.5 text-body text-fg-muted">
                {stays.map((item, index) => {
                  const words = staysWords(item);
                  return (
                    <li key={`${item.kind}-${item.table ?? ''}-${String(index)}`}>
                      <Numbered text={words.line} />
                      {words.kept === null ? null : <span className="text-fg-subtle"> {words.kept}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
            {left.length === 0 ? null : (
              <div className="flex flex-col gap-1" data-testid="erase-left">
                <span className={`${MICRO} text-warn`}>{t('studio:privacy.erase.leftLabel', 'Left as it is')}</span>
                <p className="text-body-sm text-fg-muted">{t('studio:privacy.erase.leftSub', 'These columns can’t be emptied, so what they hold stays:')}</p>
                <ul className="flex flex-col gap-1 text-body-sm">
                  {left.map((one) => (
                    <li key={`${one.connectionId}-${one.table}-${one.column}`}>
                      <span dir="ltr" className="font-mono text-[12px]">
                        {one.table}.{one.column}
                      </span>{' '}
                      <span className="text-fg-muted">
                        <Numbered text={t('studio:privacy.erase.leftRows', '{count, plural, one {# row} other {# rows}}', { count: one.rows })} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={confirmId} className="text-body-sm font-bold text-fg">
            {t('studio:privacy.erase.confirm', 'Type the address to confirm')}
          </label>
          <Input
            id={confirmId}
            autoFocus
            dir="ltr"
            mono
            autoComplete="off"
            spellCheck={false}
            value={typed}
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void erase();
              }
            }}
            className="bg-surface-2 text-[12.5px] max-sm:min-h-11"
            data-testid="erase-confirm"
          />
        </div>
        {error === null ? null : <Alert tone="danger" title={error} />}
      </ModalBody>
      <ModalFooter className="flex-wrap gap-2.5">
        <Button variant="secondary" onClick={onClose} disabled={busy} className="max-sm:min-h-11">
          {t('studio:privacy.erase.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" disabled={!ready} loading={busy} onClick={() => void erase()} className="max-sm:min-h-11" data-testid="erase-for-good">
          {t('studio:privacy.erase.eraseForGood', 'Erase for good')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
