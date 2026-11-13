// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The keys the entry chunk may not name (`check-entry-budget.mjs`): those of
 * the deferred groups of `common`, every one `COMMON_DEFERRED_GROUPS` lists,
 * so a group made deferred later is guarded the day it is. A bare key
 * (`about.title`) reads `common`, so both spellings are refused. Left out:
 * `reports` and `audit`, whose names are also permissions the first paint may
 * well carry (`reports.manage`, `audit.read`).
 */
import { COMMON_DEFERRED_GROUPS } from '@adminium/i18n/resources';

const PERMISSION_NAMES = new Set(['reports', 'audit']);

export const DEFERRED_COMMON_KEY = new RegExp(
  `['"\`](?:common:)?(${COMMON_DEFERRED_GROUPS.filter((group) => !PERMISSION_NAMES.has(group)).join('|')})\\.[A-Za-z]`,
);
