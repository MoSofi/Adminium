// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What happens to the editor when the assistant puts a draft on it.
 *
 * THE MODAL IS NOT IN THIS TEST. The button is replaced by a probe that
 * calls the host's `applyDraft` directly, because what is worth proving here
 * belongs to the EDITOR, not to the assistant: that a draft arriving from
 * outside behaves like any other structural edit. The modal's own half —
 * that *Open in editor* calls this at all, and writes nothing — is pinned in
 * `assistant/assistantModal.test.tsx`.
 *
 * ONE UNDO IS THE CLAIM. A whole document replaced in one history step is
 * the right size for something that happened to your draft while you
 * watched; two steps would mean undoing half of it.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import type { AssistantHostContext } from '../../assistant/hostContext.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { EmailDocumentDetail } from '../api.js';

const ARTEFACT: Record<string, unknown> = {
  kind: 'template',
  name: 'Payment reminder',
  locale: 'en_US',
  document: {
    subject: 'Your payment is due',
    blocks: [
      { block: 'email.heading', data: { text: 'A quick reminder' } },
      { block: 'email.text', data: { paras: ['The amount is still outstanding.'] } },
    ],
  },
};

let host: AssistantHostContext | null = null;

vi.mock('../../assistant/AskAssistant.js', () => ({
  AskAssistant: (props: { host: AssistantHostContext }) => {
    host = props.host;
    return (
      <button type="button" data-testid="apply-probe" onClick={() => props.host.applyDraft?.(ARTEFACT)}>
        apply
      </button>
    );
  },
}));

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function detail(): EmailDocumentDetail {
  return {
    id: 'et_1',
    kind: 'template',
    key: 'welcome',
    locale: 'en_US',
    name: 'Welcome',
    subject: 'Welcome',
    category: 'lifecycle',
    enabled: true,
    needsTranslation: false,
    archivedAt: null,
    updatedAt: 1,
    isBuiltin: false,
    isBuiltinCopy: false,
    starter: 'welcome',
    brand: null,
    heading: 'Welcome aboard',
    topicLabel: 'Welcome',
    document: {
      subject: 'Welcome',
      preheader: '',
      blocks: [{ id: 'b_1', block: 'email.heading', data: { text: 'Welcome aboard' }, style: {} }],
      footer: '',
      brand: null,
      attachments: [],
    },
    vars: [],
    languages: [],
    attachmentsResolved: [],
  };
}

async function renderEditor() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, assistant: { allowed: true, name: 'Milo' } }) }),
        );
      }
      if (url === '/api/v1/settings/email') {
        return Promise.resolve(
          jsonResponse(200, { data: { configured: false, host: null, port: null, user: null, from: null, secure: null, senders: [], maxAttachmentBytes: 1 } }),
        );
      }
      if (url === '/api/v1/email-blocks') return Promise.resolve(jsonResponse(200, { blocks: [] }));
      if (method === 'GET' && url.startsWith('/api/v1/email-templates?')) {
        return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, campaign: 0, archived: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/email-templates/et_1') return Promise.resolve(jsonResponse(200, detail()));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/email-templates/et_1'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-editor-header');
  return { calls, user: userEvent.setup() };
}

const chip = () => screen.getByTestId('email-save-chip');

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a draft the assistant proposed', () => {
  it('reaches the editor as an editor host, carrying what is on screen', async () => {
    await renderEditor();
    expect(host?.context).toBe('email');
    expect(host?.host.documentId).toBe('et_1');
    // The UNSAVED document travels, so the assistant talks about what the
    // person is looking at rather than what was last saved.
    expect((host?.draft as { subject: string } | undefined)?.subject).toBe('Welcome');
    expect(typeof host?.applyDraft).toBe('function');
  });

  it('replaces the draft, marks it unsaved, writes nothing, and selects the first changed block', async () => {
    const { calls, user } = await renderEditor();
    expect(chip().textContent).toBe('All changes saved');
    const before = calls.length;

    await user.click(screen.getByTestId('apply-probe'));

    expect(chip().textContent).toBe('Unsaved changes');
    expect(screen.getByTestId('email-subject-input')).toHaveProperty('value', 'Your payment is due');
    expect(screen.getByText('The amount is still outstanding.')).toBeDefined();
    // Nothing left the browser: the explicit-save rule still governs.
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    expect(calls.length).toBe(before);

    // On the canvas, exactly the first block whose contents differ. Scoped to
    // the blocks: the device segment marks its active option `data-selected`
    // too, and that is a different thing with the same attribute.
    const selected = screen.getByTestId('email-canvas').querySelectorAll('[data-block-id][data-selected]');
    expect([...selected].map((node) => node.getAttribute('data-block-id'))).toEqual(['draft_0']);
  });

  it('is taken back by ONE undo', async () => {
    const { user } = await renderEditor();
    await user.click(screen.getByTestId('apply-probe'));
    expect(chip().textContent).toBe('Unsaved changes');

    await user.click(screen.getByTestId('email-undo'));

    await waitFor(() => {
      expect(chip().textContent).toBe('All changes saved');
    });
    expect(screen.getByTestId('email-subject-input')).toHaveProperty('value', 'Welcome');
    expect(screen.getByTestId('email-undo').hasAttribute('disabled')).toBe(true);
  });
});
