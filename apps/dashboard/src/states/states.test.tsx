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
    expect(SYSTEM_STATES.forbidden.title).toBe('You don’t have access');
    expect(SYSTEM_STATES.error.body).toContain('Our team has been notified');
    expect(SYSTEM_STATES.offline.banner).toContain("You're offline");
    expect(SYSTEM_STATES['empty-no-sources'].primary?.label).toBe('Connect a database');
    expect(SYSTEM_STATES['read-only'].body).toContain('Viewer access');
  });

  it('adds the new suspended state per §6.1 (402, data-preserved copy)', () => {
    expect(SYSTEM_STATES.suspended.code).toBe('402');
    expect(SYSTEM_STATES.suspended.body).toContain('data is preserved');
    expect(SYSTEM_STATES.suspended.primary?.label).toBe('Contact owner');
    // Free-launch pivot (workplan/17-deferred-monetization.md): suspension is an
    // administrative state, never a billing state — no payment language anywhere.
    expect(JSON.stringify(SYSTEM_STATES.suspended)).not.toMatch(/billing|payment|past due/i);
  });
});

describe('StateHero', () => {
  it('renders code, title, guidance, and both CTAs', () => {
    render(<StateHero spec={SYSTEM_STATES.forbidden} requestId="req_8f2a91cd" />);
    expect(screen.getByText('403')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'You don’t have access' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Request access/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeDefined();
    expect(screen.getByText('req_8f2a91cd')).toBeDefined();
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
