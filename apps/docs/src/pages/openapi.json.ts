// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `https://docs.adminium.dev/openapi.json` — the machine-readable API contract.
 *
 * WHY AN ENDPOINT AND NOT A COPY IN `public/`. `apps/server/openapi.json` is
 * generated from the live route tree and CI fails when it is stale, so it is
 * already the single source of truth. A copy under `public/` would be a second
 * one, and the audit's finding about the REST page was exactly that: an
 * accurate spec existed and the docs pointed nobody at it. Inlining the
 * generated file at build time publishes it without giving drift anywhere to
 * hide.
 *
 * `?raw` rather than `readFileSync`: the built endpoint runs from a bundled
 * chunk whose `import.meta.url` is NOT the source path, so a relative read
 * resolves against `dist/.prerender/chunks` and fails. Vite resolves the
 * specifier at build time, against this file.
 */
import type { APIRoute } from 'astro';

import spec from '../../../server/openapi.json?raw';

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(spec, { headers: { 'content-type': 'application/json; charset=utf-8' } });
