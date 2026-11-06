// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Shown in" on an item's editor, saved as it changes.
 *
 * It is not part of the document's own Save: it is where the item is
 * listed, not what it says, and on an email template it covers every
 * language of the key, not the one draft on screen. So each change is its
 * own small write (`PATCH … { shownIn }`), one at a time and in order, and a
 * write that fails puts the control back and says so.
 *
 * Draws nothing on a server with no workspaces.
 */
import { useEffect, useRef, useState } from 'react';

import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { SHOWN_IN_ALL, type ShownIn } from './model.js';
import { useShownInScope } from './scope.js';
import { ShownInControl } from './ShownIn.js';

export interface ShownInFieldProps {
  /** What the server holds now. */
  value: ShownIn | undefined;
  /** Writes one change; resolves when the server has it. */
  save: (next: ShownIn) => Promise<unknown>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ShownInField({ value, save, disabled = false, className }: ShownInFieldProps) {
  useCommonWords();
  const scope = useShownInScope();
  const toasts = useAppToasts();
  const held = value ?? SHOWN_IN_ALL;
  const [shown, setShown] = useState<ShownIn>(held);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);

  // A new reply from the server is the truth, unless a write of ours is still on its way.
  const heldKey = `${held.mode}:${held.workspaceIds.join(',')}`;
  useEffect(() => {
    if (pending.current === 0) setShown(held);
    // `held` is a new object on every render; its key is what changes.
  }, [heldKey]);

  if (!scope.active) return null;

  const change = (next: ShownIn): void => {
    const before = shown;
    setShown(next);
    pending.current += 1;
    queue.current = queue.current
      .then(() => save(next))
      .catch(() => {
        setShown(before);
        toasts.push({ variant: 'error', title: t('shownIn.saveFailed', 'Couldn’t change where it is listed') });
      })
      .finally(() => {
        pending.current -= 1;
      });
  };

  return <ShownInControl value={shown} onChange={change} disabled={disabled} className={className} />;
}
