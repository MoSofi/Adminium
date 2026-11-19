// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DEMO SOURCE SEAM, for end-to-end tests of a lead source add-on on a
 * running server: `ADMINIUM_LEAD_SOURCE_DEMO` names add-on keys (comma
 * separated) whose sources are answered by the contract's demo transport
 * (`@adminium/add-on-contracts/testing/lead-source`: made-up companies and
 * people only, no call out) in place of the add-on's own code.
 *
 * Everything else about a call holds as it is (`call.ts`): the install, the
 * owner's switch, the key, the add-on's server half loaded from a package
 * this server vouches for, the caps and the Stop. Only the code that would
 * reach the registers is swapped, so a test drives the add-on's real pages
 * without the network.
 *
 * IT IS ON ONLY ON A SERVER THAT SAYS IT IS FOR TESTS OR DEVELOPMENT, twice
 * over. Not being labelled production is not enough: an npm install run by
 * systemd and the desktop app set no `NODE_ENV` at all, and a variable left
 * in an env file there would write made-up companies into a real CRM.
 *  - the boot refuses the variable unless `NODE_ENV` is `test` or
 *    `development`, and on a trial or hosted server whatever it says
 *    (`config/env.ts`, {@link leadSourceDemoProblem}), and warns while it is
 *    on (`compose.ts`);
 *  - and it is read at each call only while that holds
 *    ({@link leadSourceDemoKeys}), so a server composed without that boot
 *    check (a host embedding the server) still never uses it.
 */
import type { CreateLeadSource } from '@adminium/add-on-contracts';

export const LEAD_SOURCE_DEMO_ENV = 'ADMINIUM_LEAD_SOURCE_DEMO';

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);

type RawEnv = Readonly<Record<string, string | undefined>>;

/** The `NODE_ENV` values that say a server is for tests or development. */
const TEST_ENVS = new Set(['test', 'development']);

/** Why the seam may not be on for this server: anything but a test or development one, a trial, a hosted server. */
function forbidden(env: RawEnv): string | null {
  if (TRUTHY.has((env['ADMINIUM_TRIAL_MODE'] ?? '').trim().toLowerCase())) return 'this is a trial';
  if (TRUTHY.has((env['ADMINIUM_HOSTED_MODE'] ?? '').trim().toLowerCase())) return 'this is a hosted server';
  const nodeEnv = (env['NODE_ENV'] ?? '').trim().toLowerCase();
  if (nodeEnv === 'production') return 'NODE_ENV is production';
  if (!TEST_ENVS.has(nodeEnv)) return nodeEnv === '' ? 'NODE_ENV is not set to test or development' : `NODE_ENV is ${nodeEnv}, not test or development`;
  return null;
}

/** The add-on keys the variable names. */
function namedKeys(env: RawEnv): string[] {
  return (env[LEAD_SOURCE_DEMO_ENV] ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}

/** The boot's refusal: the variable set where it may never be on; null where it may be (or is not set). */
export function leadSourceDemoProblem(env: RawEnv): string | null {
  if (namedKeys(env).length === 0) return null;
  const why = forbidden(env);
  return why === null ? null : `cannot be set: ${why}. It answers lead sources with made-up companies, for tests only. Remove it.`;
}

/** The add-on keys whose sources the demo answers now: none but on a test or development server. */
export function leadSourceDemoKeys(env: RawEnv = process.env): string[] {
  return forbidden(env) === null ? namedKeys(env) : [];
}

/** The demo's factory for an add-on the seam names; null for any other (and always in production). */
export async function leadSourceDemoFor(addOnKey: string, env: RawEnv = process.env): Promise<CreateLeadSource | null> {
  if (!leadSourceDemoKeys(env).includes(addOnKey)) return null;
  // Loaded only when the seam is on: the demo's made-up rows are never part of a production process.
  const { createDemoLeadSource } = await import('@adminium/add-on-contracts/testing/lead-source');
  return createDemoLeadSource;
}

/**
 * Whether an address is one of the demo's made-up people while the seam is
 * on. Their addresses sit at `.example` domains, which the outbox never
 * writes to (`outbox/sender.ts` `reservedAddress`); with the seam on, a found
 * person's tell mail to one of them goes to the test's own mail catcher, so
 * a test can follow its Object link. Never in production: the seam is off
 * there, and so is this.
 */
export async function isDemoPersonAddress(address: string, env: RawEnv = process.env): Promise<boolean> {
  if (leadSourceDemoKeys(env).length === 0) return false;
  const { DEMO_LEAD_PEOPLE } = await import('@adminium/add-on-contracts/testing/lead-source');
  const wanted = address.trim().toLowerCase();
  return Object.values(DEMO_LEAD_PEOPLE).some((people) => people.some((person) => person.email.toLowerCase() === wanted));
}
