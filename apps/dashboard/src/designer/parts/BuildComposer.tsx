// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prompt box at the foot of the chat: two lines, the model, and send —
 * or a square stop while a turn runs or a card waits. Enter sends,
 * Shift+Enter makes a line.
 */
import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ArrowUp } from 'lucide-react';

import { t } from '../../i18n/t.js';
import { AttachButton, attachHandlers, type AttachState } from './attach.js';

const MAX_PX = 216;
/** A box that takes no files. */
const NO_ATTACH: AttachState = { files: [], refused: null, add: () => undefined, remove: () => undefined, clear: () => undefined, upload: async () => [], hasImage: false };

export function BuildComposer({
  value,
  onChange,
  onSend,
  onStop,
  working,
  canSend,
  placeholder,
  model,
  inputRef,
  attach,
  tray,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  working: boolean;
  canSend: boolean;
  placeholder: string;
  model: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Files with the message: the clip, and paste and drop on the box. Absent where nothing can be attached (answering a question). */
  attach?: AttachState | undefined;
  /** The files waiting, above the box's own line. */
  tray?: ReactNode;
}): ReactNode {
  useEffect(() => {
    const el = inputRef?.current;
    if (el === null || el === undefined) return;
    if (value === '') {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_PX))}px`;
  }, [value, inputRef]);

  const handlers = attachHandlers(attach ?? NO_ATTACH, attach === undefined || working);

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend && value.trim() !== '') onSend();
    }
  };

  return (
    <div className="shrink-0 px-3.5 pb-3.5 pt-2.5">
      <div className="rounded-2xl border border-border-strong bg-surface shadow-sm focus-within:border-accent" {...(attach === undefined ? {} : { onDragOver: handlers.onDragOver, onDrop: handlers.onDrop })}>
        {tray}
        <textarea
          onPaste={attach === undefined ? undefined : handlers.onPaste}
          ref={inputRef}
          rows={2}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKey}
          aria-label={t('designer:build.message', 'Message to Adminium Designer')}
          placeholder={placeholder}
          className="block max-h-[216px] min-h-[60px] w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 text-[13.5px] leading-normal text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
          {model}
          {attach === undefined ? null : <AttachButton state={attach} disabled={working} />}
          {working ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t('designer:build.stop', 'Stop')}
              title={t('designer:build.stop', 'Stop')}
              className="ms-auto flex size-[34px] shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-fg hover:bg-surface-2"
            >
              <span aria-hidden="true" className="block size-[11px] rounded-[2px] bg-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend || value.trim() === ''}
              aria-label={t('designer:home.send', 'Send')}
              title={t('designer:home.send', 'Send')}
              className="ms-auto flex size-[34px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-subtle"
            >
              <ArrowUp aria-hidden="true" className="size-[17px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
