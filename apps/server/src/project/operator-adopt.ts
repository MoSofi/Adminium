// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial made before operator projects, opened as one.
 *
 * Its `ADMINIUM_SOURCE_URL` seed (`connections/seed.ts`) made a connection with
 * no project key. An operator project's config names that same database as
 * `main`, and a project sync makes a connection for every key that has none: a
 * second `main`, with a second set of pages. So before the first sync the seeded
 * connection is adopted as `main` (`setProjectKey`, as `project/adopt.ts` does
 * for `adminium new`), and the sync finds it.
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';

export async function adoptSeededMain(manager: ConnectionManager, meta: MetaDb, at: number = Date.now()): Promise<'adopted' | 'already' | 'none'> {
  if ((await manager.connections.findByProjectKey('main')) !== null) return 'already';
  const seededId = await settingsRepo(meta).get('system.sourceConnectionId');
  const seeded = seededId === null ? null : await manager.connections.findById(seededId);
  if (seeded === null || seeded.projectKey !== null) return 'none';
  await manager.connections.setProjectKey(seeded.id, 'main', at);
  return 'adopted';
}
