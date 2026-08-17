// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 11-T20 — the crash / WAL-durability check (11-electron.md §9).
 *
 * "All local databases run WAL mode; killing the app mid-write loses no
 * committed data (crash test in E2E)."
 *
 * The deterministic, meaningful form of "loses no committed data" is: a write
 * that COMMITTED (the mutation returned success and a read echoed it) survives a
 * hard, ungraceful termination. So this commits a marker, confirms it, SIGKILLs
 * the app (no `before-quit`, so no graceful `wal_checkpoint(TRUNCATE)` — the
 * `.sqlite` files are left with their live `-wal` sidecars), then relaunches the
 * SAME data directory and asserts the marker is still there. The relaunch
 * reaching the app shell at all is itself a durability assertion: it means both
 * `meta.db` and the source `.sqlite` reopened cleanly and WAL recovery ran.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { editEmployeeTitle, readEmployeeTitle } from './helpers/api.js';
import { completeFirstRunDemo, waitForAppShell } from './helpers/flow.js';
import { closeDesktop, killDesktop, launchDesktop, waitForAppWindow } from './helpers/launch.js';

test.describe('desktop app: crash / WAL durability (§9)', () => {
  test('a committed write survives a hard kill and reopens cleanly', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'adminium-desktop-e2e-'));
    try {
      // 1) First launch: first-run → demo → app shell.
      const first = await launchDesktop({ userDataDir });
      const firstPage = await waitForAppWindow(first.app);
      await completeFirstRunDemo(firstPage);

      // 2) Commit a write and CONFIRM it committed (PATCH succeeded, read echoes).
      const marker = `WAL ${randomBytes(4).toString('hex')}`;
      const record = await editEmployeeTitle(firstPage, marker);
      expect(await readEmployeeTitle(firstPage, record), 'the write must commit before the kill').toBe(
        marker,
      );

      // 3) Kill — SIGKILL, no graceful shutdown, no checkpoint on the way out.
      killDesktop(first.app);
      await first.app.close().catch(() => undefined); // detach Playwright from the dead process.
      // Let the OS reap the (now parent-less) utilityProcess before a second
      // server opens the same files — a real crash's writers are gone by the time
      // the app is relaunched, and this keeps the test from racing that teardown.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      });

      // 4) Relaunch the SAME data dir. config.json now exists (not first-run), so
      // §5 single-user auto-login lands straight in the app — which only happens
      // if meta.db and the source .sqlite both reopened after the unclean kill.
      const second = await launchDesktop({ userDataDir });
      const secondPage = await waitForAppWindow(second.app);
      await waitForAppShell(secondPage);

      // 5) The committed value survived: WAL recovered it.
      expect(
        await readEmployeeTitle(secondPage, record),
        'a committed write must survive a crash (WAL durability, §9)',
      ).toBe(marker);

      await closeDesktop(second.app);
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
