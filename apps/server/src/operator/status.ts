// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/operator/status`: the totals the server's operator needs to
 * run the instance (how much disk it uses, how much mail and AI it spent, when
 * its owners last signed in), and nothing else. No row of anybody's data, and
 * of a person no more than an audit row holds: when they signed in, and from
 * which address.
 */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { filesRepo, type MetaDb } from '@adminium/meta';

import { SUPER_ADMIN_SLUG } from '../rbac/resolver.js';
import { operatorAiTokensUsed, relayMailSent, type RelayMailCount } from './counters.js';
import type { PublicPagesHold } from './holds.js';

/** How many of the Super Admins' sign-ins are reported. */
export const SIGN_INS_REPORTED = 20;

/** A folder with more entries than this is reported as unmeasured rather than walked for minutes. */
const MAX_ENTRIES = 500_000;

export interface OperatorStatus {
  at: number;
  storage: {
    /** Bytes on disk under the data folder; null when it cannot be measured. */
    dataDir: number | null;
    /** Bytes of the stored files, wherever they are kept. */
    files: number;
    /** Bytes on disk under the project folder; null without one, or when it cannot be measured. */
    projectFolder: number | null;
  };
  emails: RelayMailCount;
  /** The Super Admins' last sign-ins, newest first: when, and from which address. */
  superAdminSignIns: { at: number; ip: string | null }[];
  /** When anybody last signed in; null when nobody has. */
  lastSignInAt: number | null;
  /** Tokens spent on the operator's AI connection; null where this instance does not count them. */
  operatorAiTokens: number | null;
  publicPages: PublicPagesHold;
}

export interface OperatorStatusDeps {
  meta: MetaDb;
  dataDir: string;
  projectRoot: string | null;
  publicPages: () => PublicPagesHold;
  now?: () => number;
}

/** The bytes under `root`, links not followed; null when it is missing, unreadable or too big to walk. */
export async function folderBytes(root: string): Promise<number | null> {
  let total = 0;
  let entries = 0;
  const pending = [root];
  try {
    if (!(await lstat(root)).isDirectory()) return null;
    while (pending.length > 0) {
      const dir = pending.pop()!;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        entries += 1;
        if (entries > MAX_ENTRIES) return null;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) total += (await lstat(path)).size;
      }
    }
  } catch {
    return null;
  }
  return total;
}

export async function operatorStatus(deps: OperatorStatusDeps): Promise<OperatorStatus> {
  const at = (deps.now ?? Date.now)();
  const { db } = deps.meta;
  const [dataDir, projectFolder, usage, emails, operatorAiTokens, signIns, last] = await Promise.all([
    folderBytes(deps.dataDir),
    deps.projectRoot === null ? Promise.resolve(null) : folderBytes(deps.projectRoot),
    filesRepo(deps.meta).usageByDestination(),
    relayMailSent(deps.meta, at),
    operatorAiTokensUsed(deps.meta),
    // A sign-in is the `login` row the sign-in routes write; a Super Admin is whoever holds that role now.
    db
      .selectFrom('adminium_audit_log')
      .select(['createdAt', 'ip'])
      .where('category', '=', 'auth')
      .where('action', '=', 'login')
      .where('actorKind', '=', 'user')
      .where('actorId', 'in', (eb) =>
        eb
          .selectFrom('adminium_user_roles')
          .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
          .select('adminium_user_roles.userId')
          .where('adminium_roles.slug', '=', SUPER_ADMIN_SLUG),
      )
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(SIGN_INS_REPORTED)
      .execute(),
    db.selectFrom('adminium_users').select((eb) => eb.fn.max('lastLoginAt').as('at')).executeTakeFirst(),
  ]);
  return {
    at,
    storage: { dataDir, files: usage.reduce((sum, row) => sum + Number(row.bytes), 0), projectFolder },
    emails,
    superAdminSignIns: signIns.map((row) => ({ at: Number(row.createdAt), ip: row.ip ?? null })),
    lastSignInAt: last?.at === null || last?.at === undefined ? null : Number(last.at),
    operatorAiTokens,
    publicPages: deps.publicPages(),
  };
}
