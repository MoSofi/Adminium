// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A running turn's steps, live.
 *
 * The same shape as the campaign runner's `useRunProgress`: while a turn has a
 * job, subscribe to `jobs:<jobId>`; each `progress` event carries one step's
 * state as JSON, and anything else on the channel means the turn reached a
 * terminal state and the caller should read the row.
 *
 * WHY THE STEPS ARE FOLDED HERE AND NOT READ FROM THE ROW. A turn writes its
 * steps as it goes, but a person watching wants the row to APPEAR when its
 * call is issued and complete when the executor returns — polling the row for
 * that would be slower than the work it is describing. The row is what a
 * reload reads; this is what an open modal watches.
 *
 * A browser with no socket is not broken: it simply sees nothing until the
 * terminal fetch, which carries the same steps.
 */
import { useEffect, useRef, useState } from 'react';

import { createRealtimeClient } from '../app/ws.js';
import type { AssistantStepView } from './api.js';

/**
 * One step's progress, as the job publishes it.
 *
 * TYPE-ONLY MIRROR of `AssistantStepEvent` in `@adminium/llm` — the dashboard
 * may not import that package (`dependency-cruiser`), so the envelope is
 * restated here and the two change together.
 */
interface StepEvent {
  kind: 'step';
  id: string;
  state: 'started' | 'done' | 'failed';
  icon: string;
  label: string;
  detail: string;
  tables: string[];
  /** Only the page-read step carries these, and it carries no sentence. */
  facts?: Record<string, string | number | boolean>;
  note: { kind: 'ready' } | { kind: 'warnings'; count: number } | null;
}

/** A step row as the card draws it: the event, plus the note it carried. */
export interface LiveStep extends AssistantStepView {
  note: { kind: 'ready' } | { kind: 'warnings'; count: number } | null;
}

function readStepEvent(message: unknown): StepEvent | null {
  if (typeof message !== 'string' || message === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.kind !== 'step' || typeof raw.id !== 'string') return null;
  const state = raw.state;
  if (state !== 'started' && state !== 'done' && state !== 'failed') return null;
  const note = raw.note;
  return {
    kind: 'step',
    id: raw.id,
    state,
    icon: typeof raw.icon === 'string' ? raw.icon : 'search',
    label: typeof raw.label === 'string' ? raw.label : '',
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    tables: Array.isArray(raw.tables) ? raw.tables.filter((entry): entry is string => typeof entry === 'string') : [],
    ...(isFacts(raw.facts) ? { facts: raw.facts } : {}),
    note: readNote(note),
  };
}

/** The page-read step's bag of named facts — strings, numbers and flags only. */
function isFacts(value: unknown): value is Record<string, string | number | boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => ['string', 'number', 'boolean'].includes(typeof entry));
}

function readNote(value: unknown): LiveStep['note'] {
  if (typeof value !== 'object' || value === null) return null;
  const note = value as Record<string, unknown>;
  if (note.kind === 'ready') return { kind: 'ready' };
  if (note.kind === 'warnings' && typeof note.count === 'number') return { kind: 'warnings', count: note.count };
  return null;
}

export interface TurnProgress {
  /** Every step this turn has reached, in the order they started. */
  steps: LiveStep[];
}

/**
 * Follow one turn's job. `onTerminal` fires once, when the channel says the
 * work stopped — the caller reads the row then, which is what carries the
 * answer the steps were only narrating.
 */
export function useTurnProgress(jobId: string | null, onTerminal: () => void): TurnProgress {
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const terminalRef = useRef(onTerminal);
  terminalRef.current = onTerminal;

  useEffect(() => {
    setSteps([]);
    if (jobId === null) return;
    let stopped = false;
    const client = createRealtimeClient({
      channels: [`jobs:${jobId}`],
      onEvent: (event) => {
        if (event.type === 'progress') {
          const data = (typeof event.data === 'object' && event.data !== null ? event.data : {}) as {
            message?: unknown;
          };
          const step = readStepEvent(data.message);
          if (step === null) return;
          setSteps((previous) => {
            const next = [...previous];
            const at = next.findIndex((entry) => entry.id === step.id);
            const row: LiveStep = {
              id: step.id,
              state: step.state,
              icon: step.icon,
              label: step.label,
              detail: step.detail,
              tables: step.tables,
              // The page-read step travels as facts and no sentence; drop them
              // and its row draws blank.
              ...(step.facts === undefined ? {} : { facts: step.facts }),
              note: step.note,
            };
            // A step is added when it starts and REPLACED when it finishes:
            // the row keeps its place in the list, which is what makes the
            // card read as one thing happening after another.
            if (at === -1) next.push(row);
            else next[at] = row;
            return next;
          });
          return;
        }
        if (stopped) return;
        stopped = true;
        terminalRef.current();
      },
    });
    client.start();
    return () => {
      client.stop();
    };
  }, [jobId]);

  return { steps };
}
