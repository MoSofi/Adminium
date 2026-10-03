// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model picker and the "Add a model" dialog, over the Designer's routes.
 *
 *  1. The picker lists every model by connection, marks the one in use, and
 *     is a combobox: arrows move, Enter picks, Escape closes back to the
 *     button. A model that cannot build is marked, with its hint tied to it.
 *     A connection that could not be reached says so and tries again.
 *     Picking a model nothing is known about asks the server once.
 *  2. With no model the button opens the dialog. A key is tested (models
 *     listed, then the chosen one asked to call a tool), saved to the
 *     project, said, and the picker opens with it selected.
 *  3. A refused key is said on the key field; changing the key clears it.
 *     A model that cannot build can still be saved. A provider already added
 *     tests against its saved key, which never comes back.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { ConnectionTest, DesignerModels } from '../api.js';
import { ModelButton } from './ModelButton.js';
import { useDesignerModel } from './useModel.js';
import { useModelControl } from './useModelControl.js';

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

const TWO: DesignerModels = {
  connections: [
    { id: 'env:ollama', provider: 'ollama', source: 'environment', state: 'ok', models: [{ id: 'llama-small:8b', label: 'llama-small:8b' }, { id: 'qwen-coder:32b', label: 'qwen-coder:32b' }] },
    { id: 'env:anthropic', provider: 'anthropic', source: 'environment', state: 'ok', models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }] },
  ],
  selected: { connectionId: 'env:anthropic', model: 'claude-sonnet-5-5' },
  verdicts: [{ connectionId: 'env:ollama', model: 'llama-small:8b', canBuild: false, message: 'no tool call' }],
  canAdd: true,
};
const NONE: DesignerModels = { connections: [], selected: null, verdicts: [], canAdd: true };

let calls: Call[];
let models: DesignerModels;
let tests: (body: Record<string, unknown>) => ConnectionTest;

beforeEach(() => {
  calls = [];
  models = TWO;
  window.localStorage.clear();
  tests = (body) => ({
    ok: true,
    models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
    canBuild: body['model'] === undefined ? null : { canBuild: true, reportsUsage: true },
    error: null,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url === '/api/v1/designer/models') return Promise.resolve(jsonResponse(200, models));
      if (url === '/api/v1/designer/models/check') return Promise.resolve(jsonResponse(200, { canBuild: true, message: null }));
      if (url === '/api/v1/designer/connections/test') return Promise.resolve(jsonResponse(200, tests(body ?? {})));
      if (url === '/api/v1/designer/connections' && method === 'PUT') {
        models = {
          ...TWO,
          connections: [...TWO.connections.filter((c) => c.id !== 'env:anthropic'), { id: 'env:anthropic', provider: 'anthropic', source: 'environment', state: 'ok', models: tests({}).models }],
          verdicts: [{ connectionId: 'env:anthropic', model: String(body?.['model']), canBuild: true, message: null }],
        };
        return Promise.resolve(jsonResponse(200, { id: 'env:anthropic', provider: 'anthropic', source: 'environment', baseUrl: null, hasKey: true, model: body?.['model'] }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
});

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function Box(): ReactNode {
  const model = useDesignerModel();
  const control = useModelControl(model);
  return (
    <div>
      {control.element}
      <output data-testid="picked">{model.picked === null ? 'none' : `${model.picked.connectionId}/${model.picked.model}`}</output>
    </div>
  );
}

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <Box />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

const posted = (url: string) => calls.filter((call) => call.method !== 'GET' && call.url === url);

describe('the model picker', () => {
  it('lists the models by connection, marks the one in use, and picks with the keyboard', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Model: Claude Sonnet 5.5' });
    await userEvent.click(button);
    const list = await screen.findByRole('listbox', { name: 'Models' });
    const groups = within(list).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-labelledby') === null ? '' : document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual(['Anthropic', 'Ollama (local)']);
    expect(within(list).getByRole('option', { name: /Claude Sonnet 5\.5/ }).getAttribute('aria-selected')).toBe('true');

    // The one that cannot build: marked, its hint tied to it.
    const small = within(list).getByRole('option', { name: /llama-small:8b/ });
    expect(small.textContent).toContain('Cannot build');
    expect(document.getElementById(small.getAttribute('aria-describedby') ?? '')?.textContent).toBe('This model does not support tools, so it cannot build apps.');

    const search = screen.getByRole('combobox', { name: 'Find a model' });
    expect(document.activeElement).toBe(search);
    await userEvent.type(search, 'qwen');
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['qwen-coder:32b', 'Add a model']);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('picked').textContent).toBe('env:ollama/qwen-coder:32b');
    // Nothing was known about it: the server is asked once.
    await waitFor(() => expect(posted('/api/v1/designer/models/check').map((call) => call.body)).toEqual([{ connectionId: 'env:ollama', model: 'qwen-coder:32b' }]));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Model: qwen-coder:32b/ })));
  });

  it('closes on Escape back to the button, and picks nothing', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Model: Claude Sonnet 5.5' });
    await userEvent.click(button);
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(button);
    expect(screen.getByTestId('picked').textContent).toBe('env:anthropic/claude-sonnet-5-5');
  });

  it('says a connection could not be reached, lists the others, and tries again', async () => {
    models = { ...TWO, connections: [{ ...TWO.connections[0]!, state: 'unreachable', models: [] }, TWO.connections[1]!] };
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Model: Claude Sonnet 5.5' }));
    await screen.findByText('Could not reach this connection');
    expect(screen.getByRole('option', { name: /Claude Sonnet/ })).toBeTruthy();
    const before = calls.filter((call) => call.url === '/api/v1/designer/models').length;
    models = TWO;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('option', { name: /qwen-coder/ });
    expect(calls.filter((call) => call.url === '/api/v1/designer/models').length).toBeGreaterThan(before);
  });

  it('marks the button when the model in use cannot build', async () => {
    models = { ...TWO, selected: { connectionId: 'env:ollama', model: 'llama-small:8b' } };
    mount();
    expect(await screen.findByRole('button', { name: 'Model: llama-small:8b. It cannot build apps.' })).toBeTruthy();
  });
});

describe('where a model cannot be added (a live server)', () => {
  it('offers no "Add a model": not in the list, and not on the button with no model', async () => {
    models = { ...TWO, canAdd: false };
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Model: Claude Sonnet 5.5' }));
    const list = await screen.findByRole('listbox', { name: 'Models' });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).not.toContain('Add a model');
    // The keyboard does not reach an option that is not there: End lands on the last model.
    await userEvent.keyboard('{End}{Enter}');
    expect(screen.getByTestId('picked').textContent).toBe('env:ollama/qwen-coder:32b');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says there is no model, and opens nothing', async () => {
    models = { ...NONE, canAdd: false };
    mount();
    const button = await screen.findByRole('button', { name: 'No model' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Add a model' })).toBeNull();
  });
});

describe('Add a model', () => {
  it('opens from the button with no model, tests a key, saves it, says so and selects it', async () => {
    models = NONE;
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a model' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a model' });
    expect(within(dialog).getByText('Choose a provider')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Anthropic/ }));

    const test = within(dialog).getByRole('button', { name: 'Test' }) as HTMLButtonElement;
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const modelField = within(dialog).getByRole('combobox', { name: 'Model' }) as HTMLSelectElement;
    expect(test.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(modelField.disabled).toBe(true);
    expect(modelField.textContent).toBe('Test the key to list models');
    expect(dialog.textContent).toContain('It is not sent to the browser and not committed to git.');

    await userEvent.type(within(dialog).getByLabelText('API key'), 'sk-ant-test-key-0001');
    await userEvent.click(test);
    await within(dialog).findByText('This model can build apps.');
    expect(within(dialog).getByText(/Connected\. Claude Sonnet 5\.5 answered in \d+\.\d s\./)).toBeTruthy();
    expect(posted('/api/v1/designer/connections/test').map((call) => call.body)).toEqual([
      { provider: 'anthropic', apiKey: 'sk-ant-test-key-0001' },
      { provider: 'anthropic', apiKey: 'sk-ant-test-key-0001', model: 'claude-sonnet-5-5' },
    ]);
    expect(modelField.disabled).toBe(false);

    // Another model is asked in turn.
    await userEvent.selectOptions(modelField, 'claude-opus-5-5');
    await within(dialog).findByText(/Connected\. Claude Opus 5\.5/);
    expect(posted('/api/v1/designer/connections/test').at(-1)?.body).toEqual({ provider: 'anthropic', apiKey: 'sk-ant-test-key-0001', model: 'claude-opus-5-5' });

    await userEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a model' })).toBeNull());
    expect(posted('/api/v1/designer/connections').map((call) => call.body)).toEqual([{ provider: 'anthropic', apiKey: 'sk-ant-test-key-0001', model: 'claude-opus-5-5' }]);
    expect(await screen.findByText('Model added.')).toBeTruthy();
    expect(screen.getByTestId('picked').textContent).toBe('env:anthropic/claude-opus-5-5');
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /Claude Opus 5\.5/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('says a refused key on the key field, and clears it when the key changes', async () => {
    models = NONE;
    tests = () => ({ ok: false, models: [], canBuild: null, error: { code: 'auth', message: 'Unauthorized' } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a model' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Anthropic/ }));
    const key = within(dialog).getByLabelText('API key');
    await userEvent.type(key, 'sk-ant-wrong');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Test' }));
    await within(dialog).findByText('The key was refused.');
    expect(key.getAttribute('aria-invalid')).toBe('true');
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(key, 'x');
    expect(within(dialog).queryByText('The key was refused.')).toBeNull();
  });

  it('keeps Save on for a model that cannot build, and says why', async () => {
    models = NONE;
    tests = (body) => ({
      ok: true,
      models: [{ id: 'llama-small:8b', label: 'llama-small:8b' }],
      canBuild: body['model'] === undefined ? null : { canBuild: false, reason: 'no-tool-call', message: 'no tool call' },
      error: null,
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a model' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Ollama/ }));
    expect((within(dialog).getByLabelText('Address') as HTMLInputElement).value).toBe('http://localhost:11434');
    expect(within(dialog).queryByLabelText('API key')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Test' }));
    await within(dialog).findByText('This model cannot build apps: it does not support tools. You can still save it for other uses.');
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect(posted('/api/v1/designer/connections/test')[0]?.body).toEqual({ provider: 'ollama', baseUrl: 'http://localhost:11434' });
  });

  it('tests a provider already added against its saved key, which is never shown', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Model: Claude Sonnet 5.5' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Add a model' }));
    const dialog = await screen.findByRole('dialog');
    const card = within(dialog).getByRole('button', { name: /Anthropic/ });
    expect(card.textContent).toContain('Added');
    await userEvent.click(card);
    const key = within(dialog).getByLabelText('API key') as HTMLInputElement;
    expect(key.value).toBe('');
    expect(dialog.textContent).toContain('A key is saved. Type a new one to replace it.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Test' }));
    await within(dialog).findByText('This model can build apps.');
    expect(posted('/api/v1/designer/connections/test')[0]?.body).toEqual({ provider: 'anthropic' });
  });
});

describe('the model button', () => {
  it('is a skeleton while the models load', () => {
    const { container } = render(
      <ModelButton model={{ loading: true, hasModels: false, models: undefined, canAdd: true, picked: null, canBuild: null, cannotBuildMessage: null, pick: () => undefined }} />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
