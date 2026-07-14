/**
 * Draft review-state persistence (acceptance criterion 12: "accept/reject state
 * persists across reload until applied"). Before a run is applied there is no
 * server column for the in-progress accept set — the server only records the
 * `review` id-lists at apply time (§8.3) — so the reviewer's checkbox state is
 * parked in `localStorage`, keyed by run id, and cleared once the run is
 * applied (its state then lives authoritatively on the run).
 *
 * All access is defensively wrapped: a storage-less or quota-exhausted
 * environment degrades to "no draft" rather than throwing into React render.
 */

const KEY_PREFIX = 'adminium.llmReview.';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access can throw under strict privacy modes
  }
}

/** Load the persisted accept-id list for a run, or `null` when none is stored. */
export function loadDraftSelection(runId: string): string[] | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(KEY_PREFIX + runId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return null;
  }
}

/** Persist the current accept-id set for a run (idempotent, best-effort). */
export function saveDraftSelection(runId: string, ids: Iterable<string>): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(KEY_PREFIX + runId, JSON.stringify([...ids]));
  } catch {
    // Quota or serialization failure — a lost draft is preferable to a crash.
  }
}

/** Drop a run's draft (called after a successful apply). */
export function clearDraftSelection(runId: string): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(KEY_PREFIX + runId);
  } catch {
    // ignore
  }
}
