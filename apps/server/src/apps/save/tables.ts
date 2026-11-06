// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `requiredSchema` (tables, columns, types, keys, uniques, indexes, foreign keys and links without a constraint, table `name`/`schema`) and `optionLists`, from the model and the connection's overrides.
 */
import type { ConvertPart } from './types.js';

export const convertTables: ConvertPart = async () => ({});
