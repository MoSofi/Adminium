// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a proposal's card says, worked out from the proposal alone.
 *
 * Pure: no server, no clock, no component. The card's words are OURS, counted
 * from the actions the server checked: a title the model wrote ("Tidy up")
 * is shown as a quiet second line and never as what the button does.
 *
 * Every value drawn here came from the server's own check, made as the person
 * who is looking: what they may not read is not in it.
 */
import { t } from '../i18n/t.js';
import type { AssistantProposal, AssistantProposalAction } from './api.js';
import type { ProposalIcon, ProposalRow } from './parts/ProposalCard.js';

/** The longest a cell is drawn: what the server itself keeps of one for a card. Longer is cut there, with a mark. */
const CELL_MAX = 300;
/** The longest a value may be to be the one sentence of a list ("status → paid on 50 rows"). */
const SHARED_MAX = 32;

/** A stored value as one short piece of text. Nothing here is markup: it is drawn as text. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX - 1)}…` : text;
}

/** A table's name without its schema: `main.orders` is "orders" on a card. */
export function tableName(id: string): string {
  const at = id.lastIndexOf('.');
  return at === -1 ? id : id.slice(at + 1);
}

/** The kinds a card counts and words. */
export type ProposalKind = 'change' | 'add' | 'delete' | 'save' | 'saveOver' | 'deleteDoc' | 'send' | 'other';

export function kindOf(action: AssistantProposalAction): ProposalKind {
  switch (action.do) {
    case 'row.change':
      return 'change';
    case 'row.create':
      return 'add';
    case 'row.delete':
      return 'delete';
    case 'doc.save':
      return 'save';
    case 'doc.change':
      return 'saveOver';
    case 'doc.delete':
      return 'deleteDoc';
    case 'send.template':
      return 'send';
    default:
      return 'other';
  }
}

/** The one kind every action in a list shares, or `mixed`. */
export function sharedKind(actions: readonly AssistantProposalAction[]): ProposalKind | 'mixed' {
  const first = actions[0];
  if (first === undefined) return 'other';
  const kind = kindOf(first);
  return actions.every((action) => kindOf(action) === kind) ? kind : 'mixed';
}

export function iconOf(kind: ProposalKind | 'mixed'): ProposalIcon {
  if (kind === 'add') return 'add';
  if (kind === 'delete' || kind === 'deleteDoc') return 'delete';
  if (kind === 'send') return 'send';
  if (kind === 'save' || kind === 'saveOver') return 'save';
  return 'change';
}

/** What a document is called on a card, by the kind the server names. */
function documentWord(what: string): string {
  switch (what) {
    case 'email':
      return t('assistant:proposal.doc.email', 'email template');
    case 'report':
      return t('assistant:proposal.doc.report', 'report');
    case 'rule':
      return t('assistant:proposal.doc.rule', 'rule');
    case 'invoice':
      return t('assistant:proposal.doc.invoice', 'invoice');
    default:
      return t('assistant:proposal.doc.invoiceTemplate', 'invoice template');
  }
}

/** What the confirm will do, counted from the actions it would carry out. Also the button's label. */
export function askTitle(actions: readonly AssistantProposalAction[]): string {
  const count = actions.length;
  const kind = sharedKind(actions);
  const preview = actions[0]?.preview ?? null;
  if (kind === 'change') return t('assistant:proposal.ask.change', 'Change {count, plural, one {# row} other {# rows}}', { count });
  if (kind === 'add') return t('assistant:proposal.ask.add', 'Add {count, plural, one {# row} other {# rows}}', { count });
  if (kind === 'delete') return t('assistant:proposal.ask.delete', 'Delete {count, plural, one {# row} other {# rows}}', { count });
  if (kind === 'save' && preview?.kind === 'doc.save') return t('assistant:proposal.ask.save', 'Save as a new {what}', { what: documentWord(preview.what) });
  if (kind === 'saveOver' && preview?.kind === 'doc.change') return t('assistant:proposal.ask.saveOver', 'Save over “{name}”', { name: preview.name });
  if (kind === 'deleteDoc') {
    return count === 1 && preview?.kind === 'doc.delete'
      ? t('assistant:proposal.ask.deleteDoc', 'Delete “{name}”', { name: preview.name })
      : t('assistant:proposal.ask.deleteDocs', 'Delete {count, plural, one {# document} other {# documents}}', { count });
  }
  if (kind === 'send' && preview?.kind === 'send.template') {
    return t('assistant:proposal.ask.send', 'Send to {count, plural, one {# person} other {# people}}', { count: preview.total });
  }
  return t('assistant:proposal.ask.mixed', 'Make {count, plural, one {# change} other {# changes}}', { count });
}

/** What a confirmation did, counted from what the server says was done. */
export function doneTitle(actions: readonly AssistantProposalAction[], done: number, asked: number): string {
  const kind = sharedKind(actions);
  const preview = actions[0]?.preview ?? null;
  if (done < asked) {
    return kind === 'change'
      ? t('assistant:proposal.done.changePart', 'Changed {done} of {count, plural, one {# row} other {# rows}}.', { done, count: asked })
      : t('assistant:proposal.done.part', '{done} of {count, plural, one {# change} other {# changes}} made.', { done, count: asked });
  }
  if (kind === 'change') return t('assistant:proposal.done.change', 'Changed {count, plural, one {# row} other {# rows}}.', { count: done });
  if (kind === 'add') return t('assistant:proposal.done.add', 'Added {count, plural, one {# row} other {# rows}}.', { count: done });
  if (kind === 'delete') return t('assistant:proposal.done.delete', 'Deleted {count, plural, one {# row} other {# rows}}.', { count: done });
  if (kind === 'save' || kind === 'saveOver') return t('assistant:proposal.done.save', 'Saved.');
  if (kind === 'deleteDoc') return t('assistant:proposal.done.deleteDoc', 'Deleted {count, plural, one {# document} other {# documents}}.', { count: done });
  if (kind === 'send' && preview?.kind === 'send.template') {
    return t('assistant:proposal.done.send', 'Sending to {count, plural, one {# person} other {# people}}.', { count: preview.total });
  }
  return t('assistant:proposal.done.mixed', '{count, plural, one {# change} other {# changes}} made.', { count: done });
}

/** A refusal in this app's words where it has them; the server route's own sentence otherwise. */
export function refusalText(refused: { code: string; message: string }, name: string): string {
  switch (refused.code) {
    case 'SWITCHED_OFF':
      return t('assistant:proposal.refused.switchedOff', 'This is switched off for {name} in this workspace.', { name });
    case 'NOT_THIS_TABLE':
      return t('assistant:proposal.refused.notThisTable', 'Only the table of the page this was asked on can be changed from here.');
    case 'NOT_A_DATA_TABLE':
      return t('assistant:proposal.refused.notData', 'That is not a table of your data.');
    case 'NO_CHANGE':
      return t('assistant:proposal.refused.noChange', 'The row already holds these values.');
    case 'UNSAFE_KEY':
      return t('assistant:proposal.refused.unsafeKey', 'That id cannot be used.');
    case 'NOT_FOUND':
      return t('assistant:proposal.refused.notFound', 'This is no longer there.');
    case 'NOT_OFFERED':
      return t('assistant:proposal.refused.notOffered', 'That cannot be done from here.');
    case 'BUILT_IN':
      return t('assistant:proposal.refused.builtIn', 'A built-in mail is changed on its own screen.');
    case 'NOT_A_CAMPAIGN':
      return t('assistant:proposal.refused.notCampaign', 'Only a campaign can be sent to people.');
    case 'NOT_LIVE':
      return t('assistant:proposal.refused.notLive', 'A draft is switched on by a person before it can be sent.');
    case 'NO_RECIPIENTS':
      return t('assistant:proposal.refused.noRecipients', 'Nobody would get this mail.');
    default:
      return refused.message === '' ? t('assistant:proposal.refused.generic', 'The server refused this.') : refused.message;
  }
}

/** The name an action goes by in a list: a row's key, a document's name. */
export function labelOf(action: AssistantProposalAction): { label: string; plain: boolean } {
  const preview = action.preview;
  if (preview !== null && (preview.kind === 'doc.save' || preview.kind === 'doc.change' || preview.kind === 'doc.delete' || preview.kind === 'send.template')) {
    return { label: preview.name === '' ? t('assistant:proposal.row.untitled', 'Untitled') : preview.name, plain: true };
  }
  if (action.do === 'row.create') return { label: t('assistant:proposal.row.new', 'New row'), plain: true };
  return { label: action.id ?? '—', plain: false };
}

/** One action as a row of the card, without its tick: what changes, or why it cannot. */
export function rowOf(action: AssistantProposalAction, index: number, name: string): ProposalRow {
  const { label, plain } = labelOf(action);
  const row: ProposalRow = { id: String(index), label, ...(plain ? { plain: true } : {}) };
  if (action.refused !== null) return { ...row, dim: true, reason: refusalText(action.refused, name) };
  const preview = action.preview;
  if (preview === null) return row;
  if (preview.kind === 'change') {
    return { ...row, changes: Object.keys(preview.after).map((field) => ({ field, before: cellText(preview.before[field]), after: cellText(preview.after[field]) })) };
  }
  if (preview.kind === 'create') {
    const set = Object.entries(preview.after).filter(([, value]) => value !== null && value !== undefined && value !== '');
    // Every value the row would hold: a new row is confirmed whole.
    return { ...row, changes: set.map(([field, value]) => ({ field, before: null, after: cellText(value) })) };
  }
  if (preview.kind === 'delete') {
    // The first few things the row holds, so the person can tell which row it is.
    const told = Object.values(preview.row).filter((value) => typeof value === 'string' && value !== '' && value !== action.id);
    return { ...row, sub: told.slice(0, 2).map(cellText).join(' · ') };
  }
  if (preview.kind === 'doc.change' && preview.switchesOff) {
    return { ...row, sub: t('assistant:proposal.row.switchesOff', 'Saved switched off: switch it on again when you have looked at it.') };
  }
  return row;
}

/**
 * When every row changes the same one column to the same value, the list is
 * one sentence ("status → paid on 50 rows") and each row only says what it
 * held before. `null` for any other list.
 */
export function sharedChange(actions: readonly AssistantProposalAction[]): { field: string; after: string } | null {
  if (actions.length < 2) return null;
  let shared: { field: string; after: string; raw: string } | null = null;
  for (const action of actions) {
    const preview = action.preview;
    if (preview === null || preview.kind !== 'change') return null;
    const fields = Object.keys(preview.after);
    if (fields.length !== 1) return null;
    const field = fields[0] as string;
    // The value itself, not its text: `1` and `"1"`, or nothing and an empty text, are two values.
    const raw = JSON.stringify(preview.after[field] ?? null);
    const after = cellText(preview.after[field]);
    if (after.length > SHARED_MAX) return null;
    if (shared === null) shared = { field, after, raw };
    else if (shared.field !== field || shared.raw !== raw) return null;
  }
  return shared === null ? null : { field: shared.field, after: shared.after };
}

/** What a delete would take with it, as one sentence; `null` when nothing refers to the row. */
export function referencesText(actions: readonly AssistantProposalAction[]): string | null {
  const totals = new Map<string, number>();
  for (const action of actions) {
    if (action.preview?.kind !== 'delete') continue;
    for (const reference of action.preview.references) totals.set(reference.table, (totals.get(reference.table) ?? 0) + reference.count);
  }
  if (totals.size === 0) return null;
  const list = [...totals].map(([table, count]) => t('assistant:proposal.delete.reference', '{count} in {table}', { count, table: tableName(table) })).join(', ');
  return t('assistant:proposal.delete.references', 'Other rows refer to this: {list}. They go or change with it, as on the page’s own delete.', { list });
}

/** What the person is asked to send back when part of a proposal cannot be done. */
export function fixRequest(proposal: AssistantProposal, name: string): string {
  const reasons = proposal.actions
    .map((action, index) => (action.refused === null ? null : `${String(index + 1)}. ${labelOf(action).label}: ${refusalText(action.refused, name)}`))
    .filter((line): line is string => line !== null);
  return t('assistant:proposal.fixAsk', 'Some of that cannot be done. Propose it again without these:\n{reasons}', { reasons: reasons.join('\n') });
}
