// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A generated page's "untouched since I made it" stamp: `config.generatedHash`,
 * the hash of the envelope without the stamp itself. An update rebuilds only a
 * page whose stamp still matches; an edit breaks it.
 *
 * Shared by the manifest page writer and the rename repair, which rewrites a
 * page's table name on the operator's behalf and must NOT turn that into an
 * edit: an untouched page it repairs is stamped again.
 */
import { hashEnvelope } from '@adminium/engine';

/** A stored document's own stamp still matches it: nobody has edited it. */
export function isUntouched(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const body = (config as Record<string, unknown>)['config'];
  const stamp =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)['generatedHash']
      : undefined;
  return typeof stamp === 'string' && stamp === hashEnvelope(config as Record<string, unknown>);
}

/** The envelope with a fresh stamp over its current content. */
export function stamped(envelope: Record<string, unknown>): Record<string, unknown> {
  const body = { ...(envelope['config'] as Record<string, unknown>) };
  delete body['generatedHash'];
  const plain = { ...envelope, config: body };
  return { ...plain, config: { ...body, generatedHash: hashEnvelope(plain) } };
}
