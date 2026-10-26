// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONSENT DOOR'S WORDS — the one module the mail door, the send ledger,
 * the erasure and the marketing/service classes import.
 *
 * Every read and write of the consent log and the stop list goes through the
 * service this describes (`createConsentService`); nothing outside
 * `consent/` calls their repos. A caller speaks in addresses as people typed
 * them and rows as the record pages name them; the hashing, the keys, their
 * versions and the encryption stay inside.
 */
import type {
  ConsentEvent,
  ConsentHow,
  ConsentPerson,
  ConsentPurpose,
  ConsentSource,
  StopReason,
} from '@adminium/meta';

export {
  CONSENT_HOWS,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  CONSENT_STATES,
  STOP_REASONS,
  type ConsentEvent,
  type ConsentHow,
  type ConsentPerson,
  type ConsentPurpose,
  type ConsentSource,
  type ConsentState,
  type StopReason,
} from '@adminium/meta';

/** A staff member, as an event or an entry names them. */
export interface StaffMember {
  id: string;
  label: string;
}

/** Who a question is about: a row, an address, or both (at least one). */
export interface ConsentWho {
  person?: ConsentPerson | null | undefined;
  /** As typed: it is trimmed and put in lower case, and nothing more (`normaliseAddress`). */
  address?: string | null | undefined;
}

/** One yes or no, as a door records it. */
export interface ConsentRecordInput extends ConsentWho {
  purpose: ConsentPurpose;
  source: ConsentSource;
  /** A form's or a relay's name, or a fixed word: `before-records`, `send-review`, `one-click`, `link`. */
  detail?: string | null | undefined;
  /** Staff only: how the person agreed, and a note. */
  how?: ConsentHow | null | undefined;
  note?: string | null | undefined;
  /** The staff member who recorded it; required for a `staff` or `review` event, empty for every other source. */
  staff?: StaffMember | null | undefined;
  /** The words the person was shown, and their version. */
  wording?: { text: string; version: string } | null | undefined;
  /** A public sign-up's network address and browser. */
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  /** When a sign-up was confirmed by e-mail. */
  confirmedAt?: number | null | undefined;
  /** When it happened; now when left out. */
  at?: number | undefined;
}

/** A person's standing for one purpose: their latest yes or no, or never asked. */
export interface ConsentStanding {
  purpose: ConsentPurpose;
  state: 'yes' | 'no' | 'not-asked';
  /** The event that set it; null when never asked. */
  event: ConsentEvent | null;
}

/** A stop-list entry as the do-not-email page shows it. */
export interface StopEntryView {
  id: string;
  /** The address; null once its person was erased (the hash alone is kept). */
  address: string | null;
  reason: StopReason;
  /** Where from: a relay's, a campaign's or an app's name. */
  origin: string | null;
  addedAt: number;
  addedBy: StaffMember | null;
  erasedAt: number | null;
}

export interface StopAddInput {
  address: string;
  reason: StopReason;
  origin?: string | null | undefined;
  staff?: StaffMember | null | undefined;
  at?: number | undefined;
}

/** What taking an entry off the list did. An erased person's entry is never taken off. */
export type StopRemoveResult = 'removed' | 'missing' | 'erased';

/** What the erasure did to an address's entry. */
export type EraseDisplayResult = 'erased' | 'added' | 'missing';

/** A page of the do-not-email list. `next` continues it; null at the end. */
export interface StopListPage {
  entries: StopEntryView[];
  next: string | null;
}

/**
 * The declared yes/no column a log event is mirrored into: a row of a source
 * table, named explicitly. Which column mirrors which purpose is the people
 * declaration's to say; this door only writes it.
 */
export interface ConsentColumnTarget {
  connectionId: string;
  /** The table's snapshot id or name, as the record pages name it. */
  table: string;
  /** The row's key, as `pkLabel` writes it. */
  key: string;
  column: string;
  /** Columns never stamped here, whatever their trigger: the table's opt-out mark, which only a screen sets. */
  keep?: readonly string[] | undefined;
}

/** What `applyToColumn` did: wrote the column and its stamps, found it already so, or found no row. */
export type ApplyColumnResult = 'written' | 'unchanged' | 'missing';

export interface ConsentService {
  /** Add a yes or a no. */
  record(input: ConsentRecordInput & { state: 'yes' | 'no' }): Promise<ConsentEvent>;
  /** Add a no: the person withdrew (a link, a bounce, a staff member, the send review). */
  withdraw(input: ConsentRecordInput): Promise<ConsentEvent>;
  /** A person's standing for a purpose: by their row, their address, or both. */
  stateFor(who: ConsentWho, purpose: ConsentPurpose): Promise<ConsentStanding>;
  /** `stateFor` for many people at once, in the order given: one key read and a few queries for a whole page. */
  statesAmong(who: readonly ConsentWho[], purpose: ConsentPurpose): Promise<ConsentStanding[]>;
  /** Their events, newest first (at most `limit`, 100 by default). */
  history(who: ConsentWho, opts?: { limit?: number | undefined }): Promise<ConsentEvent[]>;
  /** Whether the log holds any yes or no for this row (for `purpose`, or any): the first-send review asks the others. */
  askedOnce(person: ConsentPerson, purpose?: ConsentPurpose): Promise<boolean>;
  /** The same, for many rows of one table at once: the keys that were asked. */
  askedAmong(connectionId: string, table: string, keys: readonly string[], purpose?: ConsentPurpose): Promise<Set<string>>;
  /** They replied to a marketing e-mail: a "replied" row, which stops their sequences. */
  markReplied(who: ConsentWho & { staff: StaffMember; at?: number | undefined }): Promise<ConsentEvent>;
  /** When they last replied; null when never. A sequence step re-checks it at its own send time. */
  lastReplied(who: ConsentWho): Promise<number | null>;
  /** The erasure: every event of the row, and of its address when given. */
  deleteForPerson(who: ConsentWho): Promise<number>;
  /**
   * The erasure: the entry keeps its hash and loses the address. With
   * `addIfMissing`, an address not on the list is put on it, hash alone,
   * with the reason `erased`.
   */
  eraseDisplay(address: string, opts?: { addIfMissing?: boolean | undefined; at?: number | undefined }): Promise<EraseDisplayResult>;
  /** Mirror a log event into a declared yes/no column and its stamps, as the system, in one statement. */
  applyToColumn(target: ConsentColumnTarget, event: ConsentEvent): Promise<ApplyColumnResult>;
  stop: {
    add(input: StopAddInput): Promise<{ entry: StopEntryView; added: boolean }>;
    remove(id: string): Promise<StopRemoveResult>;
    has(address: string): Promise<boolean>;
    /** Which of these addresses are on the list, as `normaliseAddress` spells them. */
    stoppedAmong(addresses: readonly string[]): Promise<Set<string>>;
    /** The entry an address is on, or null. */
    entryFor(address: string): Promise<StopEntryView | null>;
    get(id: string): Promise<StopEntryView | null>;
    /** How many entries there are (for `reason`, or all). */
    count(reason?: StopReason): Promise<number>;
    /** Newest first. `q` finds addresses holding it; `reason` narrows. */
    list(opts: { q?: string | undefined; reason?: StopReason | undefined; limit: number; cursor?: string | null | undefined }): Promise<StopListPage>;
  };
}
