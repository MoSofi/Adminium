// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The published JSON Schema for the IR — `docs.adminium.dev/schemas/ir-v1.json`.
 *
 * The JSON IR guide has told readers to point `$schema` at that URL since the
 * page was written, and no such document was ever generated: the URL 404'd. A
 * hand-written one would have drifted from the model within a release, so this
 * derives it from `databaseModelSchema` — the same schema that validates every
 * import.
 *
 * Lives in `src` rather than in the emitting script because both the script
 * (via `dist`) and the drift test (via `src`) must produce byte-identical
 * output; two copies would be the drift the artifact exists to prevent.
 */
import { z } from 'zod';

import { IR_VERSION, databaseModelSchema } from './schema-model.js';

/** Where the docs site serves this document (`apps/docs/src/pages/schemas/`). */
export const IR_SCHEMA_URL = 'https://docs.adminium.dev/schemas/ir-v1.json';

/**
 * The schema document, serialized exactly as `ir-v1.schema.json` holds it.
 *
 * `io: 'input'` is deliberate: the model defaults nearly everything, and an
 * author needs to know what they MAY omit. The output schema would mark every
 * defaulted field required and reject the minimal IR §2.3 promises works.
 *
 * `$schema` is added to the root as an allowed property. The generated document
 * is `additionalProperties: false` throughout (every IR object is a Zod
 * `strictObject`), so without this the very pointer that makes an editor
 * validate the file would be the first thing the editor flagged.
 * `schema-import`'s `parsers/json.ts` strips it on the way in for the same
 * reason.
 */
export function irJsonSchemaDocument(): string {
  const generated = z.toJSONSchema(databaseModelSchema, { io: 'input' }) as {
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  };

  // `introspectedAt` defaults to `new Date().toISOString()`, so the raw output
  // embeds the moment of generation and the artifact differs from itself on
  // every run — a `--check` gate that fails on a clean tree teaches people to
  // ignore it. The default is not expressible as a constant anyway: it means
  // "when this was imported", which is what the description now says.
  const introspectedAt = generated.properties?.introspectedAt as
    | Record<string, unknown>
    | undefined;
  if (introspectedAt !== undefined) {
    const stable = { ...introspectedAt };
    delete stable.default;
    (generated.properties as Record<string, unknown>).introspectedAt = {
      ...stable,
      description: 'ISO 8601. Defaults to the moment of import when omitted.',
    };
  }
  return `${JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: IR_SCHEMA_URL,
      title: `Adminium schema IR v${String(IR_VERSION)}`,
      description:
        'The intermediate representation every Adminium schema import converges on. ' +
        'Generated from packages/engine/src/schema-model.ts — do not edit by hand.',
      ...generated,
      properties: {
        $schema: {
          type: 'string',
          description: 'Optional pointer to this schema. Adminium ignores it on import.',
        },
        ...generated.properties,
      },
    },
    null,
    2,
  )}\n`;
}
