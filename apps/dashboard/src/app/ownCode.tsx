// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Own code the server's operator keeps off (trial mode, the hosted profile;
 * `apps/server/src/trial/own-code.ts`): uploads of add-ons and apps, uploads and
 * hand edits in the Designer, and builds of an app's own ("Start with an app").
 *
 * Never hidden, always explained: the control that leads there stays where it
 * is, in the tab order, `aria-disabled`, with the operator's reason in the shared
 * Tooltip (on hover and on keyboard focus) or on a line beside it, and it does
 * nothing when used. The server refuses the same thing anyway; this is so a
 * person is told before they try.
 *
 * Only pages that load later import this file: nothing of it is in the first load.
 */
import { useQuery } from '@tanstack/react-query';
import { Tooltip } from '@adminium/ui';
import type { ReactElement, ReactNode } from 'react';

import { systemInfoQuery, type SystemInfo } from './capabilities.js';

export type OwnCodeKind = 'packageUploads' | 'designerUploads' | 'ownBuilds';

/** The operator keeps `kind` off (`/system/info`'s `offByOperator`). False until the server has said. */
export function ownCodeOff(info: Partial<Pick<SystemInfo, 'offByOperator'>> | undefined, kind: OwnCodeKind): boolean {
  return info?.offByOperator?.[kind].allowed === false;
}

export function useOwnCodeOff(kind: OwnCodeKind): boolean {
  return ownCodeOff(useQuery(systemInfoQuery()).data, kind);
}

/** The classes a control kept in the tab order but off reads as off by. */
export const OFF_LOOK = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * `children` (a button that forwards its props to one element) with the
 * operator's reason in a Tooltip while `off`; as it is otherwise. The caller
 * sets `aria-disabled` and ignores a click.
 */
export function OperatorOffTip({ off, why, children }: { off: boolean; why: string; children: ReactElement }): ReactNode {
  return off ? <Tooltip content={why}>{children}</Tooltip> : children;
}
