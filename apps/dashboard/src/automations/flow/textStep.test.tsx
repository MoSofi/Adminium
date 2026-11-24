// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Send text" step (comp `Text Templates` X36): offered in the step
 * picker beside the e-mail step, edited in its own card, and kept exactly as
 * it is through whatever the builder does to the rule.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionSettings, type ActionSettingsProps } from './inspector/ActionSettings.js';
import { FlowBuilder, type FlowBuilderProps } from './FlowBuilder.js';
import type { Sources, SourceTable } from '../api.js';
import type { ActionNode, Graph } from '../model/graph.js';
import { duplicate, move, patchNode, remove } from '../model/ops.js';
import { subLineFor } from '../model/summaries.js';
import { isActionComplete } from '../model/validate.js';
import { ACTION_STEPS, iconForNode } from '../model/vocabulary.js';

const TEXT = { kind: 'text', templateKey: 'clinic-reminder-text', to: { kind: 'field', column: 'mobile' }, vars: { name: '{{record.name}}' }, notAfter: 'visit_at' } as ActionNode['action'];
const STEP = { id: 'send', kind: 'action', title: 'Text the patient', sub: null, onError: false, action: TEXT } as ActionNode;
const GRAPH: Graph = {
  version: 1,
  nodes: [{ id: 't', kind: 'trigger', title: 'A visit is booked' }, STEP, { id: 'n', kind: 'action', title: 'Tell the desk', sub: null, onError: false, action: { kind: 'notification', to: { roles: [] }, title: 'Booked', body: null } }],
};

const TABLE = {
  id: 'main.visits',
  label: 'Visits',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: null, updated: null },
  columns: [
    { name: 'mobile', label: 'Mobile', logicalType: 'text', isPk: false, pii: true, emailLike: false, dateLike: false },
    { name: 'name', label: 'Name', logicalType: 'text', isPk: false, pii: false, emailLike: false, dateLike: false },
    { name: 'visit_at', label: 'Visit at', logicalType: 'datetime', isPk: false, pii: false, emailLike: false, dateLike: true },
  ],
} as unknown as SourceTable;

const sources = (extra: Partial<Sources> = {}): Sources =>
  ({ connections: [], templates: [], roles: [], textTemplates: [{ key: 'clinic-reminder-text', name: 'Visit reminder', body: '{{practice}}: visit {{record.visit_at}} for {{name}}.' }], textsConnected: true, ...extra }) as Sources;

const noop = (): void => undefined;
const flow: FlowBuilderProps = { graph: GRAPH, selectedId: 'send', runningId: null, ranIds: [], incompleteId: null, onSelect: noop, onRemove: noop, onInsert: noop, onMoveTo: noop, onMoveIntoBranch: noop, subFor: (node) => subLineFor(node, null) };
const stepOf = (graph: Graph, id = 'send') => graph.nodes.find((node) => node.id === id) as ActionNode;
const settings = (props: Partial<ActionSettingsProps> = {}) => render(<ActionSettings action={TEXT} sources={sources()} table={TABLE} connectionId="c1" onChange={noop} {...props} />);

afterEach(cleanup);

describe('the Send text step', () => {
  it('is offered beside the e-mail step, empty', () => {
    const keys = ACTION_STEPS.map((step) => step.key);
    expect(keys.indexOf('text')).toBe(keys.indexOf('email') + 1);
    const step = ACTION_STEPS.find((one) => one.key === 'text');
    expect(step?.action).toEqual({ kind: 'text', templateKey: null, to: null, vars: {} });
    expect(isActionComplete(step!.action!)).toBe(false);
  });

  it('draws the step by its title with its own icon and sentence', () => {
    render(<FlowBuilder {...flow} />);
    expect(screen.getByText('Text the patient')).toBeTruthy();
    expect(iconForNode('action', TEXT)).toBe('message-square-text');
    expect(subLineFor(STEP, null)).toBe('Text · clinic-reminder-text → mobile');
    expect(isActionComplete(TEXT)).toBe(true);
  });

  it('edits the template, the number column and the moment', () => {
    const onChange = vi.fn();
    settings({ onChange });
    expect((screen.getByTestId('text-step-template') as HTMLSelectElement).value).toBe('clinic-reminder-text');
    fireEvent.change(screen.getByTestId('text-step-template'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ templateKey: null, vars: {} });
    fireEvent.change(screen.getByTestId('text-step-not-after'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ notAfter: undefined });
  });

  it('asks only for the placeholders the record does not fill, and counts a sample text', () => {
    const onChange = vi.fn();
    settings({ onChange });
    expect(screen.getByTestId('text-step-var-practice')).toBeTruthy();
    expect(screen.queryByTestId('text-step-var-name')).toBeNull();
    expect(screen.queryByTestId('text-step-var-record.visit_at')).toBeNull();
    fireEvent.change(screen.getByTestId('text-step-var-practice'), { target: { value: 'Rowan Health' } });
    expect(onChange).toHaveBeenLastCalledWith({ vars: { name: '{{record.name}}', practice: 'Rowan Health' } });
    expect(screen.getByTestId('text-step-counter').getAttribute('data-segments')).toBe('1');
    expect(screen.getByTestId('text-step-checked').textContent).toContain('checked when it sends');
  });

  it('says to connect a provider first when none is', () => {
    settings({ sources: sources({ textsConnected: false }) });
    expect(screen.getByTestId('text-step-no-provider').textContent).toContain('Connect a provider in Texts first.');
    cleanup();
    settings();
    expect(screen.queryByTestId('text-step-no-provider')).toBeNull();
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
