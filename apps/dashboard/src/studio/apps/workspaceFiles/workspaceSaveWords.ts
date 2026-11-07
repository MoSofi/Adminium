// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save workspace: a refusal of the whole workspace file, in words, from the
 * reason it carries. Save as app's own words (`saveAppWords.tsx`) ask here
 * first for a reason of a workspace save, and fall back to their own.
 */
import { t } from '../../../i18n/t.js';

/** The words for a workspace save's refusal, or null when the reason is not one of them. */
export function workspaceSaveRefusal(reason: string | null): string | null {
  switch (reason) {
    case 'WORKSPACE_FILE_LEAKS':
      return t('studio:workspaceFiles.save.leaks', 'The workspace file would carry a secret or an id of this server in a workspace, database or label name. Rename it, then save again.');
    case 'WORKSPACE_FILE_CHANGED':
      return t('studio:workspaceFiles.saveRefusal.changed', 'The workspace file came out different from the one saved. Save the workspace again.');
    case 'WORKSPACE_FILE_TOO_LARGE':
      return t('studio:workspaceFiles.saveRefusal.tooLarge', 'This workspace file would be larger than 128 MB. Leave out a database or its sample rows and try again.');
    case 'WORKSPACE_APP_TOO_LARGE':
      return t('studio:workspaceFiles.saveRefusal.appTooLarge', 'An app would be larger than 32 MB. Leave out its sample rows and try again.');
    case 'WORKSPACE_SAVE_EMPTY':
      return t('studio:workspaceFiles.saveRefusal.empty', 'Choose at least one database to save.');
    case 'WORKSPACE_SAVE_TOO_MANY':
      return t('studio:workspaceFiles.saveRefusal.tooMany', 'A workspace file holds too many apps. Leave out a database.');
    case 'WORKSPACE_SAVE_NOT_MEMBER':
      return t('studio:workspaceFiles.saveRefusal.notMember', 'Some of those databases are not in this workspace.');
    case 'WORKSPACE_SAVE_DUPLICATE':
      return t('studio:workspaceFiles.saveRefusal.duplicate', 'Each database becomes one app: name it once.');
    case 'WORKSPACE_SAVE_DUPLICATE_KEY':
      return t('studio:workspaceFiles.saveRefusal.duplicateKey', 'Two apps would have the same key. Give each its own.');
    case 'WORKSPACE_SAVE_INSTANCE_FROM':
      return t('studio:workspaceFiles.saveRefusal.instanceFrom', 'The server settings travel with one of the apps saved.');
    default:
      return null;
  }
}
