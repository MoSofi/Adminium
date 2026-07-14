/**
 * React binding of the pure buffer core (`overrides.ts`): baseline derives
 * from the overrides query, the overlay is local state. After a successful
 * save the query refetch swaps the baseline underneath and `clear()` drops
 * the (now redundant) overlay — the diff bar count returns to 0 either way,
 * because changes equal to their baseline are filtered out.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  baselineFromRows,
  bufferChanges,
  buildPutDocument,
  dropEntry,
  effectiveEntry,
  overrideKey,
  revertEntry,
  stageEntry,
  type BufferEntry,
  type OverrideDto,
  type OverridesPutDocument,
  type RemapChange,
  type RemapOverride,
} from './overrides.js';

export interface RemapBuffer {
  /** Effective op for a target key (overlay > baseline), null when absent. */
  get(key: string): BufferEntry | null;
  /** Stage/replace the op targeting `overrideKey(item)`. */
  stage(item: RemapOverride, status?: 'active' | 'disabled'): void;
  /** Remove the op entirely (deletes the persisted row on save). */
  drop(key: string): void;
  /** Undo the local edit for one target. */
  revert(key: string): void;
  revertAll(): void;
  /** Drop the whole overlay (used after the post-save refetch). */
  clear(): void;
  changes: RemapChange[];
  dirty: boolean;
  buildDocument(): OverridesPutDocument;
}

export function useRemapBuffer(rows: readonly OverrideDto[] | undefined): RemapBuffer {
  const baseline = useMemo(() => baselineFromRows(rows ?? []), [rows]);
  const [overlay, setOverlay] = useState<ReadonlyMap<string, BufferEntry | null>>(new Map());

  const get = useCallback(
    (key: string) => effectiveEntry(baseline, overlay, key),
    [baseline, overlay],
  );
  const stage = useCallback(
    (item: RemapOverride, status?: 'active' | 'disabled') => {
      setOverlay((current) =>
        stageEntry(baseline, current, { item, ...(status === 'disabled' ? { status } : {}) }),
      );
    },
    [baseline],
  );
  const drop = useCallback(
    (key: string) => setOverlay((current) => dropEntry(baseline, current, key)),
    [baseline],
  );
  const revert = useCallback((key: string) => setOverlay((current) => revertEntry(current, key)), []);
  const revertAll = useCallback(() => setOverlay(new Map()), []);

  const changes = useMemo(() => bufferChanges(baseline, overlay), [baseline, overlay]);
  const buildDocument = useCallback(() => buildPutDocument(baseline, overlay), [baseline, overlay]);

  return {
    get,
    stage,
    drop,
    revert,
    revertAll,
    clear: revertAll,
    changes,
    dirty: changes.length > 0,
    buildDocument,
  };
}

export { overrideKey };
