// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REGRESSION: a real seeded `adminium_email_templates` row must render.
 *
 * The Email Templates surface shipped rendering an EMPTY canvas for every row
 * in the table. `apps/server/src/email/render.ts` writes and sends six
 * `email.*` block kinds; the canvas knew only the 22 `block-*` document ids;
 * the intersection was empty. So `emailDoc.ts` classified every block of every
 * seeded template as `unknown`, `blockOrder` came out `[]`, and the editor
 * opened on "No blocks yet" for all 24 rows a fresh install seeds (3 built-ins
 * x 8 compiled locales). Nothing threw, and nothing failed.
 *
 * IT WAS GREEN BECAUSE EVERY TEST FED IT FIXTURES IT COULD ALREADY READ.
 * `builders.test.tsx` and `emailTemplates.test.tsx` both hand the editor
 * hand-written docs made of `block-highlight-box` / `block-contact` — ids the
 * canvas has always known and the mail renderer has never known. No test loaded
 * a row the server actually seeds, so the one thing that was broken was the one
 * thing nothing exercised.
 *
 * SO THE FIXTURE HERE IS NOT HAND-WRITTEN. `PASSWORD_RESET_EN_US` is copied
 * verbatim out of a seeded install's meta store
 * (`select blocks from adminium_email_templates where key='password-reset' and
 * locale='en_US'`), placeholders and typographic apostrophes included, and this
 * suite asserts against THAT. Two further gates keep the copy honest, since a
 * fixture can drift from what the seed writes:
 *
 *   - `apps/server/test/email-vocabulary.test.ts` asserts every block the real
 *     `builtins.ts` seed emits is a kind the renderer dispatches;
 *   - `scripts/check-email-block-vocab.mjs` asserts the renderer's vocabulary
 *     and the canvas's are identical, in CI.
 *
 * Together: seed -> renderer -> canvas, with no link taken on trust.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { EmailTemplatesPage } from './EmailTemplatesPage.js';
import { docToEmailBlocks, emailBlocksToDoc } from './emailDoc.js';

/**
 * Verbatim from a seeded install. Note the TWO `email.text` blocks (`intro` and
 * `notice`) — repeated kinds are the ordinary case for a transactional email,
 * which is why payloads are keyed by instance id rather than block id.
 */
const PASSWORD_RESET_EN_US: readonly Record<string, unknown>[] = [
  { block: 'email.heading', id: 'heading', data: { text: 'Reset your password', level: 1 } },
  {
    block: 'email.text',
    id: 'intro',
    data: { text: 'Hi {{name}}, we received a request to reset the password for {{email}}.' },
  },
  {
    block: 'email.button',
    id: 'action',
    data: { label: 'Choose a new password', url: '{{resetUrl}}' },
  },
  {
    block: 'email.text',
    id: 'notice',
    data: {
      text: 'This link works only once and expires in {{expiresInMinutes}} minutes. If you didn’t ask to reset your password, you can ignore this email — your current password stays active.',
    },
  },
  { block: 'email.divider', id: 'rule' },
  {
    block: 'email.footer',
    id: 'footer',
    data: {
      text: 'If the button doesn’t work, paste this link into your browser: {{resetUrl}}',
    },
  },
];

const LIST_ITEM = {
  id: 'emt_pw',
  key: 'password-reset',
  locale: 'en_US',
  name: 'Password reset',
  subject: 'Reset your {{appName}} password',
  enabled: true,
  updatedAt: 1_750_000_000_000,
};

const DETAIL = { ...LIST_ITEM, blocks: PASSWORD_RESET_EN_US };

function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && path === '/api/v1/email-templates') {
        return Promise.resolve(jsonResponse(200, { items: [LIST_ITEM] }));
      }
      if (method === 'GET' && path === '/api/v1/email-templates/password-reset/en_US') {
        return Promise.resolve(jsonResponse(200, DETAIL));
      }
      if (method === 'PUT') return Promise.resolve(jsonResponse(200, LIST_ITEM));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope' } }));
    }),
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('emailDoc over a real seeded row', () => {
  it('recognises every stored block — none fall through to `unknown`', () => {
    const state = emailBlocksToDoc(PASSWORD_RESET_EN_US, {
      name: LIST_ITEM.name,
      subject: LIST_ITEM.subject,
    });

    // The defect, stated as an assertion: this was [] and 6.
    expect(state.doc.blockOrder).toHaveLength(6);
    expect(state.unknown).toHaveLength(0);
    expect(state.doc.blockOrder?.map((instance) => instance.block)).toEqual([
      'email.heading',
      'email.text',
      'email.button',
      'email.text',
      'email.divider',
      'email.footer',
    ]);
  });

  it('keeps the two paragraphs distinct (payloads are keyed by instance, not by kind)', () => {
    const state = emailBlocksToDoc(PASSWORD_RESET_EN_US, { name: 'n', subject: 's' });
    const intro = state.doc.blocks?.['intro'] as { text: string };
    const notice = state.doc.blocks?.['notice'] as { text: string };

    expect(intro.text).toContain('we received a request');
    expect(notice.text).toContain('expires in {{expiresInMinutes}} minutes');
    // Block-keyed storage would have collapsed these two into one entry.
    expect(intro.text).not.toBe(notice.text);
  });

  it('round-trips byte-identically, so merely opening a template cannot rewrite it', () => {
    const state = emailBlocksToDoc(PASSWORD_RESET_EN_US, { name: 'n', subject: 's' });
    expect(docToEmailBlocks(state.doc, state.unknown)).toEqual(PASSWORD_RESET_EN_US);
  });
});

describe('EmailTemplatesPage over a real seeded row', () => {
  it('renders the stored blocks on the canvas instead of the empty state', async () => {
    installFetchMock();
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <EmailTemplatesPage />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('email-template-password-reset-en_US'));

    const canvas = await waitFor(() => {
      const found = document.querySelector('[data-widget="document-canvas"]');
      expect(found?.getAttribute('data-doc-type')).toBe('email');
      return found;
    });

    // Six block instances on the paper, in stored order.
    await waitFor(() => {
      expect(canvas?.querySelectorAll('[data-part="block-instance"]')).toHaveLength(6);
    });
    expect(canvas?.querySelectorAll('[data-block="email.text"]')).toHaveLength(2);

    // The row's ACTUAL copy is on screen — not a placeholder, not demo data.
    expect(screen.getByText('Reset your password')).toBeDefined();
    expect(screen.getByText('Choose a new password')).toBeDefined();
    expect(
      screen.getByText(/Hi \{\{name\}\}, we received a request to reset the password/),
    ).toBeDefined();
    expect(screen.getByText(/This link works only once/)).toBeDefined();

    // And the empty state that used to be the whole surface is gone.
    expect(screen.queryByText('No blocks yet')).toBeNull();
  });
});
