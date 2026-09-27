// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A state reached only by a move marked `undo` is made only by a person who
 * names the state they saw. A door that names none — an email's change once
 * it has gone, a guest's writable value — may never write it: the manifest
 * says so, as it does for a timed move and an effect.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const transfer = (): Doc => JSON.parse(readFileSync(new URL('./fixtures/ticket-transfer.manifest.json', import.meta.url), 'utf8')) as Doc;

describe('a state only an undo reaches', () => {
  it("is never an email's change once it has gone", () => {
    const m = valid();
    tableOf(m, 'projects')['states'] = { column: 'status', initial: 'active', moves: { active: ['paused'], paused: [{ to: 'active', undo: true }] } };
    expect(issuesText(m)).not.toContain('is an undo');
    const producer = ((m['outbox'] as { producers: Doc[] }).producers.find((p) => p['onSent'] !== undefined)!['onSent'] as Doc);
    producer['set'] = { status: 'active' };
    expect(issuesText(m)).toContain('every move of "projects" to "active" is an undo, which only a person makes');
  });

  it("is never a value a guest may write", () => {
    const m = transfer();
    expect(issuesText(m)).toBe('');
    const moves = (tableOf(m, 'tickets')['states'] as { moves: Record<string, unknown[]> }).moves;
    moves['valid'] = [{ to: 'offered', undo: true }, 'checked_in'];
    expect(issuesText(m)).toContain('every move to "offered" is an undo, which only a person makes');
  });
});
