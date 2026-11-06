// SPDX-License-Identifier: AGPL-3.0-only
/** Request and reply shapes of the workspaces routes. Every reply field is declared: the serializer strips the rest. */
import { z } from 'zod';

export const workspaceIdParams = z.object({ id: z.string().min(1).max(36) });
export const workspaceConnectionParams = z.object({ id: z.string().min(1).max(36) });

export const workspaceSenderDto = z.object({
  name: z.string().nullable(),
  from: z.string().nullable(),
  replyTo: z.string().nullable(),
  postal: z.string().nullable(),
});

/**
 * A workspace's sender, as the form sends it. The From address is what makes
 * a sender: name, reply-to and postal address go with it, each optional (a
 * blank one is none). Clearing the sender is `DELETE /workspaces/:id/sender`.
 */
export const workspaceSenderBody = z.object({
  // eslint-disable-next-line no-control-regex -- a header must hold no control character
  name: z.string().trim().max(120).regex(/^[^\u0000-\u001f\u007f]*$/, 'must not contain line breaks or control characters').nullable().optional(),
  from: z.string().trim().min(3).max(320),
  replyTo: z.string().trim().max(254).nullable().optional(),
  postal: z.string().trim().max(300).nullable().optional(),
});

/** Where the server can send from: the form says which domains a From may be at. */
export const workspaceSenderDomainsReply = z.object({
  /** Any address at these domains. */
  domains: z.array(z.string()),
  /** These addresses one by one (the server's own senders, one at a public mailbox included). */
  addresses: z.array(z.string()),
});

export const workspaceDto = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  /** Its databases, by connection id. Empty: a workspace whose last database went. */
  connectionIds: z.array(z.string()),
  sender: workspaceSenderDto,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type WorkspaceDto = z.infer<typeof workspaceDto>;

export const workspaceListReply = z.object({
  workspaces: z.array(workspaceDto),
  /** The databases in no workspace, once one exists; null while none does. */
  otherDatabases: z.array(z.string()).nullable(),
  /** How the menu shows them, for everyone on the server. */
  view: z.enum(['one', 'all']),
});

export const workspaceCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  connectionIds: z.array(z.string().min(1).max(36)).max(500).optional(),
});

export const workspaceCreateReply = z.object({
  workspace: workspaceDto,
  /** This is the server's first workspace: everyone's menu groups by workspace from now on. */
  first: z.boolean(),
});

export const workspaceRenameBody = z.object({ name: z.string().trim().min(1).max(80) });

export const workspaceOrderBody = z.object({ ids: z.array(z.string().min(1).max(36)).min(1).max(500) });

export const connectionWorkspacesBody = z.object({ workspaceIds: z.array(z.string().min(1).max(36)).max(500) });
export const connectionWorkspacesReply = z.object({
  connectionId: z.string(),
  workspaceIds: z.array(z.string()),
  added: z.array(z.string()),
  removed: z.array(z.string()),
});

/** An email template, report layout or invoice layout this workspace is the only "Shown in" of. */
export const shownOnlyInDto = z.object({ kind: z.enum(['email-template', 'report', 'invoice']), itemId: z.string(), name: z.string() });

export const workspaceDeletePlanReply = z.object({
  workspace: workspaceDto,
  /** Its databases stay; they leave this workspace. */
  connectionIds: z.array(z.string()),
  /** Items shown in this workspace alone: after the delete they are shown in none (never widened to all). */
  shownOnlyIn: z.array(shownOnlyInDto),
  /** This is the last workspace: the menu goes back to how it was before workspaces. */
  last: z.boolean(),
});

export const workspaceDeleteReply = z.object({ deleted: z.literal(true), shownOnlyIn: z.array(shownOnlyInDto), last: z.boolean() });
