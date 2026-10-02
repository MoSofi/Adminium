// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the automation rules page hands the assistant. PROTOTYPE — a local
 * spike: it creates a NEW rule from a chat and nothing else.
 *
 * A MANAGER HOST. There is no `applyDraft`: the page's flow builder edits a
 * SAVED rule, so *Open in builder* is the save flow with the rule selected
 * afterwards. The rule lands switched off either way.
 *
 * THE PREVIEW IS A LIST, NOT THE CANVAS. The steps are worded by the same
 * summaries the builder's cards use, so what is read here is what the builder
 * will say — but it is not the builder's drawing.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';

import type { AssistantHostContext } from '../assistant/hostContext.js';
import { tableForTrigger, type Sources } from './api.js';
import type { FlowNode, Graph, Trigger } from './model/graph.js';
import { subLineFor, triggerSentence } from './model/summaries.js';
import { invalidateRules } from './queries.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function StepList({ nodes, sources, trigger, depth }: { nodes: readonly FlowNode[]; sources: Sources | null; trigger: Trigger; depth: number }): ReactNode {
  const table = tableForTrigger(sources, trigger);
  return (
    <ol className={depth > 0 ? 'ms-4 flex flex-col gap-2' : 'flex flex-col gap-2'}>
      {nodes.map((node) => (
        <li key={node.id} className="rounded-lg border border-border bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">
              {node.kind === 'action' ? node.action.kind : node.kind}
            </span>
            {node.title}
          </div>
          <div className="mt-0.5 text-[12px] text-fg-subtle">
            {node.kind === 'trigger' ? triggerSentence(trigger, table) : subLineFor(node, table)}
          </div>
          {node.kind === 'branch'
            ? node.branches.map((branch) => (
                <div key={branch.id} className="mt-2">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{branch.label}</div>
                  <StepList nodes={branch.nodes as readonly FlowNode[]} sources={sources} trigger={trigger} depth={1} />
                </div>
              ))
            : null}
        </li>
      ))}
    </ol>
  );
}

function RulePreview({ artefact, sources }: { artefact: Record<string, unknown>; sources: Sources | null }): ReactNode {
  const trigger = artefact['trigger'] as Trigger | undefined;
  const graph = artefact['graph'] as Graph | undefined;
  const name = typeof artefact['name'] === 'string' ? artefact['name'] : '';
  const description = typeof artefact['description'] === 'string' ? artefact['description'] : '';
  if (trigger === undefined || graph === undefined || !Array.isArray(record(graph)['nodes'])) return null;
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="assistant-rule-preview">
      <div>
        <div className="text-[15px] font-semibold text-fg">{name}</div>
        {description === '' ? null : <div className="text-[12px] text-fg-subtle">{description}</div>}
      </div>
      <StepList nodes={graph.nodes} sources={sources} trigger={trigger} depth={0} />
    </div>
  );
}

export function useAutomationAssistant(input: {
  sources: Sources | null;
  /** After a save that asked to open the rule: the page selects it and opens the unfinished step. */
  onOpen: (id: string, incompleteNodeId: string | null) => void;
}): AssistantHostContext {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sources } = input;
  // A ref: the page passes a fresh closure every render, and the host object must not change with it.
  const onOpen = useRef(input.onOpen);
  onOpen.current = input.onOpen;

  const renderPreview = useCallback(
    (artefact: Record<string, unknown>) => <RulePreview artefact={artefact} sources={sources} />,
    [sources],
  );
  const onCreated = useCallback(
    (created: { id: string; kind: string; name: string }) => {
      void invalidateRules(queryClient).then(() => {
        // Selected either way: a rule that was just made is the one to look at.
        onOpen.current(created.id, null);
        void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, rule: created.id }) });
      });
    },
    [navigate, queryClient],
  );
  return useMemo(
    () => ({ context: 'automation', host: { connectionIds: [] }, renderPreview, onCreated }),
    [onCreated, renderPreview],
  );
}
