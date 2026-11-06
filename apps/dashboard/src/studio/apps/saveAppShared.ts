// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: what the flow hands its two shapes (the quick save and the
 * wizard) — one draft, one inventory, one plan.
 */
import type { AppSaveRow, SavedFile, SaveInventory, SavePlan } from './saveAppApi.js';
import type { SaveDatabase } from './saveAppDatabases.js';
import type { SaveDraft } from './saveAppDraft.js';

export type SaveFlowShared = {
  databases: SaveDatabase[];
  connectionId: string | null;
  inventory: SaveInventory | undefined;
  inventoryError: Error | null;
  draft: SaveDraft | null;
  setDraft: (draft: SaveDraft) => void;
  saves: AppSaveRow[];
  plan: SavePlan | undefined;
  planPending: boolean;
  planError: Error | null;
  save: () => void;
  saving: boolean;
  saveError: Error | null;
  resetSaveError: () => void;
  saved: SavedFile | null;
  /** Keys the apps of adminium.dev use: a save may not take one. */
  catalogKeys: ReadonlySet<string>;
  onClose: () => void;
};
