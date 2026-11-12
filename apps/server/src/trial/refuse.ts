// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "The operator has switched this off": an action a trial or hosted
 * installation does not offer, refused where it would take effect.
 *
 * A setting the operator decides is a lock (`operator-lock.ts`, 409
 * `SET_BY_OPERATOR`). An ACTION the profile switches off (testing a storage
 * destination, saving a webhook step, a SQLite source) is this: 403
 * `OFF_BY_OPERATOR`, `details: { question, reason }`, so the dashboard can say
 * which thing is off and why in the person's language, never a silent no.
 *
 *   refuseUnlessAllowed(app.trialPolicy, 'storageDestinations', 'Storage destinations are …');
 */
import { AppError } from '../errors.js';
import { ORDINARY_POLICY, type PolicyQuestion, type PolicyReason, type TrialPolicy } from './policy.js';

/** 403: the server's operator switched this off for this installation. */
export class OffByOperatorError extends AppError {
  override readonly name = 'OffByOperatorError';

  constructor(
    readonly question: PolicyQuestion,
    readonly reason: PolicyReason,
    message: string,
  ) {
    super(403, 'OFF_BY_OPERATOR', message, { question, reason });
  }
}

/** Throws {@link OffByOperatorError} when the policy answers no to `question`. `message` says what is off, in English. */
export function refuseUnlessAllowed(policy: Pick<TrialPolicy, 'allows'>, question: PolicyQuestion, message: string): void {
  const answer = policy.allows(question);
  if (!answer.allowed) throw new OffByOperatorError(question, answer.reason ?? 'trial-mode', message);
}

/** The policy a server was built with; an ordinary server's for a harness that registers routes on a bare instance. */
export function policyOf(app: { trialPolicy?: TrialPolicy | undefined }): Pick<TrialPolicy, 'allows'> {
  return app.trialPolicy ?? ORDINARY_POLICY;
}

/**
 * Whether the Designer may call outside services (picture search, Figma):
 * only where this server calls outside at all (`ADMINIUM_NETWORK_FEATURES`)
 * and the profile allows it. Asked at each call, so it holds as the server runs.
 */
export function designerCallsOut(networkFeatures: boolean, policy: Pick<TrialPolicy, 'allows'>): boolean {
  return networkFeatures && policy.allows('designerNetwork').allowed;
}
