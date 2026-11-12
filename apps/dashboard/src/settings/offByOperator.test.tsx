// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SQLite choice under trial mode, in the three connect front doors (the
 * first-run wizard, Studio's connect wizard, the desktop app's setup): shown,
 * disabled, with the operator's reason, never hidden. And the same choice
 * offered as before where the operator switched nothing off.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../app/api.js';
import type { SystemInfo } from '../app/capabilities.js';
import { INITIAL_DESKTOP_SETUP_STATE, type DesktopSetupState } from '../desktop/setup/desktopSetupState.js';
import { SourceStep as DesktopSourceStep } from '../desktop/setup/steps/SourceStep.js';
import { installTestI18n } from '../i18n/testing.js';
import { ConnectStep } from '../setup/onboarding/steps/ConnectStep.js';
import { SourceStep as StudioSourceStep } from '../studio/connect/steps/SourceStep.js';
import { INITIAL_WIZARD_STATE, type WizardState } from '../studio/connect/wizardState.js';
import { offByOperatorText } from './OffByOperator.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

const SQLITE_REASON = 'This installation does not open SQLite files: the operator allows only database servers.';
const off = { allowed: false, reason: 'trial-mode' };
const open = { allowed: true, reason: null };

/** A page under `/system/info` as a trial (switched off) or an ordinary server answers it. */
function withInfo(trial: boolean, children: ReactNode): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const info: Partial<SystemInfo> = {
    offByOperator: trial
      ? { sqliteSources: off, storageDestinations: off, webhooks: off, metaStore: off }
      : { sqliteSources: open, storageDestinations: open, webhooks: open, metaStore: open },
  };
  client.setQueryData(['system', 'info'], info);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the first-run wizard', () => {
  function renderStep(trial: boolean, onChange = vi.fn(), dsn = '') {
    render(
      withInfo(
        trial,
        <ConnectStep
          engine="postgres"
          dsn={dsn}
          onChange={onChange}
          existing={null}
          probing={false}
          park={false}
          onPark={() => undefined}
          onAdopt={() => undefined}
          adopting={null}
          bridgePending={false}
        />,
      ),
    );
    return onChange;
  }

  it('in trial mode: SQLite is there, aria-disabled, with the reason beside it, and a pick does nothing', () => {
    const onChange = renderStep(true);
    const card = screen.getByRole('radio', { name: /SQLite/ });
    expect(card.getAttribute('aria-disabled')).toBe('true');
    expect(card.hasAttribute('disabled')).toBe(false);
    const note = document.getElementById(card.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toContain('Set by the operator');
    expect(note?.textContent).toContain(SQLITE_REASON);
    fireEvent.click(card);
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ engine: 'sqlite' }));
  });

  it('in trial mode: a SQLite string typed in is refused in the field with the same reason', () => {
    renderStep(true, vi.fn(), 'sqlite:/var/lib/app.db');
    expect(screen.getAllByText(SQLITE_REASON).length).toBeGreaterThan(0);
  });

  it('on an ordinary server: SQLite is offered as before', () => {
    const onChange = renderStep(false);
    const card = screen.getByRole('radio', { name: /SQLite/ });
    expect(card.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByTestId('off-by-operator-note')).toBeNull();
    fireEvent.click(card);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ engine: 'sqlite' }));
  });
});

describe("Studio's connect wizard", () => {
  function Harness({ initial }: { initial: WizardState }) {
    const [state, setState] = useState<WizardState>(initial);
    return <StudioSourceStep state={state} onPatch={(patch) => setState((prev) => ({ ...prev, ...patch }))} />;
  }

  it('in trial mode: the SQLite engine is shown disabled, the reason under the picker', () => {
    render(withInfo(true, <Harness initial={{ ...INITIAL_WIZARD_STATE, mode: 'dsn' }} />));
    const sqlite = screen.getByRole('radio', { name: 'SQLite' });
    expect(sqlite.hasAttribute('disabled')).toBe(true);
    const group = sqlite.closest('[role="radiogroup"]');
    expect(document.getElementById(group?.getAttribute('aria-describedby') ?? '')?.textContent).toContain(SQLITE_REASON);
  });

  it('on an ordinary server: the SQLite engine is a choice', () => {
    render(withInfo(false, <Harness initial={{ ...INITIAL_WIZARD_STATE, mode: 'dsn' }} />));
    expect(screen.getByRole('radio', { name: 'SQLite' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('off-by-operator-note')).toBeNull();
  });
});

describe("the desktop app's setup", () => {
  function renderStep(trial: boolean, onPatch = vi.fn()) {
    const state: DesktopSetupState = { ...INITIAL_DESKTOP_SETUP_STATE };
    render(
      withInfo(
        trial,
        <DesktopSourceStep
          state={state}
          onPatch={onPatch}
          onPickSqliteFile={() => undefined}
          schemaFileName={null}
          onPickSchemaFile={() => undefined}
          demoAvailable={false}
          busy={false}
        />,
      ),
    );
    return onPatch;
  }

  it('in trial mode: a new local database (blank or from a schema file) and an existing file, both aria-disabled with the reason', () => {
    const onPatch = renderStep(true);
    const radios = screen.getAllByRole('radio');
    const disabled = radios.filter((radio) => radio.getAttribute('aria-disabled') === 'true');
    expect(disabled).toHaveLength(2);
    expect(document.getElementById(disabled[0]?.getAttribute('aria-describedby') ?? '')?.textContent).toContain(SQLITE_REASON);
    for (const card of disabled) fireEvent.click(card);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('on an ordinary server: both offered', () => {
    renderStep(false);
    expect(screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-disabled') === 'true')).toHaveLength(0);
  });
});

describe('a refusal the operator caused', () => {
  it('is said in the words of what was switched off, and nothing else is taken for one', () => {
    expect(offByOperatorText(new ApiError(403, 'OFF_BY_OPERATOR', 'x', 'r', { question: 'sqliteSources', reason: 'trial-mode' }))).toBe(SQLITE_REASON);
    expect(offByOperatorText(new ApiError(403, 'OFF_BY_OPERATOR', 'x', 'r', { question: 'somethingNew', reason: 'trial-mode' }))).toBe(
      'The operator has switched this off for this installation.',
    );
    expect(offByOperatorText(new ApiError(403, 'FORBIDDEN', 'x', 'r'))).toBeNull();
  });
});
