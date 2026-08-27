// SPDX-License-Identifier: AGPL-3.0-only
/**
 * /studio/settings integration (M5-T05): workspace identity for super admins
 * with the review-then-confirm save modal (changed fields listed, branding
 * PUT), the admin fallback (no settings fetch, danger zone still present),
 * and the danger-zone type-to-confirm connection delete. Router-mounted like
 * the GlobalDefaultsPage suite.
 *
 * The `auth.*` security section rides the SAME form: one Save button, one
 * review modal, two section-puts. The 2FA toggle carries the advisory note
 * (`require2fa.note`) because the switch's own label promises a perimeter the
 * server does not enforce — see `auth.require2fa` in
 * packages/meta/src/schema/settings-registry.ts.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { ConnectionDto } from '../api.js';
import type {
  EmailSettings,
  SecuritySettings,
  WorkspaceBranding,
  WorkspaceSettingsData,
} from './workspaceApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeWorkspace(overrides: Partial<WorkspaceSettingsData> = {}): WorkspaceSettingsData {
  return {
    branding: { appName: 'Adminium', logoUrl: null, showVersion: true },
    ...overrides,
  };
}

function makeSecurity(overrides: Partial<SecuritySettings> = {}): SecuritySettings {
  return { sessionTtlHours: 720, require2fa: false, passwordMinLength: 10, ...overrides };
}

/** Unconfigured is the DEFAULT here because it is the state every fresh install is in. */
function makeEmail(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return { configured: false, host: null, port: null, user: null, from: null, secure: null, ...overrides };
}

function makeConnection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 'conn_1',
    name: 'Production Postgres',
    engine: 'postgres',
    sourceKind: 'dsn',
    dsnMasked: 'postgres://ava@db.acme.io:5432/prod',
    readOnly: true,
    status: 'connected',
    lastTestedAt: null,
    lastLatencyMs: 42,
    lastError: null,
    lastErrorHint: null,
    timezone: null,
    timezoneSource: null,
    currency: null,
    disabled: false,
    disabledAt: null,
    snapshot: null,
    tableCount: 14,
    pageCount: 9,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(
  roles: string[],
  connections: ConnectionDto[] = [makeConnection()],
  branding: WorkspaceBranding = makeWorkspace().branding,
  security: SecuritySettings = makeSecurity(),
  email: EmailSettings = makeEmail(),
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/settings/workspace' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: { branding } }));
    }
    if (url === '/api/v1/settings/branding' && method === 'PUT') {
      const put = body as { appName: string; showVersion: boolean };
      return Promise.resolve(
        jsonResponse(200, {
          data: makeWorkspace({ branding: { ...put, logoUrl: null } }),
        }),
      );
    }
    if (url === '/api/v1/settings/security' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: security }));
    }
    if (url === '/api/v1/settings/security' && method === 'PUT') {
      // The route is a full-object write, so the reply is the body.
      return Promise.resolve(jsonResponse(200, { data: body }));
    }
    if (url === '/api/v1/settings/email' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: email }));
    }
    if (url === '/api/v1/settings/email' && method === 'PUT') {
      // Mirrors the route: the reply is the password-free view of what landed.
      const smtp = (body as { smtp: Record<string, unknown> | null }).smtp;
      return Promise.resolve(
        jsonResponse(200, {
          data:
            smtp === null
              ? makeEmail()
              : {
                  configured: true,
                  host: smtp['host'],
                  port: smtp['port'],
                  user: smtp['user'],
                  from: smtp['from'],
                  secure: smtp['secure'],
                },
        }),
      );
    }
    if (url === '/api/v1/branding' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: branding }));
    }
    if (url.startsWith('/api/v1/branding/logo')) {
      return Promise.resolve(
        jsonResponse(method === 'POST' ? 201 : 200, {
          data: {
            ...branding,
            logoUrl: method === 'DELETE' ? null : '/api/v1/branding/logo?v=file_new',
          },
        }),
      );
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { connections }));
    }
    if (method === 'DELETE' && url.startsWith('/api/v1/connections/')) {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderPage(
  roles: string[] = ['super-admin'],
  connections?: ConnectionDto[],
  branding?: WorkspaceBranding,
  security?: SecuritySettings,
  email?: EmailSettings,
) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(roles, connections, branding, security, email);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/settings'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient, router };
}

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

describe('StudioSettingsPage', () => {
  it('renders workspace identity from the workspace payload for a super admin', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Workspace settings' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Workspace identity' })).toBeDefined();
    expect((screen.getByLabelText('Application name') as HTMLInputElement).value).toBe('Adminium');
    // Pristine form — nothing to save yet.
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders the security section bound to /settings/security', async () => {
    await renderPage(['super-admin'], undefined, undefined, {
      sessionTtlHours: 24,
      require2fa: true,
      passwordMinLength: 16,
    });
    await screen.findByRole('heading', { name: 'Security' });

    const toggle = screen.getByRole('switch', { name: 'Require two-factor auth' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Session lifetime (hours)') as HTMLInputElement).value).toBe('24');
    expect((screen.getByLabelText('Minimum password length') as HTMLInputElement).value).toBe('16');
  });

  it('states the 2FA boundary beside the toggle, since the label overpromises', async () => {
    await renderPage();
    await screen.findByRole('heading', { name: 'Security' });
    // The label and its description both read as a perimeter; the server only
    // signals un-enrolled accounts and refuses `POST /auth/2fa/disable`. If
    // this note ever disappears the screen is lying about what the switch does.
    expect(
      screen.getByText(/Advisory, not a barrier/, { exact: false }).textContent,
    ).toContain('API keys are unaffected');
  });

  it('refuses an out-of-range number instead of PUTting it', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Security' });

    const ttl = screen.getByLabelText('Session lifetime (hours)');
    await user.clear(ttl);
    await user.type(ttl, '9000');
    // 8760 is the registry ceiling — the client mirrors it so the refusal
    // lands on the field rather than as a 422 over the whole save.
    expect(screen.getByText('Between 1 and 8,760 hours.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);

    // An emptied box is still an edit, so it must read as invalid, not pristine.
    await user.clear(ttl);
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('saves security through the one shared review modal, as its own section-put', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Security' });

    await user.click(screen.getByRole('switch', { name: 'Require two-factor auth' }));
    const passwordMin = screen.getByLabelText('Minimum password length');
    await user.clear(passwordMin);
    await user.type(passwordMin, '14');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Off → On')).toBeDefined();
    expect(within(dialog).getByText('10 → 14')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');

    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/security'));
    expect(put?.body).toEqual({ sessionTtlHours: 720, require2fa: true, passwordMinLength: 14 });
    // Untouched sections stay untouched: one Save button, but still two puts.
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'))).toBe(
      false,
    );
  });

  it('review-then-confirm: lists exactly the changed field, then PUTs branding', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace settings' });

    const nameInput = screen.getByLabelText('Application name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Acme Ops');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Review your changes before saving.')).toBeDefined();
    // Only the dirty field appears in the review list.
    expect(within(dialog).getByText('Adminium → Acme Ops')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');

    const brandingPut = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'));
    expect(brandingPut?.body).toEqual({ appName: 'Acme Ops', showVersion: true });
    // …and the security section, being pristine, is read but never written.
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/security'))).toBe(
      false,
    );
  });

  /**
   * The SMTP card. Before it existed the transport behind password reset, user
   * invites and scheduled reports could only be set by hand-writing
   * `PUT /api/v1/settings/email` or importing a config bundle.
   */
  describe('email (SMTP)', () => {
    it('says what an unconfigured workspace cannot do, and starts pristine', async () => {
      await renderPage();
      await screen.findByRole('heading', { name: 'Email (SMTP)' });
      expect(
        screen.getByText(/cannot send password resets, user invites or scheduled reports/),
      ).toBeDefined();
      // Empty boxes and a suggested port are not an error state — a first-time
      // admin must not be greeted by three red fields.
      expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('587');
      expect(screen.queryByText('Enter an email address.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
    });

    it('binds a configured transport, and never renders the password', async () => {
      await renderPage(['super-admin'], undefined, undefined, undefined, {
        configured: true,
        host: 'smtp.acme.io',
        port: 465,
        user: 'postmaster@acme.io',
        from: 'Adminium <ops@acme.io>',
        secure: true,
      });
      await screen.findByRole('heading', { name: 'Email (SMTP)' });
      expect((screen.getByLabelText('SMTP host') as HTMLInputElement).value).toBe('smtp.acme.io');
      expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('465');
      expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('postmaster@acme.io');
      expect((screen.getByLabelText('From address') as HTMLInputElement).value).toBe('Adminium <ops@acme.io>');
      expect(screen.getByRole('switch', { name: 'Implicit TLS' }).getAttribute('aria-checked')).toBe('true');
      // The GET carries no password in any form, so the box is empty and means
      // "keep the stored one".
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
      expect(screen.queryByText(/cannot send password resets/)).toBeNull();
    });

    it('saves a first configuration through the shared review modal', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage();
      await screen.findByRole('heading', { name: 'Email (SMTP)' });

      await user.type(screen.getByLabelText('SMTP host'), 'smtp.acme.io');
      await user.type(screen.getByLabelText('Username'), 'postmaster@acme.io');
      await user.type(screen.getByLabelText('Password'), 'hunter2');
      await user.type(screen.getByLabelText('From address'), 'ops@acme.io');

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('— → smtp.acme.io')).toBeDefined();
      // The password has no before, and its after must never be on screen.
      expect(within(dialog).getByText('Replaced')).toBeDefined();
      expect(within(dialog).queryByText(/hunter2/)).toBeNull();

      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Workspace settings updated');

      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/email'));
      expect(put?.body).toEqual({
        smtp: {
          host: 'smtp.acme.io',
          port: 587,
          user: 'postmaster@acme.io',
          from: 'ops@acme.io',
          secure: false,
          pass: 'hunter2',
        },
      });
      // Untouched sections stay untouched — three section-puts, one Save.
      expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'))).toBe(false);
      expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/security'))).toBe(false);
    });

    it('omits the password when it was not retyped, so a port change keeps the secret', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage(['super-admin'], undefined, undefined, undefined, {
        configured: true,
        host: 'smtp.acme.io',
        port: 587,
        user: 'postmaster@acme.io',
        from: 'ops@acme.io',
        secure: false,
      });
      await screen.findByRole('heading', { name: 'Email (SMTP)' });

      const port = screen.getByLabelText('Port');
      await user.clear(port);
      await user.type(port, '465');
      await user.click(screen.getByRole('switch', { name: 'Implicit TLS' }));

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('587 → 465')).toBeDefined();
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Workspace settings updated');

      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/email'));
      // No `pass` key at all: absent means "keep the stored one", which is what
      // stops a port change from making someone retype a production secret.
      expect(put?.body).toEqual({
        smtp: {
          host: 'smtp.acme.io',
          port: 465,
          user: 'postmaster@acme.io',
          from: 'ops@acme.io',
          secure: true,
        },
      });
    });

    it('refuses a pasted URL, a bad port and a from without an @ before any PUT', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage();
      await screen.findByRole('heading', { name: 'Email (SMTP)' });

      // The exact paste this guard exists for — a scheme and a port in the host
      // box. SMTP is line-oriented, so this is a server-side refusal too.
      await user.type(screen.getByLabelText('SMTP host'), 'smtp://smtp.acme.io:587');
      expect(screen.getByText(/no scheme, port or credentials/)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);

      await user.clear(screen.getByLabelText('SMTP host'));
      await user.type(screen.getByLabelText('SMTP host'), 'smtp.acme.io');
      await user.clear(screen.getByLabelText('Port'));
      await user.type(screen.getByLabelText('Port'), '70000');
      expect(screen.getByText('Between 1 and 65,535.')).toBeDefined();

      await user.clear(screen.getByLabelText('Port'));
      await user.type(screen.getByLabelText('Port'), '587');
      await user.type(screen.getByLabelText('From address'), 'ops-at-acme.io');
      expect(screen.getByText('Enter an email address.')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('mirrors the server rule that a username needs a password', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByRole('heading', { name: 'Email (SMTP)' });

      await user.type(screen.getByLabelText('SMTP host'), 'smtp.acme.io');
      await user.type(screen.getByLabelText('From address'), 'ops@acme.io');
      await user.type(screen.getByLabelText('Username'), 'postmaster');
      expect(screen.getByText('This username needs a password.')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);

      await user.type(screen.getByLabelText('Password'), 'hunter2');
      expect(screen.queryByText('This username needs a password.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(false);
    });

    it('clears a stored password when the username is emptied', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage(['super-admin'], undefined, undefined, undefined, {
        configured: true,
        host: 'smtp.acme.io',
        port: 587,
        user: 'postmaster@acme.io',
        from: 'ops@acme.io',
        secure: false,
      });
      await screen.findByRole('heading', { name: 'Email (SMTP)' });

      // Switching to an unauthenticated relay: an encrypted secret nothing can
      // use any more is one nobody will remember to revoke.
      await user.clear(screen.getByLabelText('Username'));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Workspace settings updated');

      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/email'));
      expect((put?.body as { smtp: { pass: string; user: string } }).smtp.user).toBe('');
      expect((put?.body as { smtp: { pass: string } }).smtp.pass).toBe('');
    });

    it('stages a removal and sends the null the route defines for it', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage(['super-admin'], undefined, undefined, undefined, {
        configured: true,
        host: 'smtp.acme.io',
        port: 587,
        user: '',
        from: 'ops@acme.io',
        secure: false,
      });
      await screen.findByRole('heading', { name: 'Email (SMTP)' });

      await user.click(screen.getByRole('button', { name: 'Remove mail server' }));
      // Staged, like the logo: nothing has left the browser yet.
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Removed')).toBeDefined();
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Workspace settings updated');

      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/email'));
      expect(put?.body).toEqual({ smtp: null });
    });
  });

  it('admins get the super-admin notice, no settings fetch, but keep the danger zone', async () => {
    const { fetchMock } = await renderPage(['admin']);
    expect(
      await screen.findByText('Only a super admin can change workspace identity and security settings.'),
    ).toBeDefined();
    expect(await screen.findByRole('heading', { name: 'Danger zone' })).toBeDefined();
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/v1/settings/workspace'),
    ).toHaveLength(0);
  });

  it('review-then-confirm covers the version chip too', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace settings' });

    await user.click(screen.getByRole('switch', { name: 'Version in the sidebar' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Shown → Hidden')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/branding'));
    expect(put?.body).toEqual({ appName: 'Adminium', showVersion: false });
  });

  it('stages a picked logo and uploads it only on save', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Workspace identity' });

    const input = document.querySelector('[data-testid="branding-logo-input"]');
    await user.upload(
      input as HTMLInputElement,
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'mark.png', { type: 'image/png' }),
    );

    // Nothing has left the browser yet: a half-finished edit must not already
    // be live on every screen of the app.
    const posted = () => calls.some((c) => c.url.startsWith('/api/v1/branding/logo'));
    expect(posted()).toBe(false);
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    // Bytes have no before → after, so the file's own name is the review row.
    expect(within(dialog).getByText('mark.png')).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');
    const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/api/v1/branding/logo'));
    expect(post?.url).toContain('filename=mark.png');
  });

  it('accepts a dropped image anywhere in the logo row', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Workspace identity' });

    const zone = document.querySelector('[data-part="branding-logo-dropzone"]') as HTMLElement;
    // The whole row is the target, not just the preview square — a drop that
    // lands beside a 44px tile navigates the browser to the image instead.
    expect(zone.contains(screen.getByRole('button', { name: 'Upload logo' }))).toBe(true);
    const file = new File([new Uint8Array([0x89, 0x50])], 'dropped.svg', { type: 'image/svg+xml' });
    // jsdom has no drag session and user-event has no drag API, so the drop is
    // fired with the one thing the handler reads off it.
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(within(await screen.findByRole('dialog')).getByText('dropped.svg')).toBeDefined();
  });

  it('offers Remove only once a logo exists, and DELETEs it on save', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage(['super-admin'], undefined, {
      appName: 'Adminium',
      logoUrl: '/api/v1/branding/logo?v=file_1',
      showVersion: true,
    });
    await screen.findByRole('heading', { name: 'Workspace identity' });
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    // A staged logo cannot be typed back, so there is one explicit way out.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Workspace settings updated');
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/v1/branding/logo')).toBe(true);
  });

  it('Undo puts a staged logo back and leaves nothing to save', async () => {
    const user = userEvent.setup();
    await renderPage(['super-admin'], undefined, {
      appName: 'Adminium',
      logoUrl: '/api/v1/branding/logo?v=file_1',
      showVersion: true,
    });
    await screen.findByRole('heading', { name: 'Workspace identity' });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
  });

  it('names itself in the topbar, not in the page body', async () => {
    await renderPage();
    const heading = await screen.findByRole('heading', { name: 'Workspace settings' });
    expect(heading.closest('[data-part="topbar"]')).not.toBeNull();
    // The shell falls back to "Home" for any page that publishes no title, so
    // this is what stops the header contradicting the page under it.
    expect(document.querySelector('main')?.querySelectorAll('h1')).toHaveLength(0);
  });

  it('gathers the cross-links into one card with no trailing divider', async () => {
    await renderPage();
    const card = (await screen.findByRole('button', { name: 'Manage pages' })).closest('.divide-y');
    expect(card).not.toBeNull();
    // Every cross-link is a row of that one card…
    for (const cta of ['Open AI settings', 'Open global defaults', 'Open translations']) {
      expect(screen.getByRole('button', { name: cta }).closest('.divide-y')).toBe(card);
    }
    // …and `divide-y` draws its hairlines as top borders on every row but the
    // first, so the last row can never carry one below it — whichever rows the
    // super-admin gate leaves out.
    expect(card?.className).toContain('divide-y');
  });

  it('routes a plain admin to the page manager', async () => {
    // `/studio/pages` is not in the avatar menu, so this card is its only
    // discoverable entry point — if it stops navigating, the whole surface
    // becomes URL-only. Admin, not super-admin: page management is an Admin+
    // capability and the card must not be hidden behind the super-admin gate
    // the identity form sits behind.
    const user = userEvent.setup();
    const { router } = await renderPage(['admin']);
    await user.click(await screen.findByRole('button', { name: 'Manage pages' }));
    expect(router.state.location.pathname).toBe('/studio/pages');
  });

  it('danger zone: type-to-confirm gating before the DELETE fires', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Danger zone' });

    await user.click(screen.getByRole('button', { name: 'Delete connection' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete connection' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await user.type(within(dialog).getByRole('textbox'), 'Production Postgres');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);

    await screen.findByText('Connection “Production Postgres” deleted');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('/api/v1/connections/conn_1');
    expect(del?.body).toEqual({ confirmName: 'Production Postgres' });
  });

  it('shows the empty danger zone note without connections', async () => {
    await renderPage(['super-admin'], []);
    expect(await screen.findByText('Nothing to delete — no connections yet.')).toBeDefined();
  });
});
