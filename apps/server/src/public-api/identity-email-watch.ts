// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When the desk changes the address of a person who signs in by an emailed
 * link, the address that could sign them in is no longer theirs. So, on the
 * write's record event:
 *
 *  - every session of that person ends (their next request finds them again);
 *  - every link still open to the OLD address, on the keys that sign people in
 *    through that table, is taken back;
 *  - the OLD address is told, as a person's own change of address tells it —
 *    the one way its owner hears that mail for them now goes elsewhere.
 *
 * A change made by the person themselves never reaches here: such an address
 * is not writable through the public API. A deleted person's sessions end
 * too. An update whose event carries no before-image says nothing about what
 * changed, and is left alone (see the lane report: imports and undo emit no
 * record event at all).
 */
import type { FastifyInstance } from 'fastify';
import {
  publicChallengesRepo,
  publicKeysRepo,
  publicScopesRepo,
  publicSessionsRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import type { OutboxDispatcher, RecordWriteEvent } from '../crud/after-record-write.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { emailChangedLines, translatorForLocale } from '../email/builtins.js';
import { EMAIL_CHANGED_TEMPLATE_KEY, enqueueEmail } from '../email/send.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { appContact } from '../outbox/sender.js';
import { hashAddress, maskAddress, plausibleAddress, subjectOf } from './claim-code.js';
import type { PublicViews } from './runtime.js';
import { linkSubject } from './sign-in-link.js';

/** One table people sign in through by link, on one connection. */
interface WatchedIdentity {
  tableId: string;
  email: string;
  /** The column a session is pinned to. */
  column: string;
  /** The column the notice greets the person by. */
  name: string | undefined;
  keyIds: string[];
  appKey: string | null;
}

const CACHE_MS = 15_000;

export interface IdentityEmailWatchDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  views: PublicViews;
  addressSecret: Buffer;
  logger?: { warn(obj: Record<string, unknown>, msg?: string): void } | undefined;
  now?: () => number;
}

export interface IdentityEmailWatch {
  onRecordEvent(event: RecordWriteEvent): Promise<void>;
}

const normal = (value: unknown): string | null => (typeof value === 'string' ? value.trim().toLowerCase() : null);

export function createIdentityEmailWatch(deps: IdentityEmailWatchDeps): IdentityEmailWatch {
  const cache = new Map<string, { at: number; identities: WatchedIdentity[] }>();

  /** The link identities of a connection, from its live scopes, read at most every fifteen seconds. */
  async function identitiesOf(connectionId: string, view: SnapshotView): Promise<WatchedIdentity[]> {
    const now = deps.now?.() ?? Date.now();
    const hit = cache.get(connectionId);
    if (hit !== undefined && now - hit.at < CACHE_MS) return hit.identities;
    const identities: WatchedIdentity[] = [];
    const keys = publicKeysRepo(deps.meta);
    for (const scope of await publicScopesRepo(deps.meta).listByConnection(connectionId)) {
      let document: { claim?: { strategy?: string; ref?: string; email?: string }; resources?: { ref?: string; table?: string; expose?: string[]; claim?: { column?: string } }[] };
      try {
        document = JSON.parse(scope.document) as typeof document;
      } catch {
        continue;
      }
      const claim = document.claim;
      if (claim?.strategy !== 'email-link' || claim.email === undefined) continue;
      const resource = document.resources?.find((r) => r.ref === claim.ref);
      const column = resource?.claim?.column;
      if (resource?.table === undefined || column === undefined) continue;
      let tableId: string;
      try {
        tableId = view.table(resource.table).id;
      } catch {
        continue;
      }
      const live = (await keys.listByScope(scope.id)).filter((key) => key.revokedAt === null);
      if (live.length === 0) continue;
      identities.push({
        tableId,
        email: claim.email,
        column,
        name: resource.expose?.[0],
        keyIds: live.map((key) => key.id),
        appKey: live.find((key) => (key.managedBy ?? null) !== null)?.managedBy ?? null,
      });
    }
    cache.set(connectionId, { at: now, identities });
    return identities;
  }

  async function tellOldAddress(identity: WatchedIdentity, connectionId: string, before: Record<string, unknown>, newAddress: string | null): Promise<void> {
    const old = before[identity.email];
    if (!plausibleAddress(old)) return;
    const locale = await recipientLocale(deps.meta, null);
    const contact = identity.appKey === null ? null : await appContact(deps.meta, deps.manager, identity.appKey, connectionId);
    const appName = contact?.name ?? String((await settingsRepo(deps.meta).get('branding.appName')) ?? 'Adminium');
    const lines = emailChangedLines((await translatorForLocale(deps.meta, locale)).t, contact?.phone ?? null);
    await enqueueEmail(
      { meta: deps.meta, ...(deps.logger === undefined ? {} : { logger: deps.logger as never }) },
      {
        to: old.trim(),
        templateKey: EMAIL_CHANGED_TEMPLATE_KEY,
        locale,
        always: true,
        vars: {
          appName,
          name: identity.name === undefined ? '' : String(before[identity.name] ?? ''),
          newEmail: newAddress === null ? '' : maskAddress(newAddress),
          ...lines,
        },
      },
    );
  }

  return {
    async onRecordEvent(event) {
      try {
        if (event.action === 'create' || event.before === null) return;
        const before = event.before;
        const view = await deps.views.viewFor(event.connectionId);
        if (view === null) return;
        for (const identity of await identitiesOf(event.connectionId, view)) {
          if (identity.tableId !== event.table.id) continue;
          const after = event.after;
          const moved = after === null || normal(before[identity.email]) !== normal(after[identity.email]);
          if (!moved) continue;
          const key = before[identity.column];
          if (key === null || key === undefined) continue;
          await publicSessionsRepo(deps.meta).removeBySubject(subjectOf(event.connectionId, identity.tableId, identity.column, key));
          const old = before[identity.email];
          if (typeof old === 'string') {
            await publicChallengesRepo(deps.meta).revokeLinks(linkSubject(hashAddress(deps.addressSecret, old)), identity.keyIds, deps.now?.() ?? Date.now());
          }
          if (after !== null) {
            const next = after[identity.email];
            await tellOldAddress(identity, event.connectionId, before, typeof next === 'string' ? next : null);
          }
        }
      } catch (error) {
        // Never the write's failure: the write has happened. Said, loudly, to the operator.
        deps.logger?.warn({ err: error, connectionId: event.connectionId, table: event.table.id }, 'a sign-in address change could not end its sessions');
      }
    },
  };
}

const LISTENING = Symbol.for('adminium.public.identity-email-watch');

/**
 * Hear every record event. The server has two consumers of them — the app
 * outbox and the rule engine — and no list to join, so this rides the outbox
 * dispatcher: its own call first, unchanged, then the watch. Once per server.
 */
export function listenToRecordEvents(app: FastifyInstance, watch: IdentityEmailWatch): boolean {
  if (!app.hasDecorator('outbox')) return false;
  const outbox = app.outbox as OutboxDispatcher & { [LISTENING]?: true };
  if (outbox[LISTENING] === true) return true;
  const inner = outbox.onRecordEvent.bind(outbox);
  outbox.onRecordEvent = async (event) => {
    await inner(event);
    await watch.onRecordEvent(event);
  };
  outbox[LISTENING] = true;
  return true;
}
