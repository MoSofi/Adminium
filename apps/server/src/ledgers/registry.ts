// SPDX-License-Identifier: AGPL-3.0-only
/**
 * IS THIS POSTING LIVE? — asked on every write that reaches a posting's
 * point, answered from memory.
 *
 * A table's rule is declared once and stored. Whether it runs now turns on
 * things that change with no change of the model: is its add-on installed in
 * this database, connected to the app whose rule it is, switched on for it;
 * is its package there and its deciding code loaded; did the owner switch the
 * rule off. So the write path asks here, each time, and gets one of four
 * answers:
 *
 *  - `idle` — the rule reads as not there. Nothing is asked, nothing refused:
 *    the add-on is not installed here, or it is an app's rule and the add-on
 *    is not connected to that app.
 *  - `live` — the ledger, the action and the loaded code that decides.
 *  - `off` — the owner switched the rule off: no new round starts; one that
 *    is open is still given back (when the code can be asked).
 *  - `unavailable` — it should run and cannot be asked: the add-on is switched
 *    off for the app, is being updated, or its code did not load. Never
 *    skipped: what a save does then is the write path's to say.
 *
 * Synchronous on purpose: it is asked inside a transaction, where nothing may
 * wait on a pool.
 */
import type { AddOnManifest, Ledger, LedgerAction } from '@adminium/manifest';

import { deciderGate, type DeciderGate, type InstalledDecider } from '../add-ons/decide.js';
import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { DeclaredPosting } from '../crud/ledger-points.js';

export type { LedgerAction };
export type WriteScope = Ledger['writes'][string];

/** The ledgers an add-on declares: checked whole by the validator when it was installed, kept loosely typed on the manifest. */
const ledgersOf = (manifest: AddOnManifest): readonly Ledger[] => (manifest.addOn.ledgers ?? []) as unknown as readonly Ledger[];

/** A ledger of an installed add-on, with its tables as they are in this database. */
export interface ResolvedLedger {
  addOn: string;
  version: string;
  id: string;
  refusal: Ledger['refusal'];
  receipts: ResolvedTable;
  /** The add-on's one-row settings table, when it declares one. */
  settings: ResolvedTable | null;
  /** One of the add-on's own tables, by its short name. */
  table(ref: string): ResolvedTable | null;
  /** What its code may write, by the real table's id. */
  writes: ReadonlyMap<string, WriteScope>;
  /** The add-on's short name for one of its tables; the id itself for a table that is not its own. */
  refOf(tableId: string): string;
  /**
   * What the add-on declares its own columns to be, where an engine may not
   * say: SQLite keeps json as text and a decimal as a number. Read from the
   * manifest, a value is handed the same on every engine.
   */
  typesOf(tableId: string): ReadonlyMap<string, 'json' | 'decimal' | 'boolean' | 'date'>;
}

export type PostingState =
  | { state: 'idle' }
  | { state: 'off' }
  | { state: 'live' | 'off'; ledger: ResolvedLedger; action: LedgerAction; decider: InstalledDecider }
  | { state: 'unavailable'; cause: string; ledger?: ResolvedLedger; action?: LedgerAction };

/** What a write asks of the add-ons its postings name. Absent on a server with no add-on runtime: a posting table then refuses every write. */
export interface LedgerRuntime {
  resolve(view: SnapshotView, table: ResolvedTable, posting: DeclaredPosting): PostingState;
  /** The loaded code that plans an add-on's rows, or null. */
  deciderFor(addOnKey: string): InstalledDecider | null;
  /** The add-on's update gate: a save enters as a reader. */
  gate(addOnKey: string): DeciderGate;
  /** The version and status the store holds now: read inside a save before its first statement on an add-on's table. */
  versionNow(addOnKey: string): Promise<{ version: string; status: string } | null>;
  /** Whether anything listens to changes of a table (an outbox, a rule): only then are a posting's rows announced. */
  watches(connectionId: string, tableId: string): Promise<boolean>;
}

export interface LedgerRuntimeDeps {
  /** What is installed, as it stands now (rebuilt, never patched). */
  installs: () => AddOnInstalls;
  /** The loaded deciding code of an add-on, or null: not loaded, not trusted, or its file is gone. */
  decider: (addOnKey: string) => InstalledDecider | null;
  versionNow: (addOnKey: string) => Promise<{ version: string; status: string } | null>;
  watches?: ((connectionId: string, tableId: string) => Promise<boolean>) | undefined;
}

/** The app whose manifest stored a rule on this table, or null for a rule the owner made. */
function ruleOwner(installs: AddOnInstalls, view: SnapshotView, table: ResolvedTable, posting: DeclaredPosting): string | null {
  if (table.table?.managedPostings?.includes(posting.id) !== true) return null;
  // An app's rule sits on a table that app made: the table's stored name says who.
  const stored = installs.refOf(view.connectionId, table.id);
  const cut = stored.indexOf(':');
  return stored === table.id || cut <= 0 ? null : stored.slice(0, cut);
}

/** A ledger with its tables resolved here, or the name of what is missing. */
function resolveLedger(installs: AddOnInstalls, view: SnapshotView, addOn: { manifest: AddOnManifest; version: string }, id: string): ResolvedLedger | string {
  const key = addOn.manifest.key;
  const ledger = ledgersOf(addOn.manifest).find((candidate) => candidate.id === id);
  if (ledger === undefined) return 'no-such-ledger';
  const byRef = new Map<string, ResolvedTable>();
  const refs = new Map<string, string>();
  const table = (ref: string): ResolvedTable | null => {
    const hit = byRef.get(ref);
    if (hit !== undefined) return hit;
    const tableId = installs.tableOf(view.connectionId, key, ref);
    if (tableId === null) return null;
    try {
      const resolved = view.table(tableId);
      byRef.set(ref, resolved);
      refs.set(resolved.id, ref);
      return resolved;
    } catch {
      return null;
    }
  };
  const receipts = table(ledger.receipts);
  if (receipts === null) return 'tables-missing';
  const writes = new Map<string, WriteScope>();
  for (const [ref, scope] of Object.entries(ledger.writes)) {
    const written = table(ref);
    if (written === null) return 'tables-missing';
    writes.set(written.id, scope);
  }
  const settingsRef = addOn.manifest.addOn.settingsTable;
  const settings = settingsRef === undefined ? null : table(settingsRef);
  if (settingsRef !== undefined && settings === null) return 'tables-missing';
  const hints = new Map<string, ReadonlyMap<string, 'json' | 'decimal' | 'boolean' | 'date'>>();
  const HINT: Readonly<Record<string, 'json' | 'decimal' | 'boolean' | 'date'>> = { json: 'json', decimal: 'decimal', money: 'decimal', bool: 'boolean', date: 'date' };
  const typesOf = (tableId: string): ReadonlyMap<string, 'json' | 'decimal' | 'boolean' | 'date'> => {
    const hit = hints.get(tableId);
    if (hit !== undefined) return hit;
    const ref = refs.get(tableId);
    const declared = ref === undefined ? undefined : (addOn.manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref);
    const found = new Map((declared?.columns ?? []).flatMap((column) => (HINT[column.type] === undefined ? [] : [[column.ref, HINT[column.type]!] as const])));
    hints.set(tableId, found);
    return found;
  };
  return { addOn: key, version: addOn.version, id, refusal: ledger.refusal, receipts, settings, table, writes, refOf: (tableId) => refs.get(tableId) ?? tableId, typesOf };
}

export function createLedgerRuntime(deps: LedgerRuntimeDeps): LedgerRuntime {
  return {
    resolve(view, table, posting) {
      const installs = deps.installs();
      const addOn = installs.installed(view.connectionId, posting.into.addOn);
      // Not installed in this database: the rule reads as not there.
      if (addOn === null) return { state: 'idle' };
      const off = table.table?.switchedOff?.postings.includes(posting.id) === true;
      const cannot = (cause: string, more: { ledger?: ResolvedLedger; action?: LedgerAction } = {}): PostingState =>
        // The owner's switch is the way through an add-on that cannot answer: off starts nothing, and refuses nothing.
        off ? { state: 'off' } : { state: 'unavailable', cause, ...more };
      const owner = ruleOwner(installs, view, table, posting);
      if (owner !== null) {
        // An app's rule for an add-on that is not connected to that app is inert, like the rest of what the app keeps for it.
        if (!addOn.hosts.has(owner)) return { state: 'idle' };
        if (addOn.hosts.get(owner) !== true) return cannot('switched-off-for-app');
        if (posting.needs !== undefined && !installs.featureOn(view.connectionId, owner, posting.needs)) return cannot('switched-off-for-app');
      }
      if (addOn.status !== 'installed') return cannot(addOn.status);
      const ledger = resolveLedger(installs, view, addOn, posting.into.ledger);
      if (typeof ledger === 'string') return cannot(ledger);
      const action = ledgersOf(addOn.manifest).find((candidate) => candidate.id === posting.into.ledger)?.actions[posting.into.action];
      if (action === undefined) return cannot('no-such-action', { ledger });
      const decider = deps.decider(posting.into.addOn);
      // Its file is gone or was changed, nobody vouches for it, or it did not load.
      if (decider === null) return cannot('no-decider', { ledger, action });
      // Loaded from another version than the one installed: an update is half way, or the add-ons were not loaded again.
      if (decider.version !== addOn.version) return cannot('version-moved', { ledger, action });
      return { state: off ? 'off' : 'live', ledger, action, decider };
    },
    deciderFor: (addOnKey) => deps.decider(addOnKey),
    gate: (addOnKey) => deciderGate(addOnKey),
    versionNow: (addOnKey) => deps.versionNow(addOnKey),
    watches: (connectionId, tableId) => deps.watches?.(connectionId, tableId) ?? Promise.resolve(false),
  };
}
