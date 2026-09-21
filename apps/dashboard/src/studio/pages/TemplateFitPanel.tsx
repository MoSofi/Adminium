// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this template needs from the table the operator just picked — and what
 * to do about it.
 *
 * Until now the create screen offered every table in the picker and found out
 * only on submit that a calendar needs a date column, in a 422 whose text was
 * written for whoever wrote the composer. The panel moves that answer BEFORE
 * the create and turns it into offers, which is the whole difference between a
 * refusal and a repair.
 *
 * THE ORDER OF THE OFFERS IS THE DESIGN. Cheapest, least destructive and least
 * knowledge-demanding first, because someone who does not know their own schema
 * has to be able to reach a working page before anything writes to their
 * database:
 *
 *   0. a table they already have that already fits — no writes at all, and the
 *      most common real failure is not a broken table but the wrong one,
 *      picked by someone who did not know which one carried the date;
 *   1. a column they already have, marked for what it means — one override row,
 *      no DDL, no hazard, reversible from the Column Inspector;
 *   2. a table LINKED to this one that has the dates — the calendar is built on
 *      it and each event is titled through the key with this table's name
 *      column. No writes, nothing to author: the foreign key is the join;
 *   3. the columns it is missing, added to the table they picked — real DDL,
 *      through plan 35's plan → review → apply doors, and the first offer here
 *      that writes to their database;
 *   4. a new table with everything the page needs — the same doors, and the
 *      offer that always works, because it depends on nothing they already
 *      have. `FitTableSetup` is shared with the create screen's "no table yet"
 *      entry, where there is no picked table and so no panel.
 *
 * Because remedies 3 and 4 ARE DDL, the panel now asks whether this connection
 * can be authored at all — `schemaAuthoring` on the schema reply. A connection that
 * cannot take DDL is shown the reason instead of the offer, rather than being
 * offered a button whose only possible outcome is a 403. Remedies 0 and 1 are
 * unaffected: neither touches the operator's database.
 *
 * Nothing is rendered while the table fits. A screen that congratulates an
 * operator for picking a working table is noise in the path of everyone who
 * picked one.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { studioApi } from '../api.js';
import { FitColumnSetup } from './FitColumnSetup.js';
import { FitTableSetup } from './FitTableSetup.js';
import {
  fittingTablesQuery,
  invalidateAfterTag,
  tagColumnSemantic,
  templateFitQuery,
  type FitRequirementDto,
  type RelatedTableDto,
} from './fitApi.js';
import { schemaAuthoringRefusal } from './schemaAuthoringReason.js';

/**
 * What each role means to someone who has never heard of a semantic tag.
 *
 * Five literal `t()` calls rather than one key built from `requirement.role`:
 * the i18n key-coverage sweep (`packages/i18n/src/key-coverage.test.ts`)
 * resolves literals, and a key assembled at runtime is a key no gate can prove
 * exists — the same reason `EmptyLayoutNotice` spells its three out.
 */
const ROLE_PHRASE: Record<string, () => string> = {
  'event-date': () => t('studio:pages.fit.role.eventDate', 'a date on each row'),
  title: () => t('studio:pages.fit.role.title', 'a text column to show as each row’s title'),
  'status-workflow': () =>
    t('studio:pages.fit.role.status', 'a status column whose values read as workflow states'),
  'person-fk': () => t('studio:pages.fit.role.personFk', 'a link to a table of people'),
  'shift-type': () =>
    t('studio:pages.fit.role.shiftType', 'a column saying which kind of shift each row is'),
};

function phraseFor(role: string): string | null {
  return ROLE_PHRASE[role]?.() ?? null;
}

export interface TemplateFitPanelProps {
  connectionId: string;
  table: string;
  template: string;
  /** Switch the create form to a table that already fits (remedy 0). */
  onUseTable: (tableId: string) => void;
  /**
   * Bind the page to a related table, titled through its key (remedy 2).
   * Absent ⇒ the offer is not shown — the edit screen does not take it yet.
   */
  onUseRelated?: ((related: RelatedTableDto) => void) | undefined;
}

export function TemplateFitPanel({
  connectionId,
  table,
  template,
  onUseTable,
  onUseRelated,
}: TemplateFitPanelProps) {
  const client = useQueryClient();
  // Same query key the create screen reads for its submit gate — react-query
  // dedupes, so the panel and the button are one request and can never
  // disagree about whether the table fits.
  const fit = useQuery(templateFitQuery({ connectionId, table, template }));
  const alternatives = useQuery(
    fittingTablesQuery({
      connectionId,
      table,
      template,
      enabled: fit.data?.satisfied === false,
    }),
  );
  // The same key the create screen's table picker reads, so this is the cached
  // reply rather than a second fetch. It carries three things remedy 3 needs
  // and the fit report does not: the snapshot the DDL plan is built against,
  // the columns a suggested name could collide with, and whether this
  // connection can be authored at all.
  const schema = useQuery({
    queryKey: ['studio', 'schema', connectionId] as const,
    queryFn: () => studioApi.getSchema(connectionId),
    retry: false,
  });
  const [tagging, setTagging] = useState<string | null>(null);

  const tag = useMutation({
    mutationFn: (input: { column: string; semanticType: string }) =>
      tagColumnSemantic({ connectionId, table, ...input }),
    onSuccess: async () => {
      await invalidateAfterTag(client, connectionId);
      setTagging(null);
    },
  });

  if (fit.isError) {
    // Fail OPEN. A fit check that cannot answer must not become a second way to
    // be blocked — the create route runs the same check and will say so.
    return (
      <Alert
        tone="warn"
        role="status"
        data-testid="studio-pages-fit-unknown"
        title={t('studio:pages.fit.checkFailed', 'Adminium could not check this table')}
        body={t(
          'studio:pages.fit.checkFailedBody',
          'You can still create the page. If the table cannot back it, creating it will say so.',
        )}
      />
    );
  }

  // Quiet while unknown, and quiet while it fits: a panel that flickers in on
  // every table click is in the way of the people who picked a working one.
  if (fit.data === undefined || !fit.data.bindable || fit.data.satisfied) return null;

  const unmet: FitRequirementDto[] = fit.data.requirements.filter(
    (requirement) => requirement.satisfiedBy === null && !requirement.optional,
  );
  const phrases = unmet.map((requirement) => phraseFor(requirement.role)).filter(
    (phrase): phrase is string => phrase !== null,
  );
  const offered = alternatives.data?.alternatives ?? [];
  const related = onUseRelated === undefined ? [] : (alternatives.data?.related ?? []);
  const noDdl = schemaAuthoringRefusal(schema.data?.schemaAuthoring);
  const existingColumns =
    schema.data?.model.tables.find((candidate) => candidate.id === table)?.columns ?? [];

  return (
    <div className="flex flex-col gap-3" data-testid="studio-pages-fit">
      <Alert
        tone="warn"
        role="status"
        title={t('studio:pages.fit.title', 'This table cannot back this page yet')}
        body={
          phrases.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span>{t('studio:pages.fit.needs', 'To build this page, the table needs:')}</span>
              <ul className="list-disc ps-5">
                {phrases.map((phrase) => (
                  <li key={phrase}>{phrase}</li>
                ))}
              </ul>
            </div>
          ) : (
            // The generic half: every table-bound template can name the area it
            // could not fill, even the ones with no repair descriptors behind
            // them. Naming it beats "this page cannot be built from that table".
            t('studio:pages.fit.slotOnly', 'Nothing on this table can fill its “{slot}” area.', {
              slot: fit.data.unfilled.map((entry) => entry.slot).join(', '),
            })
          )
        }
      />

      {offered.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="studio-pages-fit-alternatives">
          <div className="flex flex-col">
            <h4 className="text-body-sm font-semibold text-fg">
              {t('studio:pages.fit.alternatives.title', 'Use a table that already fits')}
            </h4>
            <span className="text-[11.5px] text-fg-muted">
              {t(
                'studio:pages.fit.alternatives.help',
                'Nothing is written to your database — this only points the page at a table that already has what it needs.',
              )}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {offered.map((candidate) => (
              <li
                key={candidate.tableId}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-body-sm text-fg">
                    {candidate.label ?? candidate.tableId}
                  </span>
                  {/* The trigger's OWN words for why it fits — naming the
                      column that plays the part the picked table was missing.
                      Inventing a second explanation here is how the panel and
                      the rule start disagreeing.

                      It WRAPS rather than truncating: in this column the
                      reason clipped at `date column "birth_date" + title
                      column "ti…`, which hides the one fact that tells two
                      offered tables apart. */}
                  <span className="text-[11.5px] text-fg-muted">
                    {candidate.reasons[0] ?? candidate.tableId}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`studio-pages-fit-use-${candidate.tableId}`}
                  onClick={() => onUseTable(candidate.tableId)}
                >
                  {t('studio:pages.fit.alternatives.use', 'Use this table')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {unmet.some((requirement) => requirement.taggable.length > 0) ? (
        <section className="flex flex-col gap-2" data-testid="studio-pages-fit-tag">
          <div className="flex flex-col">
            <h4 className="text-body-sm font-semibold text-fg">
              {t('studio:pages.fit.tag.title', 'Use a column you already have')}
            </h4>
            <span className="text-[11.5px] text-fg-muted">
              {t(
                'studio:pages.fit.tag.help',
                'This only records what the column means. Your database is not changed, and you can undo it in Studio → Schema.',
              )}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {unmet.flatMap((requirement) =>
              requirement.taggable.map((candidate) => (
                <li
                  key={`${requirement.role}:${candidate.column}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-mono text-body-sm text-fg">
                      {candidate.column}
                    </span>
                    <span className="truncate text-[11.5px] text-fg-muted">
                      {candidate.logicalType}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={tag.isPending && tagging === candidate.column}
                    disabled={tag.isPending}
                    data-testid={`studio-pages-fit-tag-${candidate.column}`}
                    onClick={() => {
                      setTagging(candidate.column);
                      tag.mutate({
                        column: candidate.column,
                        semanticType: requirement.wants.semantic,
                      });
                    }}
                  >
                    {t('studio:pages.fit.tag.action', 'Use this column')}
                  </Button>
                </li>
              )),
            )}
          </ul>
          {tag.isError ? (
            <Alert
              tone="danger"
              role="alert"
              data-testid="studio-pages-fit-tag-error"
              title={t('studio:pages.fit.tag.failed', 'That column could not be marked')}
              // Saving an override needs `system:schema:remap`, which reaching
              // this screen does not imply. The server's own refusal names the
              // grant, so it is shown rather than replaced.
              body={tag.error instanceof Error ? tag.error.message : ''}
            />
          ) : null}
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="studio-pages-fit-related">
          <div className="flex flex-col">
            <h4 className="text-body-sm font-semibold text-fg">
              {t('studio:pages.fit.related.title', 'Use the dates of a linked table')}
            </h4>
            <span className="text-[11.5px] text-fg-muted">
              {t(
                'studio:pages.fit.related.help',
                'Nothing is written to your database. The page is built on a table linked to this one, and each entry shows a name from this table.',
              )}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {related.map((candidate) => (
              <li
                key={`${candidate.tableId}:${candidate.via}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-body-sm text-fg">
                    {candidate.label ?? candidate.tableId}
                  </span>
                  <span className="text-[11.5px] text-fg-muted">
                    {t(
                      'studio:pages.fit.related.reason',
                      'Dates from “{date}”, each titled with “{title}” through “{via}”',
                      {
                        date: candidate.dateColumn ?? '',
                        title: candidate.titleColumn,
                        via: candidate.via,
                      },
                    )}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`studio-pages-fit-related-${candidate.tableId}-${candidate.via}`}
                  onClick={() => onUseRelated?.(candidate)}
                >
                  {t('studio:pages.fit.alternatives.use', 'Use this table')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        * Remedy 3, last, because it is the first offer that writes to the
        * operator's database. It waits for the schema reply rather than
        * rendering against an empty column list: a suggested name checked
        * against no columns is a name that looks free and is not.
        */}
      {schema.data === undefined ? null : noDdl !== null ? (
        <Alert
          tone="info"
          role="status"
          data-testid="studio-pages-fit-no-ddl"
          title={t('studio:pages.fit.noDdl', 'Adminium cannot change this table for you')}
          body={noDdl}
        />
      ) : (
        <>
          {/* Only with a role to add. The seven templates with no repair
              descriptors have no unmet ROLE, and an empty list used to reach
              `FitColumnSetup`'s "needs a link to another table" notice — a
              sentence about a foreign key on a page that never asked for one. */}
          {unmet.length > 0 ? (
            <FitColumnSetup
              connectionId={connectionId}
              table={table}
              baseSnapshotId={schema.data.snapshotId}
              existingColumns={existingColumns}
              requirements={unmet}
            />
          ) : null}
          {/* Remedy 4, last: the one that brings none of the operator's
              existing rows with it. Renders nothing for the seven templates
              with no repair descriptors (D4). */}
          <FitTableSetup connectionId={connectionId} template={template} onCreated={onUseTable} />
        </>
      )}
    </div>
  );
}
