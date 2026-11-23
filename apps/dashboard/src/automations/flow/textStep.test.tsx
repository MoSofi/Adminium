// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The builder has no screen for a "Send text" step yet. It must still open a
 * rule that holds one: draw the step by its title, leave its settings alone,
 * and hand it back to the server exactly as it came when the rule is saved.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionSettings, type ActionSettingsProps } from './inspector/ActionSettings.js';
import { FlowBuilder, type FlowBuilderProps } from './FlowBuilder.js';
import type { ActionNode, Graph } from '../model/graph.js';
import { duplicate, move, patchNode, remove } from '../model/ops.js';
import { subLineFor } from '../model/summaries.js';
import { isActionComplete } from '../model/validate.js';
import { iconForNode, KIND_META } from '../model/vocabulary.js';

const TEXT = { kind: 'text', templateKey: 'clinic-reminder-text', to: { kind: 'field', column: 'mobile' }, vars: { name: '{{record.name}}' }, notAfter: 'visit_at' } as unknown as ActionNode['action'];
const STEP = { id: 'send', kind: 'action', title: 'Text the patient', sub: null, onError: false, action: TEXT } as ActionNode;
const GRAPH: Graph = {
  version: 1,
  nodes: [{ id: 't', kind: 'trigger', title: 'A visit is booked' }, STEP, { id: 'n', kind: 'action', title: 'Tell the desk', sub: null, onError: false, action: { kind: 'notification', to: { roles: [] }, title: 'Booked', body: null } }],
};

const noop = (): void => undefined;
const flow: FlowBuilderProps = { graph: GRAPH, selectedId: 'send', runningId: null, ranIds: [], incompleteId: null, onSelect: noop, onRemove: noop, onInsert: noop, onMoveTo: noop, onMoveIntoBranch: noop, subFor: (node) => subLineFor(node, null) };
const stepOf = (graph: Graph, id = 'send') => graph.nodes.find((node) => node.id === id) as ActionNode;

afterEach(cleanup);

describe('a rule with a Send text step, in a builder with no screen for it', () => {
  it('draws the step by its title, beside the steps it knows', () => {
    render(<FlowBuilder {...flow} />);
    expect(screen.getByText('Text the patient')).toBeTruthy();
    expect(screen.getByText('Tell the desk')).toBeTruthy();
  });

  it('gives it the action icon and no sentence, and leaves judging it to the server', () => {
    expect(iconForNode('action', TEXT)).toBe(KIND_META.action.icon);
    expect(subLineFor(STEP, null)).toBe('');
    expect(isActionComplete(TEXT)).toBe(true);
  });

  it('opens no settings for it', () => {
    const { container } = render(<ActionSettings {...({ action: TEXT, onChange: noop, connectionId: null } as unknown as ActionSettingsProps)} />);
    expect(container.textContent).toBe('');
  });

  it('keeps its settings through what the builder can do to the rule', () => {
    expect(stepOf(patchNode(GRAPH, 'send', { title: 'Renamed' })).action).toEqual(TEXT);
    expect(stepOf(move(GRAPH, 'send', 1)).action).toEqual(TEXT);
    expect(stepOf(remove(GRAPH, 'n')).action).toEqual(TEXT);
    const copied = duplicate(GRAPH, 'send');
    expect(stepOf(copied.graph, copied.nodeId).action).toEqual(TEXT);
    expect(JSON.parse(JSON.stringify(patchNode(GRAPH, 'n', { title: 'Other' }))).nodes[1].action).toEqual(TEXT);
  });
});
