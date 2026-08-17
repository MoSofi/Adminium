// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio schema remap editor (M5-T04). Route contract: the Studio router
 * renders `<RemapEditor connectionId={...} />` at `/studio/:connectionId/remap`.
 */
export { RemapEditor, type RemapEditorProps } from './RemapEditor.js';
export {
  baselineFromRows,
  bufferChanges,
  buildPutDocument,
  overrideKey,
  type OverrideDto,
  type OverridesPutDocument,
  type RemapOverride,
} from './overrides.js';
export { useRemapBuffer, type RemapBuffer } from './useRemapBuffer.js';
