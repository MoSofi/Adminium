// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILL IN THE COMPANY: a rule's step that fills a company record's EMPTY
 * details from a lead source add-on's free registers.
 *
 * ─── Why it is held so tightly ─────────────────────────────────────────────
 * A rule runs with nobody watching, and often on a row a stranger made (a
 * form's enquiry, a chat). So the step:
 *  - asks only the FREE REGISTERS the rule names (a source that fills in a
 *    company, costs the owner nothing, and finds no people): never a paid
 *    source, never a people source, and never a website: nothing a stranger
 *    typed ever becomes an address this server fetches;
 *  - looks up by the company number, else by the name and the town, as the
 *    record holds them;
 *  - fills only the fields that are EMPTY: nothing a person typed is changed;
 *  - takes the one company a register finds; several, or none, is a line in
 *    the run log, and nothing is written;
 *  - spends from its own daily budget on each source (`STEP_SPENDER`, 50
 *    calls a day, never above a capped source's day), so a form posted all
 *    night cannot spend the owner's day.
 *
 * Each field it fills is noted in the add-on's fields' sources, as a fill
 * from the record page is, so the page says where it came from.
 */
import { parseLeadSourceAnswer } from '@adminium/add-on-contracts';
import { manifestsRepo, type AutomationAction } from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../../add-ons/credential-crypto.js';
import { installOnConnection } from '../../installs/resolve.js';
import { STEP_SPENDER } from '../../lead-sources/caps.js';
import { installManifest, withLeadSource, type LeadSourceDeps } from '../../lead-sources/call.js';
import { storedTableRef, tableRefIndex } from '../../apps/table-ref.js';
import { companiesTablesOn } from '../../leads/companies.js';
import { leadsInstall } from '../../leads/people.js';
import { freeRegisters } from '../../leads/registers.js';
import { leadColumns, noteFieldSources, shownText, writesFor, type LeadField } from '../../leads/write.js';
import { rowKeyOf } from '../../payments/payables.js';
import { sourceOf, updateRecordAsRule } from './record-write.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type CompanyFillAction = Extract<AutomationAction, { kind: 'company.fill' }>;

/** What the step reaches a lead source add-on with. */
export interface CompanyFillDeps {
  /** One call to one source (`lead-sources/call.ts`), with the add-on runtime, the keys and the operator's switches. */
  call: Omit<LeadSourceDeps, 'meta'>;
  /** Whether this server calls anything outside at all. */
  networkFeatures: () => boolean;
}

/** How long a rule waits for one register. */
const STEP_CALL_MS = 30_000;

/** What the step works on: the add-on, the companies table the record is a row of, its empty fields, the registers to ask. */
async function planOf(action: CompanyFillAction, ctx: ActionContext) {
  if (action.addOn === '') throw new ActionFailure('This step has no add-on chosen.');
  if (ctx.source === null) throw new ActionFailure('Filling in a company needs a record; this rule ran on a schedule.');
  const source = sourceOf(ctx);
  const name = action.addOnName === '' ? action.addOn : action.addOnName;
  const manifests = manifestsRepo(ctx.meta, addOnCredentialCryptoFromSecret(ctx.secret));
  const install = await installOnConnection(manifests, action.addOn, source.connectionId);
  const manifest = install === null ? null : installManifest(install);
  if (install === null || manifest === null || install.row.status !== 'installed') throw new ActionFailure(`${name} is not installed here.`);
  const companies = (await companiesTablesOn(ctx.meta, source.connectionId, source.view)).find((one) => one.table.id === source.table.id);
  if (companies === undefined) throw new ActionFailure('This rule’s table keeps no companies.');
  // Free registers only, in the order the rule names them: never a paid source, a people source or the website.
  const free = freeRegisters(manifest);
  const registers = action.sources.map((id) => free.find((entry) => entry.id === id)).filter((entry) => entry !== undefined);
  if (registers.length === 0) throw new ActionFailure(`None of the registers this step asks is a free register of ${name}.`);
  const columns = leadColumns(companies);
  const empty = (Object.keys(columns) as LeadField[]).filter((field) => {
    const shown = shownText(source.row[columns[field]!]);
    return shown === null || shown === '';
  });
  const text = (field: LeadField): string | undefined => {
    const column = columns[field];
    const shown = column === undefined ? null : shownText(source.row[column]);
    return shown === null || shown === '' ? undefined : shown;
  };
  return { source, install, companies, registers, empty, text };
}

export async function runCompanyFillAction(action: CompanyFillAction, ctx: ActionContext): Promise<ActionResult> {
  const deps = ctx.leadSources?.();
  if (deps === undefined) throw new ActionFailure('This deployment cannot fill in companies: no company finder is wired.');
  const plan = await planOf(action, ctx);
  if (plan.empty.length === 0) return { log: ctx.text.companyNothingEmpty() };
  const number = plan.text('number');
  const name = plan.text('name');
  if (number === undefined && name === undefined) return { log: ctx.text.companyNothingToAsk() };
  if (!deps.networkFeatures() || deps.call.policy?.allows('addOnHttp').allowed === false) return { log: ctx.text.companyOffline() };
  const country = plan.text('country');
  const query = {
    ...(number === undefined ? { name: name!, ...(plan.text('town') === undefined ? {} : { town: plan.text('town')! }) } : { number }),
    ...(country !== undefined && /^[A-Z]{2}$/.test(country) ? { country } : {}),
  };

  const notes: string[] = [];
  for (const register of plan.registers) {
    const answer = await withLeadSource(
      { ...deps.call, meta: ctx.meta },
      { install: plan.install, source: register.id, spender: STEP_SPENDER, signal: AbortSignal.timeout(STEP_CALL_MS) },
      async (made) => {
        const work = made.fillCompany?.(query);
        if (work === undefined) return { ok: false as const, code: 'INVALID_REQUEST' as const, message: `${register.id} does not fill in a company.` };
        return parseLeadSourceAnswer('fillCompany', await work).answer;
      },
    );
    if (!answer.ok) {
      if (answer.code === 'NOT_FOUND') notes.push(ctx.text.companyNone(register.id));
      else if (answer.code === 'DAILY_CAP' || answer.code === 'PERSON_SHARE') notes.push(ctx.text.companyBudget(register.id, 'cap' in answer && typeof answer.cap === 'number' ? answer.cap : 50));
      else notes.push(ctx.text.companyRefused(register.id, answer.message.slice(0, 200)));
      continue;
    }
    if (answer.companies.length === 0) {
      notes.push(ctx.text.companyNone(register.id));
      continue;
    }
    if (answer.companies.length > 1) {
      notes.push(ctx.text.companySeveral(register.id, answer.companies.length));
      continue;
    }
    // The one company: only the fields that are empty, in their columns' shape.
    const { ref: _ref, natural: _natural, noMarketing: _noMarketing, officers: _officers, ...facts } = answer.companies[0]!;
    const writes = writesFor(plan.companies, facts, plan.empty);
    if (writes.length === 0) {
      notes.push(ctx.text.companyFilled(0, register.id));
      return { log: notes.join(' · ') };
    }
    const stored = await updateRecordAsRule(ctx, Object.fromEntries(writes.map((write) => [write.column, write.value])));
    const leads = await leadsInstall({ meta: ctx.meta, manager: ctx.manager, viewFor: async () => plan.source.view }, plan.install.row.id);
    if (leads !== null && ctx.writes !== undefined) {
      const index = await tableRefIndex(ctx.meta, plan.source.connectionId, plan.source.view.model);
      await noteFieldSources(
        { manager: ctx.manager, writes: ctx.writes },
        {
          addOn: leads.addOn,
          view: plan.source.view,
          tableRef: storedTableRef(index, plan.source.table.id),
          rowKey: rowKeyOf(plan.source.table, stored),
          columns: writes.map((write) => ({ column: write.column, source: register.id })),
          stored,
          at: ctx.now,
        },
      );
    }
    notes.push(ctx.text.companyFilled(writes.length, register.id));
    return { log: notes.join(' · ') };
  }
  return { log: notes.join(' · ') };
}

export async function dryRunCompanyFillAction(action: CompanyFillAction, ctx: ActionContext): Promise<ActionResult> {
  const plan = await planOf(action, ctx);
  if (plan.empty.length === 0) return { log: ctx.text.companyNothingEmpty() };
  if (plan.text('number') === undefined && plan.text('name') === undefined) return { log: ctx.text.companyNothingToAsk() };
  // Nothing is asked of any register: a test spends nothing of the day.
  return { log: ctx.text.companyWould(plan.empty.length, plan.registers.map((entry) => entry.id).join(', ')) };
}
