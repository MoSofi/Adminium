/**
 * `flow-builder` (annex §10) — a vertical workflow canvas of typed nodes
 * (trigger=accent, condition=warn, action=pos) joined by connectors, with live
 * insert/remove, an action-palette popover (2-col grid of addable node types)
 * and header run stats. Evidence: Automation Rules.
 *
 * PRESENTATIONAL: nodes live in local state; every change is a `mutate` intent.
 * The widget never runs a flow and never persists one.
 *
 * Binds §3 `form-state` for the same reason as `rule-builder`: an empty canvas
 * is a builder awaiting its trigger, not an empty widget, and must show the
 * palette rather than the frame's "no data" state.
 *
 * REORDER/INSERT: nodes are added at the END and removed individually — there is
 * no drag layer here. `@dnd-kit` is CONFINED to the `boards` family by the
 * chunk-budget gate (04 §2.3), and pulling a drag engine into `forms` would put
 * it in the chunk of every page that renders a settings toggle.
 */

import { IconTile, Popover, PopoverClose, PopoverContent, PopoverTrigger, cn } from '@adminium/ui';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { DEFAULT_FLOW_PALETTE, flowBuilderConfigSchema, flowBuilderDemoData } from './forms-config.js';
import type { FlowBuilderConfig, FlowNodeConfig } from './forms-config.js';
import { FLOW_NODE_KINDS, FLOW_NODE_TONE, canAppendNode } from './forms-builders.js';
import type { FlowNodeKind } from './forms-builders.js';
import { formIcon } from './forms-icons.js';
import { numberField, oneOf, stringField } from './forms-lib.js';
import { bindingTargetOf, formValuesOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { flowBuilderConfigSchema, flowBuilderDemoData };
export type { FlowBuilderConfig };

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  icon?: string | undefined;
  title: string;
  sub?: string | undefined;
}

type Rec = Record<string, unknown>;

/** Project the §3 `form-state` payload onto ordered flow nodes. */
export function flowNodesOf(data: unknown, config: FlowBuilderConfig): FlowNode[] {
  const values = formValuesOf(data);
  const raw = values['nodes'];
  if (!Array.isArray(raw)) return [];
  const kinds = config.nodeKinds ?? FLOW_NODE_KINDS;
  const out: FlowNode[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as Rec;
    const title = stringField(row, 'title');
    if (title === undefined) continue;
    const kind = oneOf(row['kind'], FLOW_NODE_KINDS, 'action');
    // A node whose kind this flow disables is dropped: it names a step the host
    // was configured not to run, so rendering it would show a workflow that
    // does something the flow cannot actually do.
    if (!kinds.includes(kind)) continue;
    out.push({
      id: stringField(row, 'id') ?? `node-${index}`,
      kind,
      icon: stringField(row, 'icon'),
      title,
      sub: stringField(row, 'sub'),
    });
  }
  return out;
}

/** Header run stats (annex §10), or `null` when the payload carries none. */
export function flowStatsOf(data: unknown): { runs: number; successRate: number } | null {
  const values = formValuesOf(data);
  const runs = numberField(values, 'runs');
  const successRate = numberField(values, 'successRate');
  if (runs === undefined || successRate === undefined) return null;
  return { runs, successRate };
}

export function FlowBuilderWidget({ config, data, onEvent }: WidgetProps<FlowBuilderConfig>) {
  const [nodes, setNodes] = useState<FlowNode[]>(() => flowNodesOf(data, config));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const stats = flowStatsOf(data);
  const target = bindingTargetOf(config.binding);
  const enabledKinds = config.nodeKinds ?? FLOW_NODE_KINDS;
  const palette = (config.palette ?? DEFAULT_FLOW_PALETTE).filter((node) => enabledKinds.includes(node.kind));

  const commit = (next: FlowNode[]) => {
    setNodes(next);
    if (target === null) return; // unbound (demo/story/palette)
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: target.connectionId,
      table: target.table,
      values: {
        nodes: next.map((node) => ({
          id: node.id,
          kind: node.kind,
          ...(node.icon === undefined ? {} : { icon: node.icon }),
          title: node.title,
          ...(node.sub === undefined ? {} : { sub: node.sub }),
        })),
      },
    });
  };

  const addNode = (entry: FlowNodeConfig) => {
    if (nodes.length >= config.maxNodes || !canAppendNode(entry.kind, nodes)) return;
    setPaletteOpen(false);
    commit([
      ...nodes,
      {
        // The palette id is the TYPE, not the instance — two "Send email" steps
        // in one flow must not collide on a React key or on the stored node id.
        id: `${entry.id}-${nodes.length}`,
        kind: entry.kind,
        icon: entry.icon,
        title: entry.title ?? entry.id,
        sub: entry.sub,
      },
    ]);
  };

  const atCapacity = nodes.length >= config.maxNodes;

  return (
    <div
      data-widget="flow-builder"
      data-testid={config.testId}
      className="flex h-full flex-col gap-2 overflow-auto px-4 pb-4"
    >
      {stats !== null && (
        <p data-part="flow-stats" className="text-caption text-fg-muted">
          {(config.statsTemplate ?? '{runs} runs · {rate}% success')
            .replace('{runs}', String(stats.runs))
            .replace('{rate}', String(stats.successRate))}
        </p>
      )}

      {nodes.length === 0 && (
        <p data-part="flow-empty" className="text-body-sm text-fg-muted">
          {config.emptyBody ?? 'No steps yet — add a trigger to start this workflow.'}
        </p>
      )}

      <ol className="m-0 flex list-none flex-col p-0">
        {nodes.map((node, index) => {
          const tone = FLOW_NODE_TONE[node.kind];
          return (
            <li key={node.id} data-part="flow-node" data-kind={node.kind} data-node={node.id}>
              {index > 0 && (
                // The connector is a block-axis rule: `ms-5` keeps it under the
                // icon tile in BOTH directions (it mirrors with the row).
                <div aria-hidden="true" data-part="flow-connector" className="ms-5 h-3 w-px bg-border-strong" />
              )}
              <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 px-2.5 py-2.5">
                <IconTile size="md" tone={tone} icon={formIcon(node.icon)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-bold text-fg">{node.title}</p>
                  {node.sub !== undefined && <p className="truncate text-caption text-fg-muted">{node.sub}</p>}
                </div>
                <button
                  type="button"
                  data-part="flow-remove"
                  aria-label={`${config.removeLabel ?? 'Remove step'} — ${node.title}`}
                  onClick={() => commit(nodes.filter((_, i) => i !== index))}
                  className={
                    'rounded-md p-1 text-fg-subtle transition-colors duration-150 hover:bg-surface-3 hover:text-fg ' +
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                  }
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {nodes.length > 0 && <div aria-hidden="true" className="ms-5 h-3 w-px bg-border-strong" />}

      <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-part="add-node"
            disabled={atCapacity || palette.length === 0}
            className={cn(
              'flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5',
              'text-caption font-semibold text-fg-muted transition-colors duration-150',
              'hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {config.addLabel ?? 'Add step'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" data-part="palette" className="w-[min(24rem,90vw)]">
          <p className="mb-2 text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {config.paletteTitle ?? 'Add a step'}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {palette.map((entry) => {
              const blocked = !canAppendNode(entry.kind, nodes);
              return (
                <PopoverClose asChild key={entry.id}>
                  <button
                    type="button"
                    data-part="palette-node"
                    data-kind={entry.kind}
                    data-node={entry.id}
                    disabled={blocked}
                    onClick={() => addNode(entry)}
                    className={cn(
                      'flex items-start gap-2 rounded-md border border-border p-2 text-start transition-colors duration-150',
                      'hover:border-accent hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-40',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    )}
                  >
                    <IconTile size="sm" tone={FLOW_NODE_TONE[entry.kind]} icon={formIcon(entry.icon)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption font-bold text-fg">{entry.title ?? entry.id}</span>
                      {entry.sub !== undefined && (
                        <span className="block truncate text-caption text-fg-muted">{entry.sub}</span>
                      )}
                    </span>
                  </button>
                </PopoverClose>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
