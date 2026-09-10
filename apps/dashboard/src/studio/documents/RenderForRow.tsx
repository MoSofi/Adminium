// SPDX-License-Identifier: AGPL-3.0-only
/**
 * §3.7 step 8 — "Render for row…" (34-invoices-add-on.md; 34-T14).
 *
 * ─── WHY A MAPPING NEEDS THIS AT ALL ───────────────────────────────────────
 *
 * Every other step is a promise about data nobody has looked at yet: this
 * column fills that slot, this child table makes the lines. Whether the
 * promise is true is not knowable from the form — a `total` column that turns
 * out to hold pre-tax pennies produces a document that is wrong in a way no
 * validation can see. So the mapping ends by drawing one, from a row the
 * operator picks, and letting them read it.
 *
 * ─── IT NEEDS A SAVED MAPPING ──────────────────────────────────────────────
 *
 * `POST /documents/render` takes a `profileId`, and the pipeline re-reads the
 * mapping from the register rather than trusting a body — which is what stops
 * a caller drawing a document from a mapping nobody agreed to. So this section
 * says so and waits, rather than half-working against an unsaved draft.
 *
 * ─── AND THE DOCUMENT IS A LINK, NOT A POP-UP ──────────────────────────────
 *
 * §3.7 says the document "opens in the sandboxed print route". Rendering is a
 * JOB: the row does not exist when the request resolves, so opening it means
 * `window.open` from a timer or a socket callback seconds later — which every
 * browser blocks, because it is exactly the shape of an unsolicited pop-up.
 * The document is therefore offered as a link the operator clicks, which
 * reaches the same route with a real gesture behind it (DEP-38).
 */

import { Alert, Button, Card, Input, Spinner } from '@adminium/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { createCrudApi } from '../../api/crud.js';
import {
  documentPrintPath,
  entityKey,
  fetchDocumentsForEntity,
  renderDocumentFor,
} from '../../documents/documentsApi.js';
import { t as studioT } from '../../i18n/t.js';
import type { ColumnFacts } from './mapping.js';

/** How long to keep asking whether the job has drawn it. */
const POLL_MS = 1_000;
const GIVE_UP_AFTER = 20;

/**
 * The row's primary key, as the REGISTER addresses it.
 *
 * Built from the table's real key columns rather than assuming `id`: the
 * server re-reads the row with `where <column> = <value>` per entry, so a
 * table keyed `order_no` is drawn from correctly and one with a composite key
 * is drawn from at all.
 */
function pkOf(row: Record<string, unknown>, columns: readonly ColumnFacts[]): Record<string, unknown> {
  const keys = columns.filter((column) => column.primaryKey === true);
  const use = keys.length > 0 ? keys : columns.slice(0, 1);
  return Object.fromEntries(use.map((column) => [column.name, row[column.name]]));
}

/** A few columns worth showing beside the key, so the rows are tellable apart. */
function previewColumns(columns: readonly ColumnFacts[]): ColumnFacts[] {
  const keys = columns.filter((column) => column.primaryKey === true);
  const rest = columns
    .filter((column) => column.primaryKey !== true && column.pii !== true)
    .slice(0, 3);
  return [...keys, ...rest];
}

export function RenderForRow({
  profileId,
  connectionId,
  table,
  columns,
}: {
  profileId: string | null;
  connectionId: string;
  table: string;
  columns: readonly ColumnFacts[];
}) {
  const [query, setQuery] = useState('');
  const [drawnFor, setDrawnFor] = useState<string | null>(null);
  /*
   * The documents this row ALREADY had when the draw started.
   *
   * Without it the poll reads the newest row of the register and finds the
   * document somebody drew last week — instantly, on the first tick — so a
   * second draw of the same row appears to succeed before the job has run,
   * and hands the operator an old document to check the new mapping with.
   */
  const [known, setKnown] = useState<ReadonlySet<string>>(new Set());
  const [tries, setTries] = useState(0);

  const crud = useMemo(() => createCrudApi(connectionId, table), [connectionId, table]);
  const rows = useQuery({
    queryKey: ['studio', 'documents', 'rows', connectionId, table, query],
    queryFn: () => crud.list({ limit: 10, ...(query === '' ? {} : { q: query }) }),
    enabled: profileId !== null,
  });

  /*
   * The register, asked repeatedly while a job is in flight. `refetchInterval`
   * returns false once the row is there, which is what stops the timer — a
   * page that polled forever would keep a connection warm for a document
   * somebody already read.
   */
  const drawn = useQuery({
    queryKey: ['studio', 'documents', 'drawn', table, drawnFor],
    queryFn: async () => {
      setTries((count) => count + 1);
      return await fetchDocumentsForEntity({ entityTable: table, entityId: drawnFor! });
    },
    enabled: drawnFor !== null,
    refetchInterval: (q) => {
      const fresh = (q.state.data ?? []).filter((document) => !known.has(document.id));
      if (fresh.length > 0 || tries >= GIVE_UP_AFTER) return false;
      return POLL_MS;
    },
  });

  const draw = useMutation({
    mutationFn: async (row: Record<string, unknown>) => {
      const pk = pkOf(row, columns);
      const key = entityKey(pk);
      // One read before the write, so "the new one" is knowable at all.
      const before = await fetchDocumentsForEntity({ entityTable: table, entityId: key });
      await renderDocumentFor({ profileId: profileId!, pk });
      return { key, known: new Set(before.map((document) => document.id)) };
    },
    onSuccess: ({ key, known: before }) => {
      setTries(0);
      setKnown(before);
      setDrawnFor(key);
    },
  });

  if (profileId === null) {
    return (
      <p className="text-sm text-fg-muted">
        {studioT(
          'studio:documents.render.saveFirst',
          'Save the mapping first. A document is drawn from a saved one, so you can see what it makes before anybody else does.',
        )}
      </p>
    );
  }

  // Newest first (`documentsRepo.list` orders `createdAt desc`), and only ones
  // this draw made.
  const latest = (drawn.data ?? []).find((document) => !known.has(document.id));
  const waiting = drawnFor !== null && latest === undefined && tries < GIVE_UP_AFTER;
  const preview = previewColumns(columns);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        {studioT(
          'studio:documents.render.intro',
          'Draw one now, from a row you choose. Nothing is sent anywhere — it is kept on the record like any other.',
        )}
      </p>
      <Input
        value={query}
        placeholder={studioT('studio:documents.render.search', 'Search rows')}
        aria-label={studioT('studio:documents.render.search', 'Search rows')}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />

      {rows.isPending ? (
        <Spinner />
      ) : (rows.data?.data ?? []).length === 0 ? (
        <p className="text-sm text-fg-muted">
          {studioT('studio:documents.render.noRows', 'No rows to draw from yet.')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {(rows.data?.data ?? []).map((row, index) => (
            <li key={index} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {preview
                  .map((column) => String(row[column.name] ?? ''))
                  .filter((value) => value !== '')
                  .join(' · ')}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={draw.isPending}
                onClick={() => draw.mutate(row)}
              >
                {studioT('studio:documents.render.pick', 'Draw this one')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {waiting && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner />
          {studioT('studio:documents.render.pending', 'Drawing…')}
        </p>
      )}

      {latest !== undefined && (
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-sm">
            {latest.status === 'rendered'
              ? studioT('studio:documents.render.ready', 'Drawn.')
              : studioT('studio:documents.render.failedRow', 'It did not draw: {reason}', {
                  reason: latest.error ?? latest.status,
                })}
          </span>
          {latest.hasContent && (
            <a
              href={documentPrintPath(latest.id)}
              target="_blank"
              /*
               * `noopener` as well as `noreferrer`: the print view is a
               * sandboxed page of add-on-drawn HTML, and a new tab that kept
               * `window.opener` could navigate this one.
               */
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              {studioT('studio:documents.render.open', 'Open it')}
            </a>
          )}
        </Card>
      )}

      {drawnFor !== null && latest === undefined && tries >= GIVE_UP_AFTER && (
        <Alert tone="warn" title={studioT('studio:documents.render.slowTitle', 'Still nothing')}>
          {/*
           * NOT "it failed". The job may be waiting behind others, or this
           * installation may not be running background jobs at all — in which
           * case nothing draws and there is no error to report, which is the
           * case somebody would otherwise spend an afternoon on.
           *
           * It is worded as a possibility because it IS one: whether jobs run
           * is a composition option the dashboard cannot see, so a definite
           * claim either way would be a guess.
           */}
          {studioT(
            'studio:documents.render.slow',
            "No document has appeared yet. It may still be waiting its turn, or this installation may not be running background jobs — nothing draws until it does.",
          )}
        </Alert>
      )}
    </div>
  );
}
