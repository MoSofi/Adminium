// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace's mail sender, over `/api/v1/workspaces/sender-domains` and
 * `/api/v1/workspaces/:id/sender` (`apps/server/src/routes/workspaces/`).
 *
 * Shapes mirror the server's Zod replies (`routes/workspaces/schema.ts`):
 * change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { ApiError, api } from '../../app/api.js';

/** A workspace's sender: every field null is the server's sender. */
export interface WorkspaceSender {
  name: string | null;
  from: string | null;
  replyTo: string | null;
  postal: string | null;
}

/** The parts of a workspace the sender sheet reads and the server sends back. */
export interface SenderWorkspace {
  id: string;
  name: string;
  sender: WorkspaceSender;
}

/** Where the server can send from (`workspaceSenderDomainsReply`). */
export interface SendingDomains {
  /** Any address at these domains. */
  domains: string[];
  /** These addresses one by one. */
  addresses: string[];
}

/** What the form sends (`workspaceSenderBody`). */
export interface SenderDraft {
  name: string;
  from: string;
  replyTo: string;
  postal: string;
}

export const SENDING_DOMAINS_KEY = ['workspaces', 'sender-domains'] as const;

export const sendingDomainsQuery = () =>
  queryOptions({
    queryKey: SENDING_DOMAINS_KEY,
    queryFn: () => api.get<SendingDomains>('/api/v1/workspaces/sender-domains'),
    staleTime: 30_000,
  });

export const senderApi = {
  save: (workspaceId: string, draft: SenderDraft) =>
    api.put<SenderWorkspace>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sender`, {
      name: draft.name.trim() === '' ? null : draft.name.trim(),
      from: draft.from.trim(),
      replyTo: draft.replyTo.trim() === '' ? null : draft.replyTo.trim(),
      postal: draft.postal.trim() === '' ? null : draft.postal.trim(),
    }),
  clear: (workspaceId: string) => api.delete<SenderWorkspace>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sender`),
};

/** One plain address with a dotted domain: what a From and a reply-to must be (the server's `PLAIN_DOTTED`). */
const PLAIN = /^[^\s@,;:<>"()[\]\\]+@[^\s@,;:<>"()[\]\\]+\.[^\s@,;:<>"()[\]\\]+$/;

export function isPlainAddress(value: string): boolean {
  return PLAIN.test(value.trim());
}

/** Whether the server can send from `address` (the server's `maySendFrom`, which the save asks again). */
export function maySendFrom(address: string, sending: SendingDomains): boolean {
  const bare = address.trim().toLowerCase();
  if (!isPlainAddress(bare)) return false;
  if (sending.addresses.includes(bare)) return true;
  // A public mailbox's domain is never in `domains` (the server leaves it out): only its own address is.
  return sending.domains.includes(bare.slice(bare.lastIndexOf('@') + 1));
}

/** The accepted places, as one list: every domain, then each address not already at one of them. */
export function acceptedList(sending: SendingDomains): string[] {
  return [...sending.domains, ...sending.addresses.filter((address) => !sending.domains.some((domain) => address.endsWith(`@${domain}`)))];
}

/** Why the server refused a save, as the form words it. */
export type SenderRefusal =
  | { field: 'from'; code: 'not-a-sending-domain'; accepted: string[] }
  | { field: 'from'; code: 'no-mail' }
  | { field: 'from'; code: 'not-an-address' }
  | { field: 'replyTo'; code: 'not-an-address' };

/** A 422 from the sender route, read as a refusal the form can word; null for anything else. */
export function refusalOf(error: unknown): SenderRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const details = (error.details ?? {}) as { field?: unknown; code?: unknown; domains?: unknown; addresses?: unknown };
  if (details.field === 'replyTo') return { field: 'replyTo', code: 'not-an-address' };
  if (details.code === 'no-mail') return { field: 'from', code: 'no-mail' };
  if (details.code === 'not-a-sending-domain') {
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []);
    return { field: 'from', code: 'not-a-sending-domain', accepted: acceptedList({ domains: strings(details.domains), addresses: strings(details.addresses) }) };
  }
  return { field: 'from', code: 'not-an-address' };
}

/** What the form would refuse before it asks the server: the same rule, said the same way. */
export function checkDraft(draft: SenderDraft, sending: SendingDomains | undefined): SenderRefusal | null {
  if (!isPlainAddress(draft.from)) return { field: 'from', code: 'not-an-address' };
  if (sending !== undefined) {
    const accepted = acceptedList(sending);
    if (accepted.length === 0) return { field: 'from', code: 'no-mail' };
    if (!maySendFrom(draft.from, sending)) return { field: 'from', code: 'not-a-sending-domain', accepted };
  }
  if (draft.replyTo.trim() !== '' && !isPlainAddress(draft.replyTo)) return { field: 'replyTo', code: 'not-an-address' };
  return null;
}
