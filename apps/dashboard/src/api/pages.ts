// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-config client (loader contract): `GET /api/v1/pages/:pageId` → run
 * client-side config migrations (`@adminium/engine/config`, the
 * browser-safe subpath — same functions the server runs on read) →
 * Zod-validate the envelope.
 *
 * Never-crash rules: a document with `v` newer than this build renders the
 * "config too new" card; a document failing envelope validation renders the
 * invalid-config card. Both are ordinary query *data* (`PageDocumentResult`), not
 * thrown errors — only transport/API failures (403/404/5xx) throw, so the route
 * error mapping can render the matching system state.
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

import type { ColumnFact, ColumnFacts } from '@adminium/widgets';

import { api } from '../app/api.js';

export type { PageEnvelope } from '@adminium/engine/config';
export type { ColumnFact, ColumnFacts };

/** The `columnFacts` block as the page route sends it. */
/** Mirrors `RelationFact` on the page reply. */
export interface FormRelationFactReply {
  relationId: string;
  label: string;
  targetTable: string;
  targetKey: string;
  /** The column a chip shows; absent ⇒ the key labels itself. */
  targetName?: string;
  targetLabel?: string;
}

interface ColumnFactsReply {
  /** `labelPlural` is absent from a server older than it. */
  table: { labelSingular: string | null; labelPlural?: string | null | undefined };
  columns: FormColumnFactReply[];
  relations?: FormRelationFactReply[];
  children?: FormChildFactReply[];
}

/**
 * One column of that block, WHOLE — the spec included.
 *
 * The keyed `ColumnFacts` record below answers "what does the server say about
 * this column", which is all the old form needed because it rendered
 * `config.columns[]`. The form DOCUMENT needs the other half: the columns
 * themselves, in table order, including the ones the grid's eight-column cap
 * never listed. A form that can only offer what the grid shows cannot set them.
 */
/** A table whose rows this one can hold a list of — an invoice's lines. */
export interface FormChildFactReply {
  relationId: string;
  label: string;
  childTable: string;
  foreignColumn: string;
  columns: FormColumnFactReply[];
}

export interface FormColumnFactReply {
  spec: { name?: unknown } & Record<string, unknown>;
  ordinal?: number;
  filledBy: 'database' | 'adminium' | null;
  required: boolean;
  /** Asked for only while another column of the record holds one of `in`. */
  requiredWhen?: { column: string; in: (string | number | boolean)[] } | undefined;
  writable: boolean;
  /** As the connection's role is granted; absent when the server does not know. */
  insertable?: boolean | undefined;
  updatable?: boolean | undefined;
  /** Inline values carry their words in the reader's language. */
  options?: { list: string } | { values: { value: string; label?: string; tone?: string }[] } | undefined;
  validation?: Record<string, unknown> | undefined;
  /** A choice column's words for its values, in the reader's language, and their tones. */
  enumLabels?: Record<string, string> | undefined;
  enumTones?: Record<string, string> | undefined;
}

/** The reply's array, keyed by column name — the shape the form reads. */
function factsByColumn(block: ColumnFactsReply | undefined): ColumnFacts {
  const facts: Record<string, ColumnFact> = {};
  for (const column of block?.columns ?? []) {
    const name = column.spec.name;
    if (typeof name !== 'string' || name === '') continue;
    facts[name] = {
      filledBy: column.filledBy,
      required: column.required,
      ...(column.requiredWhen === undefined ? {} : { requiredWhen: column.requiredWhen }),
      writable: column.writable,
      ...(column.insertable === undefined ? {} : { insertable: column.insertable }),
      ...(column.updatable === undefined ? {} : { updatable: column.updatable }),
      // The RULE, not its answers: a named list is resolved where the reader's
      // language is known (`api/optionLists.ts`).
      ...(column.options === undefined ? {} : { options: column.options }),
      ...(column.enumLabels === undefined ? {} : { enumLabels: column.enumLabels }),
      ...(column.enumTones === undefined ? {} : { enumTones: column.enumTones }),
    };
  }
  return facts;
}

/** One button of a record page, as the server offers it to one reader (`GET /pages/:id` · `stateActions`). */
export interface StateActionFact {
  id: string;
  kind: 'move' | 'set' | 'link' | 'child';
  /** In the reader's language. */
  label: string;
  tone: 'primary' | 'neutral' | 'danger';
  confirm?: string;
  /** The states of the row it may be used in. */
  from: string[];
  /** What a move or a set asks for before it is made. */
  ask?: { column: string; label: string; required: boolean }[];
  /** A link: the record's key is appended. */
  href?: string;
  /** A child form: the child table's id, its link to this row, the columns it asks for. */
  child?: { table: string; via: string; form: string[] };
  /** A child form's fixed values. */
  set?: Record<string, string | number | boolean>;
}

export type PageDocumentResult =
  | {
      status: 'ok';
      page: PageEnvelope;
      canEditLayout: boolean;
      /** Per-caller write capabilities for the envelope's source table (the
       *  same `table:` grants the data routes enforce) — false hides the
       *  matching affordance so a viewer never sees a button that 403s. */
      canCreate: boolean;
      canUpdate: boolean;
      canDelete: boolean;
      /** May attach a sidecar file. Not derived from `canUpdate`: on a
       * read-only source the record cannot be edited and a file still can be
       * attached, which is what the sidecar mode is for. */
      canAttach: boolean;
      /** Caller holds the server's PII unmask permission — PII cells render a
       *  reveal affordance. Defaults CLOSED (false) when absent: the reveal is
       *  only honest when the server actually sent values in clear. */
      canUnmask: boolean;
      /**
       * The buttons a record of the source table may show this reader
       * (`states.actions`), each with the states of the row it is offered in.
       * The server decided them; empty when it computed none.
       */
      stateActions: readonly StateActionFact[];
      /**
       * The source table as it stands right now — who fills each column and
       * which ones the create form has to ask for. Empty when the server did
       * not compute them (no source table, no snapshot, an older server), and
       * the form then falls back to the stored spec, exactly as before.
       *
       * Why not the stored `config.columns[]`: that list froze the day the
       * page was generated, regeneration will not touch a page anybody has
       * edited, and it is capped at eight columns — so a column added since
       * is invisible to the form, and a NOT NULL column added since makes
       * every create fail with no way for the form to say why.
       */
      columnFacts: ColumnFacts;
      /**
       * The same block unkeyed and whole, in table order: what the form
       * document is derived from and rendered against.
       */
      formColumns: readonly FormColumnFactReply[];
      /** The link relations this table can write through, as fields of chips. */
      formRelations: readonly FormRelationFactReply[];
      formChildren: readonly FormChildFactReply[];
      /** The table's own singular label, for the dialog's title. */
      tableLabelSingular: string | null;
      /** What a person calls the table as a whole ("Categories"), where it has a name. */
      tableLabelPlural: string | null;
    }
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

/** migrate → validate; every failure mode is a value, never a throw. */
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
  // The per-caller server capabilities are not part of the stored document —
  // the query wrapper fills them from the response. `canEditLayout` defaults
  // closed (false routes builder saves to the personal override); the write
  // capabilities default OPEN, because absent means "not computed" (a
  // source-less page, or a server predating the field), and hiding every
  // write affordance there would be a regression, not honesty.
  return {
    status: 'ok',
    page: parsed.data,
    canEditLayout: false,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canAttach: true,
    // Closed default, unlike the write capabilities: a reveal button is only
    // honest when the server said it sent PII in clear.
    canUnmask: false,
    stateActions: [],
    columnFacts: {},
    formColumns: [],
    formRelations: [],
    formChildren: [],
    tableLabelSingular: null,
    tableLabelPlural: null,
  };
}

/** Page documents change on regeneration/edits, both WS-invalidated — 5 min. */
export const PAGE_STALE_TIME_MS = 5 * 60_000;

export function pageQuery(pageId: string) {
  return queryOptions({
    queryKey: ['page', pageId] as const,
    staleTime: PAGE_STALE_TIME_MS,
    queryFn: async (): Promise<PageDocumentResult> => {
      const reply = await api.get<{
        data: unknown;
        canEditLayout?: boolean;
        canCreate?: boolean;
        canUpdate?: boolean;
        canDelete?: boolean;
        canAttach?: boolean;
        canUnmask?: boolean;
        stateActions?: StateActionFact[];
        columnFacts?: ColumnFactsReply;
      }>(`/api/v1/pages/${encodeURIComponent(pageId)}`);
      const result = parsePageDocument(reply.data);
      return result.status === 'ok'
        ? {
            ...result,
            canEditLayout: reply.canEditLayout === true,
            // `!== false`: only an explicit server denial hides an affordance
            // (absent = not computed, keep the permissive default).
            canCreate: reply.canCreate !== false,
            canUpdate: reply.canUpdate !== false,
            canDelete: reply.canDelete !== false,
            canAttach: reply.canAttach !== false,
            // `=== true`: opposite polarity — absent means keep cells masked.
            canUnmask: reply.canUnmask === true,
            stateActions: reply.stateActions ?? [],
            columnFacts: factsByColumn(reply.columnFacts),
            formColumns: reply.columnFacts?.columns ?? [],
            formRelations: reply.columnFacts?.relations ?? [],
            formChildren: reply.columnFacts?.children ?? [],
            tableLabelSingular: reply.columnFacts?.table.labelSingular ?? null,
            tableLabelPlural: reply.columnFacts?.table.labelPlural ?? null,
          }
        : result;
    },
  });
}
