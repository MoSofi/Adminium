// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE ENGINE TELLS APART AMONG AN ADD-ON'S SOURCES.
 *
 *  - A REGISTER ({@link isRegister}) is a source that finds or fills in
 *    companies (`gives: find` or `fill`) and is not the website reader. A
 *    source that gives people (`people`) is not one, whatever else it gives.
 *  - A FREE REGISTER ({@link freeRegisters}) is a register the owner pays
 *    nothing for (`paid` not set): the only kind the automation step may ask,
 *    since nobody is there to watch what it spends.
 *  - A register's COUNTRY ({@link registerCountry}) is its hosts' country
 *    code (`.uk` is Great Britain, `.fr` France, `.no` Norway): a source
 *    names no country of its own, and a service that spans countries (a
 *    `.com`, an `.io`) has none.
 *  - The LANGUAGES a found person may be told in, beyond the install's and
 *    English ({@link sourceLanguages}): the language of each switched-on
 *    register's country, where it is one of the eight. The People switch
 *    needs a purpose in each before people may be kept (`people.ts`).
 */
import { SOURCE_READS_WEBSITE } from '@adminium/add-on-contracts';
import type { AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import { readSourcesState, sourceStateOf, sourcesOf, type LeadSourceEntry } from '../lead-sources/state.js';
import { COUNTRY_LANGUAGE, type TellLanguage } from './tell-words.js';

/** Whether a source finds or fills in companies, and is neither the website nor a people source. */
export function isRegister(entry: LeadSourceEntry): boolean {
  if (entry.reads === SOURCE_READS_WEBSITE) return false;
  if (entry.gives.includes('people')) return false;
  return entry.gives.includes('find') || entry.gives.includes('fill');
}

/** The registers that cost the owner nothing and fill in a company: what a rule may ask. */
export function freeRegisters(manifest: Pick<AddOnManifest, 'addOn'>): LeadSourceEntry[] {
  return sourcesOf(manifest as { addOn: { sources?: LeadSourceEntry[] } }).filter((entry) => isRegister(entry) && entry.paid !== true && entry.gives.includes('fill'));
}

/** A country code top-level domain that is not the country's ISO code. */
const TLD_COUNTRY: Readonly<Record<string, string>> = { uk: 'GB' };

/** The country a register serves, from its hosts' country code; null when they name none, or several. */
export function registerCountry(entry: LeadSourceEntry): string | null {
  if (!isRegister(entry)) return null;
  const countries = new Set<string>();
  for (const host of entry.hosts ?? []) {
    const tld = host.toLowerCase().replace(/\.$/, '').split('.').at(-1) ?? '';
    if (!/^[a-z]{2}$/.test(tld)) continue;
    countries.add(TLD_COUNTRY[tld] ?? tld.toUpperCase());
  }
  return countries.size === 1 ? [...countries][0]! : null;
}

/** The languages, beyond the install's and English, that each switched-on register's country writes in. */
export async function sourceLanguages(meta: MetaDb, install: { installId: string; manifest: Pick<AddOnManifest, 'addOn'> }): Promise<TellLanguage[]> {
  const state = await readSourcesState(meta, install.installId);
  const out = new Set<TellLanguage>();
  for (const entry of sourcesOf(install.manifest as { addOn: { sources?: LeadSourceEntry[] } })) {
    if (!sourceStateOf(state, entry).on) continue;
    const country = registerCountry(entry);
    const language = country === null ? undefined : COUNTRY_LANGUAGE[country];
    if (language !== undefined) out.add(language);
  }
  return [...out].sort();
}
