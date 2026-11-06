// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `instance`, the deployment-wide part, written only
 * when the person chose it (`choices.instance`): the look, the languages, the
 * wording somebody changed, the system emails somebody edited, and plain
 * settings from the allow-list. Never any part of a secret setting.
 */
import type { ConvertPart } from './types.js';

export const convertInstance: ConvertPart = async () => ({});
