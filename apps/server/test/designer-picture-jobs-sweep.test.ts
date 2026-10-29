// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The made pictures' start-up sweep: a job that was running when the server stopped is said to be lost (its
 * pictures stay counted); half-written files go; a picture nobody used goes after a day, one put on a spot or a
 * row waits a week for its Apply.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AiConnections } from '../src/llm/connections.js';
import { createPictureJobs, MADE_KEEP_MS } from '../src/designer/picture-jobs.js';

const SESSION = `ds_${'sweep'.padEnd(24, '0')}`;
const NOW = Date.UTC(2026, 9, 29, 12);
let root = '';

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

function jobs() {
  return createPictureJobs({
    root,
    meta: {} as never,
    settings: {} as never,
    connections: {} as AiConnections,
    networkFeatures: () => true,
    target: () => null,
    emit: () => undefined,
    audit: async () => undefined,
    now: () => NOW,
  });
}

describe('the made pictures’ start-up sweep', () => {
  it('marks a running job lost, takes away half-written files and unused pictures past a day, and keeps pinned ones', () => {
    root = mkdtempSync(join(tmpdir(), 'made-sweep-'));
    const dir = join(root, '.adminium', 'designer', 'sessions', SESSION, 'made');
    mkdirSync(dir, { recursive: true });
    const job = 'job_0000000000000001';
    writeFileSync(join(dir, `${job}.json`), JSON.stringify({ job, sessionId: SESSION, state: 'running', at: NOW - 60_000, lines: [] }));
    writeFileSync(join(dir, 'shelf_0000000000000001.pic_000000000001.png.ab12.tmp'), 'half');
    utimesSync(join(dir, 'shelf_0000000000000001.pic_000000000001.png.ab12.tmp'), new Date(NOW - 120_000), new Date(NOW - 120_000));
    const picture = (id: string, at: number, pinned: boolean): void => {
      writeFileSync(join(dir, `shelf_0000000000000001.${id}.png`), 'png');
      writeFileSync(join(dir, `shelf_0000000000000001.${id}.json`), JSON.stringify({ ext: 'png', sha256: 'x', bytes: 3, at, pinned }));
    };
    picture('pic_000000000002', NOW - MADE_KEEP_MS - 1, false);
    picture('pic_000000000003', NOW - MADE_KEEP_MS - 1, true);
    picture('pic_000000000004', NOW - 1000, false);

    jobs().sweep();

    expect((JSON.parse(readFileSync(join(dir, `${job}.json`), 'utf8')) as { state: string }).state).toBe('lost');
    expect(existsSync(join(dir, 'shelf_0000000000000001.pic_000000000001.png.ab12.tmp'))).toBe(false);
    expect(existsSync(join(dir, 'shelf_0000000000000001.pic_000000000002.png'))).toBe(false);
    expect(existsSync(join(dir, 'shelf_0000000000000001.pic_000000000002.json'))).toBe(false);
    expect(existsSync(join(dir, 'shelf_0000000000000001.pic_000000000003.png'))).toBe(true);
    expect(existsSync(join(dir, 'shelf_0000000000000001.pic_000000000004.png'))).toBe(true);
  });

  it('finds a made picture only by ids of its own shape, and never reads outside the session’s folder', () => {
    root = mkdtempSync(join(tmpdir(), 'made-sweep-'));
    const made = jobs();
    expect(made.found(SESSION, '../../etc', 'pic_000000000001')).toBeNull();
    expect(made.file('ds_../../x', 'shelf_0000000000000001', 'pic_000000000001')).toBeNull();
    expect(made.list('not-a-session')).toEqual({ pictures: [], running: null });
  });
});
