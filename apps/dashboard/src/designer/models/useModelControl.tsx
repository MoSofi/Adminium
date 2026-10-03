// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model control of a Designer prompt box: the picker and the "Add a
 * model" dialog, together. After a save the new model is the one in use,
 * "Model added." is said, and the picker opens again with it selected.
 */
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { designerKeys } from '../api.js';
import { AddModelDialog, type SavedModel } from './AddModelDialog.js';
import type { DesignerModelState } from './ModelButton.js';
import { ModelPicker } from './ModelPicker.js';

export function useModelControl(model: DesignerModelState): { element: ReactNode; openAdd: () => void } {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);

  const saved = async ({ connection, model: id }: SavedModel): Promise<void> => {
    setAdding(false);
    model.pick({ connectionId: connection.id, model: id });
    await queryClient.invalidateQueries({ queryKey: designerKeys.models });
    toasts.push({ variant: 'success', title: t('designer:model.addedToast', 'Model added.') });
    setPicking(true);
  };

  return {
    openAdd: () => setAdding(true),
    element: (
      <>
        <ModelPicker model={model} open={picking} onOpenChange={setPicking} onAdd={() => setAdding(true)} />
        <AddModelDialog open={adding} onOpenChange={setAdding} models={model.models} onSaved={(entry) => void saved(entry)} />
      </>
    ),
  };
}
