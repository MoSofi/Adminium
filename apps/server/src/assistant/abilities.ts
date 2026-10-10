// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the assistant may PROPOSE on one page, for one person.
 *
 * Two things have to hold for a kind to be offered: the workspace has
 * switched that ability on, and the person holds the matching right on this
 * page's own table. A kind that is not offered is not in the prompt and not
 * in the reply contract, so a model is never told of a move that cannot work;
 * and a proposal is checked again, as the person, before anything is shown.
 *
 * Nothing here writes, and nothing here is the check: it only decides what
 * is worth offering.
 */
import type { AssistantActionKind } from '@adminium/llm';
import { settingsRepo } from '@adminium/meta';

import { PERMISSIONS } from '../rbac/permissions.js';
import { dataPageOf } from './data-page.js';
import type { AssistantToolDeps } from './types.js';

export interface ProposableKinds {
  kinds: AssistantActionKind[];
  /** The most actions one proposal may hold: the workspace's own number. */
  maxActions: number;
  /** One line for the prompt that says where the kinds apply; absent when nothing is offered. */
  where?: string;
}

const ROW_KINDS = [
  { kind: 'row.create', ability: 'create', action: 'create' },
  { kind: 'row.change', ability: 'change', action: 'update' },
  { kind: 'row.delete', ability: 'delete', action: 'delete' },
] as const;

export async function proposableKindsFor(deps: AssistantToolDeps): Promise<ProposableKinds> {
  const settings = settingsRepo(deps.meta);
  const maxActions = await settings.get('assistant.maxRows');
  const none: ProposableKinds = { kinds: [], maxActions };
  // Nobody to act as: nothing is offered, whatever the switches say.
  if (deps.userId === null) return none;
  const abilities = await settings.get('assistant.abilities');
  // Away from any page (Home, a settings screen): the switches alone decide what is offered.
  // Which table, and whether this person may write it, is the check's to say, in the route's
  // own words: there is no one table here to ask about beforehand.
  if (deps.context === 'general') {
    const kinds = ROW_KINDS.filter((row) => abilities[row.ability]).map((row) => row.kind as AssistantActionKind);
    return kinds.length === 0
      ? none
      : { kinds, maxActions, where: 'Rows can be proposed on a table you have read with describe_schema, by its connectionId and table id. Whether this person may write it is checked before they are shown anything.' };
  }
  if (deps.context !== 'data') {
    // An editor page: its own document, under the same switches, for someone who may save there.
    const manage = deps.context === 'automation' ? PERMISSIONS.automationsManage : PERMISSIONS.settingsManage;
    if (!(await deps.can(manage))) return none;
    const kinds: AssistantActionKind[] = [];
    if (abilities.create) kinds.push('doc.save');
    // Saving over, and deleting, exist for the three kinds of document that have a page of their own.
    if (deps.context === 'email' || deps.context === 'report' || deps.context === 'automation') {
      if (abilities.change && deps.host.documentId !== undefined && deps.host.documentId !== '') kinds.push('doc.change');
      if (abilities.delete) kinds.push('doc.delete');
    }
    // A campaign, to people of this workspace by role: the one send a screen has. (A document
    // sent to its own recipient has a route and no screen, so it is not offered anywhere.)
    if (deps.context === 'email' && abilities.send) kinds.push('send.template');
    if (kinds.length === 0) return none;
    const kind = deps.context === 'email' ? 'email' : deps.context === 'report' ? 'report' : 'rule';
    const where = [
      ...(kinds.includes('doc.delete') ? [`On this page "doc.delete" takes kind ${JSON.stringify(kind)} and the id list_documents returned.`] : []),
      ...(kinds.includes('send.template')
        ? ['"send.template" takes the id of a CAMPAIGN that list_documents returned and the names of the roles to send it to. Ask which roles when the person has not said. You write no mail and no address.']
        : []),
    ];
    return { kinds, maxActions, ...(where.length === 0 ? {} : { where: where.join('\n') }) };
  }

  const page = await dataPageOf(deps);
  if (page === null || page.connectionId === null || page.table === null) return none;

  const kinds: AssistantActionKind[] = [];
  for (const row of ROW_KINDS) {
    if (!abilities[row.ability]) continue;
    if (await deps.can(`table:${page.connectionId}:${page.table}:${row.action}`)) kinds.push(row.kind);
  }
  if (kinds.length === 0) return none;
  return {
    kinds,
    maxActions,
    where: `Rows can be proposed on this page's own table only: connectionId ${JSON.stringify(page.connectionId)}, table ${JSON.stringify(page.table)}.`,
  };
}
