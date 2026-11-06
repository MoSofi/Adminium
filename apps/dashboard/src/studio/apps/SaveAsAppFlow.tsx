// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: the one flow behind both shapes.
 *
 * The quick save (one dialog, the quick install's pattern) and the five-step wizard
 * share one draft, one inventory and one plan, so "More choices" opens the
 * wizard on exactly what the dialog was about to save, and the dialog's count
 * of things needing a choice is the count Check shows. Mounted at one place
 * on the page for both shapes, so switching keeps the draft.
 *
 * Saving writes nothing on this server but the save record and its kept
 * copy; the file is made again from the same choices every time, never from
 * an earlier plan.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { connectionsQuery } from '../hub/ConnectionsHub.js';
import { LOCAL_PUBLISHER_ID, appCatalogQuery } from './appsApi.js';
import { QuickSaveDialog } from './QuickSaveDialog.js';
import { SaveAppWizard, type WizardStep } from './SaveAppWizard.js';
import {
  APP_SAVES_QUERY_KEY,
  appSavesQuery,
  planSave,
  saveApp,
  saveInventoryQuery,
  type SavedFile,
  type SaveInventory,
} from './saveAppApi.js';
import { KEY_PATTERN, VERSION_PATTERN, draftFromInventory, keyFromName, learnViewItems, requestOf, type SaveDraft } from './saveAppDraft.js';
import { saveDatabases } from './saveAppDatabases.js';
import type { SaveFlowShared } from './saveAppShared.js';

export type { SaveFlowShared };

/** Where a save starts: a database (or none yet), a shape, and what it is called when saved before. */
export interface SaveStart {
  connectionId: string | null;
  mode: 'quick' | 'wizard';
  /** "Save a newer version": the last save's words. */
  prefill?: { key: string; name: string; description: string; icon?: string | null; label: string };
}

export interface SaveAsAppFlowProps {
  start: SaveStart;
  onClose: () => void;
  /** The wizard replaces the page's body; the page hides its own while it shows. */
  onModeChange?: (mode: 'quick' | 'wizard') => void;
}

/** The fields a plan needs before it can be asked. */
export function draftIsPlannable(draft: SaveDraft): boolean {
  return draft.name.trim() !== '' && KEY_PATTERN.test(draft.key) && (draft.version === null || VERSION_PATTERN.test(draft.version));
}

export function SaveAsAppFlow({ start, onClose, onModeChange }: SaveAsAppFlowProps) {
  const queryClient = useQueryClient();
  const { data: connections } = useSuspenseQuery(connectionsQuery());
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const databases = useMemo(() => saveDatabases(connections, bootstrap), [connections, bootstrap]);
  const [mode, setModeState] = useState(start.mode);
  const [step, setStep] = useState<WizardStep>(start.connectionId === null ? 0 : start.mode === 'wizard' ? 1 : 0);
  const [connectionId, setConnectionId] = useState<string | null>(start.connectionId ?? databases[0]?.connection.id ?? null);
  const [draft, setDraft] = useState<SaveDraft | null>(null);
  const [saved, setSaved] = useState<SavedFile | null>(null);

  const setMode = (next: 'quick' | 'wizard') => {
    setModeState(next);
    onModeChange?.(next);
  };

  const inventoryQuery = useQuery({ ...saveInventoryQuery(connectionId ?? ''), enabled: connectionId !== null });
  const inventory: SaveInventory | undefined = inventoryQuery.data?.connectionId === connectionId ? inventoryQuery.data : undefined;
  const saves = useQuery(appSavesQuery());
  // A key an app of adminium.dev uses would clash where both are installed.
  const catalog = useQuery(appCatalogQuery());
  const catalogKeys = useMemo(() => new Set((catalog.data?.apps ?? []).filter((app) => app.publisher !== LOCAL_PUBLISHER_ID).map((app) => app.key)), [catalog.data]);

  // A new database starts a new draft, keeping what the app is called.
  useEffect(() => {
    if (inventory === undefined || draft?.connectionId === inventory.connectionId) return;
    const connection = connections.find((one) => one.id === inventory.connectionId);
    const name = draft?.name ?? start.prefill?.name ?? connection?.name ?? '';
    setDraft(
      draftFromInventory(inventory, {
        name,
        key: draft?.key ?? start.prefill?.key ?? keyFromName(name),
        description: draft?.description ?? start.prefill?.description ?? '',
        icon: draft?.icon ?? start.prefill?.icon ?? null,
        label: draft?.label ?? start.prefill?.label ?? '',
      }),
    );
  }, [inventory, draft, connections, start.prefill]);

  const request = draft !== null && inventory !== undefined && draft.connectionId === inventory.connectionId && draftIsPlannable(draft) ? requestOf(draft, inventory) : null;
  const wantsPlan = request !== null && saved === null && (mode === 'quick' || step === 3);
  const plan = useQuery({
    queryKey: ['studio', 'apps', 'save-plan', request] as const,
    queryFn: () => planSave(request!),
    enabled: wantsPlan,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Personal views a plan asked about are answered "stays behind" by default: learn their items, then ask again.
  useEffect(() => {
    if (plan.data === undefined || draft === null || plan.isPlaceholderData) return;
    const next = learnViewItems(draft, plan.data);
    if (next !== null) setDraft(next);
  }, [plan.data, plan.isPlaceholderData, draft]);
  const settling = plan.data !== undefined && draft !== null && learnViewItems(draft, plan.data) !== null;

  const save = useMutation({
    mutationFn: () => saveApp(request!),
    onSuccess: async (file) => {
      setSaved(file);
      setMode('wizard');
      setStep(4);
      await queryClient.invalidateQueries({ queryKey: APP_SAVES_QUERY_KEY });
    },
  });

  const shared = {
    databases,
    connectionId,
    inventory,
    inventoryError: inventoryQuery.error,
    draft,
    setDraft,
    saves: saves.data ?? [],
    plan: wantsPlan ? plan.data : undefined,
    planPending: wantsPlan && (plan.isFetching || settling),
    planError: wantsPlan ? plan.error : null,
    save: () => save.mutate(),
    saving: save.isPending,
    saveError: save.error,
    resetSaveError: () => save.reset(),
    saved,
    catalogKeys,
    onClose,
  };

  if (mode === 'quick') {
    return (
      <QuickSaveDialog
        {...shared}
        onMoreChoices={() => {
          setMode('wizard');
          setStep(connectionId === null ? 0 : 1);
        }}
        onReview={() => {
          setMode('wizard');
          setStep(3);
        }}
      />
    );
  }
  return (
    <SaveAppWizard
      {...shared}
      step={step}
      onStep={setStep}
      onConnection={(id) => {
        if (id === connectionId) return;
        setConnectionId(id);
      }}
    />
  );
}
