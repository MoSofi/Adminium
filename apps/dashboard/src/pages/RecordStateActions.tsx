// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BUTTONS OF A RECORD — the actions its table's states declare, as the
 * server offered them to this reader.
 *
 * The page shows the ones offered in the state the row is in, and sends an
 * action's id, that state and the few values the action asks for. It never
 * names the state a move leads to nor a column an action sets, and it never
 * decides who may press what: both are the server's.
 *
 * A move or a write that asks for something, or that says "are you sure",
 * opens a small dialog first. A refusal that names a field stays in the
 * dialog, on the field, with what was typed; any other is said on the page
 * under the record's heading, where it stays until the next action.
 */
import { useRouter } from '@tanstack/react-router';
import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { api } from '../app/api.js';
import type { StateActionFact } from '../api/pages.js';
import { t } from '../i18n/t.js';
import { recordRefusal, refusedFields } from './recordRefusal.js';

/** At most this many buttons beside Edit; the rest go under "More". */
const BUTTONS_MAX = 3;
const TONE_ORDER: Record<StateActionFact['tone'], number> = { primary: 0, neutral: 1, danger: 2 };
const VARIANT = { primary: 'primary', neutral: 'secondary', danger: 'destructive' } as const;

/** A column's name as a field's label, where the server sent no words for it (`sent_how` → `Sent how`). */
function humanized(column: string): string {
  const words = column.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface RecordStateActionsProps {
  actions: readonly StateActionFact[];
  /** The state the row is in, as the page read it; null while it is not known. */
  state: string | null;
  connectionId: string;
  /** The table's id, as the data routes take it. */
  table: string;
  recordId: string;
  /** A page that changes nothing (read-only, or closed by its parent) offers only the ways out of it: links. */
  linksOnly?: boolean;
  /** An action was made: the record, and whatever lists it, are read again. */
  onDone: () => void;
  /** What to say under the record's heading; null takes it away. */
  onRefused: (words: string | null) => void;
}

interface Asking {
  action: StateActionFact;
  /** The fields the dialog draws: an action's `ask`, or a child form's columns. */
  fields: { column: string; label: string; required: boolean }[];
  values: Record<string, string>;
  errors: Record<string, string>;
}

export function RecordStateActions({ actions, state, connectionId, table, recordId, linksOnly = false, onDone, onRefused }: RecordStateActionsProps): ReactNode {
  const router = useRouter();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const offered = useMemo(
    () =>
      actions
        .filter((action) => state !== null && action.from.includes(state) && (!linksOnly || action.kind === 'link'))
        // Stable: among actions of one tone, the order the app wrote them in.
        .map((action, index) => ({ action, index }))
        .sort((a, b) => TONE_ORDER[a.action.tone] - TONE_ORDER[b.action.tone] || a.index - b.index)
        .map((entry) => entry.action),
    [actions, state, linksOnly],
  );
  if (offered.length === 0) return null;

  const base = `/api/v1/data/${encodeURIComponent(connectionId)}`;

  async function make(action: StateActionFact, typed: Record<string, string>): Promise<void> {
    setBusy(action.id);
    try {
      // Only what was typed is sent; an empty optional field is no value at all.
      const values = Object.fromEntries(Object.entries(typed).filter(([, value]) => value !== ''));
      if (action.kind === 'child' && action.child !== undefined) {
        // A plain create of the child row: what the form asked for, the action's own fixed values, and this record as its parent.
        await api.post(`${base}/${encodeURIComponent(action.child.table)}`, { values: { ...values, ...(action.set ?? {}), [action.child.via]: recordId } });
      } else {
        await api.post(`${base}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}/actions/${encodeURIComponent(action.id)}`, {
          from: state,
          ...(Object.keys(values).length === 0 ? {} : { values }),
        });
      }
      setAsking(null);
      onRefused(null);
      onDone();
    } catch (error) {
      const fields = refusedFields(error);
      const known = fields === null ? [] : Object.keys(fields).filter((column) => asking?.fields.some((field) => field.column === column));
      if (fields !== null && asking !== null && known.length > 0) {
        // On the field, with the dialog and what was typed left as they are.
        setAsking({ ...asking, values: typed, errors: Object.fromEntries(known.map((column) => [column, fields[column]!])) });
      } else {
        setAsking(null);
        onRefused(recordRefusal(error));
        // The row may have moved on: what the page shows is read again either way.
        onDone();
      }
    } finally {
      setBusy(null);
    }
  }

  function press(action: StateActionFact): void {
    if (action.kind === 'link') {
      if (action.href !== undefined) router.history.push(`${action.href}${encodeURIComponent(recordId)}`);
      return;
    }
    const fields = action.kind === 'child' ? (action.child?.form ?? []).map((column) => ({ column, label: humanized(column), required: false })) : (action.ask ?? []);
    if (fields.length > 0 || action.confirm !== undefined) {
      setAsking({ action, fields, values: Object.fromEntries(fields.map((field) => [field.column, ''])), errors: {} });
      return;
    }
    void make(action, {});
  }

  const shown = offered.slice(0, BUTTONS_MAX);
  const more = offered.slice(BUTTONS_MAX);
  return (
    <span className="inline-flex items-center gap-1.5" data-part="record-state-actions">
      {shown.map((action) => (
        <Button key={action.id} size="sm" variant={VARIANT[action.tone]} disabled={busy !== null} onClick={() => press(action)}>
          {action.label}
        </Button>
      ))}
      {more.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary" iconLeft={<MoreHorizontal />} disabled={busy !== null}>
              {t('ui:pages.record.more', 'More')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label={t('ui:pages.record.more', 'More')}>
            {more.map((action) => (
              <DropdownMenuItem key={action.id} destructive={action.tone === 'danger'} onSelect={() => press(action)}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {asking === null ? null : (
        <Modal open size="sm" onOpenChange={(open) => (open || busy !== null ? undefined : setAsking(null))}>
          <ModalHeader title={asking.action.label} closeLabel={t('ui:action.close', 'Close')} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const missing = asking.fields.filter((field) => field.required && asking.values[field.column] === '');
              if (missing.length > 0) {
                setAsking({ ...asking, errors: Object.fromEntries(missing.map((field) => [field.column, t('ui:pages.record.fieldRequired', 'Fill this in first.')])) });
                return;
              }
              void make(asking.action, asking.values);
            }}
          >
            <ModalBody>
              <div className="flex flex-col gap-4">
                {asking.action.confirm === undefined ? null : <p className="text-body text-fg">{asking.action.confirm}</p>}
                {asking.fields.map((field) => (
                  <FormField key={field.column} label={field.label} required={field.required} error={asking.errors[field.column]}>
                    <Input
                      value={asking.values[field.column] ?? ''}
                      onChange={(event) => setAsking({ ...asking, values: { ...asking.values, [field.column]: event.target.value }, errors: Object.fromEntries(Object.entries(asking.errors).filter(([column]) => column !== field.column)) })}
                    />
                  </FormField>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setAsking(null)}>
                {t('ui:pages.record.cancel', 'Cancel')}
              </Button>
              <Button type="submit" variant={VARIANT[asking.action.tone === 'neutral' ? 'primary' : asking.action.tone]} disabled={busy !== null}>
                {busy !== null ? t('ui:pages.record.working', 'Working…') : asking.action.label}
              </Button>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </span>
  );
}
