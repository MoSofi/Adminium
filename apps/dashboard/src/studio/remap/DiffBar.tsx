// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dirty-state bar: "{n} changes" + per-change chips with individual revert,
 * revert-all, and Save (PUT full document). After a successful save the
 * "Regenerate pages" action appears (POST /connections/:id/generate) — copy
 * per 04-widget-registry.md §6.3: only pages whose generated_hash is
 * untouched are regenerated in place; human-edited pages are preserved.
 */
import { X } from 'lucide-react';
import { Badge, Button, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { RemapChange } from './overrides.js';

export interface DiffBarProps {
  changes: RemapChange[];
  onRevert: (key: string) => void;
  onRevertAll: () => void;
  onSave: () => void;
  saving: boolean;
  /** Key of the change the server rejected (422), if identifiable. */
  errorKey: string | null;
  canRegenerate: boolean;
  onRegenerate: () => void;
  regenerating: boolean;
}

function changeText(change: RemapChange): string {
  const item = change.next?.item ?? change.previous?.item;
  if (item === undefined) return change.key;
  const column = 'columnName' in item && typeof item.columnName === 'string' ? `.${item.columnName}` : '';
  return `${item.op} · ${item.tableName}${column}`;
}

const kindTone = { add: 'pos', edit: 'accent', remove: 'danger' } as const;

export function DiffBar({
  changes,
  onRevert,
  onRevertAll,
  onSave,
  saving,
  errorKey,
  canRegenerate,
  onRegenerate,
  regenerating,
}: DiffBarProps) {
  if (changes.length === 0 && !canRegenerate) return null;

  return (
    <div
      data-testid="diff-bar"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 shadow-card"
    >
      {changes.length > 0 ? (
        <span className="text-body-sm font-semibold text-fg">
          {changes.length === 1
            ? t('studio:remap.diff.one', '1 change')
            : t('studio:remap.diff.count', '{count} changes', { count: String(changes.length) })}
        </span>
      ) : (
        <span className="text-body-sm text-fg-muted">{t('studio:remap.diff.saved', 'Overrides saved.')}</span>
      )}
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {changes.map((change) => (
          <li key={change.key}>
            <Badge
              tone={errorKey === change.key ? 'danger' : kindTone[change.kind]}
              className={cn('gap-1', errorKey === change.key && 'ring-1 ring-danger')}
            >
              <span className="font-mono">{changeText(change)}</span>
              <button
                type="button"
                aria-label={t('studio:remap.diff.revertOne', 'Revert {change}', { change: changeText(change), })}
                className="rounded-full hover:opacity-70"
                onClick={() => onRevert(change.key)}
              >
                <X aria-hidden className="size-3" />
              </button>
            </Badge>
          </li>
        ))}
      </ul>
      <span className="ms-auto flex items-center gap-2">
        {canRegenerate ? (
          <Button variant="soft" size="sm" loading={regenerating} onClick={onRegenerate}>
            {t('studio:remap.diff.regenerate', 'Regenerate pages')}
          </Button>
        ) : null}
        {changes.length > 0 ? (
          <>
            <Button variant="ghost" size="sm" disabled={saving} onClick={onRevertAll}>
              {t('studio:remap.diff.revertAll', 'Revert all')}
            </Button>
            <Button size="sm" loading={saving} onClick={onSave}>
              {t('studio:remap.diff.save', 'Save overrides')}
            </Button>
          </>
        ) : null}
      </span>
    </div>
  );
}
