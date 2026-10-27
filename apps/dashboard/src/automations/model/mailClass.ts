// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule's e-mail steps as kinds of mail: what the step's inspector shows and
 * what the canvas says under each step.
 *
 * Only a mail to the record's own address (`to.kind` `field`) is marketing or
 * service; a mail to staff, to the people listed on a record or to typed
 * addresses has no kind. A step that says none goes as service mail, as the
 * runner sends it and as an app built for an older Adminium means it
 * (`@adminium/manifest` `mailClassOf`). A new step to the record's address
 * starts as marketing mail about the newsletter, as the comp draws it.
 *
 * Every marketing mail is checked again when it goes. The canvas says so on
 * the second and later marketing mails of a path (the first is the one the
 * rule was started for); a mail in one branch does not count for the other.
 */
import type { Action, BranchChildNode, FlowNode, Graph, MailClass, MailPurpose } from './graph.js';

type EmailAction = Extract<Action, { kind: 'email' }>;

/** The kind a step is sent as: null for a mail that has none (to staff, listed people, typed addresses, or nobody yet). */
export function mailClassOf(action: EmailAction): MailClass | null {
  if (action.to?.kind !== 'field') return null;
  return action.class ?? 'service';
}

/** Whether the step says no kind of its own and goes as service mail because it was saved before steps could say. */
export function classUnsaid(action: EmailAction): boolean {
  return action.to?.kind === 'field' && action.class === undefined;
}

/** The step's purpose: the one it says, else the newsletter. Null unless it is marketing mail. */
export function purposeOf(action: EmailAction): MailPurpose | null {
  return mailClassOf(action) === 'marketing' ? (action.purpose ?? 'newsletter') : null;
}

/** The patch that changes where the step goes, with the kind that fits it: a mail to the record's address starts as marketing. */
export function recipientPatch(action: EmailAction, to: EmailAction['to']): Partial<EmailAction> {
  if (to?.kind === 'field') {
    if (action.to?.kind === 'field') return { to };
    return { to, class: 'marketing', purpose: 'newsletter' };
  }
  return { to, class: undefined, purpose: undefined };
}

/** The patch that changes its kind: service mail says no purpose. */
export function classPatch(value: MailClass, action: EmailAction): Partial<EmailAction> {
  return value === 'marketing' ? { class: 'marketing', purpose: action.purpose ?? 'newsletter' } : { class: 'service', purpose: undefined };
}

const isMarketingMail = (node: FlowNode | BranchChildNode): boolean => node.kind === 'action' && node.action.kind === 'email' && mailClassOf(node.action) === 'marketing';

/** The marketing mails that come after another marketing mail on their path: the ones the canvas says are checked again. */
export function laterMarketingMails(graph: Graph): Set<string> {
  const later = new Set<string>();
  let before = false;
  for (const node of graph.nodes) {
    if (node.kind === 'branch') {
      let any = false;
      for (const branch of node.branches) {
        let inBranch = before;
        for (const child of branch.nodes) {
          if (!isMarketingMail(child)) continue;
          if (inBranch) later.add(child.id);
          inBranch = true;
          any = true;
        }
      }
      before = before || any;
      continue;
    }
    if (!isMarketingMail(node)) continue;
    if (before) later.add(node.id);
    before = true;
  }
  return later;
}
