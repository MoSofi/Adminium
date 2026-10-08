// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The architecture as a diagram: three bands — the people, what they use,
 * and Adminium — with the app's tables laid out by dagre inside the last, its
 * emails beside them, its add-ons and what comes with Adminium below. The
 * bands are fixed columns; only the tables are laid out, so fourteen tables
 * work as well as five. The canvas fits its width and pans.
 *
 * Selecting a node lights its lines and fades the rest; a second press
 * clears it.
 */
import { useMemo, type ReactNode } from 'react';
import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { Globe, IdCard, LayoutDashboard, Mail, Puzzle, UserCog, UserRound, type LucideIcon } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { ArchitectureDoc } from '../api.js';
import { builtInIcon, builtInLabel, kindLabel, nodeLabel, useLabel } from './words.js';

const COL = { people: 0, uses: 210, app: 470 } as const;
const TABLE = { width: 150, height: 52 } as const;

interface BoxFields {
  icon: LucideIcon;
  title: string;
  sub: string | null;
  tone: 'person' | 'use' | 'table' | 'add-on' | 'tile' | 'email' | 'band';
  lit: boolean;
  faded: boolean;
  pending: boolean;
}
type BoxData = BoxFields & Record<string, unknown>;

function Box({ data }: { data: BoxData }): ReactNode {
  if (data.tone === 'band') {
    return <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-fg-subtle">{data.title}</div>;
  }
  const Icon = data.icon;
  return (
    <div
      className={`relative flex h-full w-full items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 text-start shadow-sm transition-opacity ${
        data.lit ? 'border-accent ring-2 ring-accent' : 'border-border'
      } ${data.faded ? 'opacity-50' : ''} ${data.tone === 'add-on' ? 'border-dashed' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-fg-subtle" />
      <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
      <span className="flex min-w-0 flex-col">
        <span className={`truncate text-[12.5px] font-bold text-fg ${data.tone === 'table' ? 'font-mono' : ''}`}>{data.title}</span>
        {data.sub === null ? null : <span className="truncate text-[11px] text-fg-subtle">{data.sub}</span>}
      </span>
      {data.pending ? <span aria-hidden="true" className="absolute -end-1 -top-1 size-2.5 rounded-full bg-warn" /> : null}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-fg-subtle" />
    </div>
  );
}

const nodeTypes = { box: Box };

export function Diagram({ doc, selected, onSelect }: { doc: ArchitectureDoc; selected: string | null; onSelect: (id: string | null) => void }): ReactNode {
  const pending = useMemo(() => new Set(doc.pending.map((entry) => entry.node).filter((id): id is string => id !== null)), [doc.pending]);
  const linked = useMemo(() => {
    if (selected === null) return null;
    const ids = new Set<string>([selected]);
    for (const edge of doc.edges) {
      if (edge.from === selected) ids.add(edge.to);
      if (edge.to === selected) ids.add(edge.from);
    }
    return ids;
  }, [doc.edges, selected]);

  const { nodes, edges } = useMemo(() => {
    const out: Node<BoxData>[] = [];
    const box = (id: string, x: number, y: number, width: number, height: number, data: Omit<BoxFields, 'lit' | 'faded' | 'pending'>): void => {
      out.push({
        id,
        type: 'box',
        position: { x, y },
        style: { width, height },
        draggable: false,
        selectable: data.tone !== 'band',
        data: { ...data, lit: selected === id, faded: linked !== null && !linked.has(id), pending: pending.has(id) },
        ariaLabel: data.sub === null ? data.title : `${data.title}, ${data.sub}`,
      });
    };
    box('band-people', COL.people, 0, 160, 20, { icon: UserRound, title: t('designer:arch.people', 'People'), sub: null, tone: 'band' });
    box('band-uses', COL.uses, 0, 200, 20, { icon: UserRound, title: t('designer:arch.uses', 'What they use'), sub: null, tone: 'band' });
    box('band-app', COL.app, 0, 300, 20, { icon: UserRound, title: t('designer:arch.adminium', 'Adminium'), sub: null, tone: 'band' });

    doc.people.forEach((person, index) => {
      box(person.id, COL.people, 40 + index * 64, 160, 48, {
        icon: person.kind === 'customers' ? Globe : UserCog,
        title: nodeLabel(person),
        sub: person.kind === 'customers' ? t('designer:arch.customersSub', 'through a customer key') : t('designer:arch.role', 'Role'),
        tone: 'person',
      });
    });
    doc.uses.forEach((use, index) => {
      box(use.id, COL.uses, 40 + index * 84, 200, 60, {
        icon: use.id === 'dashboard' ? LayoutDashboard : use.id === 'staff' ? IdCard : UserRound,
        title: useLabel(use.id),
        sub:
          use.id === 'dashboard'
            ? t('designer:arch.pages', '{count, plural, one {# page} other {# pages}}', { count: use.count })
            : t('designer:arch.screens', '{count, plural, one {# screen} other {# screens}}', { count: use.count }),
        tone: 'use',
      });
    });

    // The app's tables, laid out by dagre, its own relations ranking them.
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 48, marginx: 0, marginy: 0 });
    for (const table of doc.tables) g.setNode(table.id, { width: TABLE.width, height: TABLE.height });
    for (const edge of doc.edges) if (edge.kind === 'relation') g.setEdge(edge.from, edge.to);
    dagre.layout(g);
    let right: number = COL.app;
    let bottom = 40;
    for (const table of doc.tables) {
      const at = g.node(table.id) as { x: number; y: number } | undefined;
      const x = COL.app + (at?.x ?? 0) - TABLE.width / 2;
      const y = 40 + (at?.y ?? 0) - TABLE.height / 2;
      right = Math.max(right, x + TABLE.width);
      bottom = Math.max(bottom, y + TABLE.height);
      box(table.id, x, y, TABLE.width, TABLE.height, {
        icon: LayoutDashboard,
        title: table.ref,
        sub: table.rows === null ? null : t('designer:arch.rows', '{count, plural, one {# row} other {# rows}}', { count: table.rows }),
        tone: 'table',
      });
    }
    doc.emails.forEach((email, index) => {
      box(email.id, right + 60, 40 + index * 60, 170, 48, { icon: Mail, title: email.name, sub: t('designer:arch.email', 'Email'), tone: 'email' });
    });
    let rowY = bottom + 48;
    doc.addOns.forEach((addOn, index) => {
      box(addOn.id, COL.app + index * 230, rowY, 220, 54, {
        icon: Puzzle,
        title: addOn.name,
        sub: `${addOn.need === 'required' ? t('designer:arch.required', 'Required') : t('designer:arch.suggested', 'Suggested')} · ${
          addOn.state === 'installed' ? t('designer:arch.installed', 'Installed {version}', { version: addOn.version ?? '' }) : t('designer:arch.notInstalled', 'Not installed')
        }`,
        tone: 'add-on',
      });
    });
    if (doc.addOns.length > 0) rowY += 54 + 32;
    box('band-builtin', COL.app, rowY, 300, 20, { icon: UserRound, title: t('designer:arch.comesWith', 'Comes with Adminium'), sub: null, tone: 'band' });
    doc.builtIn.forEach((tile, index) => {
      box(`b_${tile}`, COL.app + (index % 3) * 170, rowY + 28 + Math.floor(index / 3) * 52, 160, 42, { icon: builtInIcon(tile), title: builtInLabel(tile), sub: null, tone: 'tile' });
    });

    const ids = new Set(out.map((node) => node.id));
    const lines: Edge[] = doc.edges
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map((edge) => {
        const lit = linked !== null && (edge.from === selected || edge.to === selected);
        const label =
          edge.kind === 'customer-key' && edge.reads !== undefined
            ? t('designer:arch.keyCounts', '{reads} read, {writes} write', { reads: edge.reads, writes: edge.writes ?? 0 })
            : edge.does === 'posts'
              ? t('designer:arch.posts', 'Posts into')
              : undefined;
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          ...(label === undefined ? {} : { label }),
          ...(edge.kind === 'relation' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
          className: [
            lit ? '[&_.react-flow__edge-path]:!stroke-accent [&_.react-flow__edge-path]:!stroke-2' : '',
            linked !== null && !lit ? 'opacity-30' : '',
            edge.kind === 'customer-key' ? '[&_.react-flow__edge-path]:[stroke-dasharray:5_4]' : '',
          ]
            .join(' ')
            .trim(),
          ariaLabel: `${kindLabel(edge.kind)}: ${edge.from} → ${edge.to}`,
        };
      });
    return { nodes: out, edges: lines };
  }, [doc, linked, pending, selected]);

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-xl border border-border bg-surface-2 max-md:h-[380px]" role="group" aria-label={t('designer:arch.diagramLabel', 'Diagram. Use Show as a list for a text version.')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_event, node) => {
          if (node.id.startsWith('band')) return;
          onSelect(selected === node.id ? null : node.id);
        }}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
