// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the automation rules page hands the assistant.
 *
 * THE PREVIEW IS THE BUILDER'S OWN DRAWING (comp `Milo Automations` 01): the
 * page's canvas and cards, small and read-only, so what the card shows is
 * what the builder will show. Its steps are also said in words, for a reader
 * who cannot see a picture.
 *
 * WITH A RULE OPEN, THE PAGE IS AN EDITOR. The assistant is sent the rule as
 * it is on the screen (unsaved changes and all), and a change it drafts to
 * THAT rule goes into the page's own unsaved draft (`applyDraft`): the dirty
 * marker and the leave warning are the page's, and nothing is saved until the
 * person saves. A draft of a NEW rule is saved through the page's own route,
 * switched off.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';

import type { AssistantHostContext } from '../assistant/hostContext.js';
import { t } from '../i18n/t.js';
import { tableForTrigger, type Sources } from './api.js';
import { FlowBuilder } from './flow/FlowBuilder.js';
import { addOnNameOf, stepOf } from './model/addOnSteps.js';
import type { FlowNode, Graph, Trigger } from './model/graph.js';
import { subLineFor, triggerSentence } from './model/summaries.js';
import { invalidateRules } from './queries.js';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The steps of a flow, every branch's own among them. */
function everyNode(graph: Graph): FlowNode[] {
  return graph.nodes.flatMap((node) => (node.kind === 'branch' ? [node, ...node.branches.flatMap((branch) => branch.nodes as FlowNode[])] : [node]));
}

/**
 * The draft as the builder draws it: the page's own canvas and cards, small
 * and read-only (comp `Milo Automations` 01). Nothing in it takes a click or
 * a key: it is a picture of the rule, and the card's own buttons act on it.
 * A step the open rule does not have yet says who added it.
 */
export function RulePreview({ artefact, sources, base, name }: { artefact: Record<string, unknown>; sources: Sources | null; base: Graph | null; name: string }): ReactNode {
  const trigger = artefact['trigger'] as Trigger | undefined;
  const graph = artefact['graph'] as Graph | undefined;
  if (trigger === undefined || graph === undefined || !Array.isArray(record(graph)['nodes'])) return null;
  const table = tableForTrigger(sources, trigger);
  const known = base === null ? null : new Set(everyNode(base).map((node) => node.id));
  return (
    <div data-testid="assistant-rule-preview" {...{ inert: true }} aria-hidden="true">
      <FlowBuilder
        readOnly
        compact
        graph={graph}
        selectedId={null}
        runningId={null}
        ranIds={[]}
        incompleteId={null}
        subFor={(node) => subLineFor(node, table)}
        triggerSub={triggerSentence(trigger, table)}
        tagFor={(node) => (known === null || known.has(node.id) || node.kind === 'trigger' ? null : t('assistant:automation.addedBy', 'Added by {name}', { name }))}
        addOnFor={(node) => (node.kind === 'action' && node.action.kind === 'add-on.step' ? { name: addOnNameOf(stepOf(sources, trigger.connectionId, node.action), node.action), gone: null } : null)}
        onSelect={noop}
        onRemove={noop}
        onInsert={noop}
        onMoveTo={noop}
        onMoveIntoBranch={noop}
      />
      {/* What a screen reader is told of the picture: the steps, in order. */}
    </div>
  );
}

const noop = (): void => undefined;

/** The steps of a draft in words, for whoever cannot see the picture: one line a step. */
function RuleOutline({ artefact, sources }: { artefact: Record<string, unknown>; sources: Sources | null }): ReactNode {
  const trigger = artefact['trigger'] as Trigger | undefined;
  const graph = artefact['graph'] as Graph | undefined;
  if (trigger === undefined || graph === undefined || !Array.isArray(record(graph)['nodes'])) return null;
  const table = tableForTrigger(sources, trigger);
  return (
    <ol className="sr-only" data-testid="assistant-rule-outline">
      {everyNode(graph).map((node) => (
        <li key={node.id}>
          {node.title}
          {': '}
          {node.kind === 'trigger' ? triggerSentence(trigger, table) : subLineFor(node, table)}
        </li>
      ))}
    </ol>
  );
}

/** The rule that is open in the builder, as it is on the screen: unsaved changes and all. */
export interface OpenRule {
  id: string;
  name: string;
  description: string | null;
  trigger: Trigger;
  graph: Graph;
}

/** A draft's trigger and flow, when it holds both. */
export function ruleOf(artefact: Record<string, unknown>): { trigger: Trigger; graph: Graph } | null {
  const trigger = artefact['trigger'] as Trigger | undefined;
  const graph = artefact['graph'] as Graph | undefined;
  if (trigger === undefined || graph === undefined || !Array.isArray(record(graph)['nodes'])) return null;
  return { trigger, graph };
}

export function useAutomationAssistant(input: {
  sources: Sources | null;
  /** The assistant's name here, for "Added by …". */
  name: string;
  /** The rule open in the builder, when one is and it is the owner's to change. */
  open: OpenRule | null;
  /** Puts a change to the open rule into the page's own unsaved draft. */
  onApply: (rule: { trigger: Trigger; graph: Graph }) => void;
  /** After a save that asked to open the rule: the page selects it and opens the unfinished step. */
  onOpen: (id: string, incompleteNodeId: string | null) => void;
}): AssistantHostContext {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sources, name, open } = input;
  // Refs: the page passes fresh closures every render, and the host object must not change with them.
  const onOpen = useRef(input.onOpen);
  onOpen.current = input.onOpen;
  const onApply = useRef(input.onApply);
  onApply.current = input.onApply;
  const openId = open?.id ?? null;
  const openGraph = open?.graph ?? null;

  const renderPreview = useCallback(
    (artefact: Record<string, unknown>, meta: { basedOn: string | null }) => (
      <>
        {/* A change to the open rule is drawn against it: what is new says so. */}
        <RulePreview artefact={artefact} sources={sources} base={meta.basedOn !== null && meta.basedOn === openId ? openGraph : null} name={name} />
        <RuleOutline artefact={artefact} sources={sources} />
      </>
    ),
    [sources, name, openId, openGraph],
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
  const applyDraft = useCallback((artefact: Record<string, unknown>) => {
    const rule = ruleOf(artefact);
    if (rule !== null) onApply.current(rule);
  }, []);
  return useMemo(
    () =>
      open === null
        ? { context: 'automation', host: { connectionIds: [] }, renderPreview, onCreated }
        : {
            context: 'automation',
            host: { connectionIds: [], documentId: open.id },
            // The rule as it is on the screen, with its id: a change to it is a draft that names that id in `basedOn`.
            draft: { id: open.id, name: open.name, description: open.description, trigger: open.trigger, graph: open.graph },
            renderPreview,
            onCreated,
            applyDraft,
          },
    [onCreated, renderPreview, applyDraft, open],
  );
}
