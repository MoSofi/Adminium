// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A SOURCE SAYS ABOUT A COMPANY THAT LIMITS WHAT IS DONE WITH IT.
 *
 *  - NO SALES CONTACT (`noMarketing`): France's register marks a unit that
 *    objected to the reuse of its details for prospecting (or asked not to
 *    be shown), OpenCorporates one restricted for marketing. Such a company
 *    is never added ("This business asked not to be contacted for sales");
 *    its facts may still fill a record somebody already keeps. Before the
 *    first people are kept at a company a register added, the register is
 *    asked again: a company that objected since is refused then too.
 *  - A SOLE TRADER (`natural`): a natural person (France's legal form 1000,
 *    Norway's ENK) counts as a person. While the add-on keeps no people, they
 *    are not added ("A sole trader is a person: turn on People to keep
 *    one"); with people on, only with their address, so they are told at
 *    once as any found person is.
 *  - OFFICERS: names and roles only, and never handed on while people are
 *    off. A birth date or a nationality never reaches the engine at all (the
 *    contract's answer has no field for them).
 */
import type { FoundCompany } from '@adminium/add-on-contracts';

/** Why a found company may not be added. */
export type AddRefusal = 'no-marketing' | 'sole-trader' | 'needs-address';

/** What each refusal says. */
export const ADD_REFUSALS: Readonly<Record<AddRefusal, string>> = {
  'no-marketing': 'This business asked not to be contacted for sales.',
  'sole-trader': 'A sole trader is a person: turn on People to keep one.',
  'needs-address': 'A sole trader is a person: add their e-mail address, so they can be told where their details came from.',
};

/**
 * Why a found company may not be added, or null when it may. `address`:
 * the e-mail address a sole trader is kept with, when one was given.
 */
export function addRefusal(company: Pick<FoundCompany, 'noMarketing' | 'natural'>, peopleOn: boolean, address?: string | null): AddRefusal | null {
  if (company.noMarketing) return 'no-marketing';
  if (company.natural && !peopleOn) return 'sole-trader';
  if (company.natural && (address === undefined || address === null || address.trim() === '')) return 'needs-address';
  return null;
}

/** A found company as it may be handed on: without its officers while people are off. */
export function withOfficersFor<C extends Pick<FoundCompany, 'officers'>>(company: C, peopleOn: boolean): C {
  if (peopleOn || company.officers === undefined) return company;
  const { officers: _officers, ...rest } = company;
  return rest as C;
}
