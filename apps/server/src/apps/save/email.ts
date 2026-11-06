// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `emailTemplates` (and `outbox` where one is used): every template another part used (`refs.usedTemplates()`) plus the campaigns chosen; runs LAST.
 */
import type { ConvertPart } from './types.js';

export const convertEmail: ConvertPart = async () => ({});
