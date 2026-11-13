// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's fixed card in the Designer: the words for a request that
 * needs customer-facing screens and for the AI used up, Upgrade only where the
 * operator set its address (in this tab), "Add an AI key" to Settings → AI,
 * and the card in place of the engine's own "not applied" under the turn.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SystemInfo } from '../../app/capabilities.js';
import { installTestI18n } from '../../i18n/testing.js';
import type { DesignerEvent } from '../api.js';
import { foldTurns } from '../build/turns.js';
import { AI_SETTINGS_PATH, OperatorAiCard, operatorAiText } from './OperatorAiCard.js';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const UPGRADE = 'https://operator.example/upgrade?instance=https%3A%2F%2Fhollis.example.com';

function withInfo(upgradeUrl: string | null, children: ReactNode, trial = true): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const info: Partial<SystemInfo> = { trial: trial ? { on: true, endsAt: '2026-11-20T00:00:00.000Z', daysLeft: 8, upgradeUrl } : { on: false, endsAt: null, daysLeft: null, upgradeUrl: null } };
  client.setQueryData(['system', 'info'], info);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the operator’s AI card', () => {
  it('says the request needs the person’s own key, with Add an AI key and Upgrade', async () => {
    render(withInfo(UPGRADE, <OperatorAiCard which="scope" />));
    const card = screen.getByRole('group', { name: 'AI key needed' });
    expect(card.querySelector('p')?.textContent).toBe('Building customer-facing screens needs your own AI key. Add your own AI key to continue, or Upgrade.');
    const upgrade = screen.getByRole('link', { name: 'Upgrade' });
    // The operator's page, in this tab.
    expect(upgrade.getAttribute('href')).toBe(UPGRADE);
    expect(upgrade.getAttribute('target')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add an AI key' }));
    expect(navigate).toHaveBeenCalledWith({ to: AI_SETTINGS_PATH });
  });

  it('says the AI included is used up, the same two ways on', () => {
    render(withInfo(UPGRADE, <OperatorAiCard which="used-up" />));
    expect(screen.getByRole('group', { name: 'AI key needed' }).querySelector('p')?.textContent).toBe('The AI included with this trial is used up. Add your own AI key to continue, or Upgrade.');
    expect(screen.getByRole('button', { name: 'Add an AI key' })).toBeTruthy();
  });

  it('offers only Add an AI key where the operator set no upgrade address', () => {
    render(withInfo(null, <OperatorAiCard which="scope" />));
    expect(screen.getByRole('group', { name: 'AI key needed' }).querySelector('p')?.textContent).toBe('Building customer-facing screens needs your own AI key. Add your own AI key to continue.');
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull();
    expect(operatorAiText('used-up', false)).toBe('The AI included with this trial is used up. Add your own AI key to continue.');
  });

  it('says “this installation”, not “this trial”, on a server that is no trial', () => {
    render(withInfo(null, <OperatorAiCard which="used-up" />, false));
    expect(screen.getByRole('group', { name: 'AI key needed' }).querySelector('p')?.textContent).toBe('The AI included with this installation is used up. Add your own AI key to continue.');
    expect(operatorAiText('used-up', false, false)).toBe('The AI included with this installation is used up. Add your own AI key to continue.');
  });
});

describe('a turn that ends with the card', () => {
  const base = { turn: 1, at: 1 };
  it('carries which card, from the server’s event, and nothing for any other turn', () => {
    const events = [
      { ...base, seq: 1, kind: 'turn-started', text: 'now make the customer ordering site' },
      { ...base, seq: 2, kind: 'step', id: 's1', tool: 'add_side', label: 'Needs your own AI key', state: 'failed', operator: 'operator-ai-scope', ended: 'error' },
      { ...base, seq: 3, kind: 'operator-ai', card: 'scope' },
      { ...base, seq: 4, kind: 'turn-finished', outcome: 'done' },
      { ...base, turn: 2, seq: 5, kind: 'turn-started', text: 'add a page' },
      { ...base, turn: 2, seq: 6, kind: 'turn-finished', outcome: 'done' },
    ] as DesignerEvent[];
    const [first, second] = foldTurns(events);
    expect(first?.operatorAi).toBe('scope');
    expect(second?.operatorAi).toBeNull();
  });
});
