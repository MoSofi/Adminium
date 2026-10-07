// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A flow that is only shown — a rule that came with an app or an add-on —
 * offers no place to add a step; one that is the owner's offers them all.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FlowBuilder, type FlowBuilderProps } from './FlowBuilder.js';

const GRAPH = {
  version: 1,
  nodes: [
    { id: 't', kind: 'trigger', title: 'An order is sent' },
    { id: 'n', kind: 'action', title: 'Tell the managers', action: { kind: 'notification', to: { roles: [] }, title: 'Sent' } },
  ],
} as unknown as FlowBuilderProps['graph'];

const noop = (): void => undefined;
const props: FlowBuilderProps = { graph: GRAPH, selectedId: null, runningId: null, ranIds: [], incompleteId: null, onSelect: noop, onRemove: noop, onInsert: noop, onMoveTo: noop, onMoveIntoBranch: noop, subFor: () => '' };

describe('a flow\'s places to add a step', () => {
  it('the owner\'s rule has one between its steps and one at the end', () => {
    render(<FlowBuilder {...props} />);
    expect(screen.getAllByRole('button', { name: 'Insert step here' })).toHaveLength(1);
    expect(screen.getByTestId('flow-add-end')).toBeTruthy();
  });

  it('a rule that is only shown has none, and still shows every step', () => {
    render(<FlowBuilder {...props} readOnly />);
    expect(screen.queryByRole('button', { name: 'Insert step here' })).toBeNull();
    expect(screen.queryByTestId('flow-add-end')).toBeNull();
    expect(screen.getByText('An order is sent')).toBeTruthy();
    expect(screen.getByText('Tell the managers')).toBeTruthy();
  });
});
