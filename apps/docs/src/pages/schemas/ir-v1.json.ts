// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `https://docs.adminium.dev/schemas/ir-v1.json` — the JSON Schema for the
 * schema IR.
 *
 * The JSON IR guide has published a `$schema` URL since it was written and no
 * such document existed: the URL 404'd and the page's worked example was
 * rejected in full by the parser it documents. This serves the schema generated
 * from the Zod model that validates every import
 * (`packages/engine/scripts/ir-json-schema.mjs`), inlined at build time so the
 * published contract cannot drift from the enforced one.
 */
import type { APIRoute } from 'astro';

import schema from '../../../../../packages/engine/ir-v1.schema.json?raw';

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(schema, { headers: { 'content-type': 'application/json; charset=utf-8' } });
