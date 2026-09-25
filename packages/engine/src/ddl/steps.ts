// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `DdlStep` vocabulary and its hazard classification.
 *
 * ─── Why hazard is a contract and not copy ─────────────────────────────────
 *
 * D4: every step carries one of `safe`, `rewrite`, `locking`, `lossy`,
 * `irreversible`, `refused`. The class is computed here, per dialect AND per
 * server version, rendered by the review screen, and — on MySQL — asserted by
 * the emitted statement itself (`ALGORITHM=INSTANT` where this file says
 * `safe`), so a wrong prediction fails fast instead of silently copying a
 * table. That is what makes "preview" mean something rather than decorate a
 * confirm dialog.
 *
 * ─── Why the version matters ───────────────────────────────────────────────
 *
 * The same statement is a different operation on different servers, and the
 * differences are not marginal:
 *
 *   ADD COLUMN NOT NULL DEFAULT   metadata-only on pg 11+, full rewrite on pg 10
 *   instant ADD COLUMN            MySQL 8.0.12 last position only, anywhere 8.0.29
 *   instant DROP COLUMN           MySQL 8.0.29+; before that, always a rebuild
 *
 * No pg or sqlite floor is stated anywhere in the product, so
 * the version is READ from the probe at plan time and passed in — never assumed.
 */
import { z } from 'zod';

import type { Dialect } from '../schema-model.js';
import { isWideningChange, type TypeShape } from './type-map.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const DDL_STEP_KINDS = [
  'create-table',
  'drop-table',
  'rename-table',
  'set-table-comment',
  'add-column',
  'drop-column',
  'rename-column',
  'alter-column-type',
  'set-not-null',
  'drop-not-null',
  'set-default',
  'drop-default',
  'set-comment',
  'add-fk',
  'validate-fk',
  'drop-fk',
  'add-unique',
  'drop-unique',
  'add-check',
  'drop-check',
  'add-index',
  'drop-index',
  'set-pk',
  'drop-pk',
  'add-enum-value',
  /**
   * Turn an EXISTING integer key into a generated one (D23) — the thing
   * `set-default` could never express, because auto-increment is not a DEFAULT
   * on any of the three engines: it is an identity clause on postgres, a column
   * attribute on MySQL, and the rowid alias on SQLite. A `set-default` step
   * carrying `{kind:'autoincrement'}` reached the compiler and threw
   * `set-default with no default`, so "give this key auto-increment" was a
   * plan that could be reviewed and never applied.
   */
  'set-identity',
  'drop-identity',
  'rebuild-table',
] as const;
export const ddlStepKindSchema = z.enum(DDL_STEP_KINDS);
export type DdlStepKind = (typeof DDL_STEP_KINDS)[number];

/** D4's closed hazard vocabulary. Order = severity, low to high. */
export const HAZARDS = ['safe', 'locking', 'rewrite', 'lossy', 'irreversible', 'refused'] as const;
export const hazardSchema = z.enum(HAZARDS);
export type Hazard = (typeof HAZARDS)[number];

const SEVERITY: Readonly<Record<Hazard, number>> = {
  safe: 0,
  locking: 1,
  rewrite: 2,
  lossy: 3,
  irreversible: 4,
  refused: 5,
};

/** The worse of two hazards — a step is as dangerous as its worst facet. */
export function worseHazard(a: Hazard, b: Hazard): Hazard {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * Which hazards require Super Admin (D7). A delegated `schema.ddl` holder may
 * create tables, add columns and add constraints; discarding data or dropping
 * an object is the same asymmetry `routes/schema/index.ts:236-252` already
 * enforces for unmasking PII — a delegated authority may add safety, never
 * remove it.
 */
export function requiresSuperAdmin(hazard: Hazard): boolean {
  return hazard === 'lossy' || hazard === 'irreversible';
}

/** Why a step was refused — the codes decidable at plan time. */
export const REFUSAL_CODES = [
  'SYSTEM_TABLE',
  'META_NAMESPACE',
  'NOT_A_TABLE',
  'INVALID_IDENTIFIER',
  'IDENTIFIER_TOO_LONG',
  'RESERVED_IDENTIFIER',
  'TABLE_TOO_LARGE',
  'READ_ONLY_MODE',
  'NO_LIVE_DATABASE',
  'INSUFFICIENT_PRIVILEGE',
  'UNSUPPORTED_TYPE',
  'NEEDS_DEFAULT',
  'ENUM_VALUE_REMOVAL',
  'NEEDS_REBUILD',
  'ADDON_OWNED',
  'UNSUPPORTED_ON_DIALECT',
  /**
   * The table's size could not be established, so the row ceiling cannot be
   * applied to it (D18). Refusing is the fail-CLOSED answer: a failed count
   * used to delete the ceiling silently, which switched the gate off for
   * exactly the tables too big to count.
   */
  'COUNT_UNAVAILABLE',
] as const;
export const refusalCodeSchema = z.enum(REFUSAL_CODES);
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** A consequence preflight attached — a fact, never an adjective. */
export const consequenceSchema = z.strictObject({
  kind: z.enum([
    'row-count',
    'page',
    'saved-view',
    'scheduled-report',
    'export',
    'override',
    'grant',
    'public-scope',
    'manifest',
    'realtime',
    'not-repaired',
    /*
     * What Adminium DOES follow — the other half of `not-repaired`, and the
     * half a rename needs. A rename is `safe` for the data and anything but
     * safe for the references, so a step whose only line was "a metadata-only
     * rename" told the truth about the table and nothing about the app.
     */
    'repaired',
  ]),
  message: z.string().min(1),
  /** Ids the operator can act on — page slugs, key ids, view ids. */
  refs: z.array(z.string()).default([]),
});
export type Consequence = z.infer<typeof consequenceSchema>;

export const ddlStepSchema = z.strictObject({
  id: z.string().min(1),
  kind: ddlStepKindSchema,
  /** Qualified table id the step operates on. */
  table: z.string().min(1),
  column: z.string().nullable().default(null),
  /**
   * The constraint this step names, as the DATABASE spells it.
   *
   * Separate from `column` because they are different facts and were conflated:
   * `drop-check` read `step.column` as a constraint name, the planner never set
   * it, and the compiler fell back to guessing `ck_<table>` — a name no engine
   * had ever assigned, so changing the allowed values on an existing table
   * emitted a DROP for a constraint that did not exist. A dropped constraint's
   * real name comes out of the snapshot; an added one's is null until the
   * compiler derives it.
   */
  constraint: z.string().nullable().default(null),
  hazard: hazardSchema,
  requiresSuperAdmin: z.boolean(),
  /** Human-readable one-liner; the UI renders this beside the SQL. */
  summary: z.string().min(1),
  /** Why the hazard is what it is — shown on hover, never invented in the UI. */
  rationale: z.string().min(1),
  consequences: z.array(consequenceSchema).default([]),
  /**
   * Steps that must precede this one. The planner produces a fully ordered
   * list, but the graph is kept so the executor can report "3 succeeded, this
   * failed, 2 not run" without re-deriving it (D3).
   */
  dependsOn: z.array(z.string()).default([]),
  /**
   * True when the step must run OUTSIDE the wrapping transaction —
   * `CREATE INDEX CONCURRENTLY` and pg's `ALTER TYPE … ADD VALUE`.
   */
  outsideTransaction: z.boolean().default(false),
  /** Set only on `refused`. */
  refusal: refusalCodeSchema.nullable().default(null),
  /**
   * `rename-column` only: the column's NEW name. `column` carries the old one.
   *
   * The step used to carry only the old name and the compiler guessed the new
   * one as "the first desired column that is not the old name" — which is the
   * table's FIRST column, `id` on nearly every table. Every column rename
   * compiled to `RENAME COLUMN x TO id` and failed as a duplicate. The planner
   * knows the answer; it now says it. Optional so a step recorded before the
   * field existed (the change ledger) still parses; absent means "not a rename".
   */
  renameTo: z.string().nullable().optional(),
});
export type DdlStep = z.infer<typeof ddlStepSchema>;

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Compare a probed `serverVersion` against a floor like `11` or `8.0.29`.
 * Tolerant of the noise real servers return ("15.4 (Debian 15.4-1)",
 * "8.0.35-0ubuntu0.22.04.1", "10.11.6-MariaDB").
 */
export function atLeastVersion(serverVersion: string | null, floor: string): boolean {
  if (serverVersion === null) return false;
  const parse = (v: string): number[] => {
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
    if (m === null) return [];
    return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  };
  const actual = parse(serverVersion);
  const want = parse(floor);
  if (actual.length === 0) return false;
  for (let i = 0; i < 3; i += 1) {
    const a = actual[i] ?? 0;
    const b = want[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hazard classification
// ---------------------------------------------------------------------------

export interface HazardContext {
  dialect: Dialect;
  serverVersion: string | null;
  /**
   * True when the target table is known to hold rows. `null` = unknown, which
   * is treated as "yes" — the safe direction, and the one that makes an
   * unmeasurable table warn rather than silently promise.
   */
  tableHasRows: boolean | null;
  /** MariaDB rather than MySQL — the ALGORITHM clauses differ. */
  isMariaDb?: boolean;
}

export interface HazardVerdict {
  hazard: Hazard;
  rationale: string;
  refusal?: RefusalCode;
  /** SQLite: this operation is only reachable through the rebuild. */
  needsRebuild?: boolean;
}

/**
 * Kinds whose `locking` form still reads every row (D18).
 *
 * D18 names the counted set as "`rewrite`, or `locking` with a full scan
 * (`set-not-null`, `add-unique`, `set-pk`, `add-fk` validation)". A `locking`
 * hazard alone does not mean a scan — `drop-fk` locks briefly and reads
 * nothing — so the kind has to be named.
 */
const FULL_SCAN_LOCKING_KINDS = new Set<DdlStepKind>([
  'set-not-null',
  'add-unique',
  'set-pk',
  'add-fk',
  'validate-fk',
]);

/**
 * Does this step read or rewrite EVERY ROW of its table?
 *
 * The predicate D18's row ceiling is really about, named once so the two halves
 * of that decision — which steps get counted, and which get refused above the
 * ceiling — cannot drift apart.
 *
 * They had drifted. `preflight` counted `['rewrite','lossy']` and refused only
 * `hazard === 'rewrite'`, which left `lossy` permanently uncountable-but-
 * unrefusable: narrowing a column on a 400-million-row table is `lossy`, its
 * own rationale says "MySQL copies the whole table", and it sailed past the
 * ceiling that exists to stop exactly that. Neither set matched D18's, which
 * also names the full-scan `locking` kinds that neither of them counted at all.
 *
 * `hazard` is a SEVERITY ordering for the badge in the UI. It was the wrong
 * predicate for "does this touch every row", and spelling the question out is
 * what stops the next person reaching for it again.
 */
export function touchesEveryRow(step: { kind: DdlStepKind; hazard: Hazard }): boolean {
  if (step.hazard === 'rewrite' || step.hazard === 'lossy') return true;
  return step.hazard === 'locking' && FULL_SCAN_LOCKING_KINDS.has(step.kind);
}

const nonEmpty = (ctx: HazardContext): boolean => ctx.tableHasRows !== false;

/**
 * Classify one step. The single source of matrix — the executor reads the
 * verdict rather than re-deriving it, so the statement it emits and the badge
 * the user saw cannot disagree.
 */
export function classifyStep(
  kind: DdlStepKind,
  ctx: HazardContext,
  detail: {
    typeFrom?: TypeShape;
    typeTo?: TypeShape;
    /** `add-column` only. */
    columnNullable?: boolean;
    hasDefault?: boolean;
    /** `add-column`/`set-not-null`: is the position the last one? (MySQL INSTANT). */
    isLastPosition?: boolean;
    /** `add-column` only: every row already there is given a value (`fillsNowWhenAdded`). */
    fillsRows?: boolean;
  } = {},
): HazardVerdict {
  const { dialect } = ctx;
  const pg = dialect === 'postgres';
  const my = dialect === 'mysql';
  const lite = dialect === 'sqlite';

  const rebuild = (why: string): HazardVerdict => ({
    hazard: 'rewrite',
    rationale: `SQLite cannot express this as an ALTER, so the table is rebuilt: ${why}`,
    needsRebuild: true,
  });

  switch (kind) {
    case 'create-table':
      return { hazard: 'safe', rationale: 'Creates a new table; nothing existing is touched.' };

    case 'rename-table':
      return {
        hazard: 'safe',
        rationale: my
          ? 'A metadata-only rename — but MySQL commits DDL implicitly, so it cannot be rolled back.'
          : 'A metadata-only rename.',
      };

    case 'set-table-comment':
    case 'set-comment':
      return lite
        ? {
            hazard: 'refused',
            rationale: 'SQLite has no comment syntax; the Studio label is the labelling path.',
            refusal: 'UNSUPPORTED_ON_DIALECT',
          }
        : { hazard: 'safe', rationale: 'Comments are catalog metadata.' };

    case 'drop-table':
      return {
        hazard: 'irreversible',
        rationale: 'The table and every row in it are destroyed. Adminium cannot undo this.',
      };

    case 'drop-column':
      if (lite) {
        // 3.35+ can DROP COLUMN, but not one that is a PK, indexed, or named
        // by a constraint — the planner passes those through the rebuild.
        return {
          hazard: 'lossy',
          rationale:
            "SQLite rewrites the table's content to purge the column, so the cost is proportional to its size, and the data is destroyed.",
        };
      }
      if (my) {
        const instant = atLeastVersion(ctx.serverVersion, '8.0.29');
        return {
          hazard: instant ? 'lossy' : 'rewrite',
          rationale: instant
            ? 'MySQL 8.0.29+ drops a column instantly, but the data in it is destroyed.'
            : 'Before MySQL 8.0.29 a dropped column rebuilds the whole table, and the data is destroyed.',
        };
      }
      return {
        hazard: 'lossy',
        rationale:
          'Postgres makes the column invisible rather than removing it, so the drop is fast — but the data is unreachable, and the disk space is not reclaimed until the table is rewritten.',
      };

    case 'add-column': {
      const notNull = detail.columnNullable === false;
      const hasDefault = detail.hasDefault === true;
      if (notNull && !hasDefault && nonEmpty(ctx)) {
        return {
          hazard: 'refused',
          rationale:
            'A NOT NULL column cannot be added to a table that already has rows without a default — the existing rows would have no value. Give the column a default, or make it nullable.',
          refusal: 'NEEDS_DEFAULT',
        };
      }
      if (lite) return { hazard: 'safe', rationale: 'SQLite adds a column by appending to the schema.' };
      if (my && detail.fillsRows === true && nonEmpty(ctx)) {
        return {
          hazard: 'rewrite',
          rationale:
            "The column is added empty, then every row already in the table is given the current time on the Adminium server's clock, as Adminium stamps a new row; the next step makes it required.",
        };
      }
      if (my) {
        const anywhere = atLeastVersion(ctx.serverVersion, '8.0.29');
        const lastOnly = atLeastVersion(ctx.serverVersion, '8.0.12');
        const instant = anywhere || (lastOnly && detail.isLastPosition === true);
        return instant
          ? { hazard: 'safe', rationale: 'MySQL adds this column instantly (metadata only).' }
          : {
              hazard: 'rewrite',
              rationale:
                'This MySQL version cannot add the column instantly, so the whole table is copied.',
            };
      }
      if (notNull && hasDefault && !atLeastVersion(ctx.serverVersion, '11')) {
        return {
          hazard: 'rewrite',
          rationale:
            'Before Postgres 11, adding a NOT NULL column with a default rewrites the entire table and its indexes.',
        };
      }
      return {
        hazard: 'safe',
        rationale: 'Postgres 11+ stores the default in the catalog; no rows are rewritten.',
      };
    }

    case 'rename-column':
      return lite
        ? {
            hazard: 'safe',
            rationale:
              'SQLite renames the column and updates references in triggers and views — and fails cleanly, changing nothing, if that would make one ambiguous.',
          }
        : { hazard: 'safe', rationale: 'A metadata-only rename.' };

    case 'alter-column-type': {
      const widening =
        detail.typeFrom !== undefined && detail.typeTo !== undefined
          ? isWideningChange(detail.typeFrom, detail.typeTo)
          : false;
      if (lite) {
        return {
          ...rebuild('a column type change'),
          hazard: widening ? 'rewrite' : 'lossy',
          rationale: widening
            ? 'SQLite stores types as affinity, so the rebuild changes the declaration and copies the rows unchanged.'
            : 'SQLite rebuilds the table; on a STRICT table a value that cannot convert aborts the whole change.',
          needsRebuild: true,
        };
      }
      if (my) {
        return {
          hazard: widening ? 'rewrite' : 'lossy',
          rationale: widening
            ? 'MySQL has no online path for any type change: the table is copied in full, and concurrent writes are blocked for the duration.'
            : 'MySQL copies the whole table, and under a non-strict sql_mode it silently clips every value that does not fit rather than failing.',
        };
      }
      /*
       * Only a length or precision INCREASE within one type, and varchar →
       * text, are binary-coercible on Postgres. A widening across types
       * (int → bigint, date → timestamp) still rewrites every row and index:
       * the stored width changes. This used to call them all safe.
       */
      const inPlace =
        widening &&
        detail.typeFrom !== undefined &&
        detail.typeTo !== undefined &&
        (detail.typeFrom.logicalType === detail.typeTo.logicalType ||
          (detail.typeFrom.logicalType === 'varchar' && detail.typeTo.logicalType === 'text'));
      if (inPlace) {
        return {
          hazard: 'safe',
          rationale:
            'Postgres widens this type without rewriting the table (no rewrite for length or precision increases since 9.2).',
        };
      }
      if (widening) {
        return {
          hazard: 'rewrite',
          rationale:
            'No value is lost, but Postgres rewrites the table and its indexes to change the stored width, holding an exclusive lock while it does.',
        };
      }
      return {
        hazard: 'lossy',
        rationale:
          'Postgres rewrites the table and its indexes, values are cast (a row that will not cast aborts the whole statement), and the column’s statistics are discarded — run ANALYZE afterwards.',
      };
    }

    case 'set-not-null':
      if (lite) return rebuild('adding NOT NULL to an existing column');
      if (my) return { hazard: 'rewrite', rationale: 'MySQL restates the column, copying the table.' };
      return {
        hazard: nonEmpty(ctx) ? 'locking' : 'safe',
        rationale: nonEmpty(ctx)
          ? 'Postgres scans the whole table to prove no NULL exists, holding an exclusive lock for the duration.'
          : 'The table is empty, so the verification scan is instant.',
      };

    case 'drop-not-null':
      if (lite) return rebuild('removing NOT NULL from an existing column');
      if (my) return { hazard: 'rewrite', rationale: 'MySQL restates the column, copying the table.' };
      return { hazard: 'safe', rationale: 'Dropping NOT NULL is catalog-only.' };

    case 'set-default':
    case 'drop-default':
      if (lite) return rebuild('changing a column default');
      return {
        hazard: 'safe',
        rationale: 'A default is catalog metadata; existing rows are untouched.',
      };

    case 'add-fk':
      if (lite) return rebuild('SQLite has no ADD CONSTRAINT — a foreign key needs a new table');
      if (my) {
        return {
          hazard: 'locking',
          rationale:
            'MySQL validates every existing row and needs an index on the referencing column (it creates one if absent). The only "online" path disables foreign_key_checks, which would leave the constraint unvalidated — Adminium does not make that trade.',
        };
      }
      return {
        hazard: 'locking',
        rationale:
          'Postgres takes SHARE ROW EXCLUSIVE on both tables — writes are blocked, reads are not. On a large table the constraint is added NOT VALID and validated as a separate, gentler step.',
      };

    case 'validate-fk':
      return {
        hazard: 'locking',
        rationale:
          'Validation scans the table under SHARE UPDATE EXCLUSIVE, which does not block concurrent writes.',
      };

    case 'drop-fk':
    case 'drop-unique':
    case 'drop-check':
      if (lite) return rebuild('SQLite has no DROP CONSTRAINT');
      return { hazard: 'safe', rationale: 'Dropping a constraint is catalog-only.' };

    case 'add-unique':
    case 'add-check':
      if (lite) return rebuild('SQLite has no ADD CONSTRAINT');
      return {
        hazard: 'locking',
        rationale: nonEmpty(ctx)
          ? 'Every existing row is checked against the new constraint, under a lock that blocks writes.'
          : 'The table is empty, so the check is instant.',
      };

    case 'add-index':
      if (lite) return { hazard: 'safe', rationale: 'SQLite builds the index in place.' };
      return {
        hazard: 'locking',
        rationale: my
          ? 'MySQL builds the index in place; concurrent reads and writes continue, but a metadata lock is taken briefly at each end.'
          : 'A standard index build locks out writes (not reads) until it completes. On a large table Adminium builds it CONCURRENTLY instead, as its own step outside the transaction.',
      };

    case 'drop-index':
      if (lite) return { hazard: 'safe', rationale: 'Dropping an index is catalog-only.' };
      return { hazard: 'safe', rationale: 'Dropping an index is catalog-only.' };

    case 'set-pk':
    case 'drop-pk':
      if (lite) return rebuild('changing the primary key');
      if (my) {
        return {
          hazard: 'rewrite',
          rationale:
            'MySQL rebuilds the table. Dropping a key on its own blocks concurrent writes; dropping and adding in one statement does not.',
        };
      }
      return {
        hazard: 'rewrite',
        rationale:
          'Postgres rewrites the table, and promoting a nullable column to a key scans it in full to prove no NULL exists.',
      };

    case 'add-enum-value':
      if (!pg) {
        return {
          hazard: 'refused',
          rationale: 'Only Postgres has a native enum type to extend.',
          refusal: 'UNSUPPORTED_ON_DIALECT',
        };
      }
      return {
        hazard: 'safe',
        rationale:
          'Adding a value to a native Postgres enum is instant — but it runs outside the transaction and cannot be undone.',
      };

    /*
     * MEASURED, not assumed (D23). On PostgreSQL 18.3
     * `ALTER TABLE … ADD GENERATED BY DEFAULT AS IDENTITY` left
     * `pg_relation_filenode` unchanged — catalog only — but every ALTER TABLE
     * takes ACCESS EXCLUSIVE, so it is `locking`, not `safe`. On MySQL 26.7
     * `MODIFY … AUTO_INCREMENT` refuses both `ALGORITHM=INSTANT` ("Need to
     * rebuild the table to change column type") and `ALGORITHM=INPLACE`
     * ("Cannot change column type INPLACE. Try ALGORITHM=COPY"), so it is a
     * full copy. SQLite has no syntax for it at all.
     */
    case 'set-identity':
    case 'drop-identity':
      if (lite) return rebuild('auto-increment is part of the column declaration');
      if (my) {
        return {
          hazard: 'rewrite',
          rationale:
            'MySQL cannot add or remove AUTO_INCREMENT in place — it refuses both INSTANT and INPLACE and copies the whole table.',
        };
      }
      return {
        hazard: nonEmpty(ctx) ? 'locking' : 'safe',
        rationale:
          kind === 'set-identity'
            ? 'Postgres attaches the identity sequence in the catalog without rewriting the table, and restarts it past the highest existing value; the table is locked for the moment that takes.'
            : 'Postgres detaches the identity sequence in the catalog; the values already in the column are untouched.',
      };

    case 'rebuild-table':
      return {
        hazard: 'rewrite',
        rationale:
          'SQLite rebuilds the table: a new table is created, every row copied, the old one dropped, and indexes and triggers recreated.',
      };
  }
}
