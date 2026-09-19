// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this page hands the assistant, and what the assistant hands back.
 *
 * THE READ-ONLY CANVAS IS THE POINT OF THE WHOLE ADAPTER. The preview inside
 * the modal is drawn by the editor's own component, so the one thing worth
 * proving here is that "read-only" means it: no inline inputs, no selection
 * rings, no insert affordances. A preview that kept any of them would be an
 * editor somebody cannot save.
 *
 * THE BUTTON IS A SERVER ANSWER. `assistant.allowed` rides on bootstrap
 * because the dashboard holds no permission list, so the only honest test is
 * the bootstrap reply itself — in both headers, because they are two
 * different slots in two different components.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { BootstrapData } from '../app/bootstrap.js';
import type { EmailDocumentDetail } from './api.js';
import { documentOf } from './assistant.js';
import { EmailCanvas } from './editor/canvas/EmailCanvas.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const ARTEFACT: Record<string, unknown> = {
  kind: 'template',
  name: 'Payment reminder',
  locale: 'en_US',
  document: {
    subject: 'Your payment is due',
    blocks: [
      { block: 'email.heading', data: { text: 'A quick reminder' } },
      { block: 'email.text', data: { paras: ['The amount is still outstanding.'] }, style: {} },
    ],
  },
};

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

function stubFetch(bootstrap: BootstrapData) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: bootstrap }));
      if (url === '/api/v1/settings/email') {
        return Promise.resolve(
          jsonResponse(200, { data: { configured: false, host: null, port: null, user: null, from: null, secure: null, senders: [], maxAttachmentBytes: 1 } }),
        );
      }
      if (url === '/api/v1/email-blocks') return Promise.resolve(jsonResponse(200, { blocks: [] }));
      if (method === 'GET' && url.startsWith('/api/v1/email-templates?')) {
        return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, campaign: 0, archived: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/email-templates') {
        return Promise.resolve(jsonResponse(200, { items: [], counts: { template: 0, campaign: 0, archived: 0 } }));
      }
      if (method === 'GET' && url === '/api/v1/email-templates/et_1') return Promise.resolve(jsonResponse(200, detail()));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
}

async function renderAt(path: string, assistant: BootstrapData['assistant']) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch(makeBootstrap({ nav: { groups: [] }, ...(assistant === undefined ? {} : { assistant }) }));
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId(path === '/email-templates' ? 'email-manager' : 'email-editor-header');
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the artefact as a document', () => {
  it('fills out what the PUT shape is allowed to leave out', () => {
    const document = documentOf(ARTEFACT);
    expect(document.subject).toBe('Your payment is due');
    // The envelope omits these; a preview must not fail over a missing footer.
    expect(document.preheader).toBe('');
    expect(document.footer).toBe('');
    expect(document.brand).toBeNull();
    expect(document.attachments).toEqual([]);
    // A proposed block has no row id yet, so the list still has stable keys.
    expect(document.blocks.map((block) => block.id)).toEqual(['draft_0', 'draft_1']);
    expect(document.blocks[0]?.block).toBe('email.heading');
    expect(document.blocks[1]?.style).toEqual({});
  });

  it('survives a document that is not one', () => {
    const document = documentOf({ document: { blocks: 'nope', brand: undefined } });
    expect(document.blocks).toEqual([]);
    expect(document.subject).toBe('');
    expect(document.brand).toBeNull();
  });
});

describe('the read-only canvas', () => {
  function renderCanvas(readOnly: boolean) {
    const { container } = render(
      <EmailCanvas
        document={documentOf(ARTEFACT)}
        dir="ltr"
        vars={[]}
        attachmentsResolved={[]}
        appName="Adminium"
        accent="var(--accent)"
        logoUrl={null}
        files={new Map()}
        {...(readOnly
          ? { readOnly: true }
          : {
              selection: { kind: 'branding' as const },
              device: 'desktop' as const,
              onSelect: () => undefined,
              onDeviceChange: () => undefined,
              onSubjectFocus: () => undefined,
              onSubjectChange: () => undefined,
              onPreheaderFocus: () => undefined,
              onPreheaderChange: () => undefined,
              onHeadingFocus: () => undefined,
              onHeadingChange: () => undefined,
              onInsertAt: () => undefined,
            })}
      />,
    );
    return container;
  }

  it('draws the sheet with nothing on it to operate', () => {
    const container = renderCanvas(true);
    // The sheet is there, and it is the editor's own.
    expect(screen.getByTestId('email-mail-shell')).toBeDefined();
    expect(screen.getByText('Your payment is due')).toBeDefined();
    expect(screen.getByText('A quick reminder')).toBeDefined();
    // …and nothing a person could type into or select.
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0);
    expect(screen.queryByTestId('email-add-section')).toBeNull();
    expect(screen.queryByTestId('email-insert-above')).toBeNull();
    expect(screen.queryByTestId('email-device')).toBeNull();
    // No selector button either — the inspector it would open is not here.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('is the same component that edits, so the editable form still edits', () => {
    const container = renderCanvas(false);
    expect(screen.getByTestId('email-subject-input')).toBeDefined();
    expect(screen.getByTestId('email-add-section')).toBeDefined();
    expect(screen.getByTestId('email-device')).toBeDefined();
    expect(container.querySelectorAll('[data-selected]').length).toBeGreaterThan(0);
  });
});

describe('the Ask button', () => {
  it('renders in the manager and the editor when the grant is there, naming what bootstrap calls it', async () => {
    await renderAt('/email-templates', { allowed: true, name: 'Ada' });
    const button = screen.getByTestId('ask-assistant');
    expect(button.textContent).toContain('Ask Ada');
    expect(button.getAttribute('title')).toBe('Ask Ada about this page');
    cleanup();
    vi.unstubAllGlobals();

    await renderAt('/email-templates/et_1', { allowed: true, name: 'Ada' });
    expect(screen.getByTestId('ask-assistant')).toBeDefined();
  });

  it('renders in neither without the grant', async () => {
    await renderAt('/email-templates', { allowed: false, name: 'Milo' });
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    await renderAt('/email-templates/et_1', { allowed: false, name: 'Milo' });
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
  });

  it('renders in neither for a bootstrap that predates the field', async () => {
    // A reply with no `assistant` at all is an older server, and "no" is the
    // only safe reading of silence about a permission.
    await renderAt('/email-templates', undefined);
    expect(screen.queryByTestId('ask-assistant')).toBeNull();
  });
});
