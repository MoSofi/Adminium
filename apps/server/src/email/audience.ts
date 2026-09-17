// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who a campaign goes to: the workspace's users — every active account, or
 * the holders of the chosen roles — minus the ones who opted out of the
 * `email.campaign` kind.
 *
 * ONE resolver for the preview count and the run itself, so *1,240 recipients ·
 * 12 opted out* on the Send modal is the same arithmetic the job performs a
 * moment later — resolved at RUN START, never snapshotted (D11): a person who
 * opts out between clicking Send and the scheduled time is not mailed.
 *
 * Suspended accounts are never recipients (`notify` skips them for the same
 * reason); invited-but-never-activated accounts are not either — they have no
 * relationship with the workspace yet, and a campaign is not an invitation.
 *
 * Customer-table audiences are the next wave (O1 →); this module is where
 * `{ kind: 'table' }` joins.
 */
import {
  notificationPrefsRepo,
  rolesRepo,
  usersRepo,
  type EmailAudience,
  type MetaDb,
  type User,
} from '@adminium/meta';

/** The notification-prefs kind a person switches off to stop receiving campaigns (D11). */
export const EMAIL_CAMPAIGN_PREF_KIND = 'email.campaign';

/** The in-app notice the creator gets when a run finishes (D11). */
export const EMAIL_CAMPAIGN_SENT_KIND = 'email.campaign.sent';

const PAGE = 500;

export interface ResolvedAudience {
  /** Active users with an address whose `email.campaign` channel is on. */
  recipients: User[];
  /** Active users excluded by their preference. */
  skipped: number;
  /** `recipients.length + skipped`. */
  total: number;
}

async function allActiveUsers(meta: MetaDb, roleId?: string): Promise<User[]> {
  const users = usersRepo(meta);
  const out: User[] = [];
  let cursor: { createdAt: number; id: string } | undefined;
  for (;;) {
    const page = await users.list({
      status: 'active',
      ...(roleId === undefined ? {} : { roleId }),
      ...(cursor === undefined ? {} : { cursor }),
      limit: PAGE,
    });
    out.push(...page);
    const last = page.at(-1);
    if (page.length < PAGE || last === undefined) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
  return out;
}

/** Resolve an audience against the workspace right now. Unknown role ids contribute nobody. */
export async function resolveCampaignAudience(meta: MetaDb, audience: EmailAudience): Promise<ResolvedAudience> {
  const byId = new Map<string, User>();
  const roleIds = audience.roleIds ?? [];
  if (roleIds.length === 0) {
    for (const user of await allActiveUsers(meta)) byId.set(user.id, user);
  } else {
    const roles = rolesRepo(meta);
    for (const roleId of new Set(roleIds)) {
      if ((await roles.findById(roleId)) === null) continue;
      for (const user of await allActiveUsers(meta, roleId)) byId.set(user.id, user);
    }
  }

  const prefs = notificationPrefsRepo(meta);
  const recipients: User[] = [];
  let skipped = 0;
  for (const user of byId.values()) {
    if (user.email.trim() === '') continue;
    const channels = await prefs.channelsFor(user.id, EMAIL_CAMPAIGN_PREF_KIND);
    if (!channels.email) {
      skipped += 1;
      continue;
    }
    recipients.push(user);
  }
  // Stable order: oldest account first, the way the directory lists them.
  recipients.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { recipients, skipped, total: recipients.length + skipped };
}

/** The per-recipient substitutions of a workspace-user send (D11, D18). */
export function recipientVars(user: Pick<User, 'name' | 'email'>, appName: string): Record<string, string> {
  const name = user.name.trim();
  return {
    appName,
    name,
    first_name: name.split(/\s+/)[0] ?? '',
    email: user.email,
  };
}
