// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model button in a Designer prompt box: the model a new turn calls.
 * With no model it is "Add a model", in the accent, and opens the dialog;
 * with a model that cannot build it carries a warning and an amber tint.
 * Otherwise it is the picker's trigger (it takes the popover's props).
 */
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Cpu, Plus } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { useDesignerModel } from './useModel.js';

export type DesignerModelState = ReturnType<typeof useDesignerModel>;

/** The name a model shows: its listed label, else its id. */
export function modelLabel(state: DesignerModelState): string {
  const picked = state.picked;
  if (picked === null) return '';
  const connection = state.models?.connections.find((entry) => entry.id === picked.connectionId);
  return connection?.models.find((entry) => entry.id === picked.model)?.label ?? picked.model;
}

type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'className'>;

export function ModelButton({ model, onAdd, ...props }: ButtonProps & { model: DesignerModelState; onAdd?: (() => void) | undefined }): ReactNode {
  if (model.loading) {
    return <span aria-hidden="true" className="h-[34px] w-[120px] shrink-0 animate-pulse rounded-[10px] bg-surface-2" />;
  }
  if (model.picked === null && !model.hasModels) {
    return (
      <button
        type="button"
        onClick={onAdd}
        disabled={onAdd === undefined}
        aria-haspopup={onAdd === undefined ? undefined : 'dialog'}
        className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] bg-accent-soft px-2.5 text-[12.5px] font-bold text-accent hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {onAdd === undefined ? null : <Plus aria-hidden="true" className="size-3.5" />}
        {onAdd === undefined ? t('designer:model.none', 'No model') : t('designer:model.add', 'Add a model')}
      </button>
    );
  }
  const label = model.picked === null ? t('designer:model.choose', 'Choose a model') : modelLabel(model);
  const cannot = model.canBuild === false;
  return (
    <button
      type="button"
      {...props}
      aria-haspopup="listbox"
      aria-label={
        model.picked === null
          ? label
          : cannot
            ? t('designer:model.buttonCannot', 'Model: {model}. It cannot build apps.', { model: label })
            : t('designer:model.button', 'Model: {model}', { model: label })
      }
      className={`flex h-[34px] min-w-0 shrink items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-bold ${cannot ? 'border border-warn/40 bg-warn-soft text-warn' : 'text-fg-muted hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg'}`}
    >
      {cannot ? <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" /> : <Cpu aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />}
      <span className="truncate">{label}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
    </button>
  );
}
