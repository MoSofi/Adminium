// SPDX-License-Identifier: AGPL-3.0-only
/**
 * System states (09-generated-app.md §6.1): the map covers all 12 ids with
 * the comp copy, and StateHero renders code/glyph/copy/CTAs/diagnostics.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SYSTEM_STATE_IDS, stateIdForError } from '../app/query.js';
import { ApiError } from '../app/api.js';
import { StateHero } from './StateHero.js';
import { SYSTEM_STATES } from './stateMap.js';

describe('SYSTEM_STATES map', () => {
  it('covers all 12 state ids', () => {
    expect(Object.keys(SYSTEM_STATES).sort()).toEqual([...SYSTEM_STATE_IDS].sort());
    expect(SYSTEM_STATE_IDS).toHaveLength(12);
  });

  it('keeps the comp copy for the 11 designed states', () => {
    expect(SYSTEM_STATES.forbidden.title.en).toBe('You don’t have access');
    expect(SYSTEM_STATES.error.body.en).toContain('the server log');
    expect(SYSTEM_STATES.offline.banner?.en).toContain("You're offline");
    expect(SYSTEM_STATES['empty-no-sources'].primary?.label.en).toBe('Connect a database');
    expect(SYSTEM_STATES['read-only'].body.en).toContain('Viewer access');
  });

  it('routes every user-visible string through a bundle key', () => {
    // The whole point of the Msg shape: these 12 states are the 404/500/offline
    // pages, so English leaking here is English on the worst possible screen.
    const msgs = Object.values(SYSTEM_STATES).flatMap((spec) => [
      spec.title,
      spec.body,
      ...(spec.primary === undefined ? [] : [spec.primary.label]),
      ...(spec.secondary === undefined ? [] : [spec.secondary]),
      ...(spec.banner === undefined ? [] : [spec.banner]),
      ...(spec.diagnostics === undefined ? [] : [spec.diagnostics.status, spec.diagnostics.hint]),
    ]);
    expect(msgs).toHaveLength(47);
    for (const m of msgs) {
      expect(m.key).toMatch(/^states\.[a-zA-Z]+\.(title|body|primary|secondary|banner|diag\.(status|hint))$/);
      expect(m.en.length).toBeGreaterThan(0);
    }
    // Keys must be unique — a duplicate would make two states share one string.
    expect(new Set(msgs.map((m) => m.key)).size).toBe(msgs.length);
  });

  it('promises nothing a self-hosted instance cannot keep', () => {
    // The 500 used to read "An unexpected error occurred on our end. Our team
    // has been notified." Both halves were false: v1 self-hosts, so "our end"
    // is the reader's own machine, and nothing was notified — it implied the
    // failure had been phoned home, when it had gone to the server log.
    expect(SYSTEM_STATES.error.body.en).not.toMatch(/our (team|end)|been notified/i);
    expect(SYSTEM_STATES.error.body.en).toMatch(/server log/i);
  });

  it('adds the new suspended state per §6.1 (402, data-preserved copy)', () => {
    expect(SYSTEM_STATES.suspended.code).toBe('402');
    expect(SYSTEM_STATES.suspended.body.en).toContain('data is preserved');
    expect(SYSTEM_STATES.suspended.primary?.label.en).toBe('Contact owner');
    // Free-launch pivot (17-deferred-monetization.md): suspension is an
    // administrative state, never a billing state — no payment language anywhere.
    expect(JSON.stringify(SYSTEM_STATES.suspended)).not.toMatch(/billing|payment|past due/i);
  });
});

describe('StateHero', () => {
  it('renders code, title, guidance, and both CTAs', () => {
    render(
      <StateHero
        spec={SYSTEM_STATES.forbidden}
        requestId="req_8f2a91cd"
        onPrimary={() => undefined}
        onSecondary={() => undefined}
      />,
    );
    expect(screen.getByText('403')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'You don’t have access' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Request access/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeDefined();
    expect(screen.getByText('req_8f2a91cd')).toBeDefined();
  });

  it('omits a CTA that has nothing wired to it', () => {
    // THE REGRESSION. The label alone used to be enough to render a button, so
    // five states shipped one that swallowed the click: 'Status page' on the
    // 500, 'Edit connection' on db-unreachable, 'Contact support' on the 404,
    // 'Import sample data' on the empty state, 'Go back' on suspended.
    render(<StateHero spec={SYSTEM_STATES.forbidden} />);
    expect(screen.queryByRole('button', { name: /Request access/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });

  it('offers no status page on the 500 — a self-hosted instance has none', () => {
    render(<StateHero spec={SYSTEM_STATES.error} onPrimary={() => undefined} />);
    expect(screen.getByRole('button', { name: /Try again/ })).toBeDefined();
    expect(screen.queryByText(/Status page/)).toBeNull();
  });

  it('says what the request id IS, and lets you take it', () => {
    // A bare `req_9f2a…` under "something went wrong" told the reader nothing:
    // not what it was, not what to do with it, and it could only be recovered
    // by retyping it off a screenshot.
    render(<StateHero spec={SYSTEM_STATES.error} requestId="req_573fd2ae" />);
    const id = screen.getByText('req_573fd2ae');
    expect(id).toBeDefined();
    expect(screen.getByText(/Reference/)).toBeDefined();
    expect(screen.getByText(/your server log records the same id/)).toBeDefined();
    // One click takes the whole token — the path that works with no clipboard.
    expect(id.className).toContain('select-all');
  });

  it('offers the copy button only where a clipboard exists', () => {
    // `navigator.clipboard` is undefined outside a secure context, so a
    // self-host on `http://192.168.1.50:4600` has none. There the button took
    // the click, failed silently and never flipped to "Copied" — a dead button
    // on the screen whose whole job is explaining a failure.
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const set = (value: unknown) =>
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
    try {
      set({ writeText: () => Promise.resolve() });
      const withClipboard = render(<StateHero spec={SYSTEM_STATES.error} requestId="req_1" />);
      expect(screen.getByRole('button', { name: /Copy reference/ })).toBeDefined();
      withClipboard.unmount();

      set(undefined);
      render(<StateHero spec={SYSTEM_STATES.error} requestId="req_1" />);
      expect(screen.queryByRole('button', { name: /Copy reference/ })).toBeNull();
      // …but the reference itself is still there and still selectable.
      expect(screen.getByText('req_1').className).toContain('select-all');
    } finally {
      if (original === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
      else Object.defineProperty(navigator, 'clipboard', original);
    }
  });

  it('shows no reference block when the failure carried no id', () => {
    render(<StateHero spec={SYSTEM_STATES.error} />);
    expect(screen.queryByText(/Reference/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy reference/ })).toBeNull();
  });

  it('renders the diagnostics readout for db-unreachable', () => {
    render(<StateHero spec={SYSTEM_STATES['db-unreachable']} />);
    expect(screen.getByText('Diagnostics')).toBeDefined();
    expect(screen.getByText('db.acme.internal:5432')).toBeDefined();
    expect(screen.getByText(/allowlist 52\.9\.14\.2/)).toBeDefined();
  });

  it('renders the fixed offline banner', () => {
    render(<StateHero spec={SYSTEM_STATES.offline} />);
    expect(screen.getByRole('status')).toBeDefined();
  });
});

describe('stateIdForError mapping (§2.3 errorComponent)', () => {
  const err = (status: number, code: string) => new ApiError(status, code, 'boom', 'req_x');

  it('maps canonical statuses to their states', () => {
    expect(stateIdForError(err(401, 'SESSION_EXPIRED'))).toBe('expired-session');
    expect(stateIdForError(err(402, 'INSTANCE_SUSPENDED'))).toBe('suspended');
    expect(stateIdForError(err(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(stateIdForError(err(404, 'NOT_FOUND'))).toBe('not-found');
    expect(stateIdForError(err(429, 'RATE_LIMITED'))).toBe('rate-limited');
    expect(stateIdForError(err(503, 'MAINTENANCE'))).toBe('maintenance');
    expect(stateIdForError(err(503, 'DB_UNREACHABLE'))).toBe('db-unreachable');
    expect(stateIdForError(err(500, 'INTERNAL'))).toBe('error');
  });

  it('maps network failures to offline', () => {
    expect(stateIdForError(new TypeError('fetch failed'))).toBe('offline');
  });
});
