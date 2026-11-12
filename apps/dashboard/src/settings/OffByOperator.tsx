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
import { useContext, type ReactNode } from 'react';
import { Tooltip } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { systemInfoQuery, type OperatorSwitch } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { SetByOperatorChip } from './SetByOperator.js';

export type OperatorSwitchName = 'sqliteSources' | 'storageDestinations' | 'webhooks' | 'metaStore';

/** The questions the server's `OFF_BY_OPERATOR` names, and the words for each. */
export function offByOperatorWords(question: string): string {
  switch (question) {
    case 'sqliteSources':
      return t('operatorSwitches.sqlite', 'This installation does not open SQLite files: the operator allows only database servers.');
    case 'unlistedDatabaseHosts':
      return t('operatorSwitches.unlistedHost', 'This installation connects only to the database hosts its operator allows.');
    case 'anyDatabaseLogin':
      return t('operatorSwitches.otherLogin', 'On this database host, only the login and database the operator gave this installation work.');
    case 'metaStoreRoutes':
    case 'metaStore':
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
    default:
      return t('operatorLock.lockedOff', 'The operator has switched this off for this installation.');
  }
}

/** The sentence for a refusal the operator's switch caused, or null for any other error. */
export function offByOperatorText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'OFF_BY_OPERATOR') return null;
  const question = (error.details as { question?: unknown } | null | undefined)?.question;
  return offByOperatorWords(typeof question === 'string' ? question : '');
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
  if (!off) return children;
  return <Tooltip content={reason}>{children}</Tooltip>;
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
