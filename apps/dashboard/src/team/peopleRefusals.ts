// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A change to a person, a team or a role refused for reaching above the person
 * asking, said in their language. Anything else keeps the server's message.
 */
import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';

export function peopleFailureText(error: Error): string {
  const reason = error instanceof ApiError && error.status === 403 ? (error.details as { reason?: unknown } | null | undefined)?.reason : undefined;
  switch (reason) {
    case 'role-above-you':
      return t('team.roles.refused', 'You can give only roles whose permissions you hold yourself, and cannot take away a role that holds more than you do.');
    case 'account-above-you':
      return t('team.roles.accountRefused', 'This person holds permissions you do not, so you cannot change their email or send them a new sign-in link.');
    case 'reach-above-you':
      return t('team.roles.reachRefused', 'This would bring rows within your own reach that your role does not give you.');
    default:
      return error.message;
  }
}
