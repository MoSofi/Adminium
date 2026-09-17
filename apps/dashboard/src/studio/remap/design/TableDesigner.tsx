// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table designer.
 *
 * ─── The vocabulary on screen IS the vocabulary on the wire ────────────────
 *
 * D30 closes what a client may author: fourteen types, five default kinds,
 * checks only as enum membership. Those closures are enforced at the route's
 * Zod gate, so a UI offering more would produce 422s the user cannot act on.
 * The type select lists exactly the fourteen; there is no free-text default
 * field and no expression box, because there is nowhere for their values to go.
 *
 * ─── The key choice is honest per dialect (D31) ────────────────────────────
 *
 * A new table's key must be generated in a way the CRUD insert path can read
 * back: RETURNING on postgres and sqlite, `insertId` on MySQL — and `insertId`
 * only works for a single auto-increment column. So a database-generated uuid
 * key is offered on Postgres ONLY, and the reason is on screen rather than
 * discovered as a refusal after Apply.
 */
import { Button, FormField, IconButton, Input, Select, Switch } from '@adminium/ui';
import { useState } from 'react';
import { Info, Trash2 } from 'lucide-react';

import { t } from '../../../i18n/t.js';
import { FieldHelpModal } from './FieldHelpModal.js';
import { blankColumn } from './useDesignBuffer.js';
import {
  AUTHORABLE_TYPES,
  type AuthorableType,
  type DesiredColumn,
  type DesiredForeignKey,
  type DesiredTable,
} from './types.js';

/** Types whose length or precision the designer offers. */
const SIZED: ReadonlySet<AuthorableType> = new Set(['varchar']);
const PRECISE: ReadonlySet<AuthorableType> = new Set(['decimal']);

/**
 * The identifier rule, checked where the person is typing.
 *
 * `^[a-z][a-z0-9_]*$` is the server's gate (`INVALID_IDENTIFIER`) and it is
 * not advisory: these strings reach SQL, and `install-ddl.ts` relies on the
 * same regex to keep authored text out of emitted statements. Letting the
 * field accept "f as s" and refusing it four clicks later at Review is a worse
 * version of the same refusal — the person has already built the table.
 *
 * Length is checked too, because the limit is per dialect (63 pg · 64 mysql ·
 * 128 sqlite) and Postgres TRUNCATES silently rather than failing.
 */
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

const MAX_IDENTIFIER: Readonly<Record<string, number>> = {
  postgres: 63,
  mysql: 64,
  sqlite: 128,
};

/**
 * What is wrong with this identifier, or `null`.
 *
 * An EMPTY value is not an error here. A row that has just been added has no
 * name yet, and painting it red the instant it appears blames the user for not
 * having typed. It is still not reviewable — {@link unnamedCount} is what stops
 * Review, with a sentence that asks for the name instead of reporting a fault.
 */
export function identifierError(value: string, dialect: string): string | null {
  if (value === '') return null;
  if (!IDENTIFIER_RE.test(value)) {
    return t(
      'studio:design.error.identifier',
      'Use lowercase letters, numbers and underscores, starting with a letter.',
    );
  }
  const max = MAX_IDENTIFIER[dialect] ?? 128;
  if (value.length > max) {
    return t('studio:design.error.tooLong', 'Too long — {dialect} allows {max} characters.', {
      dialect,
      max,
    });
  }
  return null;
}

export interface TableDesignerProps {
  table: DesiredTable;
  dialect: string;
  /**
   * Tables this one may link to, with the column a link would point at.
   * `keyColumn` is the target's primary key — a foreign key must reference a
   * column covered by a unique constraint, and the primary key is the one
   * Adminium can always name.
   */
  linkTargets?: {
    id: string;
    name: string;
    keyColumn: string | null;
    /** The key's type, so linking can make the two sides match. */
    keyType?: AuthorableType | null;
  }[];
  onChange: (table: DesiredTable) => void;
  /** True while this table already exists — its name becomes a rename. */
  existing: boolean;
}

export function TableDesigner({
  table,
  dialect,
  linkTargets = [],
  onChange,
  existing,
}: TableDesignerProps) {
  const setColumn = (index: number, patch: Partial<DesiredColumn>): void => {
    onChange({
      ...table,
      columns: table.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    });
  };

  const removeColumn = (index: number): void => {
    const removed = table.columns[index];
    if (removed === undefined) return;
    onChange({
      ...table,
      columns: table.columns.filter((_, i) => i !== index),
      primaryKey: table.primaryKey.filter((name) => name !== removed.name),
      enumValues: Object.fromEntries(
        Object.entries(table.enumValues).filter(([name]) => name !== removed.name),
      ),
    });
  };

  const [helpOpen, setHelpOpen] = useState(false);

  /** The link on a column, if it has one. One FK per column is the shape the
   *  designer offers — a composite foreign key is a thing the vocabulary
   *  supports and the UI deliberately does not, because it cannot be explained
   *  in a row. */
  const linkFor = (name: string) => table.foreignKeys.find((fk) => fk.columns[0] === name);

  const setLink = (name: string, toTable: string | null): void => {
    const others = table.foreignKeys.filter((fk) => fk.columns[0] !== name);
    if (toTable === null) {
      onChange({ ...table, foreignKeys: others });
      return;
    }
    const target = linkTargets.find((t) => t.id === toTable);
    if (target?.keyColumn == null) return;
    onChange({
      ...table,
      /*
       * Linking ADOPTS the target key's type. A foreign key whose sides are
       * different types is rejected by the database — Postgres refuses it
       * outright, MySQL requires the size and sign to match — and the person
       * choosing "links to clients" has not said anything about types. Leaving
       * the column as its default `text` beside an `integer` key produced a
       * plan that previewed cleanly and failed at apply, which is the one
       * outcome the preview exists to prevent.
       */
      columns: table.columns.map((c) =>
        c.name === name && target.keyType != null
          ? { ...c, logicalType: target.keyType, maxLength: null, numericPrecision: null, numericScale: null }
          : c,
      ),
      foreignKeys: [
        ...others,
        {
          name: null,
          columns: [name],
          toTable: target.id,
          toColumns: [target.keyColumn],
          // The safe default: refuse to delete a row something still points at.
          // CASCADE is offered but never assumed — it deletes the children.
          onDelete: 'restrict',
          onUpdate: null,
        },
      ],
    });
  };

  const setLinkOnDelete = (name: string, onDelete: DesiredForeignKey['onDelete']): void => {
    onChange({
      ...table,
      foreignKeys: table.foreignKeys.map((fk) =>
        fk.columns[0] === name ? { ...fk, onDelete } : fk,
      ),
    });
  };

  const nameError = identifierError(table.name, dialect);

  const togglePrimaryKey = (name: string, on: boolean): void => {
    onChange({
      ...table,
      primaryKey: on ? [...table.primaryKey, name] : table.primaryKey.filter((c) => c !== name),
    });
  };

  /**
   * "Unique" is a single-column UNIQUE constraint. It rides `uniques[]` rather
   * than a flag on the column because that is what the wire vocabulary has and
   * what the planner diffs — a `isUnique` boolean here would have to be
   * translated somewhere, and the translation is the thing that drifts.
   */
  const isUnique = (name: string): boolean =>
    table.uniques.some((u) => u.columns.length === 1 && u.columns[0] === name);

  const toggleUnique = (name: string, on: boolean): void => {
    onChange({
      ...table,
      uniques: on
        ? [...table.uniques, { name: null, columns: [name] }]
        : table.uniques.filter((u) => !(u.columns.length === 1 && u.columns[0] === name)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <FormField
        label={t('studio:design.table.name', 'Table name')}
        error={nameError ?? undefined}
        helper={
          existing
            ? t('studio:design.table.renameHelp', 'Changing this renames the table in your database.')
            : t('studio:design.table.nameHelp', 'Lowercase letters, numbers and underscores.')
        }
      >
        <Input
          value={table.name}
          placeholder={t('studio:design.table.namePlaceholder', 'reservations')}
          error={nameError !== null}
          onChange={(event) => onChange({ ...table, name: event.target.value })}
        />
      </FormField>

      <div className="flex flex-col gap-2">
        <h4 className="text-body font-medium text-fg">
          {t('studio:design.table.columns', 'Columns')}
        </h4>
        <ul className="flex flex-col gap-2">
          {table.columns.map((column, index) => (
            <li
              key={index}
              /*
               * TWO ROWS, not one. The name is what the operator is thinking
               * about; the type and the three switches are how they qualify it.
               * On one row the five controls competed for a pane about 450px
               * wide and the name lost — it collapsed to 33 pixels. Stacking
               * gives the name the full width and the qualifiers a row of their
               * own, and it stops depending on a viewport breakpoint that
               * cannot see the pane it is in.
               */
              className="flex flex-col gap-2 rounded-lg border border-border p-2"
            >
              <div className="flex items-end gap-2">
                <FormField
                  className="min-w-[9rem] flex-1"
                  label={t('studio:design.column.name', 'Name')}
                  error={identifierError(column.name, dialect) ?? undefined}
                  /* `tag` renders in the LABEL row with `ms-auto`, which is
                     where a help affordance belongs: beside the thing it
                     explains, not floating next to the input it does not act
                     on. */
                  tag={
                    <IconButton
                      label={t('studio:design.column.help', 'What do these settings mean?')}
                      size="sm"
                      variant="ghost"
                      onClick={() => setHelpOpen(true)}
                    >
                      <Info className="size-4" aria-hidden="true" />
                    </IconButton>
                  }
                >
                  <Input
                    value={column.name}
                    placeholder={t('studio:design.column.namePlaceholder', 'client_id')}
                    error={identifierError(column.name, dialect) !== null}
                    onChange={(event) => setColumn(index, { name: event.target.value })}
                  />
                </FormField>

                <IconButton
                  label={t('studio:design.column.remove', 'Remove {name}', { name: column.name })}
                  size="sm"
                  variant="ghost"
                  onClick={() => removeColumn(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>

              {/*
                * `items-start`, not `items-end`. Bottom-aligning boxes of
                * different heights misaligns the CONTROLS inside them: the
                * "Links to" field carries helper text, so its box is taller and
                * its select rode 38px above the type select. Every FormField
                * puts its control the same distance below its own top — a
                * 16px `Label` plus the 6px `gap-1.5` — so aligning tops aligns
                * controls, and the switch groups take that same 22px offset.
                */}
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <FormField className="w-32 shrink-0" label={t('studio:design.column.type', 'Type')}>
                  <Select
                    value={column.logicalType}
                    onChange={(event) =>
                      setColumn(index, { logicalType: event.target.value as AuthorableType })
                    }
                  >
                    {AUTHORABLE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </FormField>

                {SIZED.has(column.logicalType) ? (
                  <FormField className="w-24 shrink-0" label={t('studio:design.column.length', 'Length')}>
                    <Input
                      type="number"
                      value={column.maxLength ?? ''}
                      onChange={(event) =>
                        setColumn(index, {
                          maxLength: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                  </FormField>
                ) : PRECISE.has(column.logicalType) ? (
                  <FormField className="w-24 shrink-0" label={t('studio:design.column.precision', 'Precision')}>
                    <Input
                      type="number"
                      value={column.numericPrecision ?? ''}
                      onChange={(event) =>
                        setColumn(index, {
                          numericPrecision:
                            event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                  </FormField>
                ) : null}

                <div className="flex h-[34px] items-center gap-2 mt-[22px]">
                  <Switch
                    id={`col-${index}-required`}
                    checked={!column.nullable}
                    onCheckedChange={(checked) => setColumn(index, { nullable: !checked })}
                  />
                  <label htmlFor={`col-${index}-required`} className="text-caption text-fg-muted">
                    {t('studio:design.column.required', 'Required')}
                  </label>
                </div>

                <div className="flex h-[34px] items-center gap-2 mt-[22px]">
                  <Switch
                    id={`col-${index}-unique`}
                    checked={isUnique(column.name)}
                    onCheckedChange={(checked) => toggleUnique(column.name, checked)}
                  />
                  <label htmlFor={`col-${index}-unique`} className="text-caption text-fg-muted">
                    {t('studio:design.column.unique', 'Unique')}
                  </label>
                </div>

                <div className="flex h-[34px] items-center gap-2 mt-[22px]">
                  <Switch
                    id={`col-${index}-key`}
                    checked={table.primaryKey.includes(column.name)}
                    onCheckedChange={(checked) => togglePrimaryKey(column.name, checked)}
                  />
                  <label htmlFor={`col-${index}-key`} className="text-caption text-fg-muted">
                    {t('studio:design.column.primaryKey', 'Primary key')}
                  </label>
                </div>

                {/*
                  * The link. Offered on every column rather than only on ones
                  * named `*_id`, because guessing from a name is how a designer
                  * refuses the link somebody actually wants — but the primary key
                  * is excluded, since a table's own key pointing at another table
                  * is a different (and rarer) thing than a reference column.
                  */}
                {linkTargets.length > 0 && !table.primaryKey.includes(column.name) ? (
                  <div className="contents">
                    <FormField
                      className="w-44 shrink-0"
                      label={t('studio:design.column.link', 'Links to')}
                      helper={
                        linkFor(column.name) === undefined
                          ? t('studio:design.column.linkHelp', 'Connect this to a row in another table.')
                          : t(
                              'studio:design.column.linkTypeNote',
                              'The type is matched to the linked table’s key.',
                            )
                      }
                    >
                      <Select
                        value={linkFor(column.name)?.toTable ?? ''}
                        onChange={(event) =>
                          setLink(column.name, event.target.value === '' ? null : event.target.value)
                        }
                      >
                        <option value="">{t('studio:design.column.noLink', 'Nothing')}</option>
                        {linkTargets
                          .filter((target) => target.keyColumn !== null)
                          .map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                      </Select>
                    </FormField>

                    {linkFor(column.name) !== undefined ? (
                      <FormField
                        className="w-56 shrink-0"
                        label={t('studio:design.column.onDelete', 'If the linked row is deleted')}
                      >
                        <Select
                          value={linkFor(column.name)?.onDelete ?? 'restrict'}
                          onChange={(event) =>
                            setLinkOnDelete(
                              column.name,
                              event.target.value as DesiredForeignKey['onDelete'],
                            )
                          }
                        >
                          <option value="restrict">
                            {t('studio:design.onDelete.restrict', 'Prevent the deletion')}
                          </option>
                          <option value="cascade">
                            {t('studio:design.onDelete.cascade', 'Delete this row too')}
                          </option>
                          <option value="set-null">
                            {t('studio:design.onDelete.setNull', 'Leave this field empty')}
                          </option>
                        </Select>
                      </FormField>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <div>
          <Button
            variant="secondary"
            onClick={() => onChange({ ...table, columns: [...table.columns, blankColumn()] })}
          >
            {t('studio:design.table.addColumn', 'Add column')}
          </Button>
        </div>
      </div>

      {table.primaryKey.length === 0 ? (
        <p className="text-body-sm text-fg-muted">
          {t(
            'studio:design.table.noKey',
            'This table has no primary key, so Adminium will treat it as read-only — rows can be listed but not edited.',
          )}
        </p>
      ) : null}

      {dialect !== 'postgres' ? (
        <p className="text-body-sm text-fg-muted">
          {t(
            'studio:design.table.uuidKeyUnavailable',
            'On this engine a key must be a generated integer: a database-generated uuid cannot be read back after an insert.',
          )}
        </p>
      ) : null}

      <FieldHelpModal open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
