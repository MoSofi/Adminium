/**
 * Zod schemas for the api-keys resource (08-server-api.md §2.16). The full
 * secret appears exactly once — in `apiKeyCreateReply.key` ("Copy it now —
 * you won't be able to see it again.", `designs/API Keys.dc.html`). List and
 * detail replies never carry secret material (CI grep guard §7 item 6).
 */
import { z } from 'zod';

export const apiKeyDto = z.object({
  id: z.string(),
  name: z.string(),
  /** Display fragment, e.g. `adm_sk_4f2a91cd`. */
  prefix: z.string(),
  /** The key acts with this role's permissions (07 §3.7). */
  roleId: z.string(),
  createdBy: z.string().nullable(),
  lastUsedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type ApiKeyDto = z.infer<typeof apiKeyDto>;

export const apiKeyListReply = z.object({ apiKeys: z.array(apiKeyDto) });
export type ApiKeyListReply = z.infer<typeof apiKeyListReply>;

export const apiKeyCreateBody = z.object({
  name: z.string().min(1).max(80),
  /** Scope source: the key acts with this role's grant set (§2.16/§8). */
  roleId: z.string(),
  expiresAt: z.number().int().positive().optional(),
});
export type ApiKeyCreateBody = z.infer<typeof apiKeyCreateBody>;

export const apiKeyCreateReply = z.object({
  apiKey: apiKeyDto,
  /** One-time reveal — never returned by any other route. */
  key: z.string(),
  /** The role's §5.1 grant strings at create time (informational). */
  scopes: z.array(z.string()),
});
export type ApiKeyCreateReply = z.infer<typeof apiKeyCreateReply>;

export const apiKeyIdParams = z.object({ id: z.string() });

export const apiKeyOkReply = z.object({ ok: z.literal(true) });
