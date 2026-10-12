// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The element a person pointed at in the preview, as a chip: its tag, the
 * words it shows and the page it is on. Above the prompt box while it waits
 * to go with a message (there it can be taken off), and under a sent message.
 */
import type { ReactNode } from 'react';
import { MousePointerClick, X } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { DesignerPicked } from '../api.js';

function Chip({ picked, onRemove }: { picked: DesignerPicked; onRemove?: (() => void) | undefined }): ReactNode {
  const tag = picked.part.split(' ')[0] ?? '';
  const shown = picked.text !== '' ? picked.text : picked.label;
  return (
    <span
      role="group"
      aria-label={t('designer:pick.chip', 'Picked element')}
      title={`<${picked.part.replace(' ', ' class="')}${picked.part.includes(' ') ? '"' : ''}>`}
      className={`flex max-w-full items-center gap-1.5 rounded-[10px] border border-accent/35 bg-accent-soft py-1 ps-2 text-[12px] font-semibold text-fg ${onRemove === undefined ? 'pe-2.5' : 'pe-1'}`}
    >
      <MousePointerClick aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
      <code dir="ltr" className="shrink-0 font-mono text-[11.5px] font-semibold">{`<${tag}>`}</code>
      {shown === '' ? null : (
        <span dir="auto" className="min-w-0 truncate">
          {shown}
        </span>
      )}
      <span dir="ltr" className="max-w-[120px] shrink-0 truncate font-mono text-[11px] font-medium text-fg-muted">
        {picked.path}
      </span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('designer:pick.remove', 'Take the picked element off')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/** The element waiting to go with the next message. */
export function PickedTray({ picked, onRemove }: { picked: DesignerPicked | null; onRemove: () => void }): ReactNode {
  if (picked === null) return null;
  return (
    <div className="flex px-3 pt-2.5">
      <Chip picked={picked} onRemove={onRemove} />
    </div>
  );
}

/** The element a sent message was about. */
export function SentPicked({ picked }: { picked: DesignerPicked | null }): ReactNode {
  if (picked === null) return null;
  return (
    <div className="flex justify-end">
      <Chip picked={picked} />
    </div>
  );
}
