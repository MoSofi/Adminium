// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "FILL IN THE COMPANY", AS THE BUILDER READS IT.
 *
 * Offered while a lead source add-on is installed on the rule's database and
 * the rule's table is one it fills (a declared companies table). The step
 * keeps the add-on and the registers to ask; which registers there are, and
 * whether each is still a free one, is read from `Sources` (the server
 * judges it again at every run).
 */
import { t } from '../../i18n/t.js';
import type { CompanyFillSource, Sources } from '../api.js';
import type { Action } from './graph.js';
import type { StepDefinition } from './ops.js';

export type CompanyFillAction = Extract<Action, { kind: 'company.fill' }>;

/** The lead source add-ons on a database that may fill companies in a table. */
export function companyFillSourcesOf(sources: Sources | null, connectionId: string | null, table: string | null): CompanyFillSource[] {
  if (sources === null || connectionId === null || table === null) return [];
  const here = sources.connections.find((connection) => connection.id === connectionId)?.companyFill ?? [];
  return here.filter((one) => one.tables.includes(table));
}

/** The one a step names, as installed now; null when it is gone. */
export function companyFillSourceOf(sources: Sources | null, connectionId: string | null, action: CompanyFillAction): CompanyFillSource | null {
  if (sources === null || connectionId === null) return null;
  return (sources.connections.find((connection) => connection.id === connectionId)?.companyFill ?? []).find((one) => one.addOn === action.addOn) ?? null;
}

/** The picker's tiles: one per add-on that may fill the rule's table, with its first free register ticked. */
export function companyFillTiles(sources: Sources | null, connectionId: string | null, table: string | null): StepDefinition[] {
  return companyFillSourcesOf(sources, connectionId, table).map((one) => ({
    key: `company-fill:${one.addOn}`,
    kind: 'action',
    icon: 'puzzle',
    label: t('automations:companyFill.label', 'Fill in the company'),
    sub: '',
    desc: t('automations:companyFill.desc', 'Empty details, from free registers'),
    addOnName: one.addOnName,
    action: { kind: 'company.fill', addOn: one.addOn, sources: one.registers.slice(0, 1), addOnName: one.addOnName },
  }));
}
