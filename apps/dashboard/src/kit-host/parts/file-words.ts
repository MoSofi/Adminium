// SPDX-License-Identifier: AGPL-3.0-only
/** A refused upload, in the reader's words: the kit's file parts share them. */
import type { FileRefusal } from '../file-client.js';

type Translate = (key: string, fallback: string, args?: Record<string, unknown>) => string;

export function refusalWords(t: Translate, reason: FileRefusal): string {
  switch (reason) {
    case 'tooLarge':
      return t('ui:widgets.files.tooLarge', 'This file is too large for this field.');
    case 'wrongType':
      return t('ui:widgets.files.wrongType', 'This kind of file is not taken here.');
    case 'notAllowed':
      return t('ui:widgets.files.notAllowed', 'You may not add files here.');
    case 'notSent':
    default:
      return t('ui:widgets.files.notSent', 'It could not be sent. Try again.');
  }
}
