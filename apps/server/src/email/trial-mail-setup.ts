// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's mail rules (`trial-relay.ts`) as the environment sets them, for
 * `compose.ts`: the operator's relay, the address it pins, the operator's name
 * and report link, the caps and the trial's end. Null on any server whose
 * profile lets the user keep their own mail server (an ordinary or a hosted one).
 *
 * On such a server, {@link operatorMailSetupOf} is the operator's mail server
 * (`ADMINIUM_OPERATOR_SMTP_URL`), the same rules' `operator` kind: used only
 * while the installation has no mail server of its own.
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

type OperatorMailEnv = Pick<
  Env,
  'ADMINIUM_SECRET' | 'ADMINIUM_OPERATOR_SMTP_URL' | 'ADMINIUM_OPERATOR_MAIL_FROM' | 'ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY' | 'ADMINIUM_OPERATOR_NAME' | 'ADMINIUM_PUBLIC_ORIGIN'
>;

/** Opens a queued message's sealed envelope, for the counts. */
function envelopeOpener(secret: string): TrialMailSetup['openEnvelope'] {
  const key = emailEnvelopeKey(secret);
  return (sealed) => {
    const envelope = JSON.parse(decryptSecret(sealed, key)) as { to?: unknown; subject?: unknown; account?: unknown; from?: unknown };
    return {
      to: String(envelope.to ?? ''),
      subject: String(envelope.subject ?? ''),
      account: envelope.account === true,
      ...(typeof envelope.from === 'string' ? { from: envelope.from } : {}),
    };
  };
}

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
    openEnvelope: envelopeOpener(env.ADMINIUM_SECRET),
    ...(now === undefined ? {} : { now }),
  };
}

/**
 * The operator's mail server for an installation that is not a trial, or null when the operator set none. Used
 * only while the installation has no mail server of its own (`trial-relay.ts`, `relayInUse`): the From is pinned
 * as on a trial and the mail people write is capped a day; account mail, recipients and bounces are not limited.
 * Trial mode refuses its variables at boot (`config/env.ts`), and `compose.ts` asks for it only after
 * {@link trialMailSetupOf} answered null.
 */
export function operatorMailSetupOf(env: OperatorMailEnv, now?: () => number): TrialMailSetup | null {
  const url = env.ADMINIUM_OPERATOR_SMTP_URL;
  const address = env.ADMINIUM_OPERATOR_MAIL_FROM;
  if (url === undefined || address === undefined) return null;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return {
    kind: 'operator',
    relay: {
      smtp: relaySmtpOf(url, address),
      address,
      operatorName: env.ADMINIUM_OPERATOR_NAME ?? domain,
      // No footer goes on the operator's server's mail, so nothing reads it.
      reportUrl: `mailto:abuse@${domain}`,
      origin: env.ADMINIUM_PUBLIC_ORIGIN ?? null,
    },
    caps: {
      perDay: env.ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY,
      perHour: Infinity,
      recipientsPerDay: Infinity,
      systemPerDay: Infinity,
      systemPerHour: Infinity,
      bouncesPerDay: Infinity,
      complaintsPerDay: Infinity,
    },
    endsAt: null,
    openEnvelope: envelopeOpener(env.ADMINIUM_SECRET),
    ...(now === undefined ? {} : { now }),
  };
}
