/**
 * Page-config client (09-generated-app.md §2.3 loader contract, §3):
 * `GET /api/v1/pages/:pageId` → run client-side config migrations
 * (`@adminium/engine/config`, the browser-safe subpath — same functions the
 * server runs on read, 01-architecture.md §8.2) → Zod-validate the envelope.
 *
 * Never-crash rules (§3.1): a document with `v` newer than this build renders
 * the "config too new" card; a document failing envelope validation renders
 * the invalid-config card. Both are ordinary query *data* (`PageDocumentResult`),
 * not thrown errors — only transport/API failures (403/404/5xx) throw, so the
 * route error mapping can render the matching system state.
 */
import { queryOptions } from '@tanstack/react-query';
import {
  ConfigMigrationError,
  configMigrations,
  latestConfigVersion,
  pageEnvelopeSchema,
  runConfigMigrations,
  type ConfigMigration,
  type PageEnvelope,
} from '@adminium/engine/config';

import { api } from '../app/api.js';

export type { PageEnvelope } from '@adminium/engine/config';

export type PageDocumentResult =
  | { status: 'ok'; page: PageEnvelope }
  | { status: 'too-new'; v: number; latest: number }
  | { status: 'invalid'; issues: string[] };

/**
 * Post-migration envelope validator — structural so tests can inject a
 * variant schema alongside injected migrations (the real chain and the real
 * envelope schema always agree on the latest version).
 */
export interface EnvelopeValidator {
  safeParse(input: unknown):
    | { success: true; data: PageEnvelope }
    | { success: false; error: { issues: Array<{ path: ReadonlyArray<string | number>; message: string }> } };
}

export interface ParsePageOptions {
  /** Migration-chain override (test seam; defaults to the registered chain). */
  migrations?: readonly ConfigMigration[] | undefined;
  /** Envelope-schema override (test seam; defaults to `pageEnvelopeSchema`). */
  schema?: EnvelopeValidator | undefined;
}

function versionOf(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = (raw as Record<string, unknown>)['v'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** migrate → validate; every failure mode is a value, never a throw (§3.1). */
export function parsePageDocument(raw: unknown, options: ParsePageOptions = {}): PageDocumentResult {
  const migrations = options.migrations ?? configMigrations;
  let migrated: unknown;
  try {
    migrated = runConfigMigrations(raw, migrations);
  } catch (error) {
    if (!(error instanceof ConfigMigrationError)) throw error;
    const v = versionOf(raw);
    const latest = latestConfigVersion(migrations);
    if (v !== null && v > latest) return { status: 'too-new', v, latest };
    return { status: 'invalid', issues: [error.message] };
  }

  const schema: EnvelopeValidator = options.schema ?? (pageEnvelopeSchema as EnvelopeValidator);
  const parsed = schema.safeParse(migrated);
  if (!parsed.success) {
    return {
      status: 'invalid',
      issues: parsed.error.issues.map((issue) =>
        issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }
  return { status: 'ok', page: parsed.data };
}

/** Page documents change on regeneration/edits, both WS-invalidated — 5 min. */
export const PAGE_STALE_TIME_MS = 5 * 60_000;

export function pageQuery(pageId: string) {
  return queryOptions({
    queryKey: ['page', pageId] as const,
    staleTime: PAGE_STALE_TIME_MS,
    queryFn: async (): Promise<PageDocumentResult> => {
      const reply = await api.get<{ data: unknown }>(`/api/v1/pages/${encodeURIComponent(pageId)}`);
      return parsePageDocument(reply.data);
    },
  });
}
