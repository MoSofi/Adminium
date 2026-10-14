// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The effort menu beside the model's own: it lists the levels the picked model
 * takes and nothing else, and a model that takes none shows no menu.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { DesignerEffort } from '../api.js';
import { EffortPicker } from './EffortPicker.js';
import type { DesignerModelState } from './ModelButton.js';

beforeAll(async () => {
  await installTestI18n();
});

const state = (efforts: DesignerEffort[], effort: DesignerEffort | null, pickEffort: DesignerModelState['pickEffort'] = () => undefined): DesignerModelState => ({
  loading: false,
  hasModels: true,
  canAdd: true,
  models: undefined,
  picked: { connectionId: 'env:anthropic', model: 'claude-sonnet-5-5' },
  canBuild: true,
  cannotBuildMessage: null,
  pick: () => undefined,
  efforts,
  effort,
  pickEffort,
});

describe('the effort menu', () => {
  it('is not there for a model that takes no effort level', () => {
    const { container } = render(<EffortPicker model={state([], null)} />);
    expect(container.childElementCount).toBe(0);
  });

  it('lists the model’s own levels after "Default", and says the one picked on its button', async () => {
    const pick = vi.fn();
    render(<EffortPicker model={state(['low', 'medium', 'high', 'max'], 'high', pick)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Effort: High' }));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent?.replace(/(Fastest|A balance|More thought|The most|What the model).*/, ''))).toEqual(['Default', 'Low', 'Medium', 'High', 'Max']);
    expect(screen.getByRole('menuitemradio', { name: /^High/ }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Low/ }));
    expect(pick).toHaveBeenCalledWith('low');
  });

  it('goes back to the model’s own default', async () => {
    const pick = vi.fn();
    render(<EffortPicker model={state(['low', 'high'], 'low', pick)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Effort: Low' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Default/ }));
    expect(pick).toHaveBeenCalledWith(null);
  });
});
