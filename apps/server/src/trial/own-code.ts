// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Packages from the catalogue only, and a Designer that builds with the
 * manifest alone: what trial mode and the hosted profile keep off, because
 * code a stranger brings would run unsandboxed beside the operator's network.
 *
 * Five questions of `trial/policy.ts` decide it, each one switch:
 *
 *   packageUploads   `POST /add-ons/upload`, `/apps/upload`, `/apps/upload-workspace`
 *   designerUploads  the Designer's site zip, a style of one's own, the Code tab's hand save
 *   designerCode     hooks/, actions/ and the files a build runs, written by anyone; the
 *                    app's tests run; the project's hooks and actions imported at all
 *   ownBuilds        an app's own build command, "Start with an app", the phone app's build
 *   requestPackage   the Designer's request_package
 *
 * Each is refused WHERE THE EFFECT HAPPENS (the upload's staging, the jail's
 * write, the build's run, the loader's import), and again at the door that
 * leads there (the route, the tool), which is where the refusal is worded.
 * A door that is missed still meets the effect's guard.
 *
 * Refused with 403 `OFF_BY_OPERATOR`, `details: { question, reason }`, the
 * one refusal every operator switch answers with (`trial/refuse.ts`).
 *
 * The effect's guards have no Fastify instance to ask: they ask
 * {@link ownCodeAllows}, which answers from the policy of every server this
 * process has running (each `app.ts` boot hands its policy over and takes it
 * back when it closes) AND from the profile the process's own environment
 * asks for, the strictest of them winning. A process started in trial mode
 * is in trial mode however a harness or a second boot built its app, and a
 * second server booted beside a trial one never lifts the trial's guards.
 *
 * What stays: installs from the catalogue or the image's bundle, Save as app's
 * download, and an app the Designer builds from its tables, pages, manifest and
 * client screens, built by the engine's own side build (it bundles the screens,
 * it never runs them).
 */
import { allowsIn, rawProfile, type PolicyAnswer, type PolicyQuestion, type PolicyReason, type TrialPolicy } from './policy.js';
import { OffByOperatorError } from './refuse.js';

/** The questions of this switch. */
export const OWN_CODE_QUESTIONS = ['packageUploads', 'designerUploads', 'designerCode', 'ownBuilds', 'requestPackage'] as const satisfies readonly PolicyQuestion[];
export type OwnCodeQuestion = (typeof OWN_CODE_QUESTIONS)[number];

/** The policies of the servers running in this process, each held until its server closes. */
const running = new Set<Pick<TrialPolicy, 'allows'>>();

/**
 * Hold `policy`, a running server's (`app.ts`), until the function returned
 * is called (the server's close). While held, it answers for this process's
 * guards with every other one held.
 */
export function useOwnCodePolicy(policy: Pick<TrialPolicy, 'allows'>): () => void {
  const held = { allows: (question: PolicyQuestion) => policy.allows(question) };
  running.add(held);
  return () => {
    running.delete(held);
  };
}

/**
 * Whether `question` is allowed in this process: by the policy of every
 * server running in it and by the environment the process started with. Any
 * one that says no decides.
 */
export function ownCodeAllows(question: OwnCodeQuestion): PolicyAnswer {
  for (const policy of running) {
    const answer = policy.allows(question);
    if (!answer.allowed) return answer;
  }
  return allowsIn(rawProfile(process.env), question);
}

/**
 * What a person is told, by question. Fixed words, the same for the page and
 * the API, and neutral about who the operator is.
 */
export const OWN_CODE_MESSAGES: Record<OwnCodeQuestion, string> = {
  packageUploads: 'This server installs add-ons and apps from the catalog only. Its operator has turned uploads off.',
  designerUploads: 'This server’s operator has turned off uploads and hand edits in the Designer. The Designer builds the app with its own tools.',
  designerCode: 'This server’s operator has turned off code the server would run: hooks, actions, the app’s own tests and the files a build runs. The Designer builds with the manifest, pages and screens.',
  ownBuilds: 'This server’s operator has turned off builds of an app’s own, so “Start with an app” and an app’s own build command do not run here.',
  requestPackage: 'This server’s operator has turned off adding packages from npm.',
};

/** 403 `OFF_BY_OPERATOR`: the operator turned this own code off. `details: { question, reason }`. */
export class OwnCodeOffError extends OffByOperatorError {
  override readonly name = 'OwnCodeOffError';

  constructor(question: OwnCodeQuestion, reason: PolicyReason) {
    super(question, reason, OWN_CODE_MESSAGES[question]);
  }
}

/** Throws {@link OwnCodeOffError} when `question` is not allowed in this process. */
export function refuseOwnCode(question: OwnCodeQuestion): void {
  const answer = ownCodeAllows(question);
  if (!answer.allowed) throw new OwnCodeOffError(question, answer.reason ?? 'trial-mode');
}

/**
 * The same refusal as a route's `onRequest` step: it runs before the body is
 * read, so a refused upload is not buffered first. Put after the session
 * check, so a caller who is not signed in is told that instead.
 */
export function refuseOwnCodeHook(question: OwnCodeQuestion): () => Promise<void> {
  return async () => {
    refuseOwnCode(question);
  };
}
