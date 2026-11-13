// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's mail rules (`trial-relay.ts`) as the environment sets them, for
 * `compose.ts`: the operator's relay, the address it pins, the operator's name
 * and report link, the caps and the trial's end. Null on any server whose
 * profile lets the user keep their own mail server (an ordinary or a hosted one).
 */
import type { Env } from '../config/env.js';
import { decryptSecret } from '../config/secrets.js';
import type { TrialPolicy } from '../trial/policy.js';
import { emailEnvelopeKey } from './send.js';
import {
  relaySmtpOf,
  TRIAL_BOUNCES_PER_DAY,
  TRIAL_COMPLAINTS_PER_DAY,
  TRIAL_RECIPIENTS_PER_DAY,
  TRIAL_SYSTEM_EMAILS_PER_DAY,
  TRIAL_SYSTEM_EMAILS_PER_HOUR,
  type TrialMailSetup,
  type TrialRelay,
} from './trial-relay.js';

type MailEnv = Pick<
  Env,
  'ADMINIUM_SECRET' | 'ADMINIUM_TRIAL_SMTP_URL' | 'ADMINIUM_TRIAL_MAIL_FROM' | 'ADMINIUM_TRIAL_MAIL_REPORT_URL' | 'ADMINIUM_OPERATOR_NAME' | 'ADMINIUM_PUBLIC_ORIGIN' | 'ADMINIUM_TRIAL_ENDS_AT'
>;

/** The relay as the environment names it; null when the operator set none (then a trial sends no mail). */
export function trialRelayOf(env: MailEnv): TrialRelay | null {
  const url = env.ADMINIUM_TRIAL_SMTP_URL;
  const address = env.ADMINIUM_TRIAL_MAIL_FROM;
  if (url === undefined || address === undefined) return null;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return {
    smtp: relaySmtpOf(url, address),
    address,
    operatorName: env.ADMINIUM_OPERATOR_NAME ?? domain,
    reportUrl: env.ADMINIUM_TRIAL_MAIL_REPORT_URL ?? `mailto:abuse@${domain}`,
    origin: env.ADMINIUM_PUBLIC_ORIGIN ?? null,
  };
}

export function trialMailSetupOf(env: MailEnv, policy: Pick<TrialPolicy, 'allows' | 'limits'>, now?: () => number): TrialMailSetup | null {
  if (policy.allows('ownSmtp').allowed) return null;
  const key = emailEnvelopeKey(env.ADMINIUM_SECRET);
  const endsAt = env.ADMINIUM_TRIAL_ENDS_AT === undefined ? null : Date.parse(env.ADMINIUM_TRIAL_ENDS_AT);
  return {
    relay: trialRelayOf(env),
    caps: {
      perDay: policy.limits?.emailsPerDay ?? 50,
      perHour: policy.limits?.emailsPerHour ?? 20,
      recipientsPerDay: TRIAL_RECIPIENTS_PER_DAY,
      systemPerDay: TRIAL_SYSTEM_EMAILS_PER_DAY,
      systemPerHour: TRIAL_SYSTEM_EMAILS_PER_HOUR,
      bouncesPerDay: TRIAL_BOUNCES_PER_DAY,
      complaintsPerDay: TRIAL_COMPLAINTS_PER_DAY,
    },
    endsAt: endsAt === null || Number.isNaN(endsAt) ? null : endsAt,
    openEnvelope: (sealed) => {
      const envelope = JSON.parse(decryptSecret(sealed, key)) as { to?: unknown; subject?: unknown; account?: unknown };
      return { to: String(envelope.to ?? ''), subject: String(envelope.subject ?? ''), account: envelope.account === true };
    },
    ...(now === undefined ? {} : { now }),
  };
}
