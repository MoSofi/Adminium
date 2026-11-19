// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A SAVE MAY NOT DO TO FOUND PEOPLE, whichever door it came through (a
 * person's save, a bulk edit, an import, a rule, an API key):
 *
 *  - SWITCH PEOPLE ON before the tell mail could go: a save of an add-on's
 *    settings row that turns `people_on` true while anything the People
 *    switch needs is missing (`people.ts` `peopleSwitchProblems`) is
 *    refused, saying what is missing. The save's own values count: why
 *    they are kept and for how long may be written in the same save. A
 *    keeping time outside 1 to 10 years, or a purpose holding a link, is
 *    refused by itself.
 *  - TICK "MAY BE E-MAILED" ON A FOUND PERSON: a found person is written to
 *    on consent only, and a tick is no record of how they agreed. A save
 *    that turns a declared consent column on, for a row a found person's
 *    row links, is refused: consent is recorded with how they agreed and a
 *    note ("Record consent", `routes/consent`), which writes the column
 *    through the consent log's own door, not through a save.
 *
 * Wrapped around the write service's hooks in `compose.ts`, as the outbox's
 * moves are (`outbox/moves.ts`).
 */
import { leadsOf } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ConnectionManager } from '../connections/manager.js';
import { HookRejectedError, type BeforeWriteEvent, type HookTiming, type RecordHooks, type WriteAction, type WriteTarget } from '../crud/write-service.js';
import type { WriteContext } from '../crud/write-context.js';
import type { MailDoorReachFacts } from '../email/door-reach.js';
import { rowKeyOf } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { plainSentence, storedLeadsAddOns } from './installs.js';
import { foundPersonBy, peopleSwitchProblems, peopleSwitchProblemsData } from './people.js';
import { LEADS_KEEP_YEARS_MAX, LEADS_KEEP_YEARS_MIN } from '@adminium/manifest';

export interface LeadsGuardDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  secret: string;
  reach: MailDoorReachFacts;
  installs: () => Promise<AddOnInstalls>;
}

/** The message a refused switch starts with, naming the add-on as its manifest does. */
export function peopleSwitchRefused(addOnName: string): string {
  return `${addOnName} can’t keep people yet:`;
}
/** The message a refused tick gives, naming the add-on that found the person. */
export function foundTickRefused(addOnName: string): string {
  return `This person was found by ${addOnName}: record how they agreed (Record consent), with a note, before they may be e-mailed.`;
}

const yes = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 't' || value === 'true';

/** The add-on whose settings row a table is, on its database; null for any other table. */
function settingsOf(installs: AddOnInstalls, target: WriteTarget): string | null {
  for (const key of installs.keys?.(target.connectionId) ?? []) {
    const installed = installs.installed(target.connectionId, key);
    if (installed === null || leadsOf(installed.manifest) === null) continue;
    const ref = (installed.manifest.addOn as { settingsTable?: string }).settingsTable;
    if (ref !== undefined && installs.tableOf(target.connectionId, key, ref) === target.table.id) return key;
  }
  return null;
}

/** Whether any add-on on the database finds people. */
function findsPeople(installs: AddOnInstalls, connectionId: string): boolean {
  return (installs.keys?.(connectionId) ?? []).some((key) => {
    const installed = installs.installed(connectionId, key);
    return installed !== null && leadsOf(installed.manifest) !== null;
  });
}

export function withLeadsGuard(inner: RecordHooks, deps: LeadsGuardDeps): RecordHooks {
  /** The declared consent column of a people table, when an add-on on its database finds people. */
  async function consentColumn(target: WriteTarget): Promise<string | null> {
    if (!findsPeople(await deps.installs(), target.connectionId)) return null;
    const declared = await peopleTablesOf(deps.meta).of(target.connectionId, target.view?.model, target.table.id);
    return declared?.kind === 'people' && declared.consent !== null ? declared.consent.column : null;
  }

  async function guarded(action: WriteAction, target: WriteTarget): Promise<boolean> {
    if (action !== 'create' && action !== 'update') return false;
    if (settingsOf(await deps.installs(), target) !== null) return true;
    return action === 'update' && (await consentColumn(target)) !== null;
  }

  async function judgeSwitch(addOnKey: string, event: BeforeWriteEvent): Promise<void> {
    const { values, record } = event;
    const has = (column: string) => Object.prototype.hasOwnProperty.call(values, column);
    if (has('keep_years') && values['keep_years'] !== null) {
      const years = Number(values['keep_years']);
      if (!Number.isInteger(years) || years < LEADS_KEEP_YEARS_MIN || years > LEADS_KEEP_YEARS_MAX) {
        throw new HookRejectedError(`Keep found people for ${String(LEADS_KEEP_YEARS_MIN)} to ${String(LEADS_KEEP_YEARS_MAX)} years.`, 'leads.keep-years');
      }
    }
    if (has('purpose') && values['purpose'] !== null) {
      const parsed = typeof values['purpose'] === 'string' ? safeJson(values['purpose']) : values['purpose'];
      for (const [language, text] of Object.entries(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {})) {
        if (typeof text === 'string' && !plainSentence(text)) throw new HookRejectedError(`Why you keep them is one plain sentence with no links (${language}): it goes in the mail.`, 'leads.purpose');
      }
    }
    const turningOn = has('people_on') && yes(values['people_on']) && !(record !== null && yes(record['people_on']));
    if (!turningOn) return;
    const install = (await storedLeadsAddOns(deps.meta)).find((one) => one.key === addOnKey && one.connectionId === event.target.connectionId);
    if (install === undefined) return;
    const problems = await peopleSwitchProblems(deps, { installId: install.installId }, { ...(record ?? {}), ...values });
    // The English message for a person reading the refusal; `problems` by stable code for an add-on's screen to say in its own words.
    if (problems.length > 0) throw new HookRejectedError(`${peopleSwitchRefused(install.name)} ${problems.map((problem) => problem.message).join(' ')}`, 'leads.people-switch', { problems: peopleSwitchProblemsData(problems) });
  }

  async function judgeTick(column: string, event: BeforeWriteEvent): Promise<void> {
    const { values, record, target } = event;
    if (record === null || !Object.prototype.hasOwnProperty.call(values, column) || !yes(values[column]) || yes(record[column])) return;
    const foundBy = await foundPersonBy(deps, { connectionId: target.connectionId, table: target.table.id, key: rowKeyOf(target.table, record) });
    if (foundBy !== null) throw new HookRejectedError(foundTickRefused(foundBy), 'leads.consent');
  }

  return {
    async wants(timing: HookTiming, action: WriteAction, target: WriteTarget, context: WriteContext): Promise<boolean> {
      if (await inner.wants(timing, action, target, context)) return true;
      return timing === 'before' && (await guarded(action, target));
    },
    async before(event: BeforeWriteEvent): Promise<void> {
      if (await inner.wants('before', event.action, event.target, event.context)) await inner.before(event);
      if (event.action !== 'create' && event.action !== 'update') return;
      const addOnKey = settingsOf(await deps.installs(), event.target);
      if (addOnKey !== null) {
        await judgeSwitch(addOnKey, event);
        return;
      }
      if (event.action !== 'update') return;
      const column = await consentColumn(event.target);
      if (column !== null) await judgeTick(column, event);
    },
    after: (event) => inner.after(event),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
