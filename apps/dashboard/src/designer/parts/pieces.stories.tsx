// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pieces of Adminium Designer's Home: the model button in its three states
 * and the app card of "Start with an app".
 */

import { AppCard } from '../home/StartWithAnApp.js';
import { ModelButton, type DesignerModelState } from '../models/ModelButton.js';

const base: DesignerModelState = {
  loading: false,
  hasModels: true,
  canAdd: true,
  models: {
    connections: [{ id: 'env:anthropic', provider: 'anthropic', source: 'environment', state: 'ok', models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }] }],
    selected: { connectionId: 'env:anthropic', model: 'claude-sonnet-5-5' },
    verdicts: [],
    canAdd: true,
  },
  picked: { connectionId: 'env:anthropic', model: 'claude-sonnet-5-5' },
  canBuild: true,
  cannotBuildMessage: null,
  pick: () => undefined,
};

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/Pieces' };
export default meta;

export const ModelButtons = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col items-start gap-3 bg-surface p-5">
      <ModelButton model={base} />
      <ModelButton model={{ ...base, canBuild: false, cannotBuildMessage: 'no tool call' }} />
      <ModelButton model={{ ...base, hasModels: false, models: undefined, picked: null }} onAdd={() => undefined} />
    </div>
  ),
};

export const AppCards = {
  tags: ['vrt'],
  render: () => (
    <div className="grid w-[640px] grid-cols-2 gap-5 bg-surface-2 p-5">
      <AppCard
        app={{ key: 'tickets', version: '0.2.1', name: 'Event Ticketing', tagline: 'Shows, ticket types, orders and check-in for a small venue.', category: 'Events', sides: ['staff', 'customer'], copyable: true, iconTint: null, iconPaths: [], monogram: 'ET' }}
        onStart={() => undefined}
      />
      <AppCard
        app={{ key: 'clinic', version: '0.2.3', name: 'Clinic Desk', tagline: 'Online booking, arrivals and the day sheet for a small practice.', category: 'Clinics & Health', sides: ['staff'], copyable: true, iconTint: null, iconPaths: [], monogram: null }}
        onStart={() => undefined}
      />
    </div>
  ),
};
