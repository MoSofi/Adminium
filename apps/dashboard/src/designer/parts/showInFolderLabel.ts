// SPDX-License-Identifier: AGPL-3.0-only
import { t } from '../../i18n/t.js';

/** The system's own name for where folders are looked at. */
export function showInFolderLabel(platform: string | undefined): string {
  if (platform === 'darwin') return t('designer:project.showFinder', 'Show in Finder');
  if (platform === 'win32') return t('designer:project.showExplorer', 'Show in File Explorer');
  return t('designer:project.showFiles', 'Show in the file manager');
}
