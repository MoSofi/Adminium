// SPDX-License-Identifier: AGPL-3.0-only
import type { WebsiteLineCode } from '@adminium/add-on-contracts/forms/websites';

import { t } from '../../i18n/t.js';

/** One line's message, by its code (the server answers codes; the page words them). */
export function websiteLineWords(code: WebsiteLineCode): string {
  switch (code) {
    case 'one-per-line':
      return t('studio:privacy.websites.line.onePerLine', 'One website per line, no *');
    case 'https':
      return t('studio:privacy.websites.line.https', 'Use https://');
    case 'address':
      return t('studio:privacy.websites.line.address', 'Not a website address');
    case 'path':
      return t('studio:privacy.websites.line.path', 'Just the address, no path');
    case 'self':
      return t('studio:privacy.websites.line.self', "That's this server's own address");
    case 'listed':
      return t('studio:privacy.websites.line.listed', 'Already on the list');
    case 'ok':
      return t('studio:privacy.websites.line.ok', 'Ready to add');
  }
}
