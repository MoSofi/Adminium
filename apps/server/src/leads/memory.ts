// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A SOURCE ANSWERED ONE PERSON, KEPT A WHILE FOR THEIR NEXT CLICK.
 *
 * The lead door writes only what a source said, never what a page sends
 * back: "Add" names the companies a search found by their source's own id,
 * "Fill in" names the fields a look-up found, "Keep" names the people a
 * search found by their address. The door finds each in what it kept of the
 * answer, already parsed and made plain, so a page cannot slip in a value,
 * clear a "no sales contact" flag or make a sole trader a company.
 *
 * Kept per install and person, in this process only, for an hour after the
 * answer, at most {@link MEMORY_ITEMS_MAX} things per person (the oldest go
 * first). Something no longer kept is asked for again ("Search again").
 *
 * It also keeps what an add answered for each retry key, for a table that
 * keeps none of its own: an add sent again after a reply that never came
 * answers what the first one did, and adds nothing twice.
 */
import type { CompanyFacts, FoundCompany, FoundPerson } from '@adminium/add-on-contracts';

/** How long an answer is kept for the next click. */
export const MEMORY_TTL_MS = 60 * 60 * 1000;
/** The most things kept per person and install. */
export const MEMORY_ITEMS_MAX = 2000;

interface Kept<T> {
  value: T;
  at: number;
}

/** What an add answered for one company. */
export interface AddedAnswer {
  ref: string;
  outcome: 'added' | 'refused';
  key?: string | undefined;
  reason?: string | undefined;
  message?: string | undefined;
}

export class FoundMemory {
  readonly #items = new Map<string, Map<string, Kept<unknown>>>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  #shelf(owner: string): Map<string, Kept<unknown>> {
    let shelf = this.#items.get(owner);
    if (shelf === undefined) {
      shelf = new Map();
      this.#items.set(owner, shelf);
    }
    return shelf;
  }

  #put(owner: string, key: string, value: unknown): void {
    const shelf = this.#shelf(owner);
    shelf.delete(key);
    shelf.set(key, { value, at: this.#now() });
    // The oldest first: a Map keeps the order things were put in.
    while (shelf.size > MEMORY_ITEMS_MAX) shelf.delete(shelf.keys().next().value!);
  }

  #get<T>(owner: string, key: string): T | null {
    const kept = this.#items.get(owner)?.get(key);
    if (kept === undefined) return null;
    if (this.#now() - kept.at > MEMORY_TTL_MS) {
      this.#items.get(owner)?.delete(key);
      return null;
    }
    return kept.value as T;
  }

  /** Whose memory: one person, on one install. */
  static owner(installId: string, staffId: string): string {
    return `${installId}\u0000${staffId}`;
  }

  rememberCompanies(owner: string, source: string, companies: readonly FoundCompany[]): void {
    for (const company of companies) this.#put(owner, `company\u0000${source}\u0000${company.ref}`, company);
  }

  company(owner: string, source: string, ref: string): FoundCompany | null {
    return this.#get<FoundCompany>(owner, `company\u0000${source}\u0000${ref}`);
  }

  /** What a look-up found for one record from one source: the one match, or the facts the website gave. */
  rememberFacts(owner: string, record: string, source: string, facts: CompanyFacts): void {
    this.#put(owner, `facts\u0000${record}\u0000${source}`, facts);
  }

  facts(owner: string, record: string, source: string): CompanyFacts | null {
    return this.#get<CompanyFacts>(owner, `facts\u0000${record}\u0000${source}`);
  }

  rememberPeople(owner: string, record: string, source: string, people: readonly FoundPerson[]): void {
    for (const person of people) this.#put(owner, `person\u0000${record}\u0000${source}\u0000${person.email.trim().toLowerCase()}`, person);
  }

  person(owner: string, record: string, source: string, email: string): FoundPerson | null {
    return this.#get<FoundPerson>(owner, `person\u0000${record}\u0000${source}\u0000${email.trim().toLowerCase()}`);
  }

  rememberAdded(owner: string, retryKey: string, answer: AddedAnswer): void {
    this.#put(owner, `added\u0000${retryKey}`, answer);
  }

  added(owner: string, retryKey: string): AddedAnswer | null {
    return this.#get<AddedAnswer>(owner, `added\u0000${retryKey}`);
  }
}
