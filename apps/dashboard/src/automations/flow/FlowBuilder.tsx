// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The flow builder — the comp's canvas, its nodes, its connectors and its
 * branch brackets (236-314, 502-544).
 *
 * The geometry is the comp's, to the pixel, because it is the whole drawing:
 * a 34 px connector with a 24 px round `+` between every pair of nodes
 * (253-259); an 18 px stem into a branch, a 14 px top bracket inset by
 * `calc(25% - 5.5px)` and `calc(50% + 11px)` wide, two columns at gap 18,
 * an 8 px stem out of each and the mirrored bottom bracket (274-307); a 26 px
 * stem to the full-width dashed "Add step" (310-311).
 *
 * --- DEPARTURE D13: dnd-kit, not HTML5 drag ------------------------------
 *
 * The comp uses `draggable` + `onDragEnter → moveTo` (261, 521). The BRIEF
 * locks dnd-kit for the whole product, and the two behave the same way from
 * the person's side: a node dragged onto another lands BEFORE it, a node
 * dropped on a branch's dashed "Add step" is appended to that branch, a
 * branch never enters a branch, the trigger never moves. What dnd-kit adds
 * is a keyboard drag (Space, then arrows) that HTML5 drag cannot do at all,
 * which is why the inspector's Move up / Move down — the comp's own controls
 * (151-152) — are the documented path and this is the pointer one.
 *
 * The 4 px pointer activation distance is what keeps a CLICK a click: every
 * node is also the thing you click to inspect it.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState, type ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { automationIcon } from '../icons.js';
import type { Branch, FlowNode, Graph } from '../model/graph.js';
import { KIND_META, iconForNode } from '../model/vocabulary.js';

export interface FlowBuilderProps {
  graph: Graph;
  /** The node the inspector is open on (comp's `state.inspect`). */
  selectedId: string | null;
  /** The node the Test animation is on right now, and the ones it finished. */
  runningId: string | null;
  ranIds: readonly string[];
  /** The step the server refused to enable on — lit until it is fixed (D12). */
  incompleteId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onInsert: (target: { index: number; branchId?: string }) => void;
  onMoveTo: (dragId: string, targetId: string) => void;
  onMoveIntoBranch: (dragId: string, branchId: string) => void;
  /** The node's sub-line, computed from its settings (Appendix A summaries). */
  subFor: (node: FlowNode) => string;
  /** For a step an add-on gives: the add-on's name over the card, and — when the add-on is gone — the sentence that says so (comp `Milo Automations` 5a, 5c). */
  addOnFor?: ((node: FlowNode) => { name: string; gone: string | null } | null) | undefined;
  /** Shown, not changed (a rule that came with an app or an add-on): no place to add a step. */
  readOnly?: boolean;
  /** A small drawing of the flow for a narrow place (the assistant's card): small cards, a tight frame. */
  compact?: boolean;
  /** A word on a step's card saying where it came from ("Added by Milo"); null for none. */
  tagFor?: ((node: FlowNode) => string | null) | undefined;
  /** The trigger's own second line, where the page that draws the flow has one. */
  triggerSub?: string | undefined;
}

const STEM = 'w-0.5 flex-1 bg-border-strong';

/** The line between two steps where none can be added. */
function Stem(): ReactNode {
  return (
    <div className="flex h-[26px] flex-col items-center">
      <span className={STEM} />
    </div>
  );
}

export function FlowBuilder(props: FlowBuilderProps): ReactNode {
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function onDragEnd(event: DragEndEvent): void {
    const over = event.over;
    const active = String(event.active.id);
    setDragId(null);
    if (over === null || String(over.id) === active) return;
    const target = String(over.id);
    if (target.startsWith('branch:')) props.onMoveIntoBranch(active, target.slice('branch:'.length));
    else props.onMoveTo(active, target);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => {
        setDragId(String(event.active.id));
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragId(null);
      }}
    >
      {/* The canvas: surface-2, 24/28/26 padding, an inner column capped at
          660 px and centred (comp 250-251). */}
      <div className={props.compact === true ? 'bg-surface-2 px-3 py-3' : 'bg-surface-2 px-7 pb-[26px] pt-6'}>
        <div className="mx-auto flex max-w-[660px] flex-col items-stretch">
          {props.graph.nodes.map((node, index) => (
            <div key={node.id} className="flex flex-col items-stretch">
              {index > 0 ? props.readOnly === true ? <Stem /> : <Connector onClick={() => { props.onInsert({ index }); }} /> : null}
              <NodeCard {...props} node={node} dragId={dragId} small={props.compact === true} />
              {node.kind === 'branch' ? (
                <BranchGroup {...props} node={node} dragId={dragId} />
              ) : null}
            </div>
          ))}

          {props.readOnly === true ? null : (
            <>
              <div className="flex h-[26px] flex-col items-center">
                <span className={STEM} />
              </div>
              <button
                type="button"
                onClick={() => {
                  props.onInsert({ index: props.graph.nodes.length });
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[13px] border-[1.5px] border-dashed border-border-strong bg-surface p-[13px] text-[13px] font-bold text-fg-muted hover:border-accent hover:bg-accent-soft hover:text-accent"
                data-testid="flow-add-end"
              >
                <Plus className="size-4" />
                {t('automations:canvas.addStep', 'Add step')}
              </button>
            </>
          )}
        </div>
      </div>
    </DndContext>
  );
}

function Plus({ className }: { className: string }): ReactNode {
  const Icon = automationIcon('plus');
  return <Icon aria-hidden className={className} />;
}

/** The 34 px connector with its round `+` (comp 253-259). */
function Connector({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <div className="flex h-[34px] flex-col items-center">
      <span className={STEM} />
      <button
        type="button"
        onClick={onClick}
        title={t('automations:canvas.insert', 'Insert step here')}
        aria-label={t('automations:canvas.insert', 'Insert step here')}
        className="flex size-6 items-center justify-center rounded-full border-[1.5px] border-border-strong bg-surface text-fg-subtle hover:border-accent hover:bg-accent-soft hover:text-accent"
      >
        <Plus className="size-[13px]" />
      </button>
      <span className={STEM} />
    </div>
  );
}

interface NodeCardProps extends FlowBuilderProps {
  node: FlowNode;
  dragId: string | null;
  small: boolean;
}

/** Comp 261-272 (large) and 284-295 (small) — one component, two sizes. */
function NodeCard(props: NodeCardProps): ReactNode {
  const { node, small } = props;
  const meta = KIND_META[node.kind];
  const icon = iconForNode(node.kind, node.kind === 'action' ? node.action : null);
  const Icon = automationIcon(icon);
  const selected = props.selectedId === node.id;
  const running = props.runningId === node.id;
  const dimmed = props.runningId !== null && !running;
  const ran = props.ranIds.includes(node.id);
  const incomplete = props.incompleteId === node.id;
  const movable = node.kind !== 'trigger';

  const draggable = useDraggable({ id: node.id, disabled: !movable });
  const droppable = useDroppable({ id: node.id, disabled: !movable });
  const sub = node.kind === 'trigger' && props.triggerSub !== undefined ? props.triggerSub : props.subFor(node);
  const tag = props.tagFor?.(node) ?? null;
  const addOn = props.addOnFor?.(node) ?? null;
  const gone = addOn?.gone ?? null;

  return (
    <div
      ref={(element) => {
        draggable.setNodeRef(element);
        droppable.setNodeRef(element);
      }}
      {...(movable ? draggable.listeners : {})}
      {...(movable ? draggable.attributes : {})}
      // A group, not a button: the card holds controls of its own (remove), and a button may hold none.
      // It is still reached by Tab, opened with Enter and moved from the keyboard.
      role="group"
      aria-label={node.title}
      tabIndex={0}
      aria-current={selected}
      onClick={() => {
        props.onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onSelect(node.id);
      }}
      data-testid={`flow-node-${node.id}`}
      className={[
        'group relative rounded-[13px] border border-s-[3px] transition-shadow select-none',
        gone === null ? `bg-surface ${meta.borderLeft}` : 'border-s-danger bg-danger-soft',
        small ? 'px-3 py-[11px]' : 'px-[15px] py-3.5',
        movable ? 'cursor-grab' : 'cursor-pointer',
        // The comp's three ring states: running 30 %, selected 13 %, else the
        // card shadow (comp 524).
        running
          ? 'border-accent ring-[3px] ring-accent/30'
          : incomplete || gone !== null
            ? 'border-danger ring-[3px] ring-danger/20'
            : selected
              ? 'border-accent ring-[3px] ring-accent/15'
              : 'border-border shadow-sm',
        props.dragId === node.id ? 'opacity-40' : dimmed ? 'opacity-50' : 'opacity-100',
      ].join(' ')}
    >
      <div className={`flex items-center ${small ? 'gap-2.5' : 'gap-3'}`}>
        <div
          className={`flex shrink-0 items-center justify-center ${gone === null ? `${meta.soft} ${meta.text}` : 'bg-surface text-danger'} ${
            small ? 'size-8 rounded-[9px]' : 'size-10 rounded-[11px]'
          }`}
        >
          <Icon aria-hidden className={small ? 'size-4' : 'size-[19px]'} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={`font-extrabold uppercase tracking-[0.07em] ${gone === null ? meta.text : 'text-danger'} ${small ? 'text-[9px]' : 'text-[9.5px]'}`}
            data-testid={addOn === null ? undefined : 'flow-node-add-on'}
          >
            {addOn === null ? t(meta.labelKey, meta.fallback) : addOn.name}
          </div>
          <div
            className={`mt-[3px] font-bold tracking-[-0.01em] ${small ? 'text-[12.5px]' : 'text-[13.5px]'}`}
          >
            {node.title}
          </div>
          {sub === '' ? null : (
            <div className={`mt-0.5 text-fg-muted ${small ? 'text-[11px]' : 'text-[11.5px]'}`}>{sub}</div>
          )}
          {tag === null ? null : (
            <span data-testid="flow-node-tag" className="mt-1.5 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-bold text-accent">
              {tag}
            </span>
          )}
        </div>
        {ran ? (
          <span
            className={`flex shrink-0 items-center justify-center rounded-full bg-pos-soft text-pos ${
              small ? 'size-5' : 'size-[22px]'
            }`}
          >
            <Check className={small ? 'size-3' : 'size-[13px]'} />
          </span>
        ) : null}
        {movable ? (
          <button
            type="button"
            aria-label={t('automations:canvas.remove', 'Remove step')}
            onClick={(event) => {
              event.stopPropagation();
              props.onRemove(node.id);
            }}
            className="flex size-[26px] shrink-0 items-center justify-center rounded-lg text-fg-subtle opacity-0 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className={small ? 'size-[13px]' : 'size-3.5'} />
          </button>
        ) : null}
      </div>
      {gone === null ? null : (
        <div role="alert" data-testid="flow-node-gone" className="mt-3 flex items-center gap-2.5 border-t border-danger/25 pt-3">
          <Alert className="size-3.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 text-[12px] font-semibold leading-[1.45] text-danger">{gone}</span>
          {props.readOnly === true ? null : (
            <button
              type="button"
              data-testid="flow-node-gone-remove"
              onClick={(event) => {
                event.stopPropagation();
                props.onRemove(node.id);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-[5px] text-[11.5px] font-bold text-fg hover:border-border-strong"
            >
              <Trash className="size-3" />
              {t('automations:canvas.remove', 'Remove step')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Alert({ className }: { className: string }): ReactNode {
  const Icon = automationIcon('circle-alert');
  return <Icon aria-hidden className={className} />;
}

function Trash({ className }: { className: string }): ReactNode {
  const Icon = automationIcon('trash-2');
  return <Icon aria-hidden className={className} />;
}

function Check({ className }: { className: string }): ReactNode {
  const Icon = automationIcon('check');
  return <Icon aria-hidden className={className} />;
}

function X({ className }: { className: string }): ReactNode {
  const Icon = automationIcon('x');
  return <Icon aria-hidden className={className} />;
}

/** The branch block: stem, bracket, two columns, stems, bracket (comp 274-307). */
function BranchGroup(props: FlowBuilderProps & { node: FlowNode; dragId: string | null }): ReactNode {
  const { node } = props;
  if (node.kind !== 'branch') return null;
  return (
    <>
      <div className="flex h-[18px] flex-col items-center">
        <span className={STEM} />
      </div>
      <div className="ms-[calc(25%-5.5px)] h-3.5 w-[calc(50%+11px)] rounded-t-xl border-2 border-b-0 border-border-strong" />
      <div className="grid grid-cols-2 gap-[18px]">
        {node.branches.map((branch, index) => (
          <BranchColumn key={branch.id} {...props} branch={branch} first={index === 0} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-[18px]">
        <div className="flex justify-center">
          <span className="h-2 w-0.5 bg-border-strong" />
        </div>
        <div className="flex justify-center">
          <span className="h-2 w-0.5 bg-border-strong" />
        </div>
      </div>
      <div className="ms-[calc(25%-5.5px)] h-3.5 w-[calc(50%+11px)] rounded-b-xl border-2 border-t-0 border-border-strong" />
    </>
  );
}

function BranchColumn(
  props: FlowBuilderProps & { dragId: string | null; branch: Branch; first: boolean },
): ReactNode {
  const { branch, first } = props;
  const drop = useDroppable({ id: `branch:${branch.id}` });
  return (
    <div className="flex min-w-0 flex-col items-stretch">
      <div className="flex h-3.5 flex-col items-center">
        <span className={STEM} />
      </div>
      <div className="flex justify-center">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-[10.5px] font-extrabold tracking-[0.03em] ${
            first ? 'bg-warn-soft text-warn' : 'border border-border-strong bg-surface-3 text-fg-muted'
          }`}
        >
          {branch.label}
        </span>
      </div>
      {branch.nodes.map((child) => (
        <div key={child.id} className="flex flex-col items-stretch">
          <div className="flex h-4 flex-col items-center">
            <span className={STEM} />
          </div>
          <NodeCard {...props} node={child} small />
        </div>
      ))}
      {props.readOnly === true ? null : (
        <>
          <div className="flex min-h-4 flex-1 flex-col items-center">
            <span className={STEM} />
          </div>
          <button
            ref={drop.setNodeRef}
            type="button"
            onClick={() => {
              props.onInsert({ index: branch.nodes.length, branchId: branch.id });
            }}
            data-testid={`flow-branch-add-${branch.id}`}
            className={`flex select-none items-center justify-center gap-1.5 rounded-[11px] border-[1.5px] border-dashed p-[9px] text-xs font-bold ${
              drop.isOver
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border-strong bg-surface text-fg-subtle hover:border-accent hover:bg-accent-soft hover:text-accent'
            }`}
          >
            <Plus className="size-3.5" />
            {t('automations:canvas.addStep', 'Add step')}
          </button>
        </>
      )}
    </div>
  );
}
