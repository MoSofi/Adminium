// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `sms.manage`: connecting the business's SMS provider, choosing its sender and
 * sending a test text. The key spends the business's money, so only the Super
 * Admin holds it unless it is granted on purpose, and every change needs a
 * signed-in person, never an API key.
 *
 * Until `sms.manage` joins the closed list of system actions,
 * `system:sms:manage` is outside the grammar and `rbac.require` refuses it when
 * the routes are registered: they cannot go live unguarded.
 */
export const SMS_MANAGE_ACTION = 'sms.manage';
export const SMS_MANAGE_PERMISSION = 'system:sms:manage';
/** The entry for the permissions screen's table (`routes/permissions/index.ts`). */
export const SMS_MANAGE_LABEL = { label: 'Set up text messages', category: 'workspace' } as const;
