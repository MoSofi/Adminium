// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire shapes for an app's own screens as files: Download (a project app
 * packed at a version) and Make it editable here (an installed package's
 * source copied into the project folder).
 */
import { z } from 'zod';

const appKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an app key is lowercase letters, digits and hyphens');
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'a version is three numbers, like 1.2.0');

export const ownAppKeyParams = z.object({ key: appKey });
export const packFileParams = z.object({ key: appKey, version });

/** The version to pack at: never lower than the folder's manifest; a higher one is written back to it first. */
export const packAppBody = z.object({ version }).strict();

export const packAppReply = z.object({
  key: appKey,
  version: z.string(),
  /** `<key>-<version>.tgz`. */
  fileName: z.string(),
  bytes: z.number().int(),
  /** `sha512-<base64>`: what the install page checks the file against. */
  integrity: z.string(),
  fileCount: z.number().int(),
});

export const editableReply = z.object({
  /** `offered`: the button is there. `refused`: it is not, and `reason` says why. `none`: the package carries no source. */
  state: z.enum(['offered', 'refused', 'none']),
  reason: z.enum(['NO_PROJECT', 'FOLDER_EXISTS', 'SEVERAL_INSTALLS', 'FROM_FOLDER']).optional(),
  /** `apps/<key>/`. */
  folder: z.string(),
  /** With `SEVERAL_INSTALLS`: on how many databases the app is. */
  installs: z.number().int().optional(),
});

export const makeEditableReply = z.object({
  key: appKey,
  folder: z.string(),
});
