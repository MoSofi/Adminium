// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "The operator has switched this off": a CHOICE the installation does not
 * offer (trial mode, the hosted profile), drawn disabled with the operator's
 * reason, never hidden ("never hide, always explain").
 *
 * The sibling of `SetByOperator.tsx`, which draws a SETTING the operator
 * decides. The server says what is off in `/system/info` (`offByOperator`),
 * which the first-run wizard can read before anyone signs in, and refuses the
 * action itself with 403 `OFF_BY_OPERATOR` (`details.question`), which
 * {@link offByOperatorText} turns into the same sentence.
 *
 * A disabled choice stays in the tab order with `aria-disabled` (a native
 * `disabled` would take it out of reach of a keyboard and of the tooltip),
 * ignores a pick, and carries the reason twice: in the shared `Tooltip`, for
 * a pointer and keyboard focus, and in a line under it, for touch. Its words
 * are the deferred `operatorSwitches` group of `common`: every screen here is
 * lazy, so none of them reaches the entry chunk.
 */
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { systemInfoQuery, type OperatorSwitch, type OperatorSwitchName } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { SetByOperatorChip } from './SetByOperator.js';

export type { OperatorSwitchName };

/**
 * The questions the server's `OFF_BY_OPERATOR` names, and the words for each.
 * A question with no words of its own is said by its `reason`, else as a
 * plain "switched off".
 */
export function offByOperatorWords(question: string, reason?: string): string {
  switch (question) {
    case 'sqliteSources':
      return t('operatorSwitches.sqlite', 'This installation does not open SQLite files: the operator allows only database servers.');
    case 'unlistedDatabaseHosts':
      return t('operatorSwitches.unlistedHost', 'This installation connects only to the database hosts its operator allows.');
    case 'anyDatabaseLogin':
      return t('operatorSwitches.otherLogin', 'On this database host, only the login and database the operator gave this installation work.');
    case 'metaStoreRoutes':
      return t('operatorSwitches.metaFixed', 'The operator decides where this installation keeps its own data.');
    case 'storageDestinations':
      return t('operatorSwitches.storage', 'The operator keeps this installation’s files on its own disk, so no other destination can be added or tested.');
    case 'webhooks':
      return t('operatorSwitches.webhooks', 'The operator has switched webhook steps off for this installation.');
    case 'customAiProviders':
      return t('operatorSwitches.aiProvider', 'The operator allows only your own key to Anthropic, OpenAI or Google on this installation.');
    case 'aiBaseUrl':
      return t('operatorSwitches.aiAddress', 'The operator does not allow an AI address of your own on this installation.');
    case 'paymentProviders':
      return t('operatorSwitches.payments', 'The operator has switched payment services off for this installation.');
    case 'payPages':
      return t('operatorSwitches.payPages', 'The operator has switched pay pages off for this installation.');
    case 'paymentWebhooks':
      return t('operatorSwitches.paymentWebhooks', 'The operator does not let payment services call this installation.');
    case 'mappedDomains':
      return t('operatorSwitches.mappedDomains', 'Only the domains the operator listed can point to this installation.');
    case 'marketingCampaigns':
      return t('operatorSwitches.marketingCampaigns', 'The operator has switched marketing campaigns off for this installation.');
    case 'liftMailHold':
      return t('operatorSwitches.liftMailHold', 'On this installation, today’s bounces and spam reports stay on the do-not-email list until tomorrow.');
    case 'customerScreensOnOperatorAi':
      return t('operatorSwitches.customerScreens', 'The AI that comes with this installation builds dashboards only. Screens for customers need your own AI key.');
    // Own code: uploads, the Designer's code and builds of one's own.
    case 'packageUploads':
      return t('operatorSwitches.packageUploads', 'The operator installs add-ons and apps only from the catalog on this installation, so uploads are off.');
    case 'designerUploads':
      return t('operatorSwitches.designerUploads', 'The operator has switched uploads to the Designer off for this installation.');
    case 'designerCode':
      return t('operatorSwitches.designerCode', 'The operator has switched code of your own off for this installation: the Designer builds from settings only.');
    case 'ownBuilds':
      return t('operatorSwitches.ownBuilds', 'The operator has switched builds of your own off for this installation.');
    case 'designerNetwork':
      return t('operatorSwitches.designerNetwork', 'The operator has switched picture search and Figma off for this installation.');
    case 'userMail':
      return t('operatorSwitches.userMail', 'This trial has ended, so this installation sends no more email.');
    // A trial's size caps: a limit passed, not a switch.
    case 'dataOverCap':
      return t('operatorSwitches.dataOverCap', 'This database is over the trial’s size limit, so it is read-only. Delete some rows to continue.');
    case 'storageOverCap':
      return t('operatorSwitches.storageOverCap', 'This installation’s files are over the trial’s limit, so nothing more can be stored. Delete some files to continue.');
    case 'extraSourceConnections':
      return t('operatorSwitches.extraSources', 'A trial connects at most 3 databases. Remove one to connect another.');
    case 'writes':
      return t('trial.readOnly', 'Read-only: this trial has ended');
    default:
      return offByOperatorReason(reason);
  }
}

/** A refusal said by its reason alone: for a question the dashboard has no words of its own for. */
function offByOperatorReason(reason: string | undefined): string {
  switch (reason) {
    case 'operator-ai-only':
      return t('operatorSwitches.reasonOperatorAiOnly', 'On this installation, AI runs on the operator’s connection unless you add your own key to Anthropic, OpenAI or Google.');
    case 'operator-ai-scope':
      return t('operatorSwitches.reasonOperatorAiScope', 'The AI that comes with this installation builds dashboards only.');
    case 'not-allowed':
      return t('operatorSwitches.reasonNotAllowed', 'The operator does not allow this on this installation.');
    default:
      return t('operatorLock.lockedOff', 'The operator has switched this off for this installation.');
  }
}

/** The installation's connection-test budget spent (429 `RATE_LIMITED`, scope `instance`): how long to wait. */
export function testBudgetWords(limit: number, seconds: number): string {
  return t(
    'operatorSwitches.testBudget',
    'This installation has tested {limit} database connections in the last minute. Wait {seconds, plural, one {# second} other {# seconds}} and try again.',
    { limit, seconds },
  );
}

/** The sentence for a refusal the operator's switch caused, or null for any other error. */
export function offByOperatorText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'OFF_BY_OPERATOR') return null;
  const details = error.details as { question?: unknown; reason?: unknown } | null | undefined;
  return offByOperatorWords(typeof details?.question === 'string' ? details.question : '', typeof details?.reason === 'string' ? details.reason : undefined);
}

const OPEN: OperatorSwitch = { allowed: true, reason: null };
/** Never asked: the client a screen outside any provider is given, so the hook can always be called. */
const STANDALONE = new QueryClient();

/** Whether the operator switched `name` off, from `/system/info`. A server older than trial mode says nothing: open. */
export function useOperatorSwitch(name: OperatorSwitchName): { off: boolean; reason: string } {
  // The words this answer is drawn with are a deferred group: in before it paints.
  useCommonWords();
  // A screen rendered without a query client (a step's own unit test) reads nothing: open, as an older server.
  const client = useContext(QueryClientContext);
  const info = useQuery({ ...systemInfoQuery(), enabled: client !== undefined }, client ?? STANDALONE).data;
  const switches = info?.offByOperator;
  const answer = switches?.[name] ?? OPEN;
  return { off: !answer.allowed, reason: offByOperatorWords(name) };
}

/** A control the operator switched off: the shared Tooltip with the reason, around a child that carries `aria-disabled`. */
export function OffByOperatorTip({ off, reason, children }: { off: boolean; reason: string; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  if (!off) return children;
  // Open for as long as the choice holds focus. A radio group "clicks" the item an arrow key lands on, and a
  // tooltip closes on a click, so a keyboard user would otherwise lose the reason as soon as it showed. Esc
  // still closes it.
  return (
    <span
      className="contents"
      onFocus={() => {
        focused.current = true;
        setOpen(true);
      }}
      onBlur={() => {
        focused.current = false;
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <Tooltip content={reason} open={open} onOpenChange={(next) => (next || !focused.current ? setOpen(next) : undefined)}>
        {children}
      </Tooltip>
    </span>
  );
}

/** The line under a switched-off choice: the chip and the reason, for touch and for `aria-describedby`. */
export function OffByOperatorNote({ id, reason }: { id: string; reason: string }): ReactNode {
  return (
    <p id={id} className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted" data-testid="off-by-operator-note">
      <SetByOperatorChip />
      <span>{reason}</span>
    </p>
  );
}
