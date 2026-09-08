// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One change handler for every file input in the inspector (the comp's
 * `readImg`, 1324-1328): the first picked image through `readImageFile`, the
 * data URL to the caller on success, the refusal to the editor's toast on
 * failure. Lives here (not in `editor/images.ts`) because the inspector is the
 * only place that binds an input to a setter.
 */
import type { ChangeEvent } from 'react';

import { fileFromInput, readImageFile, type ImageReadResult } from '../images.js';

export type ImageRejected = (result: Extract<ImageReadResult, { ok: false }>) => void;

export function uploadFromInput(event: ChangeEvent<HTMLInputElement>, apply: (dataUrl: string) => void, onRejected: ImageRejected): void {
  const file = fileFromInput(event);
  if (file === null) return;
  void readImageFile(file).then((result) => {
    if (result.ok) apply(result.dataUrl);
    else onRejected(result);
  });
}
