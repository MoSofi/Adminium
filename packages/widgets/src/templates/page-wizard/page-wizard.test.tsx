// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `page-wizard` template (M7-T07): step-state derivation, rail affordances
 * (done steps clickable, todo steps not), the error override, and the
 * manifest passing the §10 schema.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import pageWizardManifest from '../page-wizard.json' with { type: 'json' };
import { parsePageTemplate } from '../template-schema.js';
import { PageWizard, wizardStepState, type WizardStepDef } from './PageWizard.js';

const STEPS: WizardStepDef[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns', description: 'Match file columns to fields.' },
  { id: 'validate', label: 'Validate' },
  { id: 'run', label: 'Import & review' },
];

describe('wizardStepState', () => {
  it('derives done/active/todo from step order', () => {
    expect(wizardStepState(STEPS, 'validate', 'upload')).toBe('done');
    expect(wizardStepState(STEPS, 'validate', 'map')).toBe('done');
    expect(wizardStepState(STEPS, 'validate', 'validate')).toBe('active');
    expect(wizardStepState(STEPS, 'validate', 'run')).toBe('todo');
    expect(wizardStepState(STEPS, 'validate', 'nope')).toBe('todo');
  });

  it('lets a host override win (failed run)', () => {
    expect(wizardStepState(STEPS, 'validate', 'run', { run: 'error' })).toBe('error');
    expect(wizardStepState(STEPS, 'validate', 'upload', { upload: 'todo' })).toBe('todo');
  });
});

describe('PageWizard', () => {
  it('renders the rail with states, the active description, and the body', () => {
    render(
      <PageWizard steps={STEPS} activeStepId="map" testId="wiz">
        <div data-testid="step-body">mapping table here</div>
      </PageWizard>,
    );
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]?.getAttribute('data-state')).toBe('done');
    expect(steps[1]?.getAttribute('data-state')).toBe('active');
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(steps[2]?.getAttribute('data-state')).toBe('todo');
    expect(screen.getByText('Match file columns to fields.')).toBeTruthy();
    expect(screen.getByTestId('step-body')).toBeTruthy();
  });

  it('makes done steps clickable and todo steps inert', async () => {
    const onSelectStep = vi.fn();
    render(
      <PageWizard steps={STEPS} activeStepId="validate" onSelectStep={onSelectStep}>
        body
      </PageWizard>,
    );
    // done → button, wired to the revisit handler
    await userEvent.click(screen.getByRole('button', { name: /Upload/ }));
    expect(onSelectStep).toHaveBeenCalledWith('upload');
    // todo steps expose no button at all — a wizard cannot fast-forward
    expect(screen.queryByRole('button', { name: /Import & review/ })).toBeNull();
  });

  it('renders the footer slot only when provided', () => {
    const { rerender, container } = render(
      <PageWizard steps={STEPS} activeStepId="upload">
        body
      </PageWizard>,
    );
    expect(container.querySelector('[data-part="wizard-footer"]')).toBeNull();
    rerender(
      <PageWizard steps={STEPS} activeStepId="upload" footer={<button type="button">Next</button>}>
        body
      </PageWizard>,
    );
    expect(container.querySelector('[data-part="wizard-footer"]')).not.toBeNull();
  });

  it('shows the error tone when a step is overridden', () => {
    render(
      <PageWizard steps={STEPS} activeStepId="validate" stepStates={{ run: 'error' }}>
        body
      </PageWizard>,
    );
    const failed = screen.getAllByRole('listitem').at(-1);
    expect(failed?.getAttribute('data-state')).toBe('error');
  });
});

describe('page-wizard.json manifest', () => {
  it('passes the §10 template schema with the §11.1 composition', () => {
    const manifest = parsePageTemplate(pageWizardManifest);
    expect(manifest.id).toBe('page-wizard');
    const slots = manifest.slots.map((slot) => slot.slot);
    expect(slots).toEqual(['upload', 'mapping', 'validation', 'run-progress', 'review']);
    const widgets = manifest.slots.flatMap((slot) => slot.accepts.widgets ?? []);
    for (const id of ['upload-dropzone', 'column-mapping-table', 'validation-issues-list', 'progress-bar']) {
      expect(widgets).toContain(id);
    }
  });
});
